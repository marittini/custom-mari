// The shell's editor frame (character and persona editors): one scrolling page of sections with a sticky row of
// section chips, fields that edit a draft copy of the record, a save bar that counts changed fields, and the
// Engine's rule of saving on leave (its useEditorLeaveSave): changes are written when the screen closes.
//
//   const ed = createEditor({ mount, title, label, back: () => back("…"), record, save, more });
//   ed.render([ ed.section("info", "정보", "설명 한 줄", ed.text("data.name", "이름"), …), … ]);
//
// Paths are dotted ("data.extensions.backstory"). save({ draft, changed }) writes and returns the saved record
// (the editor then treats it as the new original). Every field reads and writes the draft only.

import { h, icon, I, setChildren } from "./h.js";
import { pageHead, toast, sheet } from "./ui.js";

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
export const getPath = (obj, path) =>
  path.split(".").reduce((o, k) => (o != null && typeof o === "object" ? o[k] : undefined), obj);
export function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Rough token count, the way Mari Kit's memory estimates it (Korean runs about 1.6 characters a token). */
export function tokensOf(text) {
  let ascii = 0;
  let other = 0;
  for (const ch of String(text ?? "")) ch.charCodeAt(0) < 128 ? (ascii += 1) : (other += 1);
  return Math.ceil(ascii / 4 + other / 1.6);
}

