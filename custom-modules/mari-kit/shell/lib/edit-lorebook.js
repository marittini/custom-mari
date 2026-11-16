// The lorebook editor (#/edit/lorebook/<id>[/<entry>]), the Engine's LorebookEditor in the shell's look. Like the
// Engine: two tabs, 개요 (what the book is and how it is scanned; saved with 저장 or on leave) and 항목 (its entries,
// lib/lore-entries.js, each saving itself). What stays in the Engine (link scope, vectors, lint) opens it in place.

import { h } from "./h.js";
import { api } from "./api.js";
import { createEditor } from "./editor.js";
import { toast, popMenu, errorBox, openEngine, ask } from "./ui.js";
import { loreEntries } from "./lore-entries.js";
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

export function lorebookEditor({ mount, id, go, back, open = null }) {
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
      title: record.name || "이름 없음",
      label: "로어북",
      back: leave,
      record,
      save,
      tab: open ? "entries" : null,
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

    const engineRow = (title, about) =>
      h(
        "button",
        { type: "button", class: "grow linkline", onClick: () => openEngine(null, { lorebook: id }) },
        h("span", null, title, h("small", { style: { display: "block" } }, `${about} · 엔진 화면 · 처음 약 14MB`)),
        h("span", null, "›"),
      );
    const list = loreEntries({ bookId: id, open });

    editor.render([
      editor.section(
        "info",
        "개요",
        "이 로어북이 무엇인지, 어떻게 찾는지",
        editor.text("name", "이름", { max: 200 }),
        editor.long("description", "설명", { rows: 3 }),
        editor.choice("category", "분류", CATEGORIES, { def: "uncategorized" }),
        editor.tags("tags", "태그"),
        editor.toggle("enabled", "사용", { hint: "끄면 어느 채팅에서도 쓰지 않아요", def: true }),
        editor.toggle("isGlobal", "모든 채팅에 쓰기 (전역)", {
          hint: "캐릭터·페르소나에 묶인 로어북은 전역으로 바꿀 수 없어요",
        }),
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
        editor.count("entryLimit", "항목 수 한도", { min: 1, max: 1000, def: null, placeholder: "기본값" }),
        editor.toggle("recursiveScanning", "재귀 검색", { hint: "넣은 항목의 내용에서도 다른 항목의 키를 찾아요" }),
        editor.count("maxRecursionDepth", "재귀 깊이", { min: 1, max: 10, def: 3 }),
        engineRow("연결 범위", "캐릭터·페르소나·채팅에 묶기"),
        engineRow("벡터 검색", "의미로 찾기 설정과 벡터 만들기"),
        engineRow("품질 검사 · 통계", "빈 키·겹치는 내용, 켜진 횟수"),
      ),
      editor.section("entries", "항목", "", list.el),
    ]);
    return editor;
  }

  return {
    dispose() {
      gone = true;
      ed?.dispose();
    },
  };
}
