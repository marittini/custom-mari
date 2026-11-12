// Chat settings for one room.
//   #/chat-settings/<chatId>          자주: what a chat changes often, one tap each
//   #/chat-settings/<chatId>/<view>   번역 · 등장 캐릭터 · 작가 노트 · Mari Kit · 화면 · 모든 채팅 설정 (all/<group>)
// 모든 채팅 설정 lists every section of the Engine's own Chat Settings for this chat's mode, in four groups. Sections
// the shell draws open here; the rest open the Engine at that section (Mari Kit's Engine-side script, with a pill back).

import { h, icon, I, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data, characterIndex, chatMeta, chatTitle } from "../lib/data.js";
import { setPrefs, isDark, TOOL_DEFS, toolPlace } from "../lib/prefs.js";
import { topBar, toast, errorBox, openEngine, sheet, avatar } from "../lib/ui.js";

// Every section of the Engine's Chat Settings (2.5.2), by the group the shell shows it in. [label, section id
// without its mode prefix, modes, the shell view that draws it (null: the Engine's)]. The daily upstream check
// compares this list with the Engine's, so a new Engine section shows up as a report instead of going missing.
const BOTH = ["conversation", "roleplay"];
export const ENGINE_SECTIONS = {
  채팅: [
    ["채팅 이름", "chat-name", BOTH, "name"],
    ["연결 · 프리셋 · 페르소나", "connection", BOTH, ""],
    ["등장 캐릭터", "characters", BOTH, "cast"],
    ["번역", "translation", BOTH, "translation"],
    ["단체 대화", "group-chat", BOTH, null],
    ["로어북", "lorebooks", BOTH, null],
    ["채팅 변수", "chat-variables", BOTH, null],
    ["자율 메시지", "autonomous-messaging", ["conversation"], null],
    ["연결된 채팅", "connected-chats", BOTH, null],
    ["함수 호출", "function-calling", BOTH, null],
    ["고급 파라미터", "advanced-parameters", BOTH, null],
    ["사칭 (Impersonate)", "impersonate", ["roleplay"], null],
  ],
  컨텍스트: [
    ["작가 노트", "author-notes", ["roleplay"], "author"],
    ["채팅 요약", "chat-summary", ["roleplay"], null],
    ["활성 컨텍스트", "active-context", BOTH, null],
  ],
  기억: [
    ["기억 회상", "memory-recall", BOTH, null],
    ["자동 요약", "automatic-summarization", ["conversation"], null],
  ],
  기타: [
    ["Mari Kit · 음성 · 번역 · 기억", "", BOTH, "kit"],
    ["화면", "", BOTH, "view"],
    ["에이전트", "agents", BOTH, null],
    ["메시지 검색", "message-search", ["conversation"], null],
    ["채팅 분기", "chat-branches", BOTH, null],
    ["갤러리", "gallery", BOTH, null],
    ["에이전트 활동", "agent-activity", ["roleplay"], null],
    ["배경", "background", ["roleplay"], null],
  ],
};
const VIEW_TITLES = {
  translation: "번역",
  cast: "등장 캐릭터",
  author: "작가 노트",
  kit: "Mari Kit · 기능",
  view: "화면",
  all: "모든 채팅 설정",
};

