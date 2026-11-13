// Memory library for one RP chat (Mari Kit memory). Phone layout: 한눈에 first, the other sections from its menu.
// Organizing is a button (one model call per chunk); recall each turn is keywords (plus meaning, when embeddings
// are on) with no model call; memory translation happens once while organizing.

import { h, icon, dots, I, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data, chatTitle, characterIndex, chatMeta, textConnections } from "../lib/data.js";
import { groupsOf, groupedOptions, splitByGroup } from "../lib/groups.js";
import { toast, errorBox, sheet } from "../lib/ui.js";

const P = (d) => d;
const SECTIONS = [
  { id: "scenes", label: "장면", group: "이야기", icon: P("M4 6h6l2 2h8v10H4z") },
  { id: "facts", label: "알게 된 사실", group: "이야기", icon: I.person },
  { id: "ledger", label: "아직 끝나지 않은 일", group: "이야기", icon: P("M6 4h12v16H6zM9 9h6M9 13h6") },
  { id: "promises", label: "약속", group: "이야기", icon: P("M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2") },
  { id: "life", label: "최근 생활", group: "이야기", icon: P("M4 12h4l2-5 4 10 2-5h4") },
  { id: "world", label: "인물·장소", group: "인물", icon: P("M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z") },
  { id: "notebook", label: "수첩", group: "인물", icon: P("M6 3h11v18H6zM9 7h5") },
  { id: "names", label: "이름 정리", group: "인물", icon: P("M4 7h16M4 12h10M4 17h7") },
  { id: "inject", label: "주입 확인", group: "확인", icon: P("M12 4v10M7 9l5 5 5-5M5 20h14") },
  { id: "settings", label: "설정", group: "확인", icon: I.sliders },
];
const KIND = {
  promise: "약속",
  emotion: "감정",
  state: "상태",
  secret: "비밀",
  pending: "미해결",
  deadline: "기한",
  open: "미해결",
};
const KIND_ORDER = ["promise", "emotion", "state", "secret", "pending", "deadline", "open"];
const OUTCOME = { kept: "지킴", broken: "깨짐", cancelled: "취소", settled: "끝남" };
const ROUTINE = { meal: "식사", wash: "씻기", groom: "꾸밈", sleep: "잠듦", wake: "깸", medicine: "약", other: "기타" };
const SETTINGS = [
  {
    group: "정리",
    rows: [
      {
        key: "chunk",
        label: "묶음",
        help: "한 번 정리할 때 읽는 메시지 수 · 묶음마다 호출 1번",
        chips: [12, 24, 36, 48],
        range: [6, 60],
      },
      {
        key: "keepRecent",
        label: "최근 제외",
        help: "정리하지 않고 원문으로 남길 최근 메시지",
        chips: [4, 6, 10],
        range: [0, 40],
      },
      {
        key: "context",
        label: "AI가 읽을 최근 메시지",
        help: "이보다 오래된 메시지는 AI에게 보내지 않아요 · 지난 일은 기억이 대신 알려줘요 · 엔진의 채팅 설정 › 컨텍스트와 같은 값",
        chips: [0, 40, 80, 150],
        range: [0, 2000],
        fmt: (v) => (v ? String(v) : "전부"),
      },
      { key: "connection", label: "기억 정리에 쓸 연결" },
      {
        key: "detail",
        label: "장면의 디테일",
        options: [
          ["standard", "보통"],
          ["detailed", "자세히"],
          ["very_detailed", "아주 자세히"],
        ],
      },
      {
        key: "npc",
        label: "주변 인물 정리",
        options: [
          ["standard", "기본"],
          ["expanded", "NPC·모브 자세히"],
        ],
      },
      {
        key: "quoteMode",
        label: "원문 인용 방식",
        options: [
          ["dialogue", "대사 위주"],
          ["narration", "서술 위주"],
          ["both", "대사 + 서술 · 토큰량 높음"],
        ],
      },
    ],
  },
  {
    group: "회상",
    rows: [
      {
        key: "budget",
        label: "상한",
        help: "다음 턴에 넣는 기억 최대 토큰",
        chips: [2000, 5000, 8000],
        fmt: (v) => `${v / 1000}k`,
      },
      {
        key: "recallAmount",
        label: "회상 양",
        options: [
          ["less", "적게 — 장면 2개"],
          ["normal", "보통 — 장면 4개"],
          ["more", "많이 — 장면 6개"],
        ],
      },
      {
        key: "chapterLength",
        label: "지난 이야기 흐름 길이",
        options: [
          ["short", "짧게 — 약 1,000토큰"],
          ["normal", "보통 — 약 2,000토큰"],
          ["long", "길게 — 약 4,000토큰"],
          ["full", "아주 길게 — 약 8,000토큰"],
        ],
      },
      {
        key: "recallStyle",
        label: "캐릭터가 지난 일을 먼저 꺼내는 정도",
        options: [
          ["quiet", "은은하게"],
          ["natural", "자연스럽게"],
          ["active", "적극적으로"],
        ],
      },
      {
        key: "embedding",
        label: "뜻으로 찾기 (임베딩)",
        toggle: true,
        help: "키워드가 달라도 뜻이 가까운 지난 장면을 찾아요",
      },
    ],
  },
  {
    group: "기억 언어",
    rows: [
      {
        key: "writeLanguage",
        label: "기억을 정리할 언어",
        options: [
          ["auto", "채팅 언어로"],
          ["ko", "한국어로"],
          ["en", "영어로"],
          ["zh", "중국어로 (간체)"],
        ],
      },
      {
        key: "memoryLanguage",
        label: "기억을 넣을 언어",
        options: [
          ["auto", "정리한 언어 그대로 (번역 없음)"],
          ["ko", "한국어"],
          ["en", "영어"],
          ["zh", "중국어 (간체)"],
        ],
        help: "다르면 정리할 때 한 번 번역해 두고, 답변마다 다시 번역하지 않아요",
      },
      { key: "translateConnection", label: "번역에 쓸 연결" },
    ],
  },
];