export function createEditor({ mount, title, label, back, record, save, more = null }) {
  let orig = clone(record);
  let draft = clone(record);
  const paths = new Set(); // every path a field edits
  let saving = null;
  let disposed = false;
  const syncers = []; // put server values back into text boxes after a save (unless being typed in)

  const status = h("span", { class: "ed-status", "aria-live": "polite" });
  const saveBtn = h("button", { type: "button", class: "pill main", onClick: () => doSave() }, "저장");
  const bar = h("div", { class: "ed-bar" }, status, saveBtn);
  const chips = h("nav", { class: "ed-chips", "aria-label": "섹션" });
  const body = h("div", { class: "scroll ed-body" });
  const head = pageHead(title, {
    label,
    back,
    actions: more
      ? [
          h(
            "button",
            { type: "button", class: "ib", "aria-label": "더보기", onClick: (e) => (e.stopPropagation(), more()) },
            icon("M5 12h.01M12 12h.01M19 12h.01", 22, 2.4),
          ),
        ]
      : [],
  });
  mount.append(head, chips, body, bar);

  const changed = () => [...paths].filter((p) => !same(getPath(draft, p), getPath(orig, p)));
  function refresh() {
    const n = changed().length;
    status.textContent = saving ? "저장 중…" : n ? `바뀐 칸 ${n}개` : "모두 저장됨";
    saveBtn.disabled = !n || !!saving;
    bar.classList.toggle("dirty", n > 0);
  }

  async function doSave({ quiet = false } = {}) {
    const list = changed();
    if (!list.length) return true;
    if (saving) return saving;
    saving = (async () => {
      refresh();
      try {
        const sent = clone(draft);
        const saved = await save({ draft: clone(draft), changed: list });
        // The server's values win (it may bump the version, trim, normalize), except where the user typed
        // something new while the save was on its way.
        const fresh = clone(saved ?? sent);
        for (const p of paths)
          if (!same(getPath(draft, p), getPath(sent, p))) setPath(fresh, p, clone(getPath(draft, p)));
        orig = clone(saved ?? draft);
        draft = fresh;
        for (const sync of syncers) sync();
        if (!quiet) toast("저장했어요");
        return true;
      } catch (error) {
        toast(`저장하지 못했어요: ${error.message}`);
        return false;
      } finally {
        saving = null;
        if (!disposed) refresh();
      }
    })();
    return saving;
  }

  // ── fields ──────────────────────────
  const fieldId = (path) => `ed-${path.replace(/[^a-z0-9]+/gi, "-")}`;
  function frame(path, labelText, control, { hint, side } = {}) {
    return h(
      "div",
      { class: "ed-field" },
      h("div", { class: "ed-label" }, h("label", { for: fieldId(path) }, labelText), side || null),
      control,
      hint ? h("p", { class: "ed-hint" }, hint) : null,
    );
  }
  function bind(path, read = (v) => v ?? "") {
    paths.add(path);
    return read(getPath(draft, path));
  }
  const put = (path, value) => {
    setPath(draft, path, value);
    refresh();
  };

  /** One line of text. */
  function text(path, labelText, { placeholder = "", hint, max = 500, trim = true } = {}) {
    const input = h("input", {
      id: fieldId(path),
      class: "inp ed-inp",
      type: "text",
      value: bind(path),
      placeholder,
      maxlength: max,
      onInput: (e) => put(path, e.target.value),
      onBlur: (e) =>
        trim && e.target.value !== e.target.value.trim() && put(path, (e.target.value = e.target.value.trim())),
    });
    syncers.push(() => document.activeElement !== input && (input.value = getPath(draft, path) ?? ""));
    return frame(path, labelText, input, { hint });
  }

  /**
   * Long text with a character and token count. vars: names offered as {{name}} chips that insert at the cursor.
   * ai: async () => text — a draft written by the Engine's AI, offered in a sheet (replace · add below · drop).
   */
  function long(path, labelText, { rows = 6, placeholder = "", hint, vars = [], ai = null } = {}) {
    const count = h("span", { class: "ed-count" });
    const area = h("textarea", {
      id: fieldId(path),
      class: "inp ed-area",
      rows,
      placeholder,
      onInput: (e) => {
        put(path, e.target.value);
        counted();
      },
    });
    area.value = bind(path);
    syncers.push(() => {
      if (document.activeElement === area) return;
      area.value = getPath(draft, path) ?? "";
      counted();
    });
    const counted = () => {
      const v = area.value;
      count.textContent = v
        ? `${v.length.toLocaleString("ko-KR")}자 · 약 ${tokensOf(v).toLocaleString("ko-KR")}토큰`
        : "비어 있음";
    };
    counted();
    const insert = (snippet) => {
      const at = area.selectionStart ?? area.value.length;
      area.value = area.value.slice(0, at) + snippet + area.value.slice(area.selectionEnd ?? at);
      area.focus();
      area.selectionStart = area.selectionEnd = at + snippet.length;
      put(path, area.value);
      counted();
    };
    const aiBtn = ai
      ? h(
          "button",
          {
            type: "button",
            class: "ed-mini",
            onClick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              btn.textContent = "쓰는 중…";
              try {
                const draftText = String((await ai()) || "").trim();
                if (!draftText) return toast("초안이 비어 있어요");
                aiSheet(labelText, draftText, (mode) => {
                  area.value =
                    mode === "add" && area.value.trim() ? `${area.value.trimEnd()}\n\n${draftText}` : draftText;
                  put(path, area.value);
                  counted();
                });
              } catch (error) {
                toast(`초안을 못 만들었어요: ${error.message}`);
              } finally {
                btn.disabled = false;
                btn.textContent = "✦ AI 초안";
              }
            },
          },
          "✦ AI 초안",
        )
      : null;
    return frame(
      path,
      labelText,
      h(
        "div",
        { class: "ed-longwrap" },
        area,
        h(
          "div",
          { class: "ed-under" },
          count,
          vars.length
            ? h(
                "span",
                { class: "ed-vars" },
                vars.map((v) =>
                  h("button", { type: "button", class: "ed-var", onClick: () => insert(`{{${v}}}`) }, `{{${v}}}`),
                ),
              )
            : null,
        ),
      ),
      { hint, side: aiBtn },
    );
  }

  function aiSheet(labelText, textOut, apply) {
    const s = sheet(
      h(
        "div",
        { class: "ed-sheet" },
        h("b", { class: "ed-sheet-t" }, `${labelText} · AI 초안`),
        h("div", { class: "ed-draft" }, textOut),
        h(
          "div",
          { class: "ed-actions" },
          h("button", { type: "button", class: "pill", onClick: () => s.close() }, "버리기"),
          h("button", { type: "button", class: "pill", onClick: () => (s.close(), apply("add")) }, "아래에 덧붙이기"),
          h(
            "button",
            { type: "button", class: "pill main", onClick: () => (s.close(), apply("replace")) },
            "이걸로 바꾸기",
          ),
        ),
      ),
      { label: "AI 초안" },
    );
  }

  /** On/off switch. */
  function toggle(path, labelText, { hint, def = false } = {}) {
    const on = () => (getPath(draft, path) ?? def) === true;
    bind(path);
    const btn = h("button", {
      id: fieldId(path),
      type: "button",
      class: "ed-switch",
      role: "switch",
      "aria-checked": on() ? "true" : "false",
      onClick: () => {
        put(path, !on());
        btn.setAttribute("aria-checked", on() ? "true" : "false");
        knob.className = on() ? "sw on" : "sw";
      },
    });
    const knob = h("span", { class: on() ? "sw on" : "sw" }, h("span"));
    btn.append(h("span", { class: "ed-switch-t" }, labelText, hint ? h("small", null, hint) : null), knob);
    return h("div", { class: "ed-field" }, btn);
  }

  /** A choice: chips when short (≤4), a dropdown otherwise. options: [[value, text]]. */
  function choice(path, labelText, options, { hint, def } = {}) {
    const cur = () => getPath(draft, path) ?? def;
    bind(path);
    if (options.length <= 4) {
      const row = h("div", { class: "ed-chiprow", role: "radiogroup", "aria-label": labelText });
      const draw = () =>
        setChildren(
          row,
          options.map(([v, t]) =>
            h(
              "button",
              {
                type: "button",
                class: same(cur(), v) ? "chip on" : "chip",
                role: "radio",
                "aria-checked": same(cur(), v) ? "true" : "false",
                onClick: () => (put(path, v), draw()),
              },
              t,
            ),
          ),
        );
      draw();
      return frame(path, labelText, row, { hint });
    }
    const sel = h(
      "select",
      { id: fieldId(path), class: "inp ed-inp", onChange: (e) => put(path, options[e.target.selectedIndex][0]) },
      options.map(([v, t]) => h("option", { selected: same(cur(), v) }, t)),
    );
    return frame(path, labelText, sel, { hint });
  }

  /** A number (with range). */
  function number(path, labelText, { min = 0, max = 100, step = 1, hint, def = 0, fmt } = {}) {
    bind(path);
    const val = h("span", { class: "ed-count" });
    const show = () => (val.textContent = fmt ? fmt(getPath(draft, path) ?? def) : String(getPath(draft, path) ?? def));
    const input = h("input", {
      id: fieldId(path),
      type: "range",
      class: "ed-range",
      min,
      max,
      step,
      value: getPath(draft, path) ?? def,
      onInput: (e) => (put(path, Number(e.target.value)), show()),
    });
    show();
    return frame(path, labelText, input, { hint, side: val });
  }

  /** Tags as chips, added with Enter or a comma. */
  function tags(path, labelText, { hint } = {}) {
    bind(path, (v) => v);
    const list = () => (Array.isArray(getPath(draft, path)) ? getPath(draft, path) : []);
    const row = h("div", { class: "ed-chiprow" });
    const input = h("input", {
      id: fieldId(path),
      class: "inp ed-inp",
      type: "text",
      placeholder: "태그 적고 Enter (쉼표로 여러 개)",
      onKeydown: (e) => {
        if (e.key !== "Enter" && e.key !== ",") return;
        e.preventDefault();
        add();
      },
      onBlur: () => add(),
    });
    const add = () => {
      const fresh = input.value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      input.value = "";
      if (!fresh.length) return;
      put(path, [...new Set([...list(), ...fresh])]);
      draw();
    };
    const draw = () =>
      setChildren(
        row,
        list().map((t) =>
          h(
            "button",
            {
              type: "button",
              class: "chip on ed-tag",
              "aria-label": `${t} 태그 빼기`,
              onClick: () => (
                put(
                  path,
                  list().filter((x) => x !== t),
                ),
                draw()
              ),
            },
            t,
            " ✕",
          ),
        ),
        list().length ? null : h("span", { class: "ed-hint" }, "태그가 없어요"),
      );
    draw();
    return frame(path, labelText, h("div", { class: "ed-stack" }, row, input), { hint });
  }

  /** A list of texts (alternate greetings, aliases): add, remove, move up and down. */
  function list(
    path,
    labelText,
    { addLabel = "+ 추가", rows = 3, hint, itemLabel = (i) => `${i + 1}`, oneLine = false } = {},
  ) {
    bind(path, (v) => v);
    const items = () => (Array.isArray(getPath(draft, path)) ? getPath(draft, path) : []);
    const box = h("div", { class: "ed-stack" });
    const draw = () =>
      setChildren(
        box,
        items().map((v, i, all) =>
          h(
            "div",
            { class: "ed-item" },
            h(
              "div",
              { class: "ed-item-head" },
              h("span", { class: "ed-item-n" }, itemLabel(i)),
              h(
                "span",
                { class: "ed-item-tools" },
                h(
                  "button",
                  {
                    type: "button",
                    class: "ed-mini",
                    disabled: i === 0,
                    "aria-label": "위로",
                    onClick: () => move(i, -1),
                  },
                  "↑",
                ),
                h(
                  "button",
                  {
                    type: "button",
                    class: "ed-mini",
                    disabled: i === all.length - 1,
                    "aria-label": "아래로",
                    onClick: () => move(i, 1),
                  },
                  "↓",
                ),
                h(
                  "button",
                  {
                    type: "button",
                    class: "ed-mini",
                    "aria-label": "지우기",
                    onClick: () => (
                      put(
                        path,
                        items().filter((_, j) => j !== i),
                      ),
                      draw()
                    ),
                  },
                  "지우기",
                ),
              ),
            ),
            oneLine
              ? h("input", {
                  class: "inp ed-inp",
                  value: v,
                  onInput: (e) =>
                    put(
                      path,
                      items().map((x, j) => (j === i ? e.target.value : x)),
                    ),
                })
              : Object.assign(
                  h("textarea", {
                    class: "inp ed-area",
                    rows,
                    onInput: (e) =>
                      put(
                        path,
                        items().map((x, j) => (j === i ? e.target.value : x)),
                      ),
                  }),
                  { value: v },
                ),
          ),
        ),
        h(
          "button",
          {
            type: "button",
            class: "pill",
            style: { alignSelf: "flex-start" },
            onClick: () => (put(path, [...items(), ""]), draw()),
          },
          addLabel,
        ),
      );
    const move = (i, d) => {
      const next = [...items()];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      put(path, next);
      draw();
    };
    draw();
    return frame(path, labelText, box, { hint });
  }

  /** A color (a CSS color; gradients the Engine allows stay as text). */
  function color(path, labelText, { hint } = {}) {
    bind(path);
    const val = () => String(getPath(draft, path) ?? "");
    const hex = /^#[0-9a-f]{6}$/i;
    const swatch = h("input", {
      type: "color",
      class: "ed-color",
      "aria-label": `${labelText} 고르기`,
      value: hex.test(val()) ? val() : "#888888",
      onInput: (e) => ((input.value = e.target.value), put(path, e.target.value)),
    });
    const input = h("input", {
      id: fieldId(path),
      class: "inp ed-inp",
      value: val(),
      placeholder: "비우면 기본 색",
      onInput: (e) => {
        put(path, e.target.value.trim() || null);
        if (hex.test(e.target.value.trim())) swatch.value = e.target.value.trim();
      },
    });
    return frame(path, labelText, h("div", { class: "rowform" }, swatch, input), { hint });
  }

  /** A section: big title, one line about it, then its fields. */
  function section(id, titleText, about, ...children) {
    return h(
      "section",
      { class: "ed-sec", "data-ed-section": id, id: `sec-${id}` },
      h("h2", { class: "ed-sec-t" }, titleText),
      about ? h("p", { class: "ed-sec-about" }, about) : null,
      h("div", { class: "ed-sec-body" }, children),
    );
  }

  function render(sections) {
    setChildren(body, sections);
    setChildren(
      chips,
      sections.map((s) =>
        h(
          "button",
          {
            type: "button",
            class: "chip",
            "data-for": s.dataset.edSection,
            onClick: () => s.scrollIntoView({ behavior: "smooth", block: "start" }),
          },
          s.querySelector(".ed-sec-t").textContent,
        ),
      ),
    );
    // The chip of the section being read is marked.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting)
            for (const c of chips.children) {
              const on = c.dataset.for === e.target.dataset.edSection;
              c.classList.toggle("on", on);
              if (on) c.scrollIntoView({ block: "nearest", inline: "nearest" });
            }
      },
      { root: body, rootMargin: "0px 0px -70% 0px" },
    );
    for (const s of sections) io.observe(s);
    refresh();
  }

  // Saved on leave, like the Engine's editors (closing the screen, or the app going to the background).
  const onHide = () => document.visibilityState === "hidden" && doSave({ quiet: true });
  document.addEventListener("visibilitychange", onHide);

  return {
    text,
    long,
    toggle,
    choice,
    number,
    tags,
    list,
    color,
    section,
    render,
    save: doSave,
    get: (path) => getPath(draft, path),
    set: (path, value) => put(path, value),
    /** Fields drawn outside the helpers register their path here so they count as changes. */
    track: (path) => paths.add(path),
    draft: () => draft,
    original: () => orig,
    /** Replaces the record (after an avatar upload or a version restore) and keeps nothing unsaved. */
    reset(next) {
      orig = clone(next);
      draft = clone(next);
      refresh();
    },
    changed,
    dispose() {
      document.removeEventListener("visibilitychange", onHide);
      const pending = changed().length;
      disposed = true;
      if (pending) doSave({ quiet: true }).then((ok) => ok && toast("편집한 내용을 저장했어요"));
    },
  };
}
