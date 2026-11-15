// One lorebook entry (#/edit/lorebook/<book>/<entry>), the Engine's entry drawer (LorebookEntryRow) redrawn as a
// page in the shell's look: 내용 (name, text, keys), 조건 (when it fires), 위치 (where it goes in the prompt) and
// 엔진에서 (timing, groups, filters, schedule, conditions, pictures, decision — still the Engine's). Saved like the
// Engine: only the changed fields, on 저장 or when the page closes.

import { h } from "./h.js";
import { api } from "./api.js";
import { createEditor } from "./editor.js";
import { toast, popMenu, errorBox, openEngine, ask } from "./ui.js";

const strings = (v) => {
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
};
const flag = (v, def) => (v === undefined || v === null ? def : v === true || v === "true" || v === 1);
const num = (v, def) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? def : Number(v));

function normalize(e) {
  return {
    ...e,
    name: e.name || "",
    content: e.content || "",
    keys: strings(e.keys),
    secondaryKeys: strings(e.secondaryKeys),
    enabled: flag(e.enabled, true),
    constant: flag(e.constant, false),
    selective: flag(e.selective, false),
    selectiveLogic: e.selectiveLogic || "and",
    position: num(e.position, 0),
    depth: num(e.depth, 4),
    order: num(e.order, 100),
    role: e.role || "system",
    probability: num(e.probability, null),
    useRegex: flag(e.useRegex, false),
    caseSensitive: flag(e.caseSensitive, false),
    matchWholeWords: flag(e.matchWholeWords, false),
    scanDepth: num(e.scanDepth, null),
  };
}

// The Engine's own choices (shared/src/schemas/lorebook.schema.ts).
const LOGIC = [
  ["and", "보조 키 중 하나라도 있으면 (AND ANY)"],
  ["and_all", "보조 키가 모두 있으면 (AND ALL)"],
  ["or", "주 키나 보조 키 중 하나 (OR)"],
  ["not", "보조 키가 하나라도 있으면 빼기 (NOT ANY)"],
  ["not_all", "보조 키가 모두 있으면 빼기 (NOT ALL)"],
];
const POSITIONS = [
  [0, "앞"],
  [1, "뒤"],
  [2, "깊이"],
  [7, "아웃렛"],
];
const ROLES = [
  ["system", "시스템"],
  ["user", "사용자"],
  ["assistant", "캐릭터"],
];

export function loreEntryEditor({ mount, bookId, id, go, back }) {
  const book = `/lorebooks/${encodeURIComponent(bookId)}`;
  const path = `${book}/entries/${encodeURIComponent(id)}`;
  const leave = () => back(`edit/lorebook/${encodeURIComponent(bookId)}`);
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
      title: "항목 편집",
      label: record.name || "이름 없음",
      back: leave,
      record,
      save,
      more: () =>
        popMenu([
          { label: "복제", onClick: duplicate },
          {
            label: "엔진에서 열기",
            sub: "엔진 화면 · 처음 약 14MB",
            onClick: () => openEngine(null, { lorebook: bookId }),
          },
          "-",
          { label: "항목 지우기", onClick: remove },
        ]),
    });

    async function duplicate() {
      if (!(await editor.save({ quiet: true }))) return;
      const d = editor.draft();
      const { id: _id, lorebookId: _book, createdAt: _c, updatedAt: _u, ...rest } = d;
      try {
        const copy = await api.post(`${book}/entries`, { ...rest, name: `${d.name || "항목"} 사본` });
        go(`edit/lorebook/${encodeURIComponent(bookId)}/${encodeURIComponent(copy.id)}`);
      } catch (error) {
        toast(error.message);
      }
    }
    async function remove() {
      if (!(await ask(`「${editor.draft().name || "항목"}」 항목을 지울까요?`, { ok: "지우기", danger: true }))) return;
      try {
        await api.delete(path);
        editor.reset(editor.draft());
        toast("지웠어요");
        leave();
      } catch (error) {
        toast(error.message);
      }
    }

    editor.render([
      editor.section(
        "content",
        "내용",
        "이름, 넣을 글, 찾을 키",
        editor.text("name", "이름", { max: 200 }),
        editor.long("content", "내용", { rows: 10, vars: ["user", "char"] }),
        editor.tags("keys", "키", { hint: "이 말이 대화에 나오면 넣어요. 입력하고 Enter나 쉼표" }),
        editor.tags("secondaryKeys", "보조 키", { hint: "아래 '보조 키 쓰기'를 켜면 함께 따져요" }),
        editor.toggle("enabled", "사용", { def: true }),
        editor.toggle("constant", "항상 넣기", { hint: "키가 없어도 늘 넣어요" }),
      ),
      editor.section(
        "trigger",
        "조건",
        "언제 넣을지",
        editor.toggle("selective", "보조 키 쓰기"),
        editor.choice("selectiveLogic", "보조 키 규칙", LOGIC, { def: "and" }),
        editor.count("probability", "확률 (%)", {
          min: 0,
          max: 100,
          def: null,
          placeholder: "100",
          hint: "키가 나와도 이 확률로만 넣어요 (비우면 늘)",
        }),
        editor.toggle("useRegex", "키를 정규식으로"),
        editor.toggle("caseSensitive", "대소문자 구분"),
        editor.toggle("matchWholeWords", "낱말 단위로만"),
        editor.count("scanDepth", "검색 깊이", {
          min: 0,
          max: 1000,
          def: null,
          placeholder: "로어북 설정",
          hint: "이 항목만 다르게 (비우면 로어북 설정)",
        }),
      ),
      editor.section(
        "place",
        "위치",
        "프롬프트 어디에 넣을지",
        editor.choice("position", "넣는 곳", POSITIONS, {
          def: 0,
          hint: "앞·뒤: 캐릭터 정보 앞뒤 · 깊이: 최근 메시지 사이",
        }),
        editor.count("depth", "깊이", {
          min: 0,
          max: 1000,
          def: 4,
          hint: "넣는 곳이 '깊이'일 때, 마지막에서 몇 번째 메시지 위",
        }),
        editor.count("order", "순서", { min: -100000, max: 100000, def: 100, hint: "작을수록 먼저" }),
        editor.choice("role", "역할", ROLES, { def: "system" }),
      ),
      editor.section(
        "engine",
        "엔진에서",
        "아직 셸에 없는 칸이에요. 누르면 엔진 화면이 열리고, ‹ Mari로 돌아올 수 있어요.",
        h(
          "button",
          { type: "button", class: "grow linkline", onClick: () => openEngine(null, { lorebook: bookId }) },
          h(
            "span",
            null,
            "고급 칸",
            h(
              "small",
              { style: { display: "block" } },
              "유지·대기·지연, 그룹, 캐릭터·태그 필터, 일정, 조건, 그림, 판단 · 엔진 화면 · 처음 약 14MB",
            ),
          ),
          h("span", null, "›"),
        ),
      ),
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
