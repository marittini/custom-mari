// A prompt preset's choice blocks, the Engine's choice window (ChoiceSelectionModal): each question with its options;
// the given choice first, then the preset's default, then the first option (a random one when the block says so);
// multi-select blocks pick any number. "이 프리셋의 기본값으로도 저장" also saves them as the preset's defaultChoices.
// The preset's full record (~27KB with its sections) is read only when this opens. Used by chat settings (saved on
// the chat) and the scene setup (kept for that scene only).

import { h, icon, I, setChildren } from "./h.js";
import { api } from "./api.js";
import { sheet } from "./ui.js";

/** Returned when the preset has no choice blocks (nothing to ask). */
export const NO_CHOICES = Symbol("no choices");

const parse = (v, fallback) => {
  if (typeof v !== "string") return v ?? fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};
const truthy = (v) => v === true || v === "true";
const sw = (on) => h("span", { class: on ? "sw on" : "sw" }, h("span"));

/**
 * Resolves the chosen { variableName: value | [values] }, null when closed, or NO_CHOICES.
 * title(presetName) → the sheet's heading; ok: the confirm label; onEdit: shows 프리셋 편집 (the Engine's editor).
 */
export async function pickPresetChoices({ presetId, existing = {}, title = (n) => n, ok = "저장", onEdit = null }) {
  const full = await api.get(`/prompts/${encodeURIComponent(presetId)}/full`);
  const blocks = (full?.choiceBlocks || []).map((cb) => {
    const options = (parse(cb.options, []) || []).filter((o) => o && typeof o.value === "string");
    if ((cb.optionSort ?? cb.option_sort) === "alphabetical")
      options.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    return {
      name: cb.variableName ?? cb.variable_name ?? "",
      question: cb.question || "선택",
      options,
      multi: truthy(cb.multiSelect ?? cb.multi_select),
      random: truthy(cb.randomPick ?? cb.random_pick),
    };
  });
  if (!blocks.length) return NO_CHOICES;
  const defaults = parse(full.preset?.defaultChoices ?? full.preset?.default_choices, {}) || {};
  const valid = (b, v) => {
    const values = new Set(b.options.map((o) => o.value));
    const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
    return b.multi ? list.filter((x, i) => values.has(x) && list.indexOf(x) === i) : list.find((x) => values.has(x));
  };
  const picks = {};
  for (const b of blocks) {
    const fallback = b.multi
      ? []
      : b.random && b.options.length
        ? b.options[Math.floor(Math.random() * b.options.length)].value
        : b.options[0]?.value;
    picks[b.name] =
      existing[b.name] !== undefined
        ? (valid(b, existing[b.name]) ?? fallback)
        : defaults[b.name] !== undefined && !(b.random && !b.multi)
          ? (valid(b, defaults[b.name]) ?? fallback)
          : fallback;
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      s.close();
      resolve(v);
    };
    let asDefault = false;
    const body = h("div", { style: { overflowY: "auto", minHeight: "0", padding: "4px 0 20px" } });
    const s = sheet(body, { label: "프리셋 선택지", onClose: () => finish(null) });
    const paint = () =>
      setChildren(
        body,
        h(
          "div",
          { style: { padding: "8px 20px 4px", fontSize: "15px", fontWeight: "600" } },
          title(full.preset?.name || "프리셋"),
        ),
        blocks.map((b) =>
          h(
            "div",
            { style: { padding: "12px 20px 4px" } },
            h(
              "div",
              { class: "hint", style: { marginBottom: "8px" } },
              b.question,
              b.multi ? " · 여럿 고르기" : b.random ? " · 처음엔 무작위" : "",
            ),
            h(
              "div",
              { class: "chips" },
              b.options.map((o) => {
                const on = b.multi ? picks[b.name].includes(o.value) : picks[b.name] === o.value;
                return h(
                  "button",
                  {
                    type: "button",
                    class: on ? "chip on" : "chip",
                    "aria-pressed": on ? "true" : "false",
                    title: o.value.length > 80 ? `${o.value.slice(0, 200)}…` : o.value,
                    onClick: () => {
                      picks[b.name] = b.multi
                        ? on
                          ? picks[b.name].filter((x) => x !== o.value)
                          : [...picks[b.name], o.value]
                        : o.value;
                      paint();
                    },
                  },
                  o.label || o.value.slice(0, 24),
                );
              }),
            ),
          ),
        ),
        h(
          "button",
          {
            type: "button",
            class: "r",
            role: "switch",
            "aria-checked": asDefault ? "true" : "false",
            style: { marginTop: "12px" },
            onClick: () => {
              asDefault = !asDefault;
              paint();
            },
          },
          h("span", { class: "ic" }, icon(I.list)),
          h("span", null, "이 프리셋의 기본값으로도 저장"),
          sw(asDefault),
        ),
        h(
          "div",
          { style: { padding: "16px 20px 0", display: "flex", justifyContent: "flex-end", gap: "8px" } },
          onEdit
            ? h("button", { type: "button", class: "pill", onClick: () => (finish(null), onEdit()) }, "프리셋 편집")
            : null,
          h(
            "button",
            {
              type: "button",
              class: "pill main",
              onClick: async () => {
                if (asDefault)
                  await api
                    .patch(`/prompts/${encodeURIComponent(presetId)}`, { defaultChoices: picks })
                    .catch(() => {});
                finish(picks);
              },
            },
            ok,
          ),
        ),
      );
    paint();
  });
}