export function memoryScreen({ mount, args, go, back }) {
  const chatId = args[0];
  const view = args[1] || "home";
  let alive = true;
  let state = null;
  let open = null;
  let query = "";
  const title = h("span", { class: "h" });
  const sub = h("span", { class: "sub" });
  const toggleOn = h("button", {
    type: "button",
    class: "ib",
    hidden: true,
    style: { width: "auto", padding: "0 10px", gap: "8px", fontSize: "12px" },
  });
  mount.append(
    h(
      "header",
      { class: "top" },
      h("button", { type: "button", class: "ib", "aria-label": "뒤로", onClick: () => back("home") }, icon(I.back)),
      h("div", { class: "ttl" }, title, sub),
      toggleOn,
    ),
  );
  const body = h(
    "div",
    { class: "scroll", style: { paddingBottom: "28px" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  mount.append(body);
  const enc = encodeURIComponent(chatId);
  const sectionLabel = SECTIONS.find((s) => s.id === view)?.label;
  title.textContent = sectionLabel || "기억 서재";

  async function load() {
    try {
      const [d, chat, chars, conns, settings, connGroups, presets] = await Promise.all([
        api.get(`/mari-kit/memory/${enc}/data`),
        data.chat(chatId),
        data.characters(),
        data.connections(),
        api.get("/mari-kit/settings").catch(() => null),
        groupsOf("connections"),
        api.get("/mari-kit/memory-presets").catch(() => ({ presets: [] })),
      ]);
      if (!alive) return;
      state = {
        ...d,
        chat,
        allConns: conns,
        // Organizing and translating write text: image, video and audio connections are left out.
        conns: textConnections(conns),
        connGroups,
        presets: presets.presets || [],
        index: characterIndex(chars),
        kit: settings,
      };
      sub.textContent = chatTitle(chat, state.index);
      draw();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  }

  const patchItem = async (type, id, patch) => {
    try {
      const res = await api.patch(`/mari-kit/memory/${enc}/item`, {
        type,
        id,
        ...(patch === "delete" ? { delete: true } : { patch }),
      });
      state.memory = res.memory;
      draw();
    } catch (error) {
      toast(error.message);
    }
  };
  const addItem = async (type, itemData) => {
    try {
      const res = await api.post(`/mari-kit/memory/${enc}/item`, { type, data: itemData });
      state.memory = res.memory;
      draw();
      return true;
    } catch (error) {
      toast(error.message);
      return false;
    }
  };
  const run = async (label, fn) => {
    toast(`${label}…`);
    try {
      const msg = await fn();
      await load();
      if (msg) toast(msg);
    } catch (error) {
      toast(`${label} 실패: ${error.message}`);
    }
  };

  // ── building blocks ──
  const sec = (t, side) =>
    h(
      "div",
      { class: "gsec", style: { margin: "24px 20px 10px" } },
      h("span", null, t),
      side ? h("span", null, side) : null,
    );
  const hint = (t) => h("p", { class: "hint", style: { margin: "0", padding: "0 20px 10px" } }, t);
  const kw = (k, hit) =>
    h(
      "span",
      {
        style: {
          display: "inline-flex",
          alignItems: "center",
          height: "22px",
          padding: "0 8px",
          border: `1px solid ${hit ? "var(--ink-3)" : "var(--line)"}`,
          borderRadius: "999px",
          fontSize: "11px",
          color: hit ? "var(--ink)" : "var(--ink-2)",
        },
      },
      k,
    );
  const tag = (t) =>
    h(
      "span",
      {
        style: {
          display: "inline-flex",
          alignItems: "center",
          height: "22px",
          padding: "0 8px",
          border: "1px solid var(--ink-3)",
          borderRadius: "999px",
          fontSize: "11px",
          whiteSpace: "nowrap",
        },
      },
      t,
    );
  const pill = (t, onClick, main) =>
    h(
      "button",
      {
        type: "button",
        class: main ? "pill main" : "pill",
        style: { minHeight: "30px", padding: "0 12px", fontSize: "12px" },
        onClick,
      },
      t,
    );
  const card = (...rows) =>
    h("div", { style: { borderTop: "1px solid var(--line)", background: "var(--surface)" } }, rows);

  /** One memory row: tap to expand (meta + actions), pin and exclude always at hand. */
  function row(type, item, { title: t, text, kws = [], meta, actions = [], right, marks = true, editable = [] }) {
    const key = `${type}:${item.id}`;
    const isOpen = open === key;
    const head = h(
      "button",
      {
        type: "button",
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          minWidth: "0",
          padding: "0",
          border: "0",
          background: "transparent",
          textAlign: "left",
          cursor: "pointer",
        },
        "aria-expanded": isOpen ? "true" : "false",
        onClick: () => {
          open = isOpen ? null : key;
          draw();
        },
      },
      h("span", { style: { fontSize: "14px", lineHeight: "1.5", color: "var(--ink)" } }, t),
      text
        ? h(
            "span",
            {
              style: {
                fontSize: "13px",
                lineHeight: "1.6",
                color: "var(--ink-2)",
                ...(isOpen
                  ? { whiteSpace: "pre-wrap" }
                  : { display: "-webkit-box", WebkitLineClamp: "2", WebkitBoxOrient: "vertical", overflow: "hidden" }),
              },
            },
            text,
          )
        : null,
      kws.length
        ? h(
            "span",
            { style: { display: "flex", flexWrap: "wrap", gap: "4px" } },
            kws.map((k) => kw(k)),
          )
        : null,
      isOpen && meta ? h("span", { class: "hint" }, meta) : null,
    );
    const side = h(
      "span",
      { style: { display: "flex", alignItems: "center", gap: "2px", marginRight: "-10px" } },
      right ? h("span", { style: { marginRight: "10px" } }, right) : null,
      marks
        ? [
            h(
              "button",
              {
                type: "button",
                class: item.pinned ? "ib on" : "ib",
                style: { width: "40px", height: "40px" },
                "aria-pressed": item.pinned ? "true" : "false",
                "aria-label": "항상 넣기",
                onClick: () => patchItem(type, item.id, { pinned: !item.pinned }),
              },
              icon(["M9 4h6l-1 5 3 3H7l3-3z", "M12 12v8"], 16),
            ),
            h(
              "button",
              {
                type: "button",
                class: item.excluded ? "ib on" : "ib",
                style: { width: "40px", height: "40px" },
                "aria-pressed": item.excluded ? "true" : "false",
                "aria-label": "기억에서 빼기",
                onClick: () => patchItem(type, item.id, { excluded: !item.excluded }),
              },
              icon(
                [
                  "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z",
                  "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
                  "M4 4l16 16",
                ],
                17,
              ),
            ),
          ]
        : null,
    );
    const acts = isOpen
      ? [...actions, ...(editable.length ? [pill("고치기", () => editSheet(type, item, editable))] : [])]
      : [];
    return h(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) auto",
          alignItems: "center",
          gap: "6px 10px",
          minHeight: "60px",
          padding: "12px 20px",
          borderBottom: "1px solid var(--line)",
          opacity: item.excluded ? ".45" : "1",
        },
      },
      head,
      side,
      acts.length
        ? h(
            "span",
            { style: { gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: "6px", paddingTop: "4px" } },
            acts,
          )
        : null,
    );
  }

  const FIELD_LABEL = {
    title: "제목",
    summary: "요약",
    when: "언제",
    where: "어디",
    keywords: "키워드 (쉼표로)",
    attribute: "항목",
    value: "내용",
    text: "내용",
    due: "기한 (YY-MM-DD)",
    time: "시각 (HH:MM)",
    owner: "누가",
    to: "누구에게",
    hides: "감추는 것",
    unlock: "풀리려면",
    name: "이름",
    aliases: "다른 이름 (쉼표로)",
    note: "메모",
    who: "누가",
    what: "무엇을",
    term: "부르는 말",
    from: "부르는 사람",
    start: "시작일 (YY-MM-DD)",
    target: "목표일 (YY-MM-DD)",
    every: "주기 (일)",
  };
  function editSheet(type, item, fields, onSave) {
    const inputs = {};
    const s = sheet(
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "14px", padding: "8px 0 24px", overflowY: "auto" } },
        fields.map((f) => {
          const v = Array.isArray(item[f]) ? item[f].join(", ") : (item[f] ?? "");
          inputs[f] =
            f === "summary" || f === "text"
              ? h("textarea", { class: "inp", rows: 5, style: { resize: "vertical" } })
              : h("input", { class: "inp", type: "text" });
          inputs[f].value = v;
          return h("label", { class: "fld" }, FIELD_LABEL[f] || f, inputs[f]);
        }),
        h(
          "div",
          { style: { display: "flex", justifyContent: "flex-end", gap: "8px", padding: "0 20px" } },
          h("button", { type: "button", class: "pill", onClick: () => s.close() }, "취소"),
          h(
            "button",
            {
              type: "button",
              class: "pill main",
              onClick: async () => {
                const patch = Object.fromEntries(
                  fields.map((f) => [
                    f,
                    ["keywords", "aliases"].includes(f)
                      ? inputs[f].value
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean)
                      : inputs[f].value,
                  ]),
                );
                s.close();
                if (onSave) await onSave(patch);
                else await patchItem(type, item.id, patch);
              },
            },
            "저장",
          ),
        ),
      ),
      { label: "고치기" },
    );
  }

  // ── sections ──
  function home() {
    const { memory: m, status, lastRecall, embedding } = state;
    const meta = state.chat
      ? typeof state.chat.metadata === "string"
        ? JSON.parse(state.chat.metadata || "{}")
        : state.chat.metadata || {}
      : {};
    const on =
      state.kit?.features?.memory && meta.enableAgents === true && (meta.activeAgentIds || []).includes("mari-kit");
    toggleOn.hidden = false;
    setChildren(toggleOn, h("span", null, on ? "사용" : "안 함"), h("span", { class: on ? "sw on" : "sw" }, h("span")));
    toggleOn.onclick = () => go(`chat-settings/${enc}`);
    const counts = status.counts;
    const deadlines = m.threads
      .filter((t) => t.status === "open" && t.due)
      .map((t) => ({ t, d: daysTo(state.memory.storyDate || state.today, t.due) }))
      .sort((a, b) => (a.d ?? 9999) - (b.d ?? 9999));
    const groups = [...new Set(SECTIONS.map((s) => s.group))];
    const countOf = {
      scenes: m.scenes.length,
      facts: m.facts.filter((f) => !f.archived).length,
      ledger: m.threads.filter((t) => t.status === "open").length,
      promises: m.threads.filter((t) => t.kind === "promise" && t.status === "open").length,
      life: m.routines.length,
      world: `${m.entities.filter((e) => e.kind !== "place").length} · ${m.entities.filter((e) => e.kind === "place").length}`,
      notebook: m.notebook.length + m.keepsakes.length + m.trackers.length,
      names: m.entities.filter((e) => e.reviewSameName).length || "",
      inject: lastRecall ? `${lastRecall.tokens} tok` : "",
      settings: "",
    };
    const tools = () => {
      const s = sheet(
        h(
          "div",
          { style: { padding: "0 0 20px" } },
          [
            [
              "장부 점검",
              "끝난 일 닫기 · 겹친 항목 합치기 · 호출 1번",
              () =>
                run("장부 점검", async () => {
                  const r = await api.post(`/mari-kit/memory/${enc}/tidy`);
                  return `닫음 ${r.closed} · 합침 ${r.merged}`;
                }),
            ],
            [
              "챕터만 다시 묶기",
              "장면·사실은 그대로 두고 챕터만 새로",
              () =>
                run("챕터 다시 묶기", async () => {
                  const r = await api.post(`/mari-kit/memory/${enc}/rechapter`);
                  return `챕터 ${r.chapters}개 (호출 ${r.calls}번)`;
                }),
            ],
            [
              "마지막 정리 되돌리기",
              "방금 정리한 묶음을 취소",
              () =>
                run("되돌리기", async () => {
                  await api.post(`/mari-kit/memory/${enc}/undo`);
                  return "되돌렸어요";
                }),
            ],
            [
              "처음부터 다시 정리",
              "직접 고친 장면·사실도 사라져요 · 백업 먼저",
              () => {
                if (confirm("이 방의 기억을 비우고 처음부터 다시 정리할까요? 먼저 설정 → 백업에서 내보내 두세요."))
                  run("비우기", async () => {
                    await api.post(`/mari-kit/memory/${enc}/reset`, { confirm: true });
                    return "비웠어요. 정리를 눌러 다시 시작하세요";
                  });
              },
            ],
          ].map(([l, sub, fn]) =>
            h(
              "button",
              {
                type: "button",
                class: "r two",
                style: { gridTemplateColumns: "minmax(0,1fr)" },
                onClick: () => {
                  s.close();
                  fn();
                },
              },
              h(
                "span",
                { style: { display: "flex", flexDirection: "column", gap: "2px" } },
                l,
                h("span", { class: "hint" }, sub),
              ),
            ),
          ),
        ),
        { label: "정리 도구" },
      );
    };
    const organize = () =>
      run("정리", async () => {
        let calls = 0;
        for (let i = 0; i < 20; i += 1) {
          const r = await api.post(`/mari-kit/memory/${enc}/organize`, { force: true });
          calls += r.calls || 0;
          if (!r.organized || !r.status?.readyChunk) break;
        }
        return calls ? `정리했어요 (모델 호출 ${calls}번)` : "정리할 메시지가 없어요";
      });
    const used = lastRecall?.tokens ?? 0;
    return [
      h(
        "div",
        { style: { padding: "14px 20px 6px" } },
        h(
          "button",
          {
            type: "button",
            onClick: () => go(`memory/${enc}/search`),
            style: {
              width: "100%",
              minHeight: "40px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "0 12px",
              border: "0",
              borderRadius: "10px",
              background: "var(--fill)",
              color: "var(--ink-3)",
              fontSize: "14px",
              textAlign: "left",
              cursor: "pointer",
            },
          },
          icon(I.search, 16, 1.6),
          "기억 검색",
        ),
      ),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "8px", padding: "12px 20px 4px" } },
        h(
          "div",
          { style: { display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--ink-3)" } },
          h("span", null, `장면 ${counts.scenes} · 챕터 ${counts.chapters} · 사실 ${counts.facts}`),
          h(
            "span",
            { style: { fontVariantNumeric: "tabular-nums" } },
            `${used.toLocaleString()} / ${m.settings.budget.toLocaleString()}`,
          ),
        ),
        h(
          "div",
          { style: { height: "4px", borderRadius: "2px", background: "var(--fill)", overflow: "hidden" } },
          h("span", {
            style: {
              display: "block",
              height: "100%",
              width: `${Math.min(100, Math.round((used / m.settings.budget) * 100))}%`,
              background: "var(--ink-2)",
            },
          }),
        ),
      ),
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "12px",
            padding: "10px 8px 10px 20px",
            borderTop: "1px solid var(--line)",
            borderBottom: "1px solid var(--line)",
            background: "var(--surface)",
          },
        },
        h(
          "span",
          { style: { flex: "1", minWidth: "0", fontSize: "14px" } },
          status.waitingMessages ? `메시지 ${status.waitingMessages}개 정리 대기` : "밀린 메시지 없음",
        ),
        h(
          "button",
          {
            type: "button",
            class: "pill main",
            style: { minHeight: "32px", padding: "0 14px", fontSize: "13px" },
            onClick: organize,
          },
          "정리",
        ),
        h("button", { type: "button", class: "ib", "aria-label": "정리 도구", onClick: tools }, dots()),
      ),
      deadlines.length
        ? [
            sec("기한", m.storyDate ? `작중 오늘 ${m.storyDate}` : ""),
            card(
              deadlines.map(({ t, d }) =>
                h(
                  "div",
                  { class: "r two static" },
                  h("span", null, t.text),
                  tag(d === null ? t.due : d > 0 ? `D-${d}` : d === 0 ? "오늘" : `${-d}일 지남`),
                ),
              ),
            ),
          ]
        : null,
      lastRecall?.recalled?.length || lastRecall?.near?.length
        ? [
            sec("방금 떠오른 기억", embedding.available && m.settings.embedding ? "키워드 · 뜻" : "키워드"),
            card([
              ...lastRecall.recalled.map((r) =>
                h(
                  "div",
                  { class: "r two static" },
                  h("span", null, r.title || "장면"),
                  h(
                    "span",
                    { style: { display: "flex", gap: "4px", flexWrap: "wrap" } },
                    r.keywords.map((k) => kw(k, true)),
                  ),
                ),
              ),
              ...lastRecall.near.map((r) =>
                h("div", { class: "r two static" }, h("span", null, r.title || "장면"), tag("뜻")),
              ),
            ]),
          ]
        : null,
      groups.map((g) => [
        sec(g),
        card(
          SECTIONS.filter((s) => s.group === g).map((s) =>
            h(
              "button",
              { type: "button", class: "r", onClick: () => go(`memory/${enc}/${s.id}`) },
              h("span", { class: "ic" }, icon(s.icon, 18)),
              h("span", null, s.label),
              h("span", { class: "val" }, `${countOf[s.id] ?? ""} ›`),
            ),
          ),
        ),
      ]),
    ];
  }

  function scenes() {
    const m = state.memory;
    const loose = m.scenes
      .filter((s) => !s.chapterId)
      .slice()
      .reverse();
    const sceneRow = (s, n) =>
      row("scene", s, {
        title: `#${String(n).padStart(2, "0")} ${s.title || "장면"}`,
        text: s.summary,
        kws: s.keywords || [],
        meta: [s.when, s.where, (s.participants || []).join(", "), s.manual ? "직접 고침" : ""]
          .filter(Boolean)
          .join(" · "),
        editable: ["title", "summary", "when", "where", "keywords"],
      });
    const number = new Map(m.scenes.map((s, i) => [s.id, i + 1]));
    return [
      loose.length
        ? [sec("최근 장면"), card(loose.map((s) => sceneRow(s, number.get(s.id))))]
        : h("div", { class: "empty" }, "아직 정리된 장면이 없어요."),
      m.chapters
        .slice()
        .reverse()
        .map((c, i) => [
          sec(`${m.chapters.length - i}장${c.title ? ` · ${c.title}` : ""}`, "챕터"),
          card(
            row("chapter", c, {
              title: c.summary.slice(0, 80),
              text: c.summary,
              kws: c.keywords || [],
              editable: ["title", "summary", "keywords"],
            }),
            m.scenes.filter((s) => s.chapterId === c.id).map((s) => sceneRow(s, number.get(s.id))),
          ),
        ]),
    ];
  }

  function facts() {
    const m = state.memory;
    const name = new Map(m.entities.map((e) => [e.id, e.name]));
    const live = m.facts.filter((f) => !f.archived);
    const conflicts = m.conflicts.filter((c) => c.status === "open");
    const answer = (c, a) =>
      run("기록 정리", async () => {
        await api.post(`/mari-kit/memory/${enc}/conflict`, { id: c.id, answer: a });
      });
    return [
      sec("알게 된 사실", "누가 아는지"),
      live.length
        ? card(
            live.map((f) =>
              row("fact", f, {
                title: `${name.get(f.entityId) ?? "?"} · ${f.attribute}`,
                text: f.value,
                kws: f.knownBy ? [`아는 사람: ${f.knownBy.join(", ")}`] : ["아는 사람: 모두"],
                meta: (f.history || []).length ? `이전: ${f.history.map((x) => x.value).join(" → ")}` : "",
                editable: ["attribute", "value"],
              }),
            ),
          )
        : hint("아직 없어요."),
      conflicts.length
        ? [
            sec(`어긋나 보이는 기록 ${conflicts.length}개`),
            hint("같은 대상의 기록이 바뀌었어요. 실수인지 확인해 주세요."),
            card(
              conflicts.map((c) => {
                const f = m.facts.find((x) => x.id === c.factId);
                return row("conflict", c, {
                  title: `${f ? `${name.get(f.entityId) ?? "?"} · ${f.attribute}` : "기록"}: “${c.before}” ↔ “${c.after}”`,
                  marks: false,
                  actions: [
                    pill("앞의 것 유지", () => answer(c, "keepA")),
                    pill("뒤의 것 유지", () => answer(c, "keepB")),
                    pill("둘 다 맞음", () => answer(c, "both")),
                    pill("무시", () => answer(c, "dismiss")),
                  ],
                });
              }),
            ),
          ]
        : null,
      state.ooc.length
        ? [
            sec(`OOC로 본 메시지 ${state.ooc.length}개`),
            hint("(OOC, ((, [OOC 로 시작하는 내 메시지는 이야기로 기록하지 않아요."),
            card(
              state.ooc.map((o) =>
                h("div", { class: "r two static" }, h("span", { style: { fontSize: "13px" } }, o.text)),
              ),
            ),
          ]
        : null,
    ];
  }

  function threadRow(t) {
    const outcomes = Object.entries(OUTCOME).map(([k, l]) =>
      pill(l, () => patchItem("thread", t.id, { status: "resolved", outcome: k })),
    );
    return row("thread", t, {
      title: t.text,
      text: [t.hides && `감추는 것: ${t.hides}`, t.unlock && `풀리려면: ${t.unlock}`].filter(Boolean).join(" · "),
      kws: t.keywords || [],
      right: t.due ? tag(t.due) : null,
      meta: [
        t.owner && `${t.owner}${t.to ? ` → ${t.to}` : ""}`,
        t.knownBy ? `${t.knownBy.join(", ")}만 앎` : "",
        t.manual ? "직접 고침" : "",
      ]
        .filter(Boolean)
        .join(" · "),
      actions:
        t.status === "open"
          ? [h("span", { class: "hint", style: { alignSelf: "center" } }, "끝난 일로:"), ...outcomes]
          : [pill("다시 열기", () => patchItem("thread", t.id, { status: "open", outcome: "" }))],
      editable: ["text", "due", "time", "owner", "to", "hides", "unlock", "keywords"],
    });
  }

  function addThreadSheet(kind) {
    editSheet("thread", { text: "", due: "", owner: "", to: "" }, ["text", "due", "owner", "to"], (d) =>
      addItem("thread", { ...d, kind }),
    );
  }

  function ledger() {
    const m = state.memory;
    const openT = m.threads.filter((t) => t.status === "open");
    const closed = m.threads.filter((t) => t.status !== "open");
    return [
      KIND_ORDER.filter((k) => k !== "deadline" && k !== "open").map((k) => {
        const rows = openT.filter(
          (t) => t.kind === k || (k === "pending" && (t.kind === "open" || t.kind === "deadline")),
        );
        return rows.length ? [sec(KIND[k], String(rows.length)), card(rows.map(threadRow))] : null;
      }),
      !openT.length ? hint("열린 항목이 없어요.") : null,
      h(
        "div",
        { style: { padding: "12px 20px 0" } },
        pill("직접 추가", () => addThreadSheet("pending")),
      ),
      closed.length ? [sec(`닫힌 항목 ${closed.length}개`), card(closed.slice().reverse().map(threadRow))] : null,
    ];
  }

  function promises() {
    const m = state.memory;
    const list = m.threads.filter((t) => t.kind === "promise");
    const openT = list
      .filter((t) => t.status === "open")
      .sort((a, b) => String(a.due || "9").localeCompare(String(b.due || "9")));
    const ended = list.filter((t) => t.status !== "open");
    return [
      sec("약속", "기한 가까운 순"),
      openT.length ? card(openT.map(threadRow)) : hint("열린 약속이 없어요."),
      h(
        "div",
        { style: { padding: "12px 20px 0" } },
        pill("약속 추가", () => addThreadSheet("promise")),
      ),
      ended.length
        ? [
            sec(`끝난 약속 ${ended.length}개`, "지킨 것·깨진 것·취소된 것"),
            card(
              ended.map((t) =>
                row("thread", t, {
                  title: t.text,
                  right: tag(OUTCOME[t.outcome] || "끝남"),
                  marks: false,
                  actions: [pill("다시 열기", () => patchItem("thread", t.id, { status: "open" }))],
                }),
              ),
            ),
          ]
        : null,
    ];
  }

  function life() {
    const m = state.memory;
    const byWho = new Map();
    for (const r of m.routines) byWho.set(r.who, [...(byWho.get(r.who) || []), r]);
    return [
      [...byWho].map(([who, rows]) => [
        sec(`${who} · 기록 ${rows.length}개`),
        card(
          rows
            .slice(-12)
            .reverse()
            .map((r) =>
              row("routine", r, {
                title: `${ROUTINE[r.kind] || r.kind} · ${r.what}`,
                editable: ["who", "what"],
                actions: [pill("지우기", () => patchItem("routine", r.id, "delete"))],
              }),
            ),
        ),
      ]),
      !m.routines.length ? hint("정리할 때 식사·잠·씻기 같은 생활 기록이 쌓여요.") : null,
      h(
        "div",
        { style: { padding: "12px 20px 0" } },
        pill("기록 추가", () =>
          editSheet("routine", { who: "", what: "" }, ["who", "what"], (d) =>
            addItem("routine", { ...d, kind: "other" }),
          ),
        ),
      ),
    ];
  }

  function world() {
    const m = state.memory;
    const people = m.entities.filter((e) => e.kind !== "place");
    const places = m.entities.filter((e) => e.kind === "place");
    const factsOf = (e) =>
      m.facts
        .filter((f) => f.entityId === e.id && !f.archived)
        .map((f) => `${f.attribute}: ${f.value}`)
        .join(" · ");
    return [
      sec("인물 현재 상태"),
      people.length
        ? card(
            people.map((e) =>
              row("entity", e, {
                title: e.name,
                text: factsOf(e),
                kws: e.aliases || [],
                marks: false,
                editable: ["name", "aliases"],
              }),
            ),
          )
        : hint("아직 없어요."),
      sec("장소"),
      places.length
        ? card(
            places.map((e) =>
              row("entity", e, {
                title: e.name,
                text: factsOf(e),
                meta: `${m.scenes.filter((s) => s.where && s.where.includes(e.name)).length}개 장면`,
                marks: false,
                editable: ["name", "aliases"],
              }),
            ),
          )
        : hint("아직 없어요."),
    ];
  }

  function notebook() {
    const m = state.memory;
    const byWho = new Map();
    for (const n of m.notebook) byWho.set(n.who, [...(byWho.get(n.who) || []), n]);
    const tracker = (t) => {
      const now = t.clock === "real" ? state.today : m.storyDate || state.today;
      const d = t.type === "until" ? daysTo(now, t.target) : daysTo(t.start, now);
      const label =
        d === null
          ? "날짜 모름"
          : t.type === "until"
            ? d > 0
              ? `D-${d}`
              : d === 0
                ? "오늘"
                : `${-d}일 지남`
            : t.type === "cycle"
              ? `${(((d % (t.every || 1)) + (t.every || 1)) % (t.every || 1)) + 1}/${t.every}일째`
              : `${d + 1}일째`;
      return row("tracker", t, {
        title: t.title,
        right: tag(label),
        meta: `${{ count: "며칠째", until: "D-day", cycle: "주기" }[t.type]} · ${t.clock === "real" ? "실제 날짜" : "이야기 날짜"} · ${{ present: "관련 인물이 있을 때 넣음", always: "항상 넣음", never: "넣지 않음" }[t.inject]}`,
        marks: false,
        editable: ["title", "start", "target", "every", "who"],
        actions: [pill("지우기", () => patchItem("tracker", t.id, "delete"))],
      });
    };
    const addTracker = () => {
      const s = sheet(
        h(
          "div",
          { style: { padding: "0 0 20px" } },
          [
            ["count", "며칠째 (시작일부터 센다)"],
            ["until", "D-day (목표일까지 센다)"],
            ["cycle", "주기 (반복되는 일)"],
          ].map(([type, l]) =>
            h(
              "button",
              {
                type: "button",
                class: "r two",
                style: { gridTemplateColumns: "minmax(0,1fr)" },
                onClick: () => {
                  s.close();
                  editSheet(
                    "tracker",
                    { title: "", start: state.today, target: "", every: 7, who: "" },
                    [
                      "title",
                      ...(type === "until" ? ["target"] : ["start"]),
                      ...(type === "cycle" ? ["every"] : []),
                      "who",
                    ],
                    (d) => addItem("tracker", { ...d, type, inject: "present", clock: "story" }),
                  );
                },
              },
              l,
            ),
          ),
        ),
        { label: "트래커 종류" },
      );
    };
    return [
      [...byWho].map(([who, rows]) => [
        sec(`인물의 수첩 · ${who}`),
        card(
          rows
            .slice()
            .reverse()
            .map((n) =>
              row("notebook", n, {
                title: n.text,
                meta: n.kind === "heart" ? "속마음·다짐" : "대하는 법",
                right: n.star ? tag("★ 중요") : null,
                marks: false,
                editable: ["text"],
                actions: [
                  pill(n.star ? "☆ 중요 해제" : "★ 중요로 표시", () => patchItem("notebook", n.id, { star: !n.star })),
                  pill("지우기", () => patchItem("notebook", n.id, "delete")),
                ],
              }),
            ),
        ),
      ]),
      !m.notebook.length ? [sec("인물의 수첩"), hint("정리할 때 대하는 법·속마음이 쌓여요.")] : null,
      sec("소중한 물건"),
      m.keepsakes.length
        ? card(
            m.keepsakes.map((k) =>
              row("keepsake", k, {
                title: k.name,
                text: k.note,
                meta: k.owner ? `가진 사람: ${k.owner}` : "",
                marks: false,
                editable: ["name", "owner", "note"],
                actions: [pill("지우기", () => patchItem("keepsake", k.id, "delete"))],
              }),
            ),
          )
        : hint("아직 없어요."),
      h(
        "div",
        { style: { padding: "12px 20px 0" } },
        pill("물건 추가", () =>
          editSheet("keepsake", { name: "", owner: "", note: "" }, ["name", "owner", "note"], (d) =>
            addItem("keepsake", d),
          ),
        ),
      ),
      sec("날짜·주기 트래커", m.storyDate ? `작중 오늘 ${m.storyDate}` : ""),
      m.trackers.length ? card(m.trackers.map(tracker)) : hint("아직 없어요."),
      h("div", { style: { padding: "12px 20px 0" } }, pill("트래커 추가", addTracker)),
    ];
  }

  function names() {
    const m = state.memory;
    const review = m.entities.filter((e) => e.reviewSameName);
    const merge = (e) => {
      const others = m.entities.filter((x) => x.id !== e.id && x.kind === e.kind);
      const s = sheet(
        h(
          "div",
          { style: { padding: "0 0 20px" } },
          h("div", { class: "hint", style: { padding: "4px 20px 10px" } }, `“${e.name}”을(를) 합칠 대상`),
          others.map((o) =>
            h(
              "button",
              {
                type: "button",
                class: "r two",
                style: { gridTemplateColumns: "minmax(0,1fr)" },
                onClick: () => {
                  s.close();
                  run("합치기", async () => {
                    await api.post(`/mari-kit/memory/${enc}/merge`, { fromId: e.id, intoId: o.id });
                    return `${e.name} → ${o.name}`;
                  });
                },
              },
              o.name,
            ),
          ),
        ),
        { label: "합치기" },
      );
    };
    return [
      sec("별칭 표"),
      m.entities.length
        ? card(
            m.entities
              .filter((e) => e.kind !== "place")
              .map((e) =>
                row("entity", e, {
                  title: e.name,
                  text: (e.aliases || []).join(" · "),
                  marks: false,
                  editable: ["name", "aliases"],
                  actions: [pill("다른 항목과 합치기", () => merge(e))],
                }),
              ),
          )
        : hint("아직 없어요."),
      sec("호칭 사전", "누가 누구를 어떻게 부르는지"),
      m.addresses.length
        ? card(
            m.addresses.map((a) =>
              row("address", a, {
                title: `${a.from} → ${a.to}: “${a.term}”`,
                text: a.note,
                marks: false,
                editable: ["from", "to", "term", "note"],
                actions: [pill("지우기", () => patchItem("address", a.id, "delete"))],
              }),
            ),
          )
        : hint("아직 없어요."),
      h(
        "div",
        { style: { padding: "12px 20px 0" } },
        pill("호칭 추가", () =>
          editSheet("address", { from: "", to: "", term: "", note: "" }, ["from", "to", "term", "note"], (d) =>
            addItem("address", d),
          ),
        ),
      ),
      review.length
        ? [
            sec(`같은 사람일 수 있음 ${review.length}개`),
            hint("이름이 같아 자동으로 합치지 않았어요."),
            card(
              review.map((e) =>
                row("entity", e, {
                  title: e.name,
                  marks: false,
                  actions: [
                    pill("같은 사람 · 합치기", () => merge(e)),
                    pill("다른 사람", () => patchItem("entity", e.id, { name: e.name })),
                  ],
                }),
              ),
            ),
          ]
        : null,
    ];
  }

  function inject() {
    const out = h("div");
    const input = h("input", { class: "inp", type: "text", placeholder: "예: 그때 역에서 한 약속 기억나?" });
    const show = (r, label) =>
      setChildren(
        out,
        sec(label, `${r.tokens} / ${state.memory.settings.budget} 토큰`),
        card(
          (r.report || []).map((x) =>
            h(
              "div",
              { class: "r two static" },
              h(
                "span",
                null,
                {
                  story_so_far: "지난 이야기 흐름",
                  open_threads: "아직 끝나지 않은 일",
                  pinned: "항상 넣는 기억",
                  current_state: "지금 상태",
                  character_notes: "인물의 수첩",
                  forms_of_address: "호칭",
                  trackers: "트래커",
                  recalled_scenes: "떠오른 장면 (키워드)",
                  near_events: "뜻이 가까운 장면",
                  last_scene: "바로 전 장면",
                }[x.section] || x.section,
              ),
              h("span", { class: "hint" }, `${x.items}개 · ${x.tokens} 토큰`),
            ),
          ),
        ),
        (r.recalled || []).length
          ? card(
              r.recalled.map((x) =>
                h(
                  "div",
                  { class: "r two static" },
                  h("span", null, x.title || "장면"),
                  h(
                    "span",
                    { style: { display: "flex", gap: "4px" } },
                    x.keywords.map((k) => kw(k, true)),
                  ),
                ),
              ),
            )
          : null,
        r.text
          ? h(
              "pre",
              {
                style: {
                  margin: "16px 20px 0",
                  padding: "12px",
                  borderRadius: "10px",
                  background: "var(--fill)",
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  fontSize: "12px",
                  lineHeight: "1.6",
                  color: "var(--ink-2)",
                },
              },
              r.text,
            )
          : hint("들어갈 기억이 없어요."),
      );
    api
      .get(`/mari-kit/memory/${enc}/preview`)
      .then((r) => alive && show(r, "다음 답변에 들어갈 기억"))
      .catch((e) => setChildren(out, errorBox(e)));
    return [
      sec("회상 시험"),
      hint("보낼 메시지를 적으면 답변은 만들지 않고 어떤 기억이 떠오르는지만 보여 줘요."),
      h(
        "div",
        { style: { display: "flex", gap: "8px", padding: "0 20px" } },
        input,
        h(
          "button",
          {
            type: "button",
            class: "pill",
            style: { flexShrink: "0" },
            onClick: async () => {
              try {
                show(
                  await api.post(`/mari-kit/memory/${enc}/recall-test`, { text: input.value }),
                  "이 메시지로 떠오를 기억",
                );
              } catch (e) {
                toast(e.message);
              }
            },
          },
          "시험",
        ),
      ),
      out,
    ];
  }

  function settings() {
    const m = state.memory;
    const s = m.settings;
    const save = async (patch) => {
      try {
        const res = await api.patch(`/mari-kit/memory/${enc}/settings`, patch);
        void res;
        await load();
      } catch (error) {
        toast(error.message);
      }
    };
    const contextLimit = Number(chatMeta(state.chat).contextMessageLimit) || 0;
    const setContextLimit = async (v) => {
      try {
        await api.patch(`/chats/${enc}/metadata`, { contextMessageLimit: v > 0 ? v : null });
        await load();
      } catch (error) {
        toast(error.message);
      }
    };
    const connSelect = (value, empty, onPick) =>
      h(
        "select",
        { class: "inp", onChange: (e) => onPick(e.target.value || null) },
        groupedOptions(
          h,
          value,
          [["", empty]],
          splitByGroup(state.conns, state.connGroups, { folderOf: (c) => c.folderId }),
          (c) => [c.id, c.name],
        ),
      );
    const control = (r) => {
      if (r.chips) {
        const cur = r.key === "chunk" ? m.chunkMessages : r.key === "context" ? contextLimit : s[r.key];
        const set = (v) =>
          r.key === "chunk"
            ? save({ chunkMessages: v })
            : r.key === "context"
              ? setContextLimit(v)
              : save({ settings: { [r.key]: v } });
        const chips = r.chips.map((v) =>
          h(
            "button",
            {
              type: "button",
              class: cur === v ? "chip on" : "chip",
              "aria-pressed": cur === v ? "true" : "false",
              onClick: (e) => (e.preventDefault(), set(v)),
            },
            r.fmt ? r.fmt(v) : String(v),
          ),
        );
        if (!r.range) return h("span", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, chips);
        // Any number in the range: type it, then leave the box (or press Enter).
        const [lo, hi] = r.range;
        const box = h("input", {
          class: "inp",
          type: "number",
          inputmode: "numeric",
          min: lo,
          max: hi,
          value: cur ?? 0,
          "aria-label": r.label,
          style: { width: "88px", textAlign: "center" },
          onChange: (e) => {
            const v = Math.round(Number(e.target.value));
            if (!Number.isFinite(v)) return;
            const n = Math.min(hi, Math.max(lo, v));
            if (n !== cur) set(n);
          },
        });
        return h(
          "span",
          { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
          box,
          chips,
        );
      }
      if (r.toggle)
        return h(
          "button",
          {
            type: "button",
            role: "switch",
            "aria-checked": s[r.key] ? "true" : "false",
            style: {
              alignSelf: "flex-start",
              display: "inline-flex",
              width: "44px",
              height: "28px",
              alignItems: "center",
              border: "0",
              background: "transparent",
              padding: "0",
              cursor: "pointer",
            },
            onClick: () => save({ settings: { [r.key]: !s[r.key] } }),
          },
          h("span", { class: s[r.key] ? "sw on" : "sw" }, h("span")),
        );
      const value =
        r.key === "connection"
          ? m.connectionId || ""
          : r.key === "translateConnection"
            ? s.translateConnectionId || ""
            : s[r.key];
      if (r.key === "connection") return connSelect(value, "채팅 연결 그대로", (v) => save({ connectionId: v }));
      if (r.key === "translateConnection")
        return connSelect(value, "채팅 연결 그대로", (v) => save({ settings: { translateConnectionId: v } }));
      const opts = r.options;
      return h(
        "select",
        {
          class: "inp",
          onChange: (e) => save({ settings: { [r.key]: e.target.value } }),
        },
        opts.map(([v, t]) => h("option", { value: v, selected: String(value) === v }, t)),
      );
    };
    const emb = state.embedding;
    // 임베딩 연결: the Engine's agent setting for Mari Kit picks the connection whose embedding model is used.
    // Only connections with an embedding model set are offered; 엔진 기본 follows the app's default.
    const embeddingPicker = () => {
      const withModel = state.allConns.filter((c) => String(c.embeddingModel || "").trim());
      return h(
        "select",
        {
          class: "inp",
          "aria-label": "임베딩 연결",
          onChange: async (e) => {
            try {
              await api.patch("/agents/type/mari-kit", { connectionId: e.target.value || null });
              toast("임베딩 연결을 바꿨어요 · 다시 색인을 눌러 주세요");
              await load();
            } catch (error) {
              toast(error.message);
            }
          },
        },
        groupedOptions(
          h,
          emb.connectionId || "",
          [["", "엔진 기본 (없으면 기기 안 무료 임베딩)"]],
          splitByGroup(withModel, state.connGroups, { folderOf: (c) => c.folderId }),
          (c) => [c.id, `${c.name} · ${c.embeddingModel}`],
        ),
      );
    };
    const backup = async () => {
      try {
        const data = await api.get(`/mari-kit/memory/${enc}/export`);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const a = h("a", { href: URL.createObjectURL(blob), download: `memory-${chatId}.json` });
        document.body.append(a);
        a.click();
        a.remove();
      } catch (error) {
        toast(error.message);
      }
    };
    const file = h("input", {
      type: "file",
      accept: "application/json",
      class: "sr",
      onChange: async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try {
          await api.post(`/mari-kit/memory/${enc}/import`, JSON.parse(await f.text()));
          toast("가져왔어요");
          await load();
        } catch (error) {
          toast(`가져오지 못했어요: ${error.message}`);
        }
      },
    });
    const fromRoom = async () => {
      // Only rooms that have something to copy: picking an empty one would just wipe this room.
      const [all, withMemory] = await Promise.all([data.chats(), api.get("/mari-kit/memory-rooms")]);
      const counts = new Map((withMemory || []).map((r) => [r.id, r.counts]));
      const chats = all
        .filter((c) => c.id !== chatId && counts.has(c.id))
        .map((c) => ({ ...c, counts: counts.get(c.id) }));
      if (!chats.length) return toast("기억이 있는 다른 방이 없어요");
      const sh = sheet(
        h(
          "div",
          { style: { padding: "0 0 20px" } },
          h(
            "div",
            { class: "hint", style: { padding: "4px 20px 10px" } },
            "어느 방의 기억을 이 방에 옮길까요? 지금 이 방의 기억은 되돌리기로만 돌아와요.",
          ),
          chats.map((c) =>
            h(
              "button",
              {
                type: "button",
                class: "r two",
                onClick: () => {
                  sh.close();
                  run("옮기기", async () => {
                    await api.post(`/mari-kit/memory/${enc}/import`, { fromChatId: c.id });
                    return "옮겼어요";
                  });
                },
              },
              h("span", null, chatTitle(c, state.index)),
              h(
                "span",
                { class: "hint" },
                `장면 ${c.counts.scenes} · 사실 ${c.counts.facts} · 장부 ${c.counts.openThreads}`,
              ),
            ),
          ),
        ),
        { label: "다른 방에서" },
      );
    };
    // 프리셋: the 정리·회상 numbers and choices of this chat, saved under a name and applied to any chat.
    const presets = state.presets || [];
    const savePresets = async (list, done) => {
      try {
        state.presets = (await api.put("/mari-kit/memory-presets", { presets: list })).presets;
        toast(done);
        draw();
      } catch (error) {
        toast(error.message);
      }
    };
    const current = () => ({
      chunkMessages: m.chunkMessages,
      contextMessageLimit: contextLimit || null,
      settings: { ...s },
    });
    const applyPreset = async (p) => {
      try {
        await api.patch(`/mari-kit/memory/${enc}/settings`, {
          chunkMessages: p.chunkMessages,
          settings: { ...p.settings, translateConnectionId: s.translateConnectionId },
        });
        await api.patch(`/chats/${enc}/metadata`, { contextMessageLimit: p.contextMessageLimit || null });
        toast(`'${p.name}' 적용`);
        await load();
      } catch (error) {
        toast(error.message);
      }
    };
    const same = (p) =>
      p.chunkMessages === m.chunkMessages &&
      (p.contextMessageLimit || 0) === contextLimit &&
      Object.keys(p.settings).every((k) => p.settings[k] === s[k]);
    const presetName = h("input", {
      class: "inp",
      placeholder: "프리셋 이름",
      maxlength: 40,
      "aria-label": "프리셋 이름",
    });
    const presetBlock = [
      sec("프리셋", presets.length ? "눌러서 적용" : ""),
      presets.length
        ? h(
            "div",
            { style: { display: "flex", flexWrap: "wrap", gap: "8px", padding: "0 20px 12px" } },
            presets.map((p) =>
              h(
                "button",
                {
                  type: "button",
                  class: same(p) ? "chip on" : "chip",
                  "aria-pressed": same(p) ? "true" : "false",
                  onClick: () => applyPreset(p),
                },
                p.name,
              ),
            ),
          )
        : hint("자주 쓰는 설정을 이름 붙여 두면 다른 방에서도 한 번에 적용해요."),
      h(
        "div",
        { class: "rowform", style: { padding: "0 20px" } },
        presetName,
        pill("지금 설정 저장", () => {
          const name = presetName.value.trim();
          if (!name) return toast("프리셋 이름을 적어 주세요");
          const old = presets.find((p) => p.name === name);
          const next = old
            ? presets.map((p) => (p === old ? { ...p, ...current() } : p))
            : [...presets, { id: Math.random().toString(36).slice(2, 10), name, ...current() }];
          savePresets(next, old ? `'${name}'을 지금 설정으로 바꿨어요` : `'${name}' 저장`);
        }),
      ),
      presets.length
        ? h(
            "details",
            { style: { padding: "10px 20px 0" } },
            h("summary", { class: "hint", style: { cursor: "pointer", minHeight: "32px" } }, "프리셋 지우기"),
            h(
              "div",
              { style: { display: "flex", flexWrap: "wrap", gap: "8px", paddingTop: "8px" } },
              presets.map((p) =>
                pill(`${p.name} 지우기`, () =>
                  confirm(`'${p.name}' 프리셋을 지울까요?`)
                    ? savePresets(
                        presets.filter((x) => x !== p),
                        "지웠어요",
                      )
                    : null,
                ),
              ),
            ),
          )
        : null,
    ];
    return [
      presetBlock,
      SETTINGS.map((g) => [
        sec(g.group),
        card(
          g.rows.map((r) =>
            h(
              "label",
              {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  padding: "14px 20px",
                  borderBottom: "1px solid var(--line)",
                },
              },
              h("span", { style: { fontSize: "14px" } }, r.label),
              control(r),
              r.key === "embedding"
                ? [
                    s.embedding ? embeddingPicker() : null,
                    h(
                      "span",
                      { class: "hint" },
                      emb.available
                        ? `지금 쓰는 것: ${emb.label || "기기 안 무료 임베딩"} · 색인된 장면 ${emb.indexed ?? 0}/${m.scenes.length}`
                        : "임베딩을 쓸 수 없어요",
                    ),
                  ]
                : r.help
                  ? h("span", { class: "hint" }, r.help)
                  : null,
            ),
          ),
        ),
      ]),
      h(
        "div",
        { style: { display: "flex", flexWrap: "wrap", gap: "6px", padding: "12px 20px 0" } },
        s.embedding
          ? pill("다시 색인", () =>
              run("색인", async () => `${(await api.post(`/mari-kit/memory/${enc}/reindex`)).indexed}개 장면 색인`),
            )
          : null,
        s.memoryLanguage !== "auto"
          ? pill("남은 항목 번역", () =>
              run("번역", async () => {
                const r = await api.post(`/mari-kit/memory/${enc}/translate`);
                return `${r.translated}개 번역 (호출 ${r.calls}번)`;
              }),
            )
          : null,
      ),
      sec("백업"),
      h(
        "div",
        { style: { display: "flex", flexWrap: "wrap", gap: "6px", padding: "0 20px" } },
        pill("내보내기", backup),
        h(
          "label",
          {
            class: "pill",
            style: {
              minHeight: "30px",
              padding: "0 12px",
              fontSize: "12px",
              display: "inline-flex",
              alignItems: "center",
            },
          },
          "가져오기",
          file,
        ),
        pill("다른 방 백업을 이 방에 적용", fromRoom),
      ),
    ];
  }

  function search() {
    const results = h("div");
    const input = h("input", { class: "inp", type: "search", placeholder: "이름, 대사, 장소 등", value: query });
    const runSearch = async () => {
      query = input.value.trim();
      if (!query) return setChildren(results);
      try {
        const r = await api.get(`/mari-kit/memory/${enc}/search?q=${encodeURIComponent(query)}`);
        setChildren(
          results,
          sec(`“${query}” 결과 ${r.results.length}개`),
          r.results.length
            ? card(
                r.results.map((x) =>
                  h(
                    "div",
                    { class: "r two static", style: { alignItems: "start" } },
                    h(
                      "span",
                      { style: { display: "flex", flexDirection: "column", gap: "4px" } },
                      x.title,
                      h("span", { class: "hint", style: { fontSize: "13px" } }, x.body),
                    ),
                    tag(
                      x.by === "meaning"
                        ? "뜻"
                        : { scene: "장면", chapter: "챕터", fact: "사실", thread: "장부", notebook: "수첩" }[x.type],
                    ),
                  ),
                ),
              )
            : hint("일치하는 기억이 없어요."),
        );
      } catch (error) {
        toast(error.message);
      }
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && runSearch());
    queueMicrotask(() => input.focus());
    if (query) runSearch();
    return [
      h(
        "div",
        { style: { display: "flex", gap: "8px", padding: "16px 20px 4px" } },
        input,
        h("button", { type: "button", class: "pill", style: { flexShrink: "0" }, onClick: runSearch }, "검색"),
      ),
      results,
    ];
  }

  const VIEWS = { home, scenes, facts, ledger, promises, life, world, notebook, names, inject, settings, search };
  function draw() {
    if (!state) return;
    toggleOn.hidden = view !== "home";
    setChildren(body, (VIEWS[view] || home)());
  }

  load();
  return { dispose: () => (alive = false) };
}

function daysTo(from, to) {
  const parse = (d) => {
    const m = /^(\d{2,4})-(\d{1,2})-(\d{1,2})$/.exec(String(d || ""));
    if (!m) return null;
    return Date.UTC(m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  const a = parse(from);
  const b = parse(to);
  return a === null || b === null ? null : Math.round((b - a) / 86400000);
}
