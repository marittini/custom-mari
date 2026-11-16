// A lorebook's entries (the 항목 tab of lib/edit-lorebook.js), in the Engine's own grammar (LorebookEditor /
// LorebookEntryRow, studied at 360px and desktop): one line per entry, all the same height, so a long list can be
// scanned and compared top to bottom; the entry opens in place under its line and saves itself, so the next entry
// is right below; folders are an indented tree; a stats line gives the token budget feel. Changed for a phone:
// the name is text (two lines) instead of a cut-off input, the main keys show under it, and the desktop's columns
// (position, order) become one small column on the right, so entries can still be compared down the list.
// Copy, move and delete sit in ⋯, so a line has three things to press (open, switch, ⋯), each 44px.
//
// The list comes from Mari Kit (/mari-kit/shell/lorebook/:id/entries) without the entries' text; an entry's text is
// read when it is opened.

import { h, icon, I, setChildren } from "./h.js";
import { api } from "./api.js";
import { toast, popMenu, errorBox, openEngine, ask, sheet } from "./ui.js";
import { tokensOf } from "./editor.js";

const POSITIONS = [
  [0, "캐릭 위"],
  [1, "캐릭 아래"],
  [2, "깊이"],
  [7, "아웃렛"],
];
const posName = Object.fromEntries(POSITIONS);
// The Engine's chips for secondary keys (its UI shows these four).
const LOGIC = [
  ["and", "AND 하나"],
  ["and_all", "AND 모두"],
  ["not", "NOT 하나"],
  ["not_all", "NOT 모두"],
];
const ROLES = [
  ["system", "시스템"],
  ["user", "사용자"],
  ["assistant", "캐릭터"],
];
const SORTS = [
  ["order", "순서"],
  ["name", "이름"],
  ["recent", "최근"],
];
const PAGE = 150;
const sw = (on) => h("span", { class: on ? "sw on" : "sw" }, h("span"));
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const flag = (v, def) => (v === undefined || v === null ? def : v === true || v === "true" || v === 1);
const num = (v, def) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? def : Number(v));

