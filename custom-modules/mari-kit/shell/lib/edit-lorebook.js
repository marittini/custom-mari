// The lorebook editor (#/edit/lorebook/<id>), the Engine's LorebookEditor redrawn in the shell's look: 개요 (its
// basics), 검색 (its scanning settings), 항목 (its entry list) and 엔진에서 (what stays in the Engine: who the book
// is linked to, vectors, lint). Entries open in their own page (#/edit/lorebook/<id>/<entry>, lib/edit-lore-entry.js).
// The entry list comes from Mari Kit (/mari-kit/shell/lorebook/:id/entries): names, keys and switches without the
// entries' text, which the Engine's own list would send in full.

import { h, setChildren } from "./h.js";
import { api } from "./api.js";
import { createEditor } from "./editor.js";
import { toast, popMenu, errorBox, openEngine, ask } from "./ui.js";
import { foldGroup } from "./groups.js";
import { CATEGORIES } from "./lorebooks.js";

const parse = (v, empty) => {
  if (typeof v !== "string") return v ?? empty;
  try {
    return JSON.parse(v);
  } catch {
    return empty;
  }
};
const flag = (v, def) => (v === undefined || v === null ? def : v === true || v === "true" || v === 1);
const int = (v, def) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.trunc(Number(v)) : def);

function normalize(b) {
  return {
    ...b,
    description: b.description || "",
    category: b.category || "uncategorized",
    tags: (Array.isArray(parse(b.tags, [])) ? parse(b.tags, []) : []).filter((t) => typeof t === "string"),
    enabled: flag(b.enabled, true),
    isGlobal: flag(b.isGlobal, false),
    scanDepth: int(b.scanDepth, 2),
    tokenBudget: int(b.tokenBudget, 2048),
    entryLimit: int(b.entryLimit, null),
    recursiveScanning: flag(b.recursiveScanning, false),
    maxRecursionDepth: int(b.maxRecursionDepth, 3),
  };
}

const sw = (on) => h("span", { class: on ? "sw on" : "sw" }, h("span"));
const SORTS = [
  ["order", "순서"],
  ["name", "이름"],
  ["recent", "최근"],
];
const PAGE = 100;

