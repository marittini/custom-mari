// Mari Kit translation for one chat: presets for incoming/outgoing text, glossary, speech notes and world notes,
// written into the chat's own translation prompts (the Engine's translator reads those). "원래대로" restores
// the chat's own prompts. The AI scan reads the chat's cards and messages once and proposes entries.

import { h, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { topBar, toast, errorBox } from "../lib/ui.js";

function parseGlossary(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [pair, ...notes] = line.split(" # ");
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    const source = pair.slice(0, at).trim();
    const target = pair.slice(at + 1).trim();
    if (source && target) out.push({ source, target, notes: notes.join(" # ").trim() });
  }
  return out;
}
const formatGlossary = (rows) =>
  (rows ?? []).map((e) => `${e.source} = ${e.target}${e.notes ? ` # ${e.notes}` : ""}`).join("\n");

export function translationScreen({ mount, args, back }) {
  const chatId = args[0];
  let alive = true;
  const body = h(
    "div",
    { class: "scroll", style: { paddingBottom: "28px" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  mount.append(topBar({ back: () => back("convos"), title: "번역" }), body);

  async function load() {
    try {
      const [presets, state] = await Promise.all([
        api.get("/mari-kit/translation/presets"),
        api.get(`/mari-kit/translation/${encodeURIComponent(chatId)}`),
      ]);
      if (alive) draw(presets, state);
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  }

  function draw(presets, { room, status }) {
    const options = presets.presets.map((p) => [p.id, p.name]);
    const sel = (value) =>
      h(
        "select",
        { class: "inp" },
        options.map(([v, t]) => h("option", { value: v, selected: value === v }, t)),
      );
    const incoming = sel(room.incomingPresetId);
    const outgoing = sel(room.outgoingPresetId);
    const glossary = h("textarea", {
      class: "inp",
      rows: 6,
      placeholder: "원어 = 번역 # 메모",
      style: { resize: "vertical", fontSize: "13px", lineHeight: "1.6" },
    });
    glossary.value = formatGlossary(room.glossary);
    const speech = h("textarea", {
      class: "inp",
      rows: 4,
      placeholder: "캐릭터별 말투",
      style: { resize: "vertical", fontSize: "13px" },
    });
    speech.value = room.speech || "";
    const world = h("textarea", {
      class: "inp",
      rows: 4,
      placeholder: "세계관·고유명사 메모",
      style: { resize: "vertical", fontSize: "13px" },
    });
    world.value = room.world || "";
    const scan = (kind, target) => async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "읽는 중…";
      try {
        const res = await api.post(`/mari-kit/translation/${encodeURIComponent(chatId)}/scan`, { kind });
        if (kind === "glossary") {
          const known = new Set(parseGlossary(target.value).map((r) => r.source));
          const added = (res.entries || []).filter((r) => !known.has(r.source));
          target.value = [target.value.trim(), formatGlossary(added)].filter(Boolean).join("\n");
          toast(`${added.length}개 추가 (모델 호출 1번)`);
        } else {
          target.value = [target.value.trim(), String(res.text || "").trim()].filter(Boolean).join("\n\n");
          toast("채웠어요 (모델 호출 1번)");
        }
      } catch (error) {
        toast(`읽지 못했어요: ${error.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = "AI로 찾기";
      }
    };
    const scanBtn = (kind, target) =>
      h("button", { type: "button", class: "chip", onClick: scan(kind, target) }, "AI로 찾기");
    const label = (title, extra) =>
      h(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
        h("span", null, title),
        extra,
      );
    const apply = async () => {
      try {
        const res = await api.put(`/mari-kit/translation/${encodeURIComponent(chatId)}`, {
          incomingPresetId: incoming.value,
          outgoingPresetId: outgoing.value,
          glossary: parseGlossary(glossary.value),
          speech: speech.value,
          world: world.value,
        });
        toast("이 채팅의 번역 지침에 적용했어요");
        draw(presets, res);
      } catch (error) {
        toast(`적용하지 못했어요: ${error.message}`);
      }
    };
    const restore = async () => {
      try {
        draw(presets, await api.post(`/mari-kit/translation/${encodeURIComponent(chatId)}/restore`));
        toast("원래 지침으로 되돌렸어요");
      } catch (error) {
        toast(error.message);
      }
    };
    const len = (side) => `${status[side]?.length ?? 0} / ${status.limit}자`;
    setChildren(
      body,
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "20px", padding: "16px 0 0" } },
        h(
          "div",
          { class: "hint", style: { padding: "0 20px" } },
          `${status.provider}${status.targetLanguage ? ` → ${status.targetLanguage}` : ""}${status.applied ? " · 적용됨" : ""}${status.editedSinceApply ? " · 적용 뒤 직접 고침" : ""}`,
        ),
        h(
          "label",
          { class: "fld" },
          label("받는 글 (AI 답 → 내 언어)", h("span", { class: "hint" }, len("incoming"))),
          incoming,
        ),
        h(
          "label",
          { class: "fld" },
          label("보내는 글 (내 글 → AI 언어)", h("span", { class: "hint" }, len("outgoing"))),
          outgoing,
        ),
        h("div", { class: "fld" }, label("단어장", scanBtn("glossary", glossary)), glossary),
        h("div", { class: "fld" }, label("말투", scanBtn("speech", speech)), speech),
        h("div", { class: "fld" }, label("세계 메모", scanBtn("world", world)), world),
        h(
          "div",
          { style: { display: "flex", justifyContent: "flex-end", gap: "8px", padding: "0 20px" } },
          status.applied ? h("button", { type: "button", class: "pill", onClick: restore }, "원래대로") : null,
          h("button", { type: "button", class: "pill main", onClick: apply }, "적용"),
        ),
      ),
    );
  }

  load();
  return { dispose: () => (alive = false) };
}
