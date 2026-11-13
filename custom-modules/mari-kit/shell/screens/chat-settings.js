// Chat settings for one room.
//   #/chat-settings/<chatId>          자주: what a chat changes often, one tap each
//   #/chat-settings/<chatId>/<view>   번역 · 등장 캐릭터 · 작가 노트 · Mari Kit · 화면 · 모든 채팅 설정 (all/<group>)
// 모든 채팅 설정 lists every section of the Engine's own Chat Settings for this chat's mode, in four groups. Sections
// the shell draws open here; the rest open the Engine at that section (Mari Kit's Engine-side script, with a pill back).

import { h, icon, I, setChildren } from "../lib/h.js";
import { api, download } from "../lib/api.js";
import { data, characterIndex, chatMeta, chatTitle, coverOf, coverPos, textConnections } from "../lib/data.js";
import { setPrefs, isDark, TOOL_DEFS, toolPlace } from "../lib/prefs.js";
import { topBar, toast, errorBox, openEngine, sheet, avatar, thumb, ask } from "../lib/ui.js";
import { lorebookViews, REASON_LABEL } from "../lib/lorebooks.js";
import { ENGINE_SECTIONS } from "../lib/engine-sections.js";
import { pickPerson } from "../lib/picker.js";
import { profileSheet } from "../lib/profiles.js";
import { startJob } from "../lib/activity.js";
import { groupsOf, splitByGroup, groupedOptions, sectioned, forgetGroups } from "../lib/groups.js";

const VIEW_TITLES = {
  translation: "번역",
  cast: "등장 캐릭터",
  author: "작가 노트",
  cover: "표지",
  lorebooks: "로어북",
  kit: "Mari Kit · 기능",
  convo: "대화 기능",
  view: "화면",
  all: "모든 채팅 설정",
};