export function chatSettingsScreen({ mount, args, go, back }) {
  const chatId = args[0];
  const view = args[1] || "";
  let group = args[2] && ENGINE_SECTIONS[args[2]] ? args[2] : "채팅";
  const here = (v = "") => `chat-settings/${encodeURIComponent(chatId)}${v ? `/${v}` : ""}`;
  let alive = true;
  let state = null;
  const tabs = h("div", { class: "tabs2", role: "tablist", "aria-label": "설정 묶음", hidden: view !== "all" });
  const body = h(
    "div",
    { class: "scroll", style: { paddingBottom: "28px" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  mount.append(
    topBar({ back: () => back(view ? here() : "convos"), title: VIEW_TITLES[view] || "채팅 설정", sub: " " }),
    tabs,
    body,
  );

  const sw = (on) => h("span", { class: on ? "sw on" : "sw" }, h("span"));
  const selectRow = (path, label, value, options, onChange) =>
    h(
      "label",
      { class: "r static" },
      h("span", { class: "ic" }, icon(path)),
      h("span", null, label),
      h(
        "select",
        { class: "sel", style: { width: "170px" }, onChange: (e) => onChange(e.target.value) },
        options.map(([v, text]) => h("option", { value: v, selected: (value || "") === v }, text)),
      ),
    );
  const linkRow = (path, label, value, onClick) =>
    h(
      "button",
      { type: "button", class: "r", onClick },
      h("span", { class: "ic" }, icon(path)),
      h("span", null, label),
      h("span", { class: "val" }, `${value} ›`),
    );
  const switchRow = (path, label, on, onClick, hint) =>
    h(
      "button",
      { type: "button", class: "r", role: "switch", "aria-checked": on ? "true" : "false", onClick },
      h("span", { class: "ic" }, icon(path)),
      h(
        "span",
        { style: { display: "flex", flexDirection: "column", gap: "2px" } },
        label,
        hint ? h("span", { class: "hint" }, hint) : null,
      ),
      sw(on),
    );

  async function load() {
    try {
      const [chat, conns, presets, personas, chars, settings, voice] = await Promise.all([
        data.chat(chatId),
        data.connections(),
        api.get("/prompts").catch(() => []),
        data.personas(),
        data.characters(),
        api.get("/mari-kit/settings").catch(() => null),
        api.get("/mari-kit/tts/settings").catch(() => null),
      ]);
      if (!alive) return;
      state = { chat, conns, presets, personas, index: characterIndex(chars), settings, voice };
      draw();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  }

  /** The Engine's own translation settings for this chat (same fields as its Chat Settings → Translation). */
  function translationList(chat, conns) {
    const meta = chatMeta(chat);
    const provider = ["google", "deepl", "deeplx", "ai"].includes(meta.translationProvider)
      ? meta.translationProvider
      : "google";
    const legacy = meta.translationTargetLang || "en";
    const langs = (current) => {
      const list = [
        ["ko", "한국어"],
        ["en", "영어"],
        ["ja", "일본어"],
        ["zh-CN", "중국어 간체"],
        ["zh-TW", "중국어 번체"],
        ["es", "스페인어"],
        ["fr", "프랑스어"],
        ["de", "독일어"],
        ["ru", "러시아어"],
        ["vi", "베트남어"],
        ["th", "태국어"],
        ["id", "인도네시아어"],
      ];
      return list.some(([v]) => v === current) ? list : [[current, current], ...list];
    };
    const input = meta.translationInputTargetLang || legacy;
    const output = meta.translationOutputTargetLang || legacy;
    return h(
      "div",
      { class: "list" },
      selectRow(
        I.translate,
        "번역",
        provider,
        [
          ["google", "Google 번역"],
          ["deepl", "DeepL"],
          ["deeplx", "DeepLX"],
          ["ai", "AI (연결)"],
        ],
        (v) => patchMeta({ translationProvider: v }),
      ),
      provider === "ai"
        ? selectRow(
            I.link,
            meta.translationConnectionId ? "번역 연결" : "번역 연결 · 골라야 번역돼요",
            meta.translationConnectionId || "",
            [["", "고르세요"], ...conns.map((c) => [c.id, c.name])],
            (v) => patchMeta({ translationConnectionId: v || null }),
          )
        : null,
      selectRow(I.translate, "보낼 말을", input, langs(input), (v) => patchMeta({ translationInputTargetLang: v })),
      selectRow(I.translate, "받은 말을", output, langs(output), (v) => patchMeta({ translationOutputTargetLang: v })),
      switchRow(I.translate, "답장 자동 번역", meta.autoTranslate === true, () =>
        patchMeta({ autoTranslate: meta.autoTranslate !== true }),
      ),
      switchRow(I.translate, "내 메시지 번역해서 보내기", meta.translateInput === true, () =>
        patchMeta({ translateInput: meta.translateInput !== true }),
      ),
      switchRow(I.translate, "보내기 옆 번역 버튼", meta.showInputTranslateButton === true, () =>
        patchMeta({ showInputTranslateButton: meta.showInputTranslateButton !== true }),
      ),
      switchRow(
        I.translate,
        "원문 대신 번역만 보기",
        meta.translationDisplayOnly === true,
        () => patchMeta({ translationDisplayOnly: meta.translationDisplayOnly !== true }),
        "번역된 메시지는 번역문만 보여요",
      ),
    );
  }

  /** Who is in the room: add or take out characters (at least one stays). */
  function editCast(chat, index) {
    let ids = [...(chat.characterIds || [])];
    const body = h("div", { style: { overflowY: "auto", minHeight: "0", padding: "4px 0 20px" } });
    const s = sheet(body, { label: "등장 캐릭터" });
    const paint = () =>
      setChildren(
        body,
        h("div", { style: { padding: "8px 20px 12px", fontSize: "15px", fontWeight: "600" } }, "등장 캐릭터"),
        h(
          "div",
          { class: "list" },
          [...index.values()]
            .sort((a, b) => Number(ids.includes(b.id)) - Number(ids.includes(a.id)) || a.name.localeCompare(b.name))
            .map((c) => {
              const on = ids.includes(c.id);
              return h(
                "button",
                {
                  type: "button",
                  class: "r two",
                  role: "checkbox",
                  "aria-checked": on ? "true" : "false",
                  style: { gridTemplateColumns: "28px minmax(0,1fr) 20px" },
                  onClick: () => {
                    if (on && ids.length === 1) return toast("캐릭터가 한 명은 있어야 해요");
                    ids = on ? ids.filter((x) => x !== c.id) : [...ids, c.id];
                    paint();
                  },
                },
                avatar(c.avatar, c.name?.[0] || "·", 28),
                h("span", null, c.name),
                h("span", { class: on ? "cbx on" : "cbx", "aria-hidden": "true" }),
              );
            }),
        ),
        h(
          "div",
          { style: { padding: "20px", display: "flex", justifyContent: "flex-end" } },
          h(
            "button",
            {
              type: "button",
              class: "pill main",
              onClick: async () => {
                s.close();
                await patchChat({ characterIds: ids });
              },
            },
            "저장",
          ),
        ),
      );
    paint();
  }

  async function patchChat(patch) {
    try {
      await api.patch(`/chats/${encodeURIComponent(chatId)}`, patch);
      data.chats(true);
      await load();
    } catch (error) {
      toast(error.message);
    }
  }
  async function patchMeta(patch) {
    try {
      await api.patch(`/chats/${encodeURIComponent(chatId)}/metadata`, patch);
      await load();
    } catch (error) {
      toast(error.message);
    }
  }
  async function setFeature(id, on) {
    try {
      await api.patch("/mari-kit/settings", { features: { [id]: on } });
      await load();
    } catch (error) {
      toast(error.message);
    }
  }

  // ── Views ──────────────────────────────────

  const gap = () => h("div", { class: "gap" });
  const engineRow = (label, id, chat) =>
    h(
      "button",
      {
        type: "button",
        class: "r",
        onClick: () =>
          openEngine(chat.id, {
            section:
              id === "connection"
                ? ["connection"]
                : [`${chat.mode}-${id}`, id, ...(id === "prompt-preset" ? ["conversation-prompt"] : [])],
          }),
      },
      h("span", { class: "ic" }, icon(I.square)),
      h("span", null, label),
      h("span", { class: "val" }, "엔진 ›"),
    );

  function homeView() {
    const { chat, conns, presets, personas, index } = state;
    const meta = chatMeta(chat);
    const cast = (chat.characterIds || []).map((id) => index.get(id)?.name).filter(Boolean);
    return [
      gap(),
      h(
        "div",
        { class: "list" },
        selectRow(I.link, "연결", chat.connectionId, [["", "기본"], ...conns.map((c) => [c.id, c.name])], (v) =>
          patchChat({ connectionId: v || null }),
        ),
        selectRow(I.list, "프리셋", chat.promptPresetId, [["", "기본"], ...presets.map((p) => [p.id, p.name])], (v) =>
          patchChat({ promptPresetId: v || null }),
        ),
        selectRow(
          I.person,
          "페르소나",
          chat.personaId,
          [["", "없음"], ...personas.map((p) => [p.id, p.name || "이름 없음"])],
          (v) => patchChat({ personaId: v || null }),
        ),
      ),
      gap(),
      h(
        "div",
        { class: "list" },
        linkRow(I.person, "등장 캐릭터", cast.join(", ") || "없음", () => go(here("cast"))),
        engineRow("로어북", "lorebooks", chat),
        chat.mode === "roleplay"
          ? linkRow(
              I.list,
              "작가 노트",
              String(meta.authorNotes || "")
                .split("\n")[0]
                .slice(0, 18) || "비어 있음",
              () => go(here("author")),
            )
          : null,
        linkRow(I.translate, "번역", meta.autoTranslate === true ? "자동 번역 켬" : "", () => go(here("translation"))),
        linkRow(I.square, "Mari Kit · 기능", "", () => go(here("kit"))),
        linkRow(I.contrast, "화면", "", () => go(here("view"))),
      ),
      gap(),
      h(
        "div",
        { class: "list" },
        linkRow(I.list, "모든 채팅 설정", "채팅 · 컨텍스트 · 기억 · 기타", () => go(here("all"))),
      ),
    ];
  }

  function allView() {
    const { chat } = state;
    setChildren(
      tabs,
      Object.keys(ENGINE_SECTIONS).map((g) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            class: group === g ? "t2 on" : "t2",
            "aria-selected": group === g ? "true" : "false",
            onClick: () => {
              group = g;
              history.replaceState(null, "", `#/${here(`all/${encodeURIComponent(g)}`)}`);
              draw();
            },
          },
          g,
        ),
      ),
    );
    const rows = ENGINE_SECTIONS[group].filter(([, , modes]) => modes.includes(chat.mode));
    const anyEngine = rows.some(([, , , v]) => v === null);
    return [
      gap(),
      h(
        "div",
        { class: "list" },
        rows.map(([label, id, , v]) =>
          v === null ? engineRow(label, id, chat) : linkRow(I.list, label, "", () => (v ? go(here(v)) : go(here()))),
        ),
      ),
      anyEngine
        ? h(
            "p",
            { class: "hint", style: { padding: "12px 20px 0", lineHeight: "1.6" } },
            "엔진 표시는 엔진 화면의 그 항목으로 열려요. 엔진 앱을 처음 열 때 약 17MB를 받고, 그 뒤로는 저장된 파일을 써요.",
          )
        : null,
    ];
  }

  function castView() {
    const { chat, index } = state;
    return [
      gap(),
      h(
        "div",
        { class: "list" },
        (chat.characterIds || []).map((id) =>
          linkRow(I.person, index.get(id)?.name || "?", "프로필", () => go(`character/${encodeURIComponent(id)}`)),
        ),
      ),
      gap(),
      h(
        "div",
        { class: "list" },
        linkRow(I.person, "등장 캐릭터 바꾸기", `${(chat.characterIds || []).length}명`, () => editCast(chat, index)),
        (chat.characterIds || []).length > 1 ? engineRow("단체 대화 방식", "group-chat", chat) : null,
      ),
    ];
  }

  function authorView() {
    const meta = chatMeta(state.chat);
    const area = h("textarea", {
      class: "inp",
      rows: 8,
      placeholder: "모델에게 계속 알려 둘 말 (예: 지금은 비 오는 밤, 장면을 서두르지 말 것)",
      style: { width: "100%", minHeight: "160px", resize: "vertical" },
    });
    area.value = String(meta.authorNotes || "");
    const depth = h("input", {
      class: "inp",
      type: "number",
      min: "0",
      max: "100",
      inputmode: "numeric",
      value: String(meta.authorNotesDepth ?? 4),
      style: { width: "90px" },
      "aria-label": "넣는 깊이",
    });
    return [
      h(
        "div",
        { style: { padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" } },
        area,
        h(
          "label",
          { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" } },
          h(
            "span",
            { style: { display: "flex", flexDirection: "column", gap: "2px" } },
            "넣는 깊이",
            h("span", { class: "hint" }, "최근 메시지 몇 개 앞에 넣을지 (엔진 기본 4)"),
          ),
          depth,
        ),
        h(
          "div",
          { style: { display: "flex", justifyContent: "flex-end" } },
          h(
            "button",
            {
              type: "button",
              class: "pill main",
              onClick: async () => {
                const n = Math.max(0, Math.min(100, Math.round(Number(depth.value) || 0)));
                await patchMeta({ authorNotes: area.value, authorNotesDepth: n });
                toast("저장했어요");
              },
            },
            "저장",
          ),
        ),
      ),
    ];
  }

  function kitView() {
    const { chat, settings } = state;
    const meta = chatMeta(chat);
    const kitOn = meta.enableAgents === true && (meta.activeAgentIds || []).includes("mari-kit");
    const features = settings?.features || {};
    const ids = meta.activeAgentIds || [];
    return [
      gap(),
      h(
        "div",
        { class: "list" },
        switchRow(
          I.square,
          "Mari Kit",
          kitOn,
          () =>
            patchMeta(
              kitOn
                ? { activeAgentIds: ids.filter((x) => x !== "mari-kit") }
                : { enableAgents: true, activeAgentIds: [...new Set([...ids, "mari-kit"])] },
            ),
          "이 방에서 대사 음성·번역·기억을 씀",
        ),
      ),
      // Convo turns read voice cues and the user's schedule without the agent (Convo has no agent list).
      kitOn || chat.mode === "conversation"
        ? [
            gap(),
            h(
              "div",
              { class: "list" },
              switchRow(I.voice, "대사 음성", !!features.tts, () => setFeature("tts", !features.tts), "모든 방 공통"),
              features.tts && state.voice
                ? switchRow(
                    I.voice,
                    "음성 지침 · 이 방",
                    state.voice.rooms?.[chatId] !== false,
                    async () => {
                      try {
                        await api.put(`/mari-kit/tts/room/${encodeURIComponent(chatId)}`, {
                          guidance: state.voice.rooms?.[chatId] === false,
                        });
                        await load();
                      } catch (error) {
                        toast(error.message);
                      }
                    },
                    "끄면 이 방 답장에 목소리 표시를 넣지 않아요",
                  )
                : null,
              switchRow(
                I.translate,
                "번역 (Mari Kit)",
                !!features.translation,
                () => setFeature("translation", !features.translation),
                "모든 방 공통 · 번역 프리셋과 단어장",
              ),
              features.translation
                ? linkRow(I.glossary, "번역 프리셋 · 단어장", "", () => go(`translation/${encodeURIComponent(chatId)}`))
                : null,
              switchRow(
                I.memory,
                "기억",
                !!features.memory,
                () => setFeature("memory", !features.memory),
                "모든 방 공통",
              ),
              features.memory && chat.mode === "roleplay"
                ? linkRow(I.memory, "기억 서재", "", () => go(`memory/${encodeURIComponent(chatId)}`))
                : null,
              chat.mode === "conversation"
                ? linkRow(I.calendar, "내 일정", "", async () => {
                    const me = await api.get(`/mari-kit/schedule/chat/${encodeURIComponent(chatId)}`).catch(() => null);
                    go(`schedule/${encodeURIComponent(me?.key || "default")}/now/${encodeURIComponent(chatId)}`);
                  })
                : null,
              chat.mode === "conversation"
                ? linkRow(I.phone, "통화 설정", "", () => go(`call-settings/${encodeURIComponent(chatId)}`))
                : null,
            ),
          ]
        : null,
      gap(),
      h("div", { class: "list" }, engineRow("에이전트 (엔진)", "agents", chat)),
    ];
  }

  function viewView() {
    const shown = TOOL_DEFS.filter((t) => toolPlace(t) === "show").length;
    const more = TOOL_DEFS.filter((t) => toolPlace(t) === "more").length;
    return [
      gap(),
      h(
        "div",
        { class: "list" },
        switchRow(I.contrast, "다크 모드", isDark(), () => {
          setPrefs({ theme: isDark() ? "light" : "dark" });
          draw();
        }),
        linkRow(I.reader, "읽기", "", () => go("reader")),
        linkRow(I.list, "메시지 도구", `표시 ${shown} · 더보기 ${more}`, () => go("settings/tools")),
      ),
    ];
  }

  function draw() {
    if (!state) return;
    const { chat, conns, index } = state;
    if (view === "name") {
      rename(chat);
      return;
    }
    const content =
      view === "all"
        ? allView()
        : view === "cast"
          ? castView()
          : view === "author"
            ? authorView()
            : view === "translation"
              ? [gap(), translationList(chat, conns)]
              : view === "kit"
                ? kitView()
                : view === "view"
                  ? viewView()
                  : homeView();
    setChildren(body, content);
    const sub = mount.querySelector(".ttl .sub");
    if (sub) sub.textContent = chatTitle(chat, index);
  }

  /** 채팅 이름: a small sheet over the list. */
  function rename(chat) {
    setChildren(body, homeView());
    const input = h("input", {
      class: "inp",
      value: chat.name || "",
      "aria-label": "채팅 이름",
      style: { width: "100%" },
    });
    const box = h(
      "div",
      { style: { padding: "8px 20px 20px", display: "flex", flexDirection: "column", gap: "12px" } },
      h("div", { style: { fontSize: "15px", fontWeight: "600" } }, "채팅 이름"),
      input,
      h(
        "div",
        { style: { display: "flex", justifyContent: "flex-end" } },
        h(
          "button",
          {
            type: "button",
            class: "pill main",
            onClick: async () => {
              s.close();
              await patchChat({ name: input.value.trim() || chat.name });
            },
          },
          "저장",
        ),
      ),
    );
    const s = sheet(box, { label: "채팅 이름", onClose: () => back(here()) });
    setTimeout(() => input.focus(), 50);
  }

  load();
  return { dispose: () => (alive = false), onPrefs: draw };
}
