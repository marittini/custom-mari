// Chat settings for one room: 채팅 (connection, preset, persona, characters) · 확장 (Mari Kit) · 화면 (theme, reading,
// message tools). Things only the Engine screens edit (lorebooks, agents beyond Mari Kit) open there.

import { h, icon, I, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data, characterIndex, chatMeta, chatTitle } from "../lib/data.js";
import { setPrefs, isDark, TOOL_DEFS, toolPlace } from "../lib/prefs.js";
import { topBar, toast, errorBox, openEngine, sheet, avatar } from "../lib/ui.js";

let lastTab = "chat";

export function chatSettingsScreen({ mount, args, go, back }) {
  const chatId = args[0];
  let alive = true;
  let tab = lastTab;
  let state = null;
  const tabs = h("div", { class: "tabs2", role: "tablist", "aria-label": "설정 분류" });
  const body = h(
    "div",
    { class: "scroll", style: { paddingBottom: "28px" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  mount.append(topBar({ back: () => back("convos"), title: "채팅 설정", sub: " " }), tabs, body);

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

  function draw() {
    setChildren(
      tabs,
      [
        ["chat", "채팅"],
        ["ext", "확장"],
        ["view", "화면"],
      ].map(([id, label]) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            class: tab === id ? "t2 on" : "t2",
            "aria-selected": tab === id ? "true" : "false",
            onClick: () => {
              tab = lastTab = id;
              draw();
            },
          },
          label,
        ),
      ),
    );
    if (!state) return;
    const { chat, conns, presets, personas, index, settings } = state;
    const meta = chatMeta(chat);
    const kitOn = meta.enableAgents === true && (meta.activeAgentIds || []).includes("mari-kit");
    const features = settings?.features || {};
    let content;
    if (tab === "chat") {
      content = [
        h("div", { class: "gap" }),
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
        h("div", { class: "gap" }),
        translationList(chat, conns),
        h("div", { class: "gap" }),
        h(
          "div",
          { class: "list" },
          (chat.characterIds || []).map((id) =>
            linkRow(I.person, "캐릭터", index.get(id)?.name || "?", () => go(`character/${encodeURIComponent(id)}`)),
          ),
          linkRow(I.person, "등장 캐릭터 바꾸기", `${(chat.characterIds || []).length}명`, () => editCast(chat, index)),
        ),
        h("div", { class: "gap" }),
        h(
          "div",
          { class: "list" },
          linkRow(I.square, "엔진 화면에서 열기", "전체 기능", () => openEngine(chat.id)),
        ),
      ];
    } else if (tab === "ext") {
      const ids = meta.activeAgentIds || [];
      content = [
        h("div", { class: "gap" }),
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
              h("div", { class: "gap" }),
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
                  "번역",
                  !!features.translation,
                  () => setFeature("translation", !features.translation),
                  "모든 방 공통",
                ),
                features.translation
                  ? linkRow(I.glossary, "번역 프리셋 · 단어장", "", () =>
                      go(`translation/${encodeURIComponent(chatId)}`),
                    )
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
                      const me = await api
                        .get(`/mari-kit/schedule/chat/${encodeURIComponent(chatId)}`)
                        .catch(() => null);
                      go(`schedule/${encodeURIComponent(me?.key || "default")}/now/${encodeURIComponent(chatId)}`);
                    })
                  : null,
              ),
            ]
          : null,
      ];
    } else {
      const shown = TOOL_DEFS.filter((t) => toolPlace(t) === "show").length;
      const more = TOOL_DEFS.filter((t) => toolPlace(t) === "more").length;
      content = [
        h("div", { class: "gap" }),
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
    setChildren(body, content);
    const sub = mount.querySelector(".ttl .sub");
    if (sub) sub.textContent = chatTitle(chat, index);
  }

  draw();
  load();
  return { dispose: () => (alive = false), onPrefs: draw };
}