// The Engine's Convo commands (ChatSettingsDrawer CONVERSATION_COMMAND_TOGGLE_OPTIONS), in its order.
const CONVO_COMMANDS = [
  ["schedule_update", "상태 바꾸기", "지금 하는 일·상태를 스스로 바꿔요"],
  ["cross_post", "다른 채팅으로 보내기", "메시지를 함께 쓰는 다른 채팅으로 옮겨요"],
  ["selfie", "셀카", "사진을 만들어 보내요"],
  ["video", "영상", "짧은 영상 메시지를 보내요"],
  ["memory", "기억 남기기", "다른 캐릭터에게 기억을 만들어 줘요"],
  ["scene", "장면", "대화에서 몰입형 장면을 시작해요"],
  ["music", "음악", "음악 플레이어로 노래를 틀어요"],
  ["haptic", "진동", "연결된 진동 기기를 움직여요"],
  ["influence", "영향", "연결된 채팅에 한 번 영향을 줘요"],
  ["note", "메모", "연결된 채팅에 오래 남는 메모를 써요"],
  ["call", "전화 걸기 명령", "캐릭터가 통화를 걸어요"],
  ["react", "반응", "메시지에 이모지 반응을 달아요"],
  ["uno", "UNO", "함께 하자면 UNO를 시작해요"],
  ["chess", "체스", "체스 대결을 받아요"],
  ["poker", "포커", "텍사스 홀덤을 같이 해요"],
  ["eightball", "포켓볼", "8볼 당구를 같이 해요"],
  ["tic_tac_toe", "틱택토", "틱택토 대결을 받아요"],
  ["rock_paper_scissors", "가위바위보", "가위바위보를 같이 해요"],
];

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
        // [[value, text]] pairs, or ready <option>/<optgroup> nodes (grouped lists).
        Array.isArray(options[0]) || !options.length
          ? options.map(([v, text]) => h("option", { value: v, selected: (value || "") === v }, text))
          : options,
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
      // Each page reads only what it shows: the main list needs connections, presets and personas; 번역 needs
      // connections; Mari Kit needs its settings.
      const main = !view;
      const groupKinds = main
        ? ["connections", "presets", "personas", "chats"]
        : view === "translation"
          ? ["connections"]
          : [];
      const groups = Object.fromEntries(await Promise.all(groupKinds.map(async (k) => [k, await groupsOf(k)])));
      const [chat, conns, presets, personas, chars, settings, voice] = await Promise.all([
        data.chat(chatId),
        main || view === "translation" ? data.connections() : [],
        main ? api.get("/prompts").catch(() => []) : [],
        main ? data.personas() : [],
        data.characters(),
        view === "kit" ? api.get("/mari-kit/settings").catch(() => null) : null,
        view === "kit" ? api.get("/mari-kit/tts/settings").catch(() => null) : null,
      ]);
      // Lorebooks only where they are shown (the list can be long).
      const lorebooks = !view || view === "lorebooks" ? await api.get("/lorebooks").catch(() => []) : null;
      if (!alive) return;
      state = {
        chat,
        // Chat models only: image, video and audio connections are not for writing replies.
        conns: textConnections(conns),
        presets,
        personas,
        index: characterIndex(chars),
        settings,
        voice,
        lorebooks,
        groups,
      };
      draw();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  }

  /** Chat connections for a dropdown, split by the Engine's connection folders. */
  function connectionOptions(value, empty) {
    return groupedOptions(
      h,
      value,
      [["", empty]],
      splitByGroup(state.conns, state.groups.connections || [], { folderOf: (c) => c.folderId }),
      (c) => [c.id, c.name],
    );
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
            connectionOptions(meta.translationConnectionId, "고르세요"),
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

  /**
   * The preset's choice blocks for this chat (RP), the same way the Engine's choice window works: each question with
   * its options; the chat's saved choice first, then the preset's default, then the first option (a random one when
   * the block says so); multi-select blocks pick any number. Saved to presetChoices; optionally as the preset's
   * defaultChoices too. The preset's full record (~27KB with its sections) is read only when this opens.
   */
  async function presetChoices(chat) {
    const presetId = chat.promptPresetId;
    if (!presetId) return toast("기본 프리셋에는 선택지가 없어요");
    let full;
    try {
      full = await api.get(`/prompts/${encodeURIComponent(presetId)}/full`);
    } catch (error) {
      return toast(error.message);
    }
    const parse = (v, fallback) => {
      if (typeof v !== "string") return v ?? fallback;
      try {
        return JSON.parse(v);
      } catch {
        return fallback;
      }
    };
    const truthy = (v) => v === true || v === "true";
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
    if (!blocks.length) return toast("이 프리셋에는 선택지가 없어요");
    const existing = chatMeta(chat).presetChoices || {};
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
    let asDefault = false;
    const body = h("div", { style: { overflowY: "auto", minHeight: "0", padding: "4px 0 20px" } });
    const s = sheet(body, { label: "프리셋 선택지" });
    const paint = () =>
      setChildren(
        body,
        h(
          "div",
          { style: { padding: "8px 20px 4px", fontSize: "15px", fontWeight: "600" } },
          `${full.preset?.name || "프리셋"} · 이 채팅의 선택`,
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
          h(
            "button",
            { type: "button", class: "pill", onClick: () => (s.close(), openEngine(chat.id, { preset: presetId })) },
            "프리셋 편집",
          ),
          h(
            "button",
            {
              type: "button",
              class: "pill main",
              onClick: async () => {
                s.close();
                if (asDefault)
                  await api
                    .patch(`/prompts/${encodeURIComponent(presetId)}`, { defaultChoices: picks })
                    .catch(() => {});
                await patchMeta({ presetChoices: picks });
                toast("선택을 저장했어요");
              },
            },
            "저장",
          ),
        ),
      );
    paint();
  }

  /** Who is in the room: add or take out characters (at least one stays). */
  async function editCast(chat, index) {
    let ids = [...(chat.characterIds || [])];
    const groups = await groupsOf("characters");
    const body = h("div", { style: { overflowY: "auto", minHeight: "0", padding: "4px 0 20px" } });
    const s = sheet(body, { label: "등장 캐릭터" });
    const paint = () =>
      setChildren(
        body,
        h("div", { style: { padding: "8px 20px 12px", fontSize: "15px", fontWeight: "600" } }, "등장 캐릭터"),
        sectioned(
          h,
          splitByGroup(
            [...index.values()].sort(
              (a, b) => Number(ids.includes(b.id)) - Number(ids.includes(a.id)) || a.name.localeCompare(b.name),
            ),
            groups,
          ),
          (c) => {
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
          },
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

  /** How many of the preset's choices this chat has made. */
  function choiceSummary(meta) {
    const n = Object.keys(meta.presetChoices || {}).length;
    return n ? `${n}개 고름` : "고르기";
  }

  function homeView() {
    const { chat, conns, presets, personas, index } = state;
    const meta = chatMeta(chat);
    const cast = (chat.characterIds || []).map((id) => index.get(id)?.name).filter(Boolean);
    return [
      gap(),
      h(
        "div",
        { class: "list" },
        selectRow(I.link, "연결", chat.connectionId, connectionOptions(chat.connectionId, "기본"), (v) =>
          patchChat({ connectionId: v || null }),
        ),
        selectRow(
          I.list,
          "프리셋",
          chat.promptPresetId,
          groupedOptions(
            h,
            chat.promptPresetId,
            [["", "기본"]],
            splitByGroup(presets, state.groups.presets || []),
            (p) => [p.id, p.name],
          ),
          async (v) => {
            await patchChat({ promptPresetId: v || null });
            // Like the Engine: a Roleplay chat picks the new preset's choices right away.
            if (v && chat.mode === "roleplay") presetChoices({ ...chat, promptPresetId: v });
          },
        ),
        chat.mode === "roleplay" && chat.promptPresetId
          ? linkRow(I.list, "프리셋 선택지", choiceSummary(meta), () => presetChoices(chat))
          : null,
        linkRow(I.sliders, "채팅 프로필", "", () => profileSheet({ chat: state.chat, changed: () => load() })),
        linkRow(I.person, "페르소나", personas.find((p) => p.id === chat.personaId)?.name || "없음", () =>
          pickPerson({
            title: "페르소나",
            key: "pick-personas",
            items: personas.map((p) => ({ id: p.id, name: p.name || "이름 없음", avatar: p.avatarPath })),
            groups: state.groups.personas || [],
            selected: chat.personaId || null,
            onPick: (v) => patchChat({ personaId: v }),
          }),
        ),
      ),
      gap(),
      h(
        "div",
        { class: "list" },
        linkRow(I.square, "표지", coverOf(chat) ? "있음" : "캐릭터 사진", () => go(here("cover"))),
        linkRow(I.search, "메시지 검색", "", () => go(`search/${encodeURIComponent(chatId)}`)),
        linkRow(I.list, "내보내기", "jsonl · 글 · 마크다운 · HTML", exportSheet),
        linkRow(
          I.list,
          "폴더",
          (state.groups.chats || []).find((f) => f.id === chat.folderId)?.name || "폴더 없음",
          folderSheet,
        ),
        linkRow(I.person, "등장 캐릭터", cast.join(", ") || "없음", () => go(here("cast"))),
        linkRow(I.lore, "로어북", lorebookSummary(), () => go(here("lorebooks"))),
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
        chat.mode === "conversation"
          ? linkRow(
              I.chat,
              "대화 기능",
              [
                meta.autonomousMessages === true ? "먼저 말 걸기" : "",
                meta.conversationCallsEnabled === true ? "통화" : "",
              ]
                .filter(Boolean)
                .join(" · ") || "자율 메시지 · 일정 · 통화",
              () => go(here("convo")),
            )
          : null,
        linkRow(I.square, "Mari Kit · 기능", "", () => go(here("kit"))),
        linkRow(I.contrast, "화면", "", () => go(here("view"))),
      ),
      gap(),
      h(
        "div",
        { class: "list" },
        linkRow(I.list, "모든 채팅 설정", "채팅 · 컨텍스트 · 기억 · 기타", () => go(here("all"))),
      ),
      gap(),
      h(
        "div",
        { class: "list" },
        h(
          "button",
          { type: "button", class: "r two danger", onClick: removeChat },
          h("span", null, "이 채팅 지우기"),
          h("span", { class: "val" }, chat.groupId ? "이 분기만" : ""),
        ),
      ),
    ];
  }

  // Deletes this chat (this branch only, like the Engine's single-chat delete) and its shell cover.
  async function removeChat() {
    const { chat, index } = state;
    const title = chatTitle(chat, index);
    // A chat with branches: this branch only, or every branch (the Engine's group delete).
    const branches = chat.groupId ? (await data.chats(true)).filter((c) => c.groupId === chat.groupId) : [chat];
    let all = false;
    if (branches.length > 1) {
      const pick = await new Promise((resolve) => {
        const done = (v) => (resolve(v), s.close());
        const s = sheet(
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "12px", padding: "8px 20px 24px" } },
            h(
              "p",
              { style: { margin: "0 0 4px", fontSize: "16px", lineHeight: "1.6" } },
              `'${title}'에는 분기가 ${branches.length}개 있어요. 무엇을 지울까요? 되돌릴 수 없어요.`,
            ),
            h(
              "button",
              { type: "button", class: "pill", style: { minHeight: "48px" }, onClick: () => done("one") },
              "이 분기만 지우기",
            ),
            h(
              "button",
              { type: "button", class: "pill main", style: { minHeight: "48px" }, onClick: () => done("all") },
              `분기 ${branches.length}개 모두 지우기`,
            ),
            h(
              "button",
              { type: "button", class: "pill", style: { minHeight: "48px" }, onClick: () => done(null) },
              "취소",
            ),
          ),
          { label: "채팅 지우기", onClose: () => resolve(null) },
        );
      });
      if (!pick) return;
      all = pick === "all";
    } else if (!(await ask(`'${title}' 채팅을 지울까요? 메시지도 함께 지워지고 되돌릴 수 없어요.`, { ok: "지우기" })))
      return;
    try {
      for (const c of all ? branches : [chat]) {
        const cover = coverOf(c);
        if (cover)
          await api
            .delete(`/mari-kit/shell/cover/${encodeURIComponent(cover.replace(/#.*$/, "").split("/").pop())}`)
            .catch(() => {});
      }
      if (all) await api.delete(`/chats/group/${encodeURIComponent(chat.groupId)}`);
      else await api.delete(`/chats/${encodeURIComponent(chatId)}`);
      await data.chats(true);
      toast(all ? `분기 ${branches.length}개를 모두 지웠어요` : "채팅을 지웠어요");
      location.replace(`#/${chat.mode === "conversation" ? "convos" : "library"}`);
    } catch (error) {
      toast(`지우지 못했어요: ${error.message}`);
    }
  }

  // 내보내기: the Engine's own chat export, saved on this device.
  function exportSheet() {
    const name = (chatTitle(state.chat, state.index) || "chat").replace(/[\\/:*?"<>|]+/g, " ").trim();
    const formats = [
      ["jsonl", ".jsonl", "다시 가져올 수 있는 형식"],
      ["text", ".txt", "글로"],
      ["markdown", ".md", "마크다운"],
      ["html", ".html", "읽기 좋은 웹 페이지"],
    ];
    const s = sheet(
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "8px", padding: "6px 0 24px" } },
        h("b", { style: { padding: "0 20px 6px", fontSize: "16px" } }, "내보내기"),
        h(
          "div",
          { class: "list" },
          formats.map(([format, ext, sub]) =>
            h(
              "button",
              {
                type: "button",
                class: "r two",
                onClick: async () => {
                  s.close();
                  try {
                    await download(`/chats/${encodeURIComponent(chatId)}/export?format=${format}`, name + ext);
                  } catch (error) {
                    toast(`내보내지 못했어요: ${error.message}`);
                  }
                },
              },
              h("span", null, ext, h("small", null, sub)),
              h("span", { class: "val" }, "저장 ›"),
            ),
          ),
        ),
      ),
      { label: "내보내기" },
    );
  }

  // 폴더: the Engine's chat folders of this chat's mode; move this chat, or make a folder and move it there.
  function folderSheet() {
    const { chat } = state;
    const folders = (state.groups.chats || []).filter((f) => f.mode === chat.mode);
    const move = async (folderId) => {
      try {
        await api.post("/chat-folders/move-chat", { chatId, folderId });
        forgetGroups("chats");
        await data.chats(true);
        s.close();
        toast(folderId ? "폴더로 옮겼어요" : "폴더에서 뺐어요");
        await load();
      } catch (error) {
        toast(error.message);
      }
    };
    const name = h("input", { class: "inp", placeholder: "새 폴더 이름", maxlength: 60 });
    const pick = (id, label) =>
      h(
        "button",
        {
          type: "button",
          class: "r two",
          "aria-pressed": (chat.folderId || null) === id ? "true" : "false",
          onClick: () => move(id),
        },
        h("span", null, label),
        h("span", { class: "val" }, (chat.folderId || null) === id ? "지금" : ""),
      );
    const s = sheet(
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "8px", padding: "4px 0 24px", overflowY: "auto" } },
        h("b", { style: { padding: "0 20px 6px", fontSize: "15px" } }, "폴더"),
        h(
          "div",
          { class: "list" },
          folders.map((f) => pick(f.id, f.name)),
          pick(null, "폴더 없음"),
        ),
        h(
          "div",
          { style: { display: "flex", gap: "8px", padding: "12px 20px 0" } },
          name,
          h(
            "button",
            {
              type: "button",
              class: "pill main",
              onClick: async () => {
                if (!name.value.trim()) return toast("폴더 이름을 적어 주세요");
                try {
                  const made = await api.post("/chat-folders", { name: name.value.trim(), mode: chat.mode });
                  await move(made.id);
                } catch (error) {
                  toast(error.message);
                }
              },
            },
            "만들고 옮기기",
          ),
        ),
      ),
      { label: "폴더" },
    );
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
        rows.map(([label, ids, , v]) =>
          v === null
            ? engineRow(label, ids[0], chat)
            : linkRow(I.list, label, "", () => (v ? go(here(v)) : go(here()))),
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

  function lorebookSummary() {
    if (!state.lorebooks) return "";
    const used = lorebookViews(state.lorebooks, state.chat, chatMeta(state.chat)).filter((v) => !v.excluded).length;
    return used ? `${used}개 사용` : "없음";
  }

  function lorebooksView() {
    const { chat, lorebooks } = state;
    const meta = chatMeta(chat);
    const views = lorebookViews(lorebooks || [], chat, meta);
    const usedIds = new Set(views.map((v) => v.book.id));
    const others = (lorebooks || []).filter((b) => !usedIds.has(b.id) && b.enabled !== false);
    const pinnedIds = () => (Array.isArray(meta.activeLorebookIds) ? [...meta.activeLorebookIds] : []);
    const excludedIds = () => (Array.isArray(meta.excludedLorebookIds) ? [...meta.excludedLorebookIds] : []);
    const budget = h("input", {
      class: "inp",
      type: "number",
      min: "0",
      inputmode: "numeric",
      placeholder: "기본",
      value: meta.lorebookTokenBudget ?? "",
      style: { width: "110px" },
      "aria-label": "로어북 토큰 한도",
      onChange: (e) => {
        const n = e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value) || 0));
        patchMeta({ lorebookTokenBudget: n });
      },
    });
    return [
      gap(),
      views.length
        ? h(
            "div",
            { class: "list" },
            views.map((v) => {
              const auto = v.reasons.some((r) => r !== "Chat");
              const on = !v.excluded;
              return h(
                "div",
                { class: "r", style: { gridTemplateColumns: "minmax(0,1fr) auto auto" } },
                h(
                  "span",
                  { style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" } },
                  h(
                    "span",
                    { style: on ? null : { textDecoration: "line-through", color: "var(--ink-3)" } },
                    v.book.name,
                  ),
                  h("span", { class: "hint" }, v.reasons.map((r) => REASON_LABEL[r]).join(" · ")),
                ),
                h(
                  "button",
                  { type: "button", class: "txtbtn", onClick: () => openEngine(chat.id, { lorebook: v.book.id }) },
                  "편집",
                ),
                auto
                  ? h(
                      "button",
                      {
                        type: "button",
                        role: "switch",
                        "aria-checked": on ? "true" : "false",
                        "aria-label": `${v.book.name} 이 채팅에서 쓰기`,
                        class: "swbtn",
                        onClick: () =>
                          patchMeta({
                            excludedLorebookIds: on
                              ? [...excludedIds(), v.book.id]
                              : excludedIds().filter((id) => id !== v.book.id),
                          }),
                      },
                      sw(on),
                    )
                  : h(
                      "button",
                      {
                        type: "button",
                        class: "txtbtn",
                        onClick: () => patchMeta({ activeLorebookIds: pinnedIds().filter((id) => id !== v.book.id) }),
                      },
                      "빼기",
                    ),
              );
            }),
          )
        : h("div", { class: "empty" }, "이 채팅에서 쓰는 로어북이 없어요."),
      others.length
        ? [
            h("div", { class: "sec", style: { padding: "20px 20px 6px" } }, h("span", { class: "hint" }, "더 붙이기")),
            h(
              "div",
              { class: "list" },
              others.map((b) =>
                h(
                  "button",
                  {
                    type: "button",
                    class: "r",
                    onClick: () => patchMeta({ activeLorebookIds: [...new Set([...pinnedIds(), b.id])] }),
                  },
                  h("span", { class: "ic" }, icon(I.plus)),
                  h("span", null, b.name),
                  h("span", { class: "val" }, ""),
                ),
              ),
            ),
          ]
        : null,
      gap(),
      h(
        "div",
        { class: "list" },
        h(
          "label",
          { class: "r static" },
          h("span", { class: "ic" }, icon(I.lore)),
          h(
            "span",
            { style: { display: "flex", flexDirection: "column", gap: "2px" } },
            "토큰 한도",
            h("span", { class: "hint" }, "이 채팅에서 로어북이 쓸 수 있는 양 · 비우면 기본"),
          ),
          budget,
        ),
      ),
    ];
  }

  /**
   * 표지: this chat's own cover. The browser crops the picked photo to 3:4 and shrinks it to 600×800 WebP before
   * sending it (~50–150KB instead of a full photo). Without a cover, lists show the first character's cropped avatar.
   */
  function coverView() {
    const { chat, index } = state;
    const current = coverOf(chat);
    const raw = current ? current.replace(/#.*$/, "") : null;
    const lead = index.get((chat.characterIds || [])[0]);
    // 표지 위치: drag (or tap) on the picture to choose the point the lists keep in view.
    let at = coverPos(chatMeta(chat)) || { x: 50, y: 50 };
    const bg = raw ? `url("${raw}")` : lead?.avatar ? `url("${thumb(lead.avatar, 240)}")` : "";
    const dot = h("span", { class: "cov-dot", hidden: !raw });
    const preview = h(
      "div",
      {
        class: raw ? "ph cov-pick" : "ph",
        style: {
          position: "relative",
          width: "min(100%, 340px)",
          aspectRatio: "3 / 4",
          margin: "20px auto 8px",
          borderRadius: "12px",
          // A cover shows whole, in its own shape, so the focus can be anywhere on it.
          backgroundSize: raw ? "100% 100%" : "cover",
          backgroundPosition: "center",
          backgroundImage: bg,
          touchAction: raw ? "none" : "auto",
        },
        "aria-label": raw ? "표지에서 보일 곳 고르기" : null,
      },
      dot,
    );
    const smalls = raw
      ? [
          ["목록", { width: "56px", height: "56px", borderRadius: "50%" }],
          ["서재 카드", { width: "56px", height: "76px", borderRadius: "10px" }],
        ].map(([label, size]) =>
          h(
            "span",
            { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" } },
            h("span", {
              class: "ph cov-small",
              style: { ...size, backgroundSize: "cover", backgroundImage: `url("${raw}?w=96")` },
            }),
            h("span", { class: "hint" }, label),
          ),
        )
      : [];
    const show = () => {
      dot.style.left = `${at.x}%`;
      dot.style.top = `${at.y}%`;
      for (const el of preview.parentNode?.querySelectorAll?.(".cov-small") || [])
        el.style.backgroundPosition = `${at.x}% ${at.y}%`;
    };
    if (raw) {
      const probe = new Image();
      probe.onload = () => (preview.style.aspectRatio = `${probe.naturalWidth} / ${probe.naturalHeight}`);
      probe.src = raw;
    }
    if (raw) {
      const move = (e) => {
        const r = preview.getBoundingClientRect();
        at = {
          x: Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))),
          y: Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100))),
        };
        show();
      };
      preview.addEventListener("pointerdown", (e) => {
        preview.setPointerCapture(e.pointerId);
        move(e);
      });
      preview.addEventListener("pointermove", (e) => e.buttons && move(e));
    }
    const savePos = (pos) =>
      patchMeta({ mariKitCoverPos: pos && !(pos.x === 50 && pos.y === 50) ? pos : null }).then(() =>
        toast("표지 위치를 저장했어요"),
      );
    const file = h("input", {
      type: "file",
      accept: "image/*",
      hidden: true,
      onChange: async () => {
        const f = file.files?.[0];
        if (!f) return;
        try {
          const data = await coverWebp(f);
          const res = await api.post(`/mari-kit/shell/cover/${encodeURIComponent(chatId)}`, {
            data,
            replaces: raw ? raw.split("/").pop() : null,
          });
          await patchMeta({ mariKitCover: res.url, mariKitCoverPos: null });
          toast(`표지를 바꿨어요 (${Math.round(res.bytes / 1024)}KB)`);
        } catch (error) {
          toast(`표지를 바꾸지 못했어요: ${error.message}`);
        }
      },
    });
    const out = [
      preview,
      h(
        "p",
        { class: "hint", style: { textAlign: "center", margin: "0 0 12px" } },
        raw
          ? "사진에서 목록·카드에 보일 중심을 눌러 고르세요. 아래 미리 보기로 확인해요"
          : "표지가 없어서 첫 캐릭터 사진(엔진에서 자른 모양)을 써요",
      ),
      raw
        ? h(
            "div",
            {
              style: {
                display: "flex",
                justifyContent: "center",
                alignItems: "flex-end",
                gap: "24px",
                margin: "4px 0 18px",
              },
            },
            smalls,
          )
        : null,
      file,
      raw
        ? h(
            "div",
            { style: { display: "flex", justifyContent: "center", gap: "8px", marginBottom: "12px" } },
            h(
              "button",
              { type: "button", class: "pill", onClick: () => ((at = { x: 50, y: 50 }), show(), savePos(null)) },
              "가운데로",
            ),
            h("button", { type: "button", class: "pill main", onClick: () => savePos(at) }, "위치 저장"),
          )
        : null,
      h(
        "div",
        { style: { display: "flex", justifyContent: "center", gap: "8px" } },
        raw
          ? h(
              "button",
              {
                type: "button",
                class: "pill",
                onClick: async () => {
                  await api.delete(`/mari-kit/shell/cover/${encodeURIComponent(raw.split("/").pop())}`).catch(() => {});
                  await patchMeta({ mariKitCover: null, mariKitCoverPos: null });
                },
              },
              "표지 지우기",
            )
          : null,
        h("button", { type: "button", class: "pill", onClick: () => file.click() }, raw ? "다른 사진" : "사진 고르기"),
      ),
    ];
    requestAnimationFrame(show);
    return out;
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
              chat.mode === "conversation"
                ? linkRow(I.chat, "대화 기능", "자율 메시지 · 일정 · 통화", () => go(here("convo")))
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

  // 대화 기능 (Convo only): the Engine's own per-chat switches for what characters do by themselves — messaging
  // first, their daily routines, calls, cross-chat memory and their commands. Same keys as the Engine's Chat
  // Settings (autonomousMessages, conversationSchedulesEnabled, conversationCallsEnabled, …).
  function convoView() {
    const { chat } = state;
    const meta = chatMeta(chat);
    const many = (chat.characterIds || []).length > 1;
    const auto = meta.autonomousMessages === true;
    const cap = Number.isInteger(meta.autonomousDailyCapOverride) ? meta.autonomousDailyCapOverride : null;
    const schedules =
      meta.characterSchedules && typeof meta.characterSchedules === "object" ? meta.characterSchedules : {};
    const hasSchedules = Object.keys(schedules).length > 0;
    const schedOn =
      typeof meta.conversationSchedulesEnabled === "boolean" ? meta.conversationSchedulesEnabled : hasSchedules;
    const toggles =
      meta.conversationCommandToggles && typeof meta.conversationCommandToggles === "object"
        ? meta.conversationCommandToggles
        : {};
    const commandsOn = meta.characterCommands !== false;
    const capBox = h("input", {
      class: "inp",
      type: "number",
      inputmode: "numeric",
      min: 1,
      value: cap ?? 8,
      "aria-label": "하루 횟수",
      style: { width: "88px", textAlign: "center" },
      onChange: (e) => {
        const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
        patchMeta({ autonomousDailyCapOverride: n });
      },
    });
    const regenerate = async () => {
      const done = startJob("캐릭터 일정 만드는 중…");
      try {
        await api.post("/conversation/schedule/generate", {
          chatId,
          characterIds: chat.characterIds || [],
          forceRefresh: true,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
        });
        toast("캐릭터 일정을 새로 만들었어요");
        await load();
      } catch (error) {
        toast(`일정을 만들지 못했어요: ${error.message}`);
      } finally {
        done();
      }
    };
    return [
      h("div", { class: "gsec", style: { margin: "24px 20px 8px" } }, h("span", null, "자율 메시지")),
      h(
        "div",
        { class: "list" },
        switchRow(
          I.chat,
          "캐릭터가 먼저 말 걸기",
          auto,
          () => patchMeta({ autonomousMessages: !auto }),
          "내가 조용할 때 캐릭터가 먼저 메시지를 보내요",
        ),
        auto
          ? h(
              "div",
              { class: "r static", style: { flexWrap: "wrap", gap: "10px", minHeight: "60px" } },
              h("span", { class: "ic" }, icon(I.calendar)),
              h(
                "span",
                { style: { flex: "1", minWidth: "140px" } },
                "하루 횟수",
                h(
                  "small",
                  { class: "hint", style: { display: "block" } },
                  cap === null ? "캐릭터 말수에 맞춰 정해요" : `하루 최대 ${cap}번`,
                ),
              ),
              h(
                "span",
                { style: { display: "flex", gap: "6px", alignItems: "center" } },
                h(
                  "button",
                  {
                    type: "button",
                    class: cap === null ? "chip on" : "chip",
                    onClick: () => patchMeta({ autonomousDailyCapOverride: null }),
                  },
                  "자동",
                ),
                cap === null
                  ? h(
                      "button",
                      { type: "button", class: "chip", onClick: () => patchMeta({ autonomousDailyCapOverride: 8 }) },
                      "직접",
                    )
                  : capBox,
              ),
            )
          : null,
        many
          ? switchRow(
              I.person,
              "캐릭터끼리 대화",
              meta.characterExchanges === true,
              () => patchMeta({ characterExchanges: meta.characterExchanges !== true }),
              "등장 캐릭터들이 서로 이야기해요",
            )
          : null,
      ),
      h("div", { class: "gsec", style: { margin: "24px 20px 8px" } }, h("span", null, "캐릭터 일정")),
      h(
        "div",
        { class: "list" },
        switchRow(
          I.calendar,
          "캐릭터 일정 쓰기",
          schedOn,
          () => patchMeta({ conversationSchedulesEnabled: !schedOn }),
          "시간대마다 바쁨·잠 같은 상태가 바뀌고 답이 늦어지기도 해요",
        ),
        schedOn
          ? linkRow(
              I.calendar,
              hasSchedules ? "일정 다시 만들기" : "일정 만들기",
              hasSchedules ? `${Object.keys(schedules).length}명 있음` : "없음",
              regenerate,
            )
          : null,
        schedOn
          ? linkRow(I.person, "캐릭터별 일정 고치기", "엔진", () =>
              openEngine(null, { character: (chat.characterIds || [])[0], tab: "convo" }),
            )
          : null,
      ),
      h("div", { class: "gsec", style: { margin: "24px 20px 8px" } }, h("span", null, "통화")),
      h(
        "div",
        { class: "list" },
        switchRow(I.phone, "이 방에서 통화", meta.conversationCallsEnabled === true, () =>
          patchMeta({ conversationCallsEnabled: meta.conversationCallsEnabled !== true }),
        ),
        meta.conversationCallsEnabled === true
          ? switchRow(I.phone, "캐릭터가 전화 걸기", meta.conversationCharactersCanCall !== false, () =>
              patchMeta({ conversationCharactersCanCall: meta.conversationCharactersCanCall === false }),
            )
          : null,
        meta.conversationCallsEnabled === true
          ? switchRow(
              I.voice,
              "통화 대사에 감정 표시",
              meta.conversationCallVoiceCues !== false,
              () => patchMeta({ conversationCallVoiceCues: meta.conversationCallVoiceCues === false }),
              "음성이 [속삭임] 같은 표시를 읽어요",
            )
          : null,
        linkRow(I.phone, "통화 설정 더보기", "", () => go(`call-settings/${encodeURIComponent(chatId)}`)),
      ),
      h("div", { class: "gsec", style: { margin: "24px 20px 8px" } }, h("span", null, "다른 채팅")),
      h(
        "div",
        { class: "list" },
        switchRow(
          I.link,
          "다른 채팅 알기",
          meta.crossChatAwareness !== false,
          () => patchMeta({ crossChatAwareness: meta.crossChatAwareness === false }),
          "같은 캐릭터가 다른 채팅에서 있었던 일을 알아요",
        ),
      ),
      h("div", { class: "gsec", style: { margin: "24px 20px 8px" } }, h("span", null, "캐릭터가 할 수 있는 일")),
      h(
        "div",
        { class: "list" },
        switchRow(
          I.guide,
          "명령 쓰기",
          commandsOn,
          () => patchMeta({ characterCommands: !commandsOn }),
          "끄면 아래 모두 꺼져요",
        ),
        commandsOn
          ? CONVO_COMMANDS.map(([id, label, about]) =>
              switchRow(
                I.square,
                label,
                toggles[id] !== false,
                () => patchMeta({ conversationCommandToggles: { ...toggles, [id]: toggles[id] === false } }),
                about,
              ),
            )
          : null,
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
    const views = {
      all: allView,
      cast: castView,
      author: authorView,
      cover: coverView,
      lorebooks: lorebooksView,
      translation: () => [gap(), translationList(chat, conns)],
      kit: kitView,
      view: viewView,
      convo: convoView,
    };
    const content = (views[view] || homeView)();
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

/** A picked photo as a 3:4, 600×800 (at most) WebP, base64 — cropped from the middle, made in the browser. */
async function coverWebp(file) {
  // The whole picture in its own shape (wide stays wide), longest side up to 1200px; lists crop around the focus.
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
