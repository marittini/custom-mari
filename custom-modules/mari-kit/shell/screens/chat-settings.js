// Chat settings for one room.
//   #/chat-settings/<chatId>          자주: what a chat changes often, one tap each
//   #/chat-settings/<chatId>/<view>   번역 · 등장 캐릭터 · 작가 노트 · Mari Kit · 화면 · 모든 채팅 설정 (all/<group>)
// 모든 채팅 설정 lists every section of the Engine's own Chat Settings for this chat's mode, in four groups. Sections
// the shell draws open here; the rest open the Engine at that section (Mari Kit's Engine-side script, with a pill back).

import { h, icon, I, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data, characterIndex, chatMeta, chatTitle, coverOf } from "../lib/data.js";
import { setPrefs, isDark, TOOL_DEFS, toolPlace } from "../lib/prefs.js";
import { topBar, toast, errorBox, openEngine, sheet, avatar, thumb } from "../lib/ui.js";
import { lorebookViews, REASON_LABEL } from "../lib/lorebooks.js";
import { ENGINE_SECTIONS } from "../lib/engine-sections.js";
import { groupsOf, splitByGroup, groupedOptions, sectioned } from "../lib/groups.js";

const NOT_CHAT = ["image_generation", "video_generation", "audio_generation", "audio", "decision"];

const VIEW_TITLES = {
  translation: "번역",
  cast: "등장 캐릭터",
  author: "작가 노트",
  cover: "표지",
  lorebooks: "로어북",
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
      const groupKinds = main ? ["connections", "presets", "personas"] : view === "translation" ? ["connections"] : [];
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
        conns: conns.filter((c) => !NOT_CHAT.includes(c.provider)),
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
        selectRow(
          I.person,
          "페르소나",
          chat.personaId,
          groupedOptions(
            h,
            chat.personaId,
            [["", "없음"]],
            splitByGroup(personas, state.groups.personas || []),
            (p) => [p.id, p.name || "이름 없음"],
          ),
          (v) => patchChat({ personaId: v || null }),
        ),
      ),
      gap(),
      h(
        "div",
        { class: "list" },
        linkRow(I.square, "표지", coverOf(chat) ? "있음" : "캐릭터 사진", () => go(here("cover"))),
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
    if (!confirm(`'${chatTitle(chat, index)}' 채팅을 지울까요? 메시지도 함께 지워지고 되돌릴 수 없어요.`)) return;
    try {
      const cover = coverOf(chat);
      if (cover)
        await api.delete(`/mari-kit/shell/cover/${encodeURIComponent(cover.split("/").pop())}`).catch(() => {});
      await api.delete(`/chats/${encodeURIComponent(chatId)}`);
      await data.chats(true);
      toast("채팅을 지웠어요");
      location.replace(`#/${chat.mode === "conversation" ? "convos" : "library"}`);
    } catch (error) {
      toast(`지우지 못했어요: ${error.message}`);
    }
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
    const lead = index.get((chat.characterIds || [])[0]);
    const preview = h("div", {
      class: "ph",
      style: {
        width: "150px",
        aspectRatio: "3 / 4",
        margin: "20px auto 8px",
        borderRadius: "12px",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundImage: current ? `url("${current}")` : lead?.avatar ? `url("${thumb(lead.avatar, 240)}")` : "",
      },
    });
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
            replaces: current ? current.split("/").pop() : null,
          });
          await patchMeta({ mariKitCover: res.url });
          toast(`표지를 바꿨어요 (${Math.round(res.bytes / 1024)}KB)`);
        } catch (error) {
          toast(`표지를 바꾸지 못했어요: ${error.message}`);
        }
      },
    });
    return [
      preview,
      h(
        "p",
        { class: "hint", style: { textAlign: "center", margin: "0 0 12px" } },
        current ? "이 채팅의 표지" : "표지가 없어서 첫 캐릭터 사진(엔진에서 자른 모양)을 써요",
      ),
      file,
      h(
        "div",
        { style: { display: "flex", justifyContent: "center", gap: "8px" } },
        current
          ? h(
              "button",
              {
                type: "button",
                class: "pill",
                onClick: async () => {
                  await api
                    .delete(`/mari-kit/shell/cover/${encodeURIComponent(current.split("/").pop())}`)
                    .catch(() => {});
                  await patchMeta({ mariKitCover: null });
                },
              },
              "표지 지우기",
            )
          : null,
        h(
          "button",
          { type: "button", class: "pill main", onClick: () => file.click() },
          current ? "다른 사진" : "사진 고르기",
        ),
      ),
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
    const views = {
      all: allView,
      cast: castView,
      author: authorView,
      cover: coverView,
      lorebooks: lorebooksView,
      translation: () => [gap(), translationList(chat, conns)],
      kit: kitView,
      view: viewView,
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
  const bitmap = await createImageBitmap(file);
  const want = 3 / 4;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (sw / sh > want) sw = Math.round(sh * want);
  else sh = Math.round(sw / want);
  const scale = Math.min(1, 600 / sw);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas
    .getContext("2d")
    .drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