/** The entries tab: returns its element; `open` (an entry id) starts with that entry opened. */
export function loreEntries({ bookId, open = null }) {
  const book = `/lorebooks/${encodeURIComponent(bookId)}`;
  const el = h("div", { class: "lb-entries" }, h("div", { class: "empty" }, "불러오는 중…"));
  let entries = null; // slim rows
  let folders = [];
  let query = "";
  let sort = "order";
  let shown = PAGE;
  let opened = open; // the entry whose drawer is open
  let full = null; // { id, record } of the opened entry
  const closedFolders = new Set(readFolds());

  function readFolds() {
    try {
      return JSON.parse(localStorage.getItem(`mari-kit:lore-folds:${bookId}`) || "[]") || [];
    } catch {
      return [];
    }
  }
  function writeFolds() {
    try {
      localStorage.setItem(`mari-kit:lore-folds:${bookId}`, JSON.stringify([...closedFolders]));
    } catch {}
  }

  async function load() {
    try {
      [entries, folders] = await Promise.all([
        api.get(`/mari-kit/shell/lorebook/${encodeURIComponent(bookId)}/entries`),
        api.get(`${book}/folders`).catch(() => []),
      ]);
    } catch (error) {
      setChildren(el, errorBox(error));
      return;
    }
    if (opened) await openEntry(opened, false);
    draw();
  }

  // ── saving (each change on its own, like the Engine's entry rows) ──
  let saving = 0;
  const status = h("span", { class: "lb-saved", "aria-live": "polite" });
  const showStatus = (t) => (status.textContent = t);
  async function patch(e, body) {
    saving += 1;
    showStatus("저장 중…");
    try {
      const saved = await api.patch(`${book}/entries/${encodeURIComponent(e.id)}`, body);
      Object.assign(e, slimOf(saved, e));
      if (full?.id === e.id) Object.assign(full.record, body);
      showStatus("저장됨");
    } catch (error) {
      showStatus("저장 못 함");
      toast(error.message);
    } finally {
      saving -= 1;
    }
  }
  // The slim row from a saved entry (its text only as length and preview).
  function slimOf(saved, prev) {
    const content = typeof saved?.content === "string" ? saved.content : null;
    return {
      name: saved?.name ?? prev.name,
      keys: saved?.keys ? strings(saved.keys) : prev.keys,
      secondaryKeys: saved?.secondaryKeys ? strings(saved.secondaryKeys) : prev.secondaryKeys,
      enabled: saved ? flag(saved.enabled, true) : prev.enabled,
      constant: saved ? flag(saved.constant, false) : prev.constant,
      position: num(saved?.position, prev.position),
      depth: num(saved?.depth, prev.depth),
      order: num(saved?.order, prev.order),
      folderId: saved && "folderId" in saved ? saved.folderId || null : prev.folderId,
      useRegex: saved ? flag(saved.useRegex, false) : prev.useRegex,
      tokens: content === null ? prev.tokens : tokensOf(content),
      preview: content === null ? prev.preview : content.replace(/\s+/g, " ").trim().slice(0, 80),
      updatedAt: saved?.updatedAt || prev.updatedAt,
    };
  }

  async function openEntry(id, redraw = true) {
    if (opened === id && full?.id === id && redraw) {
      opened = null;
      full = null;
      return draw();
    }
    opened = id;
    full = null;
    if (redraw) draw();
    try {
      full = { id, record: await api.get(`${book}/entries/${encodeURIComponent(id)}`) };
    } catch (error) {
      toast(error.message);
      opened = null;
    }
    if (redraw) {
      draw();
      el.querySelector(`[data-entry="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    }
  }

  async function addEntry(folderId = null) {
    try {
      const made = await api.post(`${book}/entries`, { name: "새 항목", content: "", keys: [], folderId });
      entries.push({ ...slimOf(made, { keys: [], secondaryKeys: [], tokens: 0, preview: "" }), id: made.id });
      query = "";
      await openEntry(made.id);
      el.querySelector(`[data-entry="${CSS.escape(made.id)}"] .lb-name-in`)?.select();
    } catch (error) {
      toast(error.message);
    }
  }

  // ⋯ on a line: copy, up/down in its folder, move to a folder, delete.
  function entryMenu(e) {
    const siblings = sorted(
      entries.filter((x) => (x.folderId || null) === (e.folderId || null)),
      "order",
    );
    const at = siblings.findIndex((x) => x.id === e.id);
    popMenu([
      { label: "복제", onClick: () => duplicate(e) },
      ...(at > 0 ? [{ label: "위로", onClick: () => reorder(siblings, at, at - 1) }] : []),
      ...(at < siblings.length - 1 ? [{ label: "아래로", onClick: () => reorder(siblings, at, at + 1) }] : []),
      ...(folders.length ? [{ label: "폴더로 옮기기", onClick: () => moveTo(e) }] : []),
      "-",
      { label: "지우기", onClick: () => remove(e) },
    ]);
  }
  async function duplicate(e) {
    try {
      const src = await api.get(`${book}/entries/${encodeURIComponent(e.id)}`);
      const { id: _id, lorebookId: _b, createdAt: _c, updatedAt: _u, ...rest } = src;
      const copy = await api.post(`${book}/entries`, { ...rest, name: `${src.name || "항목"} 사본` });
      entries.push({ ...slimOf(copy, e), id: copy.id });
      toast("복제했어요");
      draw();
    } catch (error) {
      toast(error.message);
    }
  }
  // The Engine's reorder: the folder's entries in their new order (it renumbers them).
  async function reorder(siblings, from, to) {
    const ids = siblings.map((x) => x.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    try {
      await api.put(`${book}/entries/reorder`, { entryIds: ids, folderId: siblings[0]?.folderId || null });
      entries = await api.get(`/mari-kit/shell/lorebook/${encodeURIComponent(bookId)}/entries`);
      draw();
    } catch (error) {
      toast(error.message);
    }
  }
  function moveTo(e) {
    const box = h("div", { class: "psheet" });
    const s = sheet(box, { label: "폴더로 옮기기" });
    const pick = async (folderId) => {
      s.close();
      await patch(e, { folderId });
      draw();
    };
    setChildren(
      box,
      h("div", { class: "psheet-title" }, "폴더로 옮기기"),
      h(
        "div",
        { class: "list" },
        [{ id: null, name: "폴더 없음" }, ...folders].map((f) =>
          h(
            "button",
            { type: "button", class: "r two", onClick: () => pick(f.id) },
            h("span", null, f.name),
            h("span", { class: "val" }, (e.folderId || null) === f.id ? "지금" : ""),
          ),
        ),
      ),
    );
  }
  async function remove(e) {
    if (!(await ask(`「${e.name || "항목"}」 항목을 지울까요?`, { ok: "지우기", danger: true }))) return;
    try {
      await api.delete(`${book}/entries/${encodeURIComponent(e.id)}`);
      entries = entries.filter((x) => x.id !== e.id);
      if (opened === e.id) ((opened = null), (full = null));
      draw();
    } catch (error) {
      toast(error.message);
    }
  }
  async function setFolder(f, on) {
    try {
      await api.patch(`${book}/folders/${encodeURIComponent(f.id)}`, { enabled: on });
      f.enabled = on;
      draw();
    } catch (error) {
      toast(error.message);
    }
  }

  // ── drawing ──
  function sorted(list, by = sort) {
    const out = [...list];
    if (by === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    else if (by === "recent") out.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    else out.sort((a, b) => a.order - b.order);
    return out;
  }
  function line(e) {
    const isOpen = opened === e.id;
    return h(
      "div",
      { class: isOpen ? "lb-item open" : "lb-item", "data-entry": e.id },
      h(
        "div",
        { class: "lb-line" },
        h(
          "button",
          {
            type: "button",
            class: "lb-open",
            "aria-expanded": isOpen ? "true" : "false",
            onClick: () => openEntry(e.id),
          },
          h("span", { class: "lb-chev", "aria-hidden": "true" }, isOpen ? "⌄" : "›"),
          h(
            "span",
            { class: "lb-txt" },
            h(
              "span",
              { class: e.enabled ? "lb-name" : "lb-name off" },
              h("span", { class: e.constant ? "lb-dot on" : "lb-dot", title: e.constant ? "상시" : "키로" }),
              e.name || "이름 없음",
              e.useRegex ? h("span", { class: "lb-re", title: "정규식" }, ".*") : null,
            ),
            h(
              "small",
              null,
              e.constant ? `상시${e.keys.length ? ` · ${e.keys.join(", ")}` : ""}` : e.keys.join(", ") || "키 없음",
            ),
          ),
          h(
            "span",
            { class: "lb-meta" },
            `${posName[e.position] || ""}${e.position === 2 ? ` ${e.depth}` : ""}`,
            h("i", null, String(e.order)),
          ),
        ),
        h(
          "button",
          {
            type: "button",
            class: "lb-sw",
            role: "switch",
            "aria-checked": e.enabled ? "true" : "false",
            "aria-label": `${e.name || "항목"} 사용`,
            onClick: async () => {
              await patch(e, { enabled: !e.enabled });
              draw();
            },
          },
          sw(e.enabled),
        ),
        h(
          "button",
          {
            type: "button",
            class: "ib lb-more",
            "aria-label": `${e.name || "항목"} 더보기`,
            onClick: () => entryMenu(e),
          },
          icon("M5 12h.01M12 12h.01M19 12h.01", 20, 2.4),
        ),
      ),
      isOpen ? drawer(e) : null,
    );
  }

  // The entry opened in place: the Engine's field order (name, keys, logic, content, place), the rarer ones folded.
  function drawer(e) {
    if (!full || full.id !== e.id)
      return h("div", { class: "lb-drawer" }, h("div", { class: "empty" }, "불러오는 중…"));
    const r = full.record;
    const field = (label, control, side = null) =>
      h("div", { class: "lb-f" }, h("div", { class: "lb-l" }, h("span", null, label), side), control);
    const text = (key, label, { max = 200 } = {}) => {
      const input = h("input", {
        class: key === "name" ? "inp lb-in lb-name-in" : "inp lb-in",
        value: r[key] ?? "",
        maxlength: max,
        "aria-label": label,
        onChange: (ev) => {
          const v = ev.target.value.trim();
          if (key === "name" && !v) return (ev.target.value = r.name || "");
          patch(e, { [key]: v }).then(draw);
        },
      });
      return field(label, input);
    };
    const count = (key, label, { min = 0, max = 100000, empty = null } = {}) => {
      const input = h("input", {
        class: "inp lb-in lb-num",
        type: "number",
        inputmode: "numeric",
        min,
        max,
        value: r[key] === null || r[key] === undefined ? "" : String(r[key]),
        placeholder: empty === null ? "" : String(empty),
        "aria-label": label,
        onChange: (ev) => {
          const raw = ev.target.value.trim();
          const n = Math.trunc(Number(raw));
          const v = raw === "" || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, n));
          patch(e, { [key]: v ?? (key === "order" ? 100 : key === "depth" ? 4 : null) }).then(draw);
        },
      });
      return field(label, input);
    };
    const toggle = (key, label, def = false) => {
      const on = flag(r[key], def);
      return h(
        "button",
        {
          type: "button",
          class: "lb-toggle",
          role: "switch",
          "aria-checked": on ? "true" : "false",
          onClick: () => patch(e, { [key]: !on }).then(draw),
        },
        h("span", null, label),
        sw(on),
      );
    };
    const chips = (key, label, options, def) => {
      const cur = r[key] ?? def;
      return field(
        label,
        h(
          "div",
          { class: "lb-chips", role: "radiogroup", "aria-label": label },
          options.map(([v, t]) =>
            h(
              "button",
              {
                type: "button",
                class: cur === v ? "chip on" : "chip",
                role: "radio",
                "aria-checked": cur === v ? "true" : "false",
                onClick: () => patch(e, { [key]: v }).then(draw),
              },
              t,
            ),
          ),
        ),
      );
    };
    const keys = (key, label) => {
      const list = strings(Array.isArray(r[key]) ? r[key] : []);
      const save = (next) => patch(e, { [key]: next }).then(draw);
      const input = h("input", {
        class: "inp lb-in",
        placeholder: list.length ? "더 넣기" : "키를 쓰고 Enter",
        "aria-label": `${label} 넣기`,
        enterkeyhint: "done",
        onKeyDown: (ev) => {
          const v = ev.target.value.trim().replace(/,$/, "");
          if ((ev.key === "Enter" || ev.key === ",") && v) {
            ev.preventDefault();
            const add = v
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s && !list.includes(s));
            ev.target.value = "";
            if (add.length) save([...list, ...add]);
          } else if (ev.key === "Backspace" && !ev.target.value && list.length) save(list.slice(0, -1));
        },
        onBlur: (ev) => {
          const v = ev.target.value.trim();
          if (v && !list.includes(v)) save([...list, v]);
        },
      });
      return field(
        label,
        h(
          "div",
          { class: "lb-keys" },
          list.map((k) =>
            h(
              "button",
              {
                type: "button",
                class: "chip lb-key",
                "aria-label": `${k} 빼기`,
                onClick: () => save(list.filter((x) => x !== k)),
              },
              k,
              h("span", { "aria-hidden": "true" }, " ×"),
            ),
          ),
          input,
        ),
      );
    };
    const content = h("textarea", {
      class: "inp lb-area",
      rows: 5,
      "aria-label": "내용",
      onInput: (ev) => {
        tok.textContent = `약 ${tokensOf(ev.target.value)} 토큰`;
        ev.target.style.height = "auto";
        ev.target.style.height = `${Math.min(ev.target.scrollHeight, 420)}px`;
      },
      onChange: (ev) => patch(e, { content: ev.target.value }).then(draw),
    });
    content.value = r.content || "";
    const tok = h("span", { class: "hint" }, `약 ${tokensOf(r.content || "")} 토큰`);
    requestAnimationFrame(() => {
      content.style.height = "auto";
      content.style.height = `${Math.min(content.scrollHeight, 420)}px`;
    });
    const pos = num(r.position, 0);
    const rest = h(
      "details",
      { class: "lb-rest" },
      h("summary", null, "조건 · 고급"),
      h(
        "div",
        { class: "lb-grid" },
        toggle("useRegex", "키를 정규식으로"),
        toggle("caseSensitive", "대소문자 구분"),
        toggle("matchWholeWords", "낱말 단위로만"),
        toggle("selective", "보조 키 쓰기"),
      ),
      count("scanDepth", "검색 깊이 (비우면 로어북 설정)", { max: 1000 }),
      chips("role", "역할", ROLES, "system"),
      h(
        "button",
        { type: "button", class: "grow linkline", onClick: () => openEngine(null, { lorebook: bookId }) },
        h(
          "span",
          null,
          "엔진에서 더 보기",
          h(
            "small",
            { style: { display: "block" } },
            "유지·대기·지연, 그룹, 필터, 일정, 조건, 그림, 판단 · 엔진 화면 · 처음 약 14MB",
          ),
        ),
        h("span", null, "›"),
      ),
    );
    return h(
      "div",
      { class: "lb-drawer" },
      text("name", "이름"),
      keys("keys", "주 키"),
      keys("secondaryKeys", "보조 키"),
      chips("selectiveLogic", "보조 키 규칙", LOGIC, "and"),
      field("내용", content, tok),
      h(
        "div",
        { class: "lb-grid" },
        h(
          "div",
          { class: "lb-f" },
          h("div", { class: "lb-l" }, h("span", null, "넣는 곳")),
          h(
            "select",
            {
              class: "inp lb-in",
              "aria-label": "넣는 곳",
              onChange: (ev) => patch(e, { position: Number(ev.target.value) }).then(draw),
            },
            POSITIONS.map(([v, t]) => h("option", { value: String(v), selected: pos === v }, t)),
          ),
        ),
        pos === 2 ? count("depth", "깊이", { max: 1000 }) : h("span"),
        count("order", "순서", { min: -100000 }),
        count("probability", "확률 %", { max: 100, empty: 100 }),
      ),
      h("div", { class: "lb-grid" }, toggle("constant", "상시 (키 없이 늘)")),
      rest,
      h(
        "div",
        { class: "lb-foot" },
        status,
        h("button", { type: "button", class: "pill", onClick: () => openEntry(e.id) }, "접기"),
      ),
    );
  }

  function folderLine(f, inside) {
    const closed = closedFolders.has(f.id);
    const on = flag(f.enabled, true);
    return h(
      "div",
      { class: "lb-folder" },
      h(
        "div",
        { class: "lb-line lb-fline" },
        h(
          "button",
          {
            type: "button",
            class: "lb-open",
            "aria-expanded": closed ? "false" : "true",
            onClick: () => {
              closed ? closedFolders.delete(f.id) : closedFolders.add(f.id);
              writeFolds();
              draw();
            },
          },
          h("span", { class: "lb-chev", "aria-hidden": "true" }, closed ? "›" : "⌄"),
          h("span", { class: on ? "lb-fname" : "lb-fname off" }, f.name),
          h("span", { class: "lb-meta" }, String(inside.length)),
        ),
        h(
          "button",
          {
            type: "button",
            class: "lb-sw",
            role: "switch",
            "aria-checked": on ? "true" : "false",
            "aria-label": `${f.name} 폴더 사용`,
            onClick: () => setFolder(f, !on),
          },
          sw(on),
        ),
        h("span", { class: "lb-more" }),
      ),
      closed ? null : h("div", { class: "lb-kids" }, inside.map(line)),
    );
  }

  let typingAt = null;
  function draw() {
    if (!entries) return;
    const q = query.trim().toLowerCase();
    const hit = (e) => !q || [e.name, e.preview, ...e.keys, ...e.secondaryKeys].join(" ").toLowerCase().includes(q);
    const visible = sorted(entries.filter(hit)).slice(0, shown);
    const total = entries.filter(hit).length;
    const tokens = entries.reduce((n, e) => n + (e.tokens || 0), 0);
    // Folders like the Engine's: only when sorted by order and not searching.
    const tree = sort === "order" && !q && folders.length;
    const known = new Set(folders.map((f) => f.id));
    const body = tree
      ? [
          ...folders.map((f) =>
            folderLine(
              f,
              visible.filter((e) => e.folderId === f.id),
            ),
          ),
          ...visible.filter((e) => !known.has(e.folderId)).map(line),
        ]
      : visible.map(line);
    const search = h("input", {
      class: "inp",
      type: "search",
      placeholder: "이름·키·내용 찾기",
      "aria-label": "항목 찾기",
      value: query,
      onInput: (ev) => {
        query = ev.target.value;
        shown = PAGE;
        typingAt = ev.target.selectionStart;
        draw();
      },
    });
    setChildren(
      el,
      h(
        "div",
        { class: "lb-tools" },
        search,
        h(
          "select",
          {
            class: "inp lb-sort",
            "aria-label": "정렬",
            onChange: (ev) => ((sort = ev.target.value), draw()),
          },
          SORTS.map(([v, t]) => h("option", { value: v, selected: sort === v }, t)),
        ),
        h("button", { type: "button", class: "pill main lb-add", onClick: () => addEntry() }, "＋ 항목"),
      ),
      h(
        "p",
        { class: "lb-stat" },
        `항목 ${entries.length} · 켜짐 ${entries.filter((e) => e.enabled).length} · 폴더 ${folders.length} · 약 ${tokens} 토큰${q ? ` · 찾은 것 ${total}` : ""}`,
      ),
      total
        ? h("div", { class: "lb-list" }, body)
        : h("div", { class: "empty" }, q ? "찾는 항목이 없어요" : "아직 항목이 없어요"),
      total > shown
        ? h(
            "button",
            { type: "button", class: "pill lb-page", onClick: () => ((shown += PAGE), draw()) },
            `더 보기 (${total - shown}개)`,
          )
        : null,
    );
    if (typingAt !== null) {
      search.focus();
      search.setSelectionRange(typingAt, typingAt);
      typingAt = null;
    }
  }

  load();
  return { el, busy: () => saving > 0 };
}