export function lorebookEditor({ mount, id, go, back }) {
  const path = `/lorebooks/${encodeURIComponent(id)}`;
  const leave = () => back("settings/lorebooks");
  const root = h("div", { class: "ed-load" });
  mount.append(root);
  let ed = null;
  let gone = false;
  api
    .get(path)
    .then((raw) => {
      if (gone) return;
      root.remove();
      ed = build(normalize(raw));
    })
    .catch((error) => root.replaceChildren(errorBox(error)));

  function build(record) {
    async function save({ draft, changed }) {
      const keys = [...new Set(changed.map((p) => p.split(".")[0]))];
      if (keys.includes("name") && !String(draft.name || "").trim()) throw new Error("이름을 적어 주세요");
      const body = {};
      for (const key of keys) body[key] = key === "name" ? String(draft[key]).trim() : draft[key];
      return normalize(await api.patch(path, body));
    }
    const editor = createEditor({
      mount,
      title: "로어북 편집",
      label: record.name || "이름 없음",
      back: leave,
      record,
      save,
      more: () =>
        popMenu([
          {
            label: "엔진에서 열기",
            sub: "엔진 화면 · 처음 약 14MB",
            onClick: () => openEngine(null, { lorebook: id }),
          },
          "-",
          {
            label: "로어북 지우기",
            onClick: async () => {
              if (!(await ask(`「${record.name}」 로어북과 항목을 모두 지울까요?`, { ok: "지우기", danger: true })))
                return;
              try {
                await api.delete(path);
                editor.reset(editor.draft()); // nothing left to save on leave
                toast("지웠어요");
                leave();
              } catch (error) {
                toast(error.message);
              }
            },
          },
        ]),
    });

    // ── 항목 ──────────────────────────
    const entriesBox = h("div", { class: "lore-entries" }, h("div", { class: "empty" }, "불러오는 중…"));
    let entries = null;
    let folders = [];
    let query = "";
    let sort = "order";
    let shown = PAGE;
    async function loadEntries() {
      try {
        [entries, folders] = await Promise.all([
          api.get(`/mari-kit/shell/lorebook/${encodeURIComponent(id)}/entries`),
          api.get(`${path}/folders`).catch(() => []),
        ]);
      } catch (error) {
        setChildren(entriesBox, errorBox(error));
        return;
      }
      drawEntries();
    }
    async function addEntry() {
      try {
        const made = await api.post(`${path}/entries`, { name: "새 항목", content: "", keys: [] });
        go(`edit/lorebook/${encodeURIComponent(id)}/${encodeURIComponent(made.id)}`);
      } catch (error) {
        toast(error.message);
      }
    }
    async function setEnabled(e, on) {
      try {
        await api.patch(`${path}/entries/${encodeURIComponent(e.id)}`, { enabled: on });
        e.enabled = on;
        drawEntries();
      } catch (error) {
        toast(error.message);
      }
    }
    const POSITION = { 0: "앞", 1: "뒤", 2: "깊이", 7: "아웃렛" };
    function entryRow(e) {
      const sub = [
        e.constant ? "항상" : e.keys.length ? e.keys.slice(0, 4).join(", ") : "키 없음",
        `${POSITION[e.position] || ""}${e.position === 2 ? ` ${e.depth}` : ""} · 순서 ${e.order}`,
      ].join(" · ");
      return h(
        "div",
        { class: "r lore-row" },
        h(
          "button",
          {
            type: "button",
            class: "lore-open",
            onClick: () => go(`edit/lorebook/${encodeURIComponent(id)}/${encodeURIComponent(e.id)}`),
          },
          h("span", { class: e.enabled ? "lore-name" : "lore-name off" }, e.name || "이름 없음"),
          h("small", null, sub),
          e.preview ? h("small", { class: "lore-prev" }, e.preview) : null,
        ),
        h(
          "button",
          {
            type: "button",
            class: "lore-sw",
            role: "switch",
            "aria-checked": e.enabled ? "true" : "false",
            "aria-label": `${e.name || "항목"} 사용`,
            onClick: () => setEnabled(e, !e.enabled),
          },
          sw(e.enabled),
        ),
      );
    }
    function drawEntries() {
      if (!entries) return;
      const q = query.trim().toLowerCase();
      let list = q
        ? entries.filter((e) => [e.name, e.preview, ...e.keys, ...e.secondaryKeys].join(" ").toLowerCase().includes(q))
        : [...entries];
      if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
      else if (sort === "recent")
        list.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      else list.sort((a, b) => a.order - b.order);
      const total = list.length;
      list = list.slice(0, shown);
      // The Engine's folders, while sorted by order and not searching (like the Engine).
      const byFolder = sort === "order" && !q && folders.length;
      const rows = byFolder
        ? [
            ...folders.map((f) => {
              const inside = list.filter((e) => e.folderId === f.id);
              return inside.length
                ? foldGroup(h, `lore:${id}`, f.name, inside.length, h("div", { class: "list" }, inside.map(entryRow)))
                : null;
            }),
            h("div", { class: "list" }, list.filter((e) => !folders.some((f) => f.id === e.folderId)).map(entryRow)),
          ]
        : [h("div", { class: "list" }, list.map(entryRow))];
      setChildren(
        entriesBox,
        h(
          "div",
          { class: "lore-tools" },
          h("input", {
            class: "inp",
            type: "search",
            placeholder: "이름·키·내용",
            "aria-label": "항목 검색",
            value: query,
            onInput: (ev) => {
              query = ev.target.value;
              shown = PAGE;
              const at = ev.target.selectionStart;
              drawEntries();
              const again = entriesBox.querySelector("input[type=search]");
              again?.focus();
              again?.setSelectionRange(at, at);
            },
          }),
          h(
            "div",
            { class: "ed-chiprow", role: "radiogroup", "aria-label": "정렬" },
            SORTS.map(([v, t]) =>
              h(
                "button",
                {
                  type: "button",
                  class: sort === v ? "chip on" : "chip",
                  role: "radio",
                  "aria-checked": sort === v ? "true" : "false",
                  onClick: () => ((sort = v), drawEntries()),
                },
                t,
              ),
            ),
            h("button", { type: "button", class: "chip", onClick: addEntry }, "＋ 새 항목"),
          ),
          h(
            "p",
            { class: "ed-hint" },
            `항목 ${entries.length}개 · 켜짐 ${entries.filter((e) => e.enabled).length}개${q ? ` · 찾은 것 ${total}개` : ""}`,
          ),
        ),
        total ? rows : h("div", { class: "empty" }, q ? "찾는 항목이 없어요" : "아직 항목이 없어요"),
        total > shown
          ? h(
              "button",
              { type: "button", class: "pill lore-more", onClick: () => ((shown += PAGE), drawEntries()) },
              `더 보기 (${total - shown}개 남음)`,
            )
          : null,
      );
    }

    const engineRow = (title, about) =>
      h(
        "button",
        { type: "button", class: "grow linkline", onClick: () => openEngine(null, { lorebook: id }) },
        h("span", null, title, h("small", { style: { display: "block" } }, `${about} · 엔진 화면 · 처음 약 14MB`)),
        h("span", null, "›"),
      );

    editor.render([
      editor.section(
        "info",
        "개요",
        "이 로어북이 무엇인지와 켜짐",
        editor.text("name", "이름", { max: 200 }),
        editor.long("description", "설명", { rows: 3 }),
        editor.choice("category", "분류", CATEGORIES, { def: "uncategorized" }),
        editor.tags("tags", "태그"),
        editor.toggle("enabled", "사용", { hint: "끄면 어느 채팅에서도 쓰지 않아요", def: true }),
        editor.toggle("isGlobal", "모든 채팅에 쓰기 (전역)", {
          hint: "캐릭터·페르소나에 묶인 로어북은 전역으로 바꿀 수 없어요",
        }),
      ),
      editor.section(
        "scan",
        "검색",
        "대화에서 키를 찾는 방법",
        editor.count("scanDepth", "검색 깊이", {
          min: 0,
          max: 1000,
          def: 2,
          hint: "최근 몇 개의 메시지에서 키를 찾을지",
        }),
        editor.count("tokenBudget", "토큰 예산", {
          min: 0,
          max: 1000000,
          def: 2048,
          hint: "한 번에 넣을 수 있는 최대 토큰",
        }),
        editor.count("entryLimit", "항목 수 한도", {
          min: 1,
          max: 1000,
          def: null,
          placeholder: "기본값",
          hint: "한 번에 넣는 항목 수 (비우면 기본값)",
        }),
        editor.toggle("recursiveScanning", "재귀 검색", { hint: "넣은 항목의 내용에서도 다른 항목의 키를 찾아요" }),
        editor.count("maxRecursionDepth", "재귀 깊이", { min: 1, max: 10, def: 3 }),
      ),
      editor.section("entries", "항목", "키가 나오면 들어가는 글", entriesBox),
      editor.section(
        "engine",
        "엔진에서",
        "아직 셸에 없는 화면이에요. 누르면 엔진 화면이 열리고, ‹ Mari로 돌아올 수 있어요.",
        engineRow("연결 범위", "캐릭터·페르소나·채팅에 묶기"),
        engineRow("벡터 검색", "의미로 찾기 설정과 벡터 만들기"),
        engineRow("품질 검사 · 통계", "빈 키·겹치는 내용, 켜진 횟수"),
      ),
    ]);
    loadEntries();
    return editor;
  }

  return {
    dispose() {
      gone = true;
      ed?.dispose();
    },
  };
}
