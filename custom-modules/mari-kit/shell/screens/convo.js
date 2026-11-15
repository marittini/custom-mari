// Convo screen, messenger style: bubbles grouped by sender, a tap on a bubble shows its message tools
// (show / more / hidden, same choice as RP), and the composer offers the same quick-reply menu.
// Convo rooms keep the Engine's own memory system; Mari Kit's memory button is RP only.

import { quickButton } from "../lib/quick.js";
import { swipeNav } from "../lib/swipes.js";
import { chatScrolling } from "../lib/scrolling.js";
import { activityStrip, startJob } from "../lib/activity.js";
import { h, icon, dots, I, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import {
  data,
  characterIndex,
  chatTitle,
  chatMeta,
  messageText,
  firstLetter,
  shortTime,
  messageWindow,
} from "../lib/data.js";
import { TOOL_DEFS, toolPlace, prefs } from "../lib/prefs.js";
import {
  toast,
  errorBox,
  avatar,
  avatarStack,
  olderButton,
  fitMenus,
  jumpTo,
  sheet,
  ask,
  openEngine,
} from "../lib/ui.js";
import { pickVoice, stripCues, inline } from "../lib/render.js";
import * as tts from "../lib/tts.js";
import { syncVoiceSettings } from "../lib/voice.js";
import { shownText, translateStickerInput, stickerTokensMatch } from "../lib/translate.js";
import { loadStickers, stickerContent, stickerPicker, stickerLabel, withoutStickerTokens } from "../lib/stickers.js";
import { watchGeneration, stopGeneration } from "../lib/generation.js";
import { attachmentsOf, closeInTime, dayKey, dayLabel, presenceText, subject, timeLabel } from "../lib/convo-bits.js";
import { presenceOf, presenceLine, STATUS_KO } from "../lib/presence.js";
// lib/compose.js (pictures, @mentions) loads the first time it is needed, not with the screen.
let composeP = null;
const compose = () => composeP || (composeP = import("../lib/compose.js"));
import { presenceFields } from "../lib/my-status.js";
import {
  QUICK,
  USER,
  reactionsOf,
  reactorNames,
  removeReactor,
  replyFor,
  replyOf,
  toggleReaction,
} from "../lib/reactions.js";
import { activeAutonomy, clearUnread } from "../lib/autonomy.js";
import { runSlash } from "../lib/slash.js";
import { readRecents, rememberRecent } from "../lib/media.js";
import {
  GUIDE,
  quickReplies,
  runTool,
  streamGenerate,
  hiddenFromAI,
  toolLabel,
  composerTool,
  slashNote,
} from "../lib/actions.js";

export function convoScreen({ mount, args, go, back }) {
  const chatId = args[0];
  let alive = true;
  let chat = null;
  let index = new Map();
  let group = false; // more than one character in the room
  let messages = [];
  const win = messageWindow(chatId);
  let busy = false;
  let live = null;
  let picked = null;
  let moreOpen = false;
  let quick = [];
  let qrOpen = false;
  let ttsConfig = null;
  let callAudio = false;
  let voiceSet = null;
  let abort = null;
  // The Engine's presence notices: wait = a character typing, or busy/away and answering later (during a
  // generation); offNote = why the last message got no answer (offline, in a Scene), until the next send.
  let wait = null;
  let offNote = null;
  let pictures = []; // pictures waiting to be sent: the Engine's attachments, made small on the phone
  let replyDraft = null; // { messageId, name, content }: sent as the generate request's replyTo (the Engine's reply)
  let fresh = null; // GET /conversation/status/:chatId statuses (characters' presence), once per open and reply
  let tick = null; // the presence line's minute timer
  let me = null; // the persona's schedule state (Mari Kit 내 일정), when there is one
  let phoneBtn = null;
  let call = null; // the call screen, when the Calls package is installed
  let callPoll = null;
  let ringCheck = null; // looks for a ringing call (calls start from a character's message)
  let auto = null; // Convo autonomy while this chat is open
  let offVisible = () => {};
  let stickers = { list: [], map: new Map(), globals: [] };
  let stickersIn = false; // the chat's stickers and emojis have been read (at least once)
  let stickerContext = "";
  let stickerAttempted = false;
  let stickerLoad = null;
  let stickerDialog = null;
  let standardEmoji = null; // the Engine's shortcode → emoji, once its list is here
  const emojiView = () => ({ map: stickers.emojis?.map || new Map(), resolve: standardEmoji });

  const who = h("span", {
    style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", minWidth: "0" },
  });
  const head = h(
    "header",
    {
      style: {
        flexShrink: "0",
        display: "grid",
        gridTemplateColumns: "96px minmax(0,1fr) 96px",
        alignItems: "center",
        padding: "12px 4px",
        borderBottom: "1px solid var(--line)",
        background: "var(--surface)",
      },
    },
    h(
      "button",
      {
        type: "button",
        class: "ib",
        "aria-label": "대화 목록",
        onClick: () => back("convos"),
      },
      icon(I.back, 22, 1.8),
    ),
    who,
    h(
      "span",
      { style: { display: "flex", justifyContent: "flex-end" } },
      (phoneBtn = h(
        "button",
        { type: "button", class: "ib", "aria-label": "전화 걸기", hidden: true, onClick: () => dial() },
        icon(I.phone, 19, 1.6),
      )),
      h(
        "button",
        {
          type: "button",
          class: "ib",
          "aria-label": "채팅 설정",
          onClick: () => go(`chat-settings/${encodeURIComponent(chatId)}`),
        },
        icon(I.info),
      ),
    ),
  );
  const list = h("div", { class: "cv" });
  const scroller = h("div", { class: "scroll", style: { background: "var(--paper)" } }, list);
  const input = h("textarea", {
    class: "cin",
    rows: 1,
    placeholder: "메시지",
    "aria-label": "메시지",
    onInput: () => {
      grow();
      if (input.value.includes("@") || input.value.includes(":") || !mentionBox.hidden) mentionCheck();
    },
    // Tapping the text box brings the keyboard back in place of the media panel.
    onFocus: () => closePanel(false),
    onKeydown: (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) {
        e.preventDefault();
        send();
      }
    },
  });
  const qrBtn = h(
    "button",
    {
      type: "button",
      class: "cb",
      "aria-label": "빠른 답장",
      "aria-haspopup": "menu",
      hidden: true,
      onClick: () => {
        qrOpen = !qrOpen;
        drawQuick();
      },
    },
    dots(),
  );
  // The Engine's 보내기 옆 번역 버튼 (chat setting): translates the draft in place.
  const trBtn = h(
    "button",
    {
      type: "button",
      class: "cb",
      "aria-label": "입력 번역",
      hidden: true,
      onClick: async () => {
        const text = input.value.trim();
        if (!text) return;
        trBtn.disabled = true;
        try {
          input.value = await translateStickerInput(text, chatMeta(chat), chatId);
          grow();
        } catch (error) {
          toast(
            error.code === "STICKER_TRANSLATION_CHANGED"
              ? stickerLabel("translationChanged")
              : `번역하지 못했어요: ${error.message}`,
          );
        } finally {
          trBtn.disabled = false;
        }
      },
    },
    icon(I.translate, 16, 1.6),
  );
  const sendBtn = h(
    "button",
    { type: "button", class: "cb send", "aria-label": "보내기", onClick: () => (busy ? stopGenerating() : send()) },
    icon(I.send, 16, 2),
  );
  const mediaIcon = [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
    "M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8",
    "M9 9.5h.01M15 9.5h.01",
  ];
  const PHOTO = ["M4 6h16v12H4z", "M9 10.5a1.5 1.5 0 1 0 0-.01", "M20 15l-5-5-8 8"];
  // ☺: the Engine's media panel (emoji, kaomoji, stickers) where the keyboard was; loaded the first time.
  let panel = null;
  const panelHost = h("div", { class: "mp-host" });
  const reactHost = h("div", { class: "mp-host" }); // the reaction ＋'s emoji panel (moreReactions)
  const mediaBtn = h(
    "button",
    {
      type: "button",
      class: "cb",
      "aria-label": "이모지·스티커",
      title: "이모지·스티커",
      "aria-expanded": "false",
      disabled: true,
      onClick: () => (panel?.open ? closePanel(true) : openPanel()),
    },
    icon(mediaIcon, 18, 1.6),
  );
  async function openPanel() {
    if (!chat) return;
    reactPanel?.hide();
    qrOpen = false;
    drawQuick();
    hideMentions();
    input.blur(); // the panel takes the keyboard's place
    if (!panel) {
      const { mediaPanel } = await import("../lib/media-panel.js");
      panel = mediaPanel({
        media: async ({ refresh }) => {
          if (refresh) stickerLoad = null;
          const s = await refreshStickers();
          return { stickers: s, emojis: s.emojis };
        },
        onInsert: (text) => insertText(text),
        onSticker: (name, how) => {
          if (how === "send" && busy) {
            // A reply is being written (보내기 is 멈추기 now): the sticker waits in the text box, and says so.
            insertSticker(name, false);
            toast("답장을 쓰는 중이라 입력칸에 넣었어요");
          } else if (how === "send") {
            closePanel(false);
            generate({ userMessage: `sticker:${name}:` });
          } else insertSticker(name, false);
        },
        manage: (kind) => manageMedia(kind),
        games: async () => (await import("../lib/games.js")).turnGames(),
        onGame: (g) => openGame(g),
      });
      setChildren(panelHost, panel.el);
    }
    panel.show();
    mediaBtn.setAttribute("aria-expanded", "true");
  }
  function closePanel(toKeyboard) {
    if (!panel?.open) return;
    panel.hide();
    mediaBtn.setAttribute("aria-expanded", "false");
    if (toKeyboard) input.focus();
  }
  /** Text at the caret without opening the keyboard (the panel stays open for more). */
  function insertText(text) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText(text, start, end, "end");
    grow();
  }
  async function manageMedia(kind) {
    if (kind === "selection") {
      const { emojiSelectionSheet } = await import("../lib/emoji-selection.js");
      return emojiSelectionSheet(chat, () => load(false));
    }
    return new Promise((resolve) => {
      stickerDialog?.close();
      stickerDialog = stickerPicker({
        kind,
        load: () => ((stickerLoad = null), refreshStickers().then((s) => (kind === "emoji" ? s.emojis : s))),
        onPick: kind === "emoji" ? (name) => insertText(`:${name}:`) : (name) => insertSticker(name, false),
        onClose: () => {
          stickerDialog = null;
          resolve();
        },
      });
    });
  }
  const quickLayer = h("div");
  const replyBar = h("div", { class: "rbar", hidden: true });
  // Pictures to send (＋): picked, made small on the phone (lib/compose.js), shown above the composer until sent.
  const picBar = h("div", { class: "picbar", hidden: true });
  const filePick = h("input", {
    type: "file",
    accept: "image/*",
    multiple: true,
    hidden: true,
    onChange: async (e) => {
      const files = [...(e.target.files || [])].slice(0, 6 - pictures.length);
      e.target.value = "";
      if (!files.length) return;
      const done = startJob(`사진 ${files.length}장 줄이는 중…`, null, { chat: chatId });
      try {
        for (const f of files) {
          try {
            pictures.push(await (await compose()).shrinkPicture(f));
          } catch (error) {
            toast(`${f.name || "사진"}: ${error.message}`);
          }
        }
      } finally {
        done();
        drawPictures();
      }
    },
  });
  const picBtn = h(
    "button",
    {
      type: "button",
      class: "cb",
      "aria-label": "사진 첨부",
      title: "사진 첨부",
      onClick: () => (pictures.length >= 6 ? toast("한 번에 6장까지 보낼 수 있어요") : filePick.click()),
    },
    icon(I.plus, 18, 1.7),
  );
  // @이름: the room's characters while typing "@…" (the Engine's mention autocomplete).
  const mentionBox = h("div", { class: "mbox", role: "listbox", "aria-label": "부를 캐릭터", hidden: true });
  // ＋: everything besides typing and sending, tucked into one menu that looks like the quick-reply menu (the
  // composer keeps only ＋ · the text box · 보내기). The buttons below stay the actions; the menu presses them.
  const quickSettingsBtn = quickButton({
    getChat: () => chat,
    go,
    changed: async () => {
      await load(false);
      await loadMe();
    },
  });
  let toolsMenuOpen = false;
  const toolsBtn = h(
    "button",
    {
      type: "button",
      class: "cb",
      "aria-label": "도구",
      title: "도구",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      onClick: () => {
        toolsMenuOpen = !toolsMenuOpen;
        qrOpen = false;
        drawQuick();
      },
    },
    icon(I.plus, 19, 1.7),
  );
  const toolItems = () =>
    [
      [mediaBtn, mediaIcon, "이모지·스티커"],
      [picBtn, PHOTO, "사진"],
      [qrBtn, null, "빠른 답장"],
      [quickSettingsBtn, I.sliders, "빠른 설정"],
      [trBtn, I.translate, "입력 번역"],
    ].filter(([btn]) => !btn.hidden);
  const strip = activityStrip();
  const scroll = chatScrolling(scroller);
  mount.append(
    head,
    scroller,
    scroll.anchor,
    quickLayer,
    strip.el,
    replyBar,
    picBar,
    mentionBox,
    h("div", { class: "cmp", style: { background: "var(--paper)" } }, toolsBtn, filePick, input, sendBtn),
    panelHost,
    reactHost,
  );

  function grow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }

  function insertSticker(name, focus = true) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const before = input.value.slice(0, start);
    input.setRangeText(`${before && !before.endsWith("\n") ? "\n" : ""}sticker:${name}:\n`, start, end, "end");
    grow();
    if (focus) input.focus();
  }

  // No polling or asset reads on each reply. History loads the map only when it contains a sticker;
  // opening the picker and changing its library explicitly refresh it.
  function refreshStickers() {
    const context = stickerContext;
    if (stickerLoad?.context === context) return stickerLoad.promise;
    stickerAttempted = true;
    const request = { context, promise: null };
    request.promise = loadStickers(chat, index)
      .then((next) => {
        if (alive && context === stickerContext) {
          stickers = next;
          stickersIn = true;
          draw();
        }
        return next;
      })
      .finally(() => {
        if (stickerLoad === request) stickerLoad = null;
      });
    stickerLoad = request;
    return request.promise;
  }

  // Mini-games (lib/games.js): the Engine draws their boards, so a pick opens the Engine here with the command typed.
  let gameBoard = false;
  function openGame(g) {
    openEngine(chatId, { draft: `${g.command} ` });
  }
  async function gamesSheet() {
    const { turnGames } = await import("../lib/games.js");
    const list = await turnGames();
    const s = sheet(
      h(
        "div",
        { class: "psheet pad" },
        h("b", { class: "psheet-title" }, "게임"),
        list.length
          ? [
              h(
                "div",
                { class: "list" },
                list.map((g) =>
                  h(
                    "button",
                    { type: "button", class: "r", onClick: () => (s.close(), openGame(g)) },
                    h("span", null, g.name, h("small", { class: "hint", style: { display: "block" } }, g.command)),
                    h("span", { class: "val" }, "엔진에서 ›"),
                  ),
                ),
              ),
              h(
                "p",
                { class: "hint", style: { margin: "0" } },
                "게임판은 엔진 화면에서 열려요. 처음 열 때 몇 MB를 받아요. 엔진에서 보내기를 누르면 게임 준비 창이 떠요.",
              ),
            ]
          : h(
              "p",
              { class: "hint", style: { margin: "0" } },
              "설치한 게임이 없어요. 우노·체스 같은 게임은 엔진의 패키지 목록에서 설치하면 여기 나타나요.",
            ),
      ),
      { label: "게임" },
    );
  }
  async function loadGameBoard() {
    const { turnGames, hasGameBoard } = await import("../lib/games.js");
    gameBoard = (await turnGames()).length > 0 && (await hasGameBoard(chatId));
    if (alive && gameBoard) draw();
  }
  const gameStrip = () =>
    gameBoard
      ? h(
          "div",
          { class: "scnbar", role: "status" },
          h(
            "div",
            { class: "scnbar-t" },
            h("b", null, "이 채팅에 게임판이 있어요"),
            h("span", null, "게임판은 엔진 화면에 있어요"),
          ),
          h("button", { type: "button", class: "pill main", onClick: () => openEngine(chatId) }, "엔진에서 이어 하기"),
        )
      : null;

  // A scene running from this Convo (the Engine's SceneBanner): { id, name, repliesHere }, read when the chat says so.
  let scene = null;
  const sceneLib = () => import("../lib/scene.js");
  async function loadScene() {
    const id = chatMeta(chat).activeSceneChatId;
    if (!id) return (scene = null);
    try {
      const sc = await data.chat(id);
      const m = chatMeta(sc);
      scene =
        m.sceneStatus === "active"
          ? { id, name: sc.name || "장면", repliesHere: m.sceneOriginRepliesAllowed === true }
          : null;
    } catch {
      scene = null;
    }
  }
  const extraOf = (m) => {
    if (typeof m.extra !== "string") return m.extra || {};
    try {
      return JSON.parse(m.extra) || {};
    } catch {
      return {};
    }
  };
  async function beginScene(request) {
    const { startScene } = await sceneLib();
    await startScene({ chat, index, request, go });
    await loadScene();
    if (alive) draw();
  }
  // The invitation under a character's message (extra.sceneRequest): set it up, or go to the scene already running.
  function sceneCard(m) {
    const r = extraOf(m).sceneRequest;
    if (!r || typeof r !== "object") return null;
    const name = r.initiatorCharName || index.get(r.initiatorCharId)?.name || "캐릭터";
    return h(
      "div",
      { class: "scncard" },
      h("span", null, `${name}이(가) 장면에 초대했어요.`),
      scene
        ? h(
            "button",
            { type: "button", class: "pill", onClick: () => go(`rp/${encodeURIComponent(scene.id)}`) },
            "진행 중인 장면으로",
          )
        : h("button", { type: "button", class: "pill main", onClick: () => beginScene(r) }, "장면 준비하기"),
    );
  }
  function sceneBanner() {
    if (!scene) return null;
    return h(
      "div",
      { class: "scnbar", role: "status" },
      h("div", { class: "scnbar-t" }, h("b", null, "장면 진행 중"), h("span", null, scene.name)),
      h(
        "button",
        {
          type: "button",
          class: "r two",
          role: "switch",
          "aria-checked": scene.repliesHere ? "true" : "false",
          onClick: async () => {
            const next = !scene.repliesHere;
            scene.repliesHere = next;
            draw();
            try {
              await (await sceneLib()).setRepliesHere(scene.id, next);
            } catch (error) {
              scene.repliesHere = !next;
              draw();
              toast(`바꾸지 못했어요: ${error.message}`);
            }
          },
        },
        h("span", null, "여기서도 답하게", h("small", null, "장면 중에도 이 대화에서 답해요 · 먼저 말 걸지는 않아요")),
        h("span", { class: scene.repliesHere ? "sw on" : "sw" }, h("span")),
      ),
      h(
        "button",
        { type: "button", class: "pill main", onClick: () => go(`rp/${encodeURIComponent(scene.id)}`) },
        "장면으로 가기",
      ),
    );
  }

  async function load(first, tail = false) {
    try {
      const [c, chars] = await Promise.all([data.chat(chatId), data.characters(), win.reload(tail)]);
      if (!alive) return;
      chat = c;
      await loadScene();
      if (!alive) return;
      mediaBtn.disabled = false;
      const context = JSON.stringify([chat.personaId, chat.characterIds || []]);
      if (context !== stickerContext) {
        stickerContext = context;
        stickerAttempted = false;
        stickers = { list: [], map: new Map(), globals: [] };
        if (panel?.open) panel.reload();
      }
      trBtn.hidden = chatMeta(chat).showInputTranslateButton !== true;
      index = characterIndex(chars);
      group = (chat.characterIds || []).length > 1;
      messages = shown();
      if (first) {
        const [ui, config] = await Promise.all([data.engineUi(), api.get("/tts/config").catch(() => null)]);
        quick = quickReplies(ui, I.guide, "conversation");
        qrBtn.hidden = !quick.length;
        ttsConfig = config?.enabled ? config : null;
        callAudio = config?.callAudioEnabled === true;
        voiceSet = ttsConfig ? await syncVoiceSettings(config) : null;
        const cast = (chat.characterIds || []).map((id) => index.get(id)).filter(Boolean);
        const lead = cast[0];
        const title = chatTitle(chat, index);
        setChildren(
          who,
          cast.length > 1 ? avatarStack(cast, 40) : avatar(lead?.avatar, firstLetter(title), 40),
          h(
            "span",
            {
              style: {
                fontSize: "12px",
                maxWidth: "100%",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              },
            },
            `${title} ›`,
          ),
        );
        who.style.cursor = lead ? "pointer" : "";
        // One character: their profile. A group: the room's cast in chat settings.
        if (lead)
          who.onclick = () =>
            go(
              cast.length > 1
                ? `chat-settings/${encodeURIComponent(chatId)}`
                : `character/${encodeURIComponent(lead.id)}`,
            );
        loadMe();
        loadPresence();
        loadGameBoard().catch(() => {});
        // The status line follows the schedule minute by minute, from data already here.
        tick = setInterval(() => document.visibilityState === "visible" && drawPresence(), 60000);
        setupCalls();
        // The Engine's Convo autonomy (characters writing first, exchanges, busy delays) runs in its client;
        // the shell runs the same while this chat is open (lib/autonomy.js).
        auto = activeAutonomy({
          chatId,
          meta: () => chatMeta(chat),
          userStatus: () => presence().userStatus || "active",
          isBusy: () => busy,
          generate: (body) => generate(body),
        });
        if (Number(chatMeta(chat).autonomousUnreadCount) > 0) clearUnread(chatId).then(() => data.chats(true));
        // Opened from a search hit (#/convo/<chat>/<message>): read back to it.
        if (args[1] && (await win.until(args[1]))) messages = shown();
      }
      draw();
      if (first) requestAnimationFrame(() => jumpTo(list, args[1]) || (scroller.scrollTop = scroller.scrollHeight));
    } catch (error) {
      if (alive) setChildren(list, errorBox(error));
    }
  }

  // The user's own schedule (Mari Kit 내 일정): its status goes with every generation (presence()), and its line is
  // at the bottom of the status sheet.
  const SCHED_LABEL = { online: "온라인", idle: "자리 비움", dnd: "방해 금지", offline: "오프라인" };
  async function loadMe() {
    try {
      me = await api.get(`/mari-kit/schedule/chat/${encodeURIComponent(chatId)}`);
    } catch {
      me = null;
    }
    if (alive) drawPresence();
  }

  // The characters' presence (the Engine's status and schedules) under the name; tapping it opens the status sheet,
  // which also holds the user's own schedule line. Computed on screen from the schedule each minute (no request);
  // read fresh from the Engine when the chat opens and after each reply.
  async function loadPresence() {
    try {
      fresh = (await api.get(`/conversation/status/${encodeURIComponent(chatId)}`))?.statuses || null;
    } catch {
      fresh = null;
    }
    if (alive) drawPresence();
  }
  function drawPresence() {
    if (!chat) return;
    who.querySelector(".me-line")?.remove();
    const meta = chatMeta(chat);
    const now = new Date();
    const people = (chat.characterIds || [])
      .map((id) => ({ id, c: index.get(id), p: presenceOf(meta, id, now, fresh?.[id] || null) }))
      .filter((x) => x.c);
    if (!people.length) return;
    let text;
    if (people.length === 1) text = presenceLine(people[0].p) || STATUS_KO[people[0].p?.status || "online"];
    else {
      const shown = people.slice(0, 2).map((x) => `${x.c.name} ${STATUS_KO[x.p?.status || "online"]}`);
      text = `${shown.join(" · ")}${people.length > 2 ? ` 외 ${people.length - 2}` : ""}`;
    }
    who.append(
      h(
        "button",
        {
          type: "button",
          class: "me-line",
          "aria-label": `상태와 일정: ${text}`,
          onClick: (e) => {
            e.stopPropagation();
            openPresence();
          },
        },
        people.slice(0, 3).map((x) => h("span", { class: `sdot ${x.p?.status || "online"}` })),
        h("span", { class: "me-line-t" }, text),
      ),
    );
  }
  // The sheet's code loads only when it is opened (most visits never open it).
  async function openPresence() {
    const { presenceSheet } = await import("../lib/presence-sheet.js");
    if (!alive) return;
    presenceSheet({
      chat,
      index,
      fresh,
      me,
      go,
      changed: async () => {
        await load(false);
        await loadPresence();
      },
    });
  }
  /** The Engine's own presence fields, so its autonomy sees the user's planned status too. */
  // The status the user chose (상태 시트 › 나), or, following the schedule, what 내 일정 says now.
  function presence() {
    return presenceFields(me?.profile?.config?.enabled ? me.now : null, SCHED_LABEL);
  }

  function toolsFor(m) {
    const usable = TOOL_DEFS.filter(
      (t) =>
        !(t.assistantOnly && m.role !== "assistant") &&
        !(t.id === "voice" && (!ttsConfig || !stripCues(withoutStickerTokens(messageText(m))).trim())),
    );
    return {
      shown: usable.filter((t) => toolPlace(t) === "show"),
      more: usable.filter((t) => toolPlace(t) === "more"),
    };
  }

  // The call package's notes in the conversation (ringing, started, declined, ended), shown as thin lines in the
  // shell's words instead of its English ("Incoming call"); an ended call also gets its card when calls are kept
  // (통화 설정 › 대화에 통화 대사 남기기), and its 통화 종료 line always.
  function callEvent(m) {
    if (m.role !== "system") return null;
    let extra = m.extra;
    try {
      if (typeof extra === "string") extra = JSON.parse(extra);
    } catch {}
    const ev = extra?.conversationCallEvent;
    return ev?.callId ? { ...ev, endedBy: extra.mariEndedBy || null, missed: extra.mariMissed === true } : null;
  }
  // What the package's note does not say, learnt when the call screen closes and written onto the note so it
  // survives a reload: who hung up (on the ended note) and that nobody answered (on the declined note).
  const callNotes = new Map(); // callId → { status, patch }
  async function markCallNotes() {
    for (const m of win.list) {
      const ev = callEvent(m);
      const note = ev && callNotes.get(ev.callId);
      if (!note || note.status !== ev.status) continue;
      callNotes.delete(ev.callId);
      try {
        await api.patch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(m.id)}/extra`, note.patch);
        const extra = typeof m.extra === "string" ? JSON.parse(m.extra || "{}") : m.extra || {};
        m.extra = { ...extra, ...note.patch };
      } catch {}
    }
  }
  const hiddenFromUser = (m) => {
    try {
      return (typeof m.extra === "string" ? JSON.parse(m.extra || "{}") : m.extra || {}).hiddenFromUser === true;
    } catch {
      return false;
    }
  };
  function callLine(ev, m) {
    const at = shortTime(m.createdAt);
    const cast = (chat?.characterIds || []).map((id) => index.get(id)).filter(Boolean);
    const text =
      ev.status === "ended"
        ? ev.endedBy === "user"
          ? "통화 종료 · 내가 끊음"
          : ev.endedBy && index.get(ev.endedBy)
            ? `통화 종료 · ${subject(index.get(ev.endedBy).name)} 끊음`
            : "통화 종료"
        : ev.status === "ringing"
          ? `${cast.length === 1 ? `${cast[0].name}에게서 ` : ""}전화가 왔어요 · ${at}`
          : ev.status === "declined"
            ? ev.missed
              ? `부재중 전화${cast.length > 1 && index.get(m.characterId) ? ` · ${index.get(m.characterId).name}` : ""} · ${at}`
              : `거절한 전화 · ${at}`
            : `통화 시작 · ${at}`;
    return h(
      "div",
      { class: "daysep callsep", role: "note", title: messageText(m) },
      h("span", null, icon(I.phone, 12, 1.8), text),
      ev.missed && call && chatMeta(chat).conversationCallsEnabled === true && callAudio
        ? h("button", { type: "button", class: "chip", onClick: () => dial(false) }, "다시 걸기")
        : null,
    );
  }
  // An ended call as a card: how long, the Engine's call summary when it has made one, the first two lines (read
  // once per call, kept), and the whole record on a tap.
  const callLines = new Map(); // callId → { count, first: [text] } | "loading"
  function callCard(ev, m) {
    const min = ev.durationMs ? Math.max(1, Math.round(ev.durationMs / 60000)) : null;
    const lines = callLines.get(ev.callId);
    if (!lines) {
      callLines.set(ev.callId, "loading");
      Promise.all([
        api.get(`/conversation-calls/${encodeURIComponent(ev.callId)}/messages`),
        data.personas().catch(() => []),
      ])
        .then(([rows, personas]) => {
          const myName = (personas || []).find((p) => p.id === chat?.personaId)?.name || "나";
          const said = (Array.isArray(rows) ? rows : []).filter(
            (r) => r.extra?.hiddenFromUser !== true && !["command", "system"].includes(r.kind) && r.content,
          );
          const who = (r) => (r.participantKind === "user" ? myName : index.get(r.characterId)?.name || "상대");
          callLines.set(ev.callId, {
            count: said.length,
            first: said.slice(0, 2).map((r) => `${who(r)}: ${r.content}`),
          });
          if (alive) draw();
        })
        .catch(() => callLines.set(ev.callId, { count: 0, first: [] }));
    }
    const got = lines && lines !== "loading" ? lines : null;
    return h(
      "button",
      { type: "button", class: "callcard", onClick: () => call?.logSheet(ev.callId, ev) },
      h(
        "span",
        { class: "callcard-h" },
        icon(I.phone, 14, 1.8),
        `음성 통화${min ? ` · ${min}분` : ""}`,
        h("span", { class: "hint", style: { fontWeight: "400" } }, shortTime(m.createdAt)),
      ),
      ev.summary ? h("span", { class: "callcard-q", style: { whiteSpace: "normal" } }, ev.summary) : null,
      !ev.summary && got ? got.first.map((t) => h("span", { class: "callcard-q" }, t)) : null,
      h("span", { class: "callcard-f" }, got ? `대사 ${got.count}줄 · 눌러서 전체 보기` : "눌러서 통화 기록 보기"),
    );
  }

  function shown() {
    // System lines (dice, notices) show like the Engine's; call notes as lines; never what is hidden from the user
    // (the package's call summary for the model).
    return win.list.filter(
      (m) => !hiddenFromUser(m) && (m.role !== "system" || callEvent(m) || !!messageText(m).trim()),
    );
  }

  // The call screen (lib/call.js) is loaded only when the Calls package answers for this chat.
  async function setupCalls() {
    // The chat's call status when the Calls package is installed (404 when it is not).
    const first = await api.get(`/conversation-calls/chat/${encodeURIComponent(chatId)}/status`).then(
      (r) => r || {},
      () => null,
    );
    if (!first || !alive) return;
    const { callScreen } = await import("../lib/call.js");
    if (!alive) return;
    call = callScreen({
      chatId,
      // (read each time: the Convo reloads the chat after each reply)
      get chat() {
        return chat;
      },
      index,
      ttsConfig,
      mount,
      go,
      onEnded: async (info) => {
        if (info?.by) callNotes.set(info.callId, { status: "ended", patch: { mariEndedBy: info.by } });
        if (info?.missed) callNotes.set(info.callId, { status: "declined", patch: { mariMissed: true } });
        await load();
        await markCallNotes();
        draw();
        scroller.scrollTop = scroller.scrollHeight;
      },
    });
    phoneBtn.hidden = false;
    // Someone set offline for a call that ended while the app was closed gets their status back.
    if (!first.activeCall) call.restoreLeft();
    const ring = (st) => {
      const s = st?.activeCall || st?.ringingCall;
      if (s && alive && !call.session) call.open(s);
    };
    // A character can only ring under the package's own rules (call command on, call audio on); while it cannot,
    // or the page is in the background, there is nothing to watch for.
    const canRing = () => {
      const m = chatMeta(chat);
      return callAudio && m.characterCommands !== false && m.conversationCommandToggles?.call !== false;
    };
    const check = async () => {
      if (!alive || call.session || document.visibilityState !== "visible" || !canRing()) return;
      try {
        ring(await api.get(`/conversation-calls/chat/${encodeURIComponent(chatId)}/status`));
      } catch {}
    };
    ring(first);
    ringCheck = check;
    // A character rings from a message, which this screen sees arrive (checked right after each reply); the slow
    // fallback covers a call started elsewhere. Each check is a request with about 1.4KB of headers.
    callPoll = setInterval(check, 30000);
    document.addEventListener("visibilitychange", check);
    offVisible = () => document.removeEventListener("visibilitychange", check);
  }
  async function dial(confirm = true) {
    if (!call) return;
    if (chatMeta(chat).conversationCallsEnabled !== true || !callAudio) {
      toast(
        callAudio
          ? "이 방은 통화가 꺼져 있어요 · 통화 설정에서 켜 주세요"
          : "통화 음성이 꺼져 있어요 · 통화 설정에서 켜 주세요",
      );
      return go(`call-settings/${encodeURIComponent(chatId)}`);
    }
    // A call starts the character talking (AI and voice), so a stray tap on the phone icon asks first.
    const names = (chat.characterIds || []).map((id) => index.get(id)?.name).filter(Boolean);
    if (confirm && !(await ask(`${names.join(", ") || "캐릭터"}에게 전화를 걸까요?`, { ok: "전화 걸기" }))) return;
    try {
      call.open(await api.post("/conversation-calls/start", { chatId, mode: "audio", initiator: "user" }));
    } catch (error) {
      toast(`걸지 못했어요: ${error.message}`);
    }
  }

  function draw() {
    if (!chat) return;
    if (!stickerAttempted && messages.some((m) => /:[a-z0-9_]+:/i.test(messageText(m))))
      refreshStickers().catch(() => {}); // A failed read leaves the token visible; the picker offers retry.
    // ":name:" shortcodes that are not this chat's own emojis need the Engine's emoji list (23KB): read once, and
    // only after the chat's emojis are in, when a message still has one they do not cover.
    const own = stickers.emojis?.map;
    const standardLeft = (m) =>
      [...messageText(m).matchAll(/(^|[^a-z0-9_]):([a-z0-9_]+):/gi)].some(([, , name]) => !own?.has(name));
    if (!standardEmoji && (stickersIn || !stickerAttempted) && messages.some(standardLeft))
      import("../lib/media.js")
        .then((m) => m.emojiData())
        .then((d) => {
          standardEmoji = d.resolveStandardEmojiShortcode;
          if (alive) draw();
        })
        .catch(() => {});
    const items = [];
    if (win.more) items.push(olderButton(win, scroller, () => ((messages = shown()), draw())));
    // Like the Engine's Convo, a blank line starts a new bubble.
    const meta = chatMeta(chat);
    const bubbles = [];
    const later = new Set(
      messages
        .map((m) => callEvent(m))
        .filter((ev) => ev && ev.status !== "ringing")
        .map((ev) => ev.callId),
    );
    for (const m of messages) {
      const ev = callEvent(m);
      if (ev) {
        // 전화가 왔어요 stays only while that call has no later note (started, declined, missed).
        if (ev.status === "ringing" && later.has(ev.callId)) continue;
        bubbles.push({ m, ev, me: null, first: true, last: true });
        continue;
      }
      // System and narrator lines (dice, notices) sit in the middle like the Engine's cards.
      if (m.role === "system" || m.role === "narrator") {
        bubbles.push({ m, sys: true, text: messageText(m).trim(), me: null, first: true, last: true });
        continue;
      }
      const original = m.role === "assistant" ? stripCues(messageText(m)) : messageText(m);
      let { main, sub } = shownText(m, meta, original);
      if (!stickerTokensMatch(original, main)) {
        // A saved translation may drop media tokens. Keep the original image and show the translation below it.
        sub = main;
        main = original;
      }
      const split = (t) =>
        t
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean);
      const parts = split(main);
      // The translation goes under the bubble it belongs to: piece by piece when it has as many pieces,
      // otherwise all of it under the last bubble.
      let subs = split(sub);
      if (subs.length !== parts.length && parts.length > 1)
        subs = sub
          .split(/\n+/)
          .map((p) => p.trim())
          .filter(Boolean);
      const each = parts.length > 1 && subs.length === parts.length;
      const atts = attachmentsOf(m);
      if (!parts.length && atts.length) {
        bubbles.push({ m, text: "", media: true, me: m.role === "user", first: true, last: true, sub });
        continue;
      }
      (parts.length ? parts : [""]).forEach((text, k, all) =>
        bubbles.push({
          m,
          text,
          me: m.role === "user",
          first: k === 0,
          last: k === all.length - 1,
          sub: each ? subs[k] : k === all.length - 1 ? sub : "",
        }),
      );
    }
    const lastReplyId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
    let lastDay = "";
    bubbles.forEach((bub, i) => {
      const { m, me } = bub;
      // A line with the day whenever the day changes (오늘, 어제, 11월 12일 목요일), like the Engine.
      const day = dayKey(m.createdAt);
      if (bub.first && day && day !== lastDay) {
        lastDay = day;
        items.push(h("div", { class: "daysep", role: "separator" }, h("span", null, dayLabel(m.createdAt))));
      }
      if (bub.ev) {
        // 통화 설정 › 대화에 통화 대사 남기기 (callPrefs().log in lib/call.js)
        if (bub.ev.status === "ended" && prefs().callLog !== false) items.push(callCard(bub.ev, m));
        items.push(callLine(bub.ev, m));
        return;
      }
      const prev = bubbles[i - 1];
      const next = bubbles[i + 1];
      // A run is one speaker's bubbles in a row: in a group, another character starts a new run.
      // Like the Engine, a run also ends after 5 minutes or at a new day.
      const sameRun = (o) =>
        o &&
        !o.ev &&
        !o.sys &&
        !bub.sys &&
        o.me === me &&
        (me || o.m.characterId === m.characterId) &&
        closeInTime(o.m.createdAt, m.createdAt);
      const firstOfRun = !sameRun(prev);
      const lastOfRun = !sameRun(next);
      const radius = me
        ? `18px ${firstOfRun ? "18px" : "6px"} ${lastOfRun ? "18px" : "6px"} 18px`
        : `${firstOfRun ? "18px" : "6px"} 18px 18px ${lastOfRun ? "18px" : "6px"}`;
      const on = picked === m.id;
      const speaker = group && !me && !bub.sys ? index.get(m.characterId) : null;
      const wrap = h(
        "div",
        {
          class: [group && !me && !bub.sys ? "who" : "", hiddenFromAI(m) ? "hid" : ""].join(" ").trim() || null,
          "data-message-id": bub.first ? m.id : null,
          "data-mid": m.id, // every bubble of the message (data-message-id marks only the first, for jumps)
          style: {
            display: "flex",
            flexDirection: "column",
            alignItems: bub.sys ? "center" : me ? "flex-end" : "flex-start",
            marginTop: i === 0 ? "0" : firstOfRun ? "24px" : bub.first ? "14px" : "10px",
          },
        },
        speaker && firstOfRun ? avatar(speaker.avatar, speaker.name?.[0] || "·", 28) : null,
        speaker && firstOfRun ? h("span", { class: "who-name" }, speaker.name) : null,
        bub.first && me ? quoteOf(m) : null,
        bub.media
          ? null
          : h(
              "button",
              {
                type: "button",
                class: bub.sys ? `sysmsg${on ? " on" : ""}` : `bub ${me ? "me" : "them"}${on ? " on" : ""}`,
                style: bub.sys ? null : { borderRadius: radius },
                "aria-expanded": on ? "true" : "false",
                onClick: (e) => {
                  e.stopPropagation();
                  picked = on ? null : m.id;
                  moreOpen = false;
                  draw();
                },
              },
              bub.sys ? inline(bub.text) : stickerContent(bub.text, stickers.map, emojiView()),
            ),
        bub.sub ? h("span", { class: "bub-tr" }, stickerContent(bub.sub, stickers.map, emojiView())) : null,
        bub.last && !bub.sys ? mediaOf(m, me) : null,
        bub.last && !bub.sys ? reactionRow(m, me) : null,
        bub.last && !me && !bub.sys ? sceneCard(m) : null,
        // The time under the last bubble of a run (one speaker within 5 minutes).
        lastOfRun && bub.last && !bub.sys ? h("span", { class: "btime" }, timeLabel(m.createdAt)) : null,
      );
      // Other replies to this turn, when there are some: on the newest reply always, on others when tapped. A new
      // reply is 다시 생성 in the message tools.
      const newest = m.id === lastReplyId;
      if (bub.last && m.role === "assistant" && (m.swipeCount || 1) > 1 && (newest || on))
        wrap.append(swipeNav({ chatId, message: m, reload: () => load(), busy }));
      if (on && bub.last && !bub.sys) wrap.append(reactBar(m, me));
      if (on && bub.last) {
        const { shown, more } = toolsFor(m);
        wrap.append(
          h(
            "div",
            {
              role: "toolbar",
              "aria-label": "메시지 도구",
              style: {
                position: "relative",
                display: "flex",
                marginTop: "6px",
                marginLeft: me ? "0" : "-10px",
                marginRight: me ? "-10px" : "0",
              },
            },
            shown.map((t) => [
              h(
                "button",
                {
                  type: "button",
                  class: "ma",
                  "aria-label": toolLabel(t, m),
                  title: toolLabel(t, m),
                  onClick: (e) => {
                    e.stopPropagation();
                    tool(t.id, m);
                  },
                },
                icon(t.icon, 15, 1.6),
              ),
              t.id === "voice" ? remakeVoice(m) : null,
            ]),
            more.length
              ? h(
                  "button",
                  {
                    type: "button",
                    class: "ma",
                    "aria-label": "더보기",
                    "aria-expanded": moreOpen ? "true" : "false",
                    onClick: (e) => {
                      e.stopPropagation();
                      moreOpen = !moreOpen;
                      draw();
                    },
                  },
                  dots(15),
                )
              : null,
            moreOpen
              ? h(
                  "div",
                  { class: "tmenu", role: "menu", style: { [me ? "right" : "left"]: "0", top: "40px" } },
                  more.map((t) =>
                    h(
                      "button",
                      {
                        type: "button",
                        role: "menuitem",
                        onClick: (e) => {
                          e.stopPropagation();
                          moreOpen = false;
                          tool(t.id, m);
                        },
                      },
                      h("span", { style: { display: "flex", color: "var(--ink-2)" } }, icon(t.icon, 16, 1.6)),
                      toolLabel(t, m),
                    ),
                  ),
                )
              : null,
          ),
        );
      }
      items.push(wrap);
    });
    // Typing shows like a messenger; a busy or away character's later answer shows nothing extra (the header's
    // status already says it), and nothing offers to hurry it.
    if (busy && !live && wait?.kind === "typing") items.push(waitRow());
    else if (busy) {
      const parts = String(live || "")
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);
      (parts.length ? parts : ["…"]).forEach((text, k) =>
        items.push(
          h(
            "div",
            { style: { display: "flex", marginTop: k === 0 ? "24px" : "10px" } },
            h(
              "span",
              { class: "bub them", style: { cursor: "default" } },
              stickerContent(text, stickers.map, emojiView()),
            ),
          ),
        ),
      );
    }
    if (offNote && !busy) items.push(h("div", { class: "pnote", role: "status" }, presenceText(offNote)));
    items.push(sceneBanner(), gameStrip());
    if (!messages.length && !busy) items.push(h("div", { class: "empty" }, "첫 메시지를 보내 보세요."));
    setChildren(list, items);
    setChildren(sendBtn, icon(busy ? I.stop : I.send, busy ? 14 : 16, 2));
    sendBtn.setAttribute("aria-label", busy ? "멈춤" : "보내기");
    fitMenus(list);
  }

  // Attachments under a message: a character's selfies and videos, pictures the user sent.
  function mediaOf(m, me) {
    const atts = attachmentsOf(m);
    if (!atts.length) return null;
    return h(
      "div",
      { class: `att ${me ? "me" : "them"}` },
      atts.map((a) =>
        a.kind === "video"
          ? h("video", {
              class: "att-v",
              src: a.src,
              controls: true,
              playsinline: true,
              preload: "metadata",
              title: a.prompt,
              onLoadedmetadata: (e) => {
                const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
                if (gap <= e.currentTarget.offsetHeight + 120) scroller.scrollTop = scroller.scrollHeight;
              },
            })
          : a.kind === "image"
            ? h(
                "button",
                {
                  type: "button",
                  class: "att-i",
                  "aria-label": a.prompt ? `사진: ${a.prompt.slice(0, 60)}` : "사진 크게 보기",
                  onClick: (e) => {
                    e.stopPropagation();
                    viewImage(a, m);
                  },
                },
                h("img", {
                  src: a.thumb,
                  alt: a.prompt || "",
                  loading: "lazy",
                  decoding: "async",
                  // A picture grows the chat when it arrives: a reader who was at the bottom stays there.
                  onLoad: (e) => {
                    const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
                    if (gap <= e.currentTarget.offsetHeight + 120) scroller.scrollTop = scroller.scrollHeight;
                  },
                }),
              )
            : h("span", { class: "att-f" }, a.name),
      ),
    );
  }
  function viewImage(a, m) {
    const s = sheet(
      h(
        "div",
        { class: "att-view" },
        h("img", { src: a.src, alt: a.prompt || "" }),
        a.prompt ? h("p", { class: "hint" }, a.prompt) : null,
        h(
          "div",
          { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          h(
            "button",
            {
              type: "button",
              class: "pill",
              onClick: () => {
                s.close();
                picked = m.id;
                moreOpen = false;
                draw();
              },
            },
            "메시지 도구",
          ),
          h("button", { type: "button", class: "pill", onClick: () => s.close() }, "닫기"),
        ),
      ),
      { label: "사진" },
    );
  }
  // While a character is typing.
  function waitRow() {
    // A typing notice carries names only; find their faces by name among the room's characters.
    const cast = (chat?.characterIds || []).map((id) => index.get(id)).filter(Boolean);
    const faces = wait.characterIds?.length
      ? wait.characterIds.map((id) => index.get(id)).filter(Boolean)
      : (wait.names || []).map((n) => cast.find((c) => c.name === n)).filter(Boolean);
    const names = wait.characterIds?.length
      ? wait.characterIds.map((id) => index.get(id)?.name).filter(Boolean)
      : wait.names;
    const info = { ...wait, names: names?.length ? names : wait.names };
    return h(
      "div",
      { class: `pwait ${wait.kind}`, role: "status" },
      faces.length > 1
        ? avatarStack(faces, 24)
        : faces[0]
          ? avatar(faces[0].avatar, faces[0].name?.[0] || "·", 24)
          : null,
      h(
        "span",
        { class: "pwait-t" },
        presenceText(info),
        wait.kind === "typing" ? h("span", { class: "tdots" }, h("i"), h("i"), h("i")) : null,
      ),
    );
  }

  // ── Reactions (the Engine's MessageReaction) and replies (its replyTo) ──
  const nameOf = (id) => index.get(id)?.name || "";
  function reactionRow(m, me) {
    const list = reactionsOf(m);
    if (!list.length) return null;
    return h(
      "div",
      { class: `rxrow ${me ? "me" : "them"}` },
      list.map((r) => {
        // Tap: add or take back mine. Long-press (or right-click): who reacted, and remove any of them.
        let timer = null;
        let held = false;
        const hold = () => {
          if (held) return;
          held = true;
          clearTimeout(timer);
          reactors(m, r);
        };
        const cancel = () => clearTimeout(timer);
        return h(
          "button",
          {
            type: "button",
            class: r.by.includes(USER) ? "rx mine" : "rx",
            "aria-pressed": r.by.includes(USER) ? "true" : "false",
            "aria-label": `${r.emoji} · ${reactorNames(r, nameOf)} (길게 누르면 지우기)`,
            title: reactorNames(r, nameOf),
            onPointerdown: () => {
              held = false;
              clearTimeout(timer);
              timer = setTimeout(hold, 500);
            },
            onPointerup: cancel,
            onPointerleave: cancel,
            onPointercancel: cancel,
            onContextmenu: (e) => {
              e.preventDefault();
              e.stopPropagation();
              hold();
            },
            onClick: (e) => {
              e.stopPropagation();
              if (held) return (held = false);
              react(m, r.emoji, r.imageUrl || null);
            },
          },
          r.imageUrl ? h("img", { src: r.imageUrl, alt: r.emoji, loading: "lazy" }) : h("span", null, r.emoji),
          r.by.length > 1 ? h("small", null, String(r.by.length)) : null,
        );
      }),
    );
  }
  // Who reacted with this emoji; each one can be removed (a character's too, like the Engine's reaction details).
  function reactors(m, r) {
    const box = h("div", { class: "rxsheet" });
    const s = sheet(box, { label: `${r.emoji} 반응` });
    const paint = () => {
      const cur = reactionsOf(m).find((x) => x.emoji === r.emoji && (x.segment ?? null) === null);
      if (!cur) return s.close();
      setChildren(
        box,
        h("b", null, `${r.emoji} 반응한 사람`),
        h(
          "div",
          { class: "list" },
          cur.by.map((id) => {
            const c = id === USER ? null : index.get(id);
            const who = id === USER ? "나" : c?.name || "누군가";
            return h(
              "div",
              { class: "r static" },
              h("span", { class: "ic" }, id === USER ? null : avatar(c?.avatar, who[0] || "·", 28)),
              h("span", null, who),
              h(
                "button",
                {
                  type: "button",
                  class: "pill",
                  "aria-label": `${who}의 ${r.emoji} 반응 지우기`,
                  onClick: async () => {
                    if (id !== USER && !(await ask(`${who}의 ${r.emoji} 반응을 지울까요?`, { ok: "지우기" }))) return;
                    await saveReactions(m, removeReactor(reactionsOf(m), r.emoji, id), "반응을 지우지 못했어요");
                    if (box.isConnected) paint();
                  },
                },
                "지우기",
              ),
            );
          }),
        ),
      );
    };
    paint();
  }
  function reactBar(m, me) {
    const mine = new Set(
      reactionsOf(m)
        .filter((r) => r.by.includes(USER))
        .map((r) => r.emoji),
    );
    // My recent emojis first (shared with the Engine's picker), then the usual six; six in all.
    const recent = readRecents()
      .emoji.map((x) => x.value)
      .filter((v) => v && !v.startsWith(":"));
    const shown = [...new Set([...recent, ...QUICK])].slice(0, 6);
    return h(
      "div",
      { class: `rxbar ${me ? "me" : "them"}`, role: "group", "aria-label": "반응 달기" },
      shown.map((emoji) =>
        h(
          "button",
          {
            type: "button",
            class: mine.has(emoji) ? "on" : null,
            "aria-label": `${emoji} 반응`,
            "aria-pressed": mine.has(emoji) ? "true" : "false",
            onClick: (e) => {
              e.stopPropagation();
              react(m, emoji);
            },
          },
          emoji,
        ),
      ),
      h(
        "button",
        {
          type: "button",
          "aria-label": "다른 반응",
          onClick: (e) => {
            e.stopPropagation();
            moreReactions(m);
          },
        },
        "＋",
      ),
    );
  }
  // ＋ on the reaction bar: any emoji, like the Engine (its picker with search, recents and ★ custom emojis) — the
  // media panel with only its emoji tab, where the keyboard would be. A pick reacts and closes it.
  let reactPanel = null;
  let reactTo = null;
  async function moreReactions(m) {
    reactTo = m;
    closePanel(false);
    if (!reactPanel) {
      const { mediaPanel } = await import("../lib/media-panel.js");
      reactPanel = mediaPanel({
        tabs: ["emoji"],
        media: async ({ refresh }) => {
          if (refresh) stickerLoad = null;
          const st = await refreshStickers();
          return { stickers: st, emojis: st.emojis };
        },
        onInsert: (text) => {
          const target = reactTo;
          reactPanel.hide();
          if (!target) return;
          const custom = /^:([\w-]+):$/.exec(text);
          const c = custom ? emojiView().map.get(custom[1]) : null;
          react(target, text, c?.url || c?.imageUrl || null);
        },
        onSticker: () => {},
        manage: () => {},
      });
      setChildren(reactHost, reactPanel.el);
    }
    picked = null;
    draw();
    reactPanel.show();
  }
  const react = (m, emoji, imageUrl = null) => {
    rememberRecent("emoji", imageUrl ? { value: emoji, previewUrl: imageUrl } : { value: emoji });
    return saveReactions(m, toggleReaction(reactionsOf(m), emoji, imageUrl), "반응을 달지 못했어요");
  };
  async function saveReactions(m, next, failed) {
    const before = m.extra;
    let extra = m.extra;
    try {
      extra = typeof extra === "string" ? JSON.parse(extra) : { ...(extra || {}) };
    } catch {
      extra = {};
    }
    m.extra = { ...extra, reactions: next };
    picked = null;
    draw();
    try {
      await api.patch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(m.id)}/extra`, {
        reactions: next,
      });
    } catch (error) {
      m.extra = before;
      draw();
      toast(`${failed}: ${error.message}`);
    }
  }
  function quoteOf(m) {
    const r = replyOf(m);
    if (!r) return null;
    return h(
      "button",
      {
        type: "button",
        class: "rquote",
        "aria-label": `${r.name}에게 답장: ${r.content.slice(0, 60)}`,
        onClick: (e) => {
          e.stopPropagation();
          if (!jumpTo(list, r.messageId)) toast("원래 메시지가 지금 불러온 범위 밖에 있어요");
        },
      },
      h("span", { class: "rquote-n" }, `${r.name}에게 답장`),
      h("span", { class: "rquote-t" }, r.content),
    );
  }
  function startReply(m) {
    const name = m.role === "user" ? "나" : nameOf(m.characterId) || chatTitle(chat, index);
    const text = stripCues(withoutStickerTokens(messageText(m))).trim();
    const r = replyFor(m, name, text);
    if (!r) return toast("이 메시지에는 답장할 수 없어요");
    setReply(r);
    input.focus();
  }
  function drawPictures() {
    picBar.hidden = !pictures.length;
    const kb = Math.round(pictures.reduce((n, p) => n + p.bytes, 0) / 1024);
    setChildren(
      picBar,
      pictures.length
        ? [
            ...pictures.map((p, i) =>
              h(
                "span",
                { class: "pic" },
                h("img", { src: p.data, alt: p.name }),
                h(
                  "button",
                  {
                    type: "button",
                    "aria-label": `${p.name} 빼기`,
                    onClick: () => (pictures.splice(i, 1), drawPictures()),
                  },
                  icon(I.close, 12, 2),
                ),
              ),
            ),
            h("span", { class: "picbar-t" }, `사진 ${pictures.length}장 · ${kb}KB로 줄여서 보내요`),
          ]
        : [],
    );
  }
  function hideMentions() {
    mentionBox.hidden = true;
    setChildren(mentionBox);
  }
  async function mentionCheck() {
    const { mentionAt, mentionChoices, insertMention } = await compose();
    const caret = input.selectionStart ?? input.value.length;
    // ":smi" → the chat's custom emojis and standard shortcodes (the Engine's composer completion).
    const { shortcodeAt, shortcodeChoices, completionText, insertAt, emojiData } = await import("../lib/media.js");
    const sc = shortcodeAt(input.value, caret);
    if (sc) {
      const [data, s] = await Promise.all([emojiData(), stickerAttempted ? stickers : refreshStickers()]);
      const choices = shortcodeChoices(sc.query, s?.emojis?.list || [], data.searchStandardEmojiShortcodes);
      const still = shortcodeAt(input.value, input.selectionStart ?? input.value.length);
      if (!choices.length || !still || still.query !== sc.query) return choices.length ? null : hideMentions();
      mentionBox.hidden = false;
      mentionBox.setAttribute("aria-label", "이모지");
      return setChildren(
        mentionBox,
        choices.map((c) =>
          h(
            "button",
            {
              type: "button",
              role: "option",
              onPointerdown: (e) => e.preventDefault(), // keep the keyboard open
              onClick: () => {
                const now = input.selectionStart ?? input.value.length;
                const next = insertAt(input.value, sc.start, now, completionText(c));
                input.value = next.text;
                input.setSelectionRange(next.caret, next.caret);
                input.focus();
                grow();
                hideMentions();
              },
            },
            c.kind === "custom"
              ? h("img", { class: "cemoji", src: c.url, alt: "" })
              : h("span", { class: "mb-emoji" }, c.emoji),
            h("span", null, `:${c.name}:`),
            c.kind === "custom" ? h("span", { class: "hint" }, "내 이모지") : null,
          ),
        ),
      );
    }
    mentionBox.setAttribute("aria-label", "부를 캐릭터");
    const at = mentionAt(input.value, caret);
    const cast = (chat?.characterIds || []).map((id) => index.get(id)).filter(Boolean);
    const choices = at
      ? mentionChoices(
          cast.map((c) => c.name),
          at.query,
        )
      : [];
    if (!choices.length) return hideMentions();
    mentionBox.hidden = false;
    setChildren(
      mentionBox,
      choices.map((name) => {
        const c = cast.find((x) => x.name === name);
        const p = presenceOf(chatMeta(chat), c.id, new Date(), fresh?.[c.id] || null);
        return h(
          "button",
          {
            type: "button",
            role: "option",
            onPointerdown: (e) => e.preventDefault(), // keep the keyboard open
            onClick: () => {
              const caret = input.selectionStart ?? input.value.length;
              const next = insertMention(input.value, caret, at.start, name);
              input.value = next.text;
              input.setSelectionRange(next.caret, next.caret);
              input.focus();
              grow();
              hideMentions();
            },
          },
          avatar(c.avatar, name[0] || "·", 28),
          h("span", null, name),
          p && p.status !== "online"
            ? h("span", { class: "hint" }, `${STATUS_KO[p.status]} · 부르면 더 빨리 답해요`)
            : null,
        );
      }),
    );
  }
  function setReply(r) {
    replyDraft = r;
    replyBar.hidden = !r;
    setChildren(
      replyBar,
      r
        ? [
            h("span", { class: "rbar-t" }, h("b", null, `${r.name}에게 답장`), h("span", null, r.content)),
            h(
              "button",
              { type: "button", class: "ib", "aria-label": "답장 취소", onClick: () => setReply(null) },
              icon(I.close, 18),
            ),
          ]
        : [],
    );
  }

  function drawQuick() {
    toolsBtn.setAttribute("aria-expanded", toolsMenuOpen ? "true" : "false");
    if (toolsMenuOpen) return drawTools();
    setChildren(
      quickLayer,
      qrOpen
        ? [
            h("button", {
              type: "button",
              class: "scrim",
              style: { background: "transparent" },
              "aria-label": "닫기",
              onClick: () => {
                qrOpen = false;
                drawQuick();
              },
            }),
            h(
              "div",
              { class: "qr", role: "menu", "aria-label": "빠른 답장", style: { zIndex: "22" } },
              quick.map((q) =>
                h(
                  "button",
                  {
                    type: "button",
                    role: "menuitem",
                    disabled: busy,
                    onClick: () => {
                      qrOpen = false;
                      drawQuick();
                      runQuick(q);
                    },
                  },
                  h(
                    "span",
                    {
                      style: {
                        display: "flex",
                        justifyContent: "center",
                        fontSize: "16px",
                        lineHeight: "1",
                        color: "var(--ink-2)",
                      },
                    },
                    q.icon ? icon(q.icon, 17, 1.6) : q.emoji,
                  ),
                  h("span", null, q.label),
                ),
              ),
            ),
          ]
        : [],
    );
  }

  // The ＋ menu: the quick-reply menu's look (same panel, same rows), opened above ＋ on the left.
  function drawTools() {
    const close = () => {
      toolsMenuOpen = false;
      drawQuick();
    };
    setChildren(
      quickLayer,
      h("button", {
        type: "button",
        class: "scrim",
        style: { background: "transparent" },
        "aria-label": "닫기",
        onClick: close,
      }),
      h(
        "div",
        { class: "qr qr-left", role: "menu", "aria-label": "도구", style: { zIndex: "22" } },
        toolItems().map(([btn, path, label]) =>
          h(
            "button",
            {
              type: "button",
              role: "menuitem",
              disabled: btn.disabled,
              onClick: () => {
                toolsMenuOpen = false;
                // 빠른 답장 opens its own menu in the same place; the others close this one and act.
                if (btn === qrBtn) {
                  qrOpen = true;
                  return drawQuick();
                }
                drawQuick();
                btn.click();
              },
            },
            h(
              "span",
              { style: { display: "flex", justifyContent: "center", color: "var(--ink-2)" } },
              path ? icon(path, 17, 1.6) : dots(17),
            ),
            h("span", null, label),
          ),
        ),
      ),
    );
  }

  /** One message as a speak request: tag-capable voices read the cues inline, others get the first as a tone. */
  function messageRequest(m) {
    const raw = messageText(m);
    const speech = withoutStickerTokens(raw);
    const voice = pickVoice(ttsConfig, m.characterId);
    const speaker = index.get(m.characterId)?.name;
    const tags = voiceSet?.cueResolved === "tags";
    const lead = /^\s*\[([^\]\n]{1,80})\]\s*/.exec(speech);
    const text = tags ? speech : stripCues(speech);
    return {
      key: tts.hashKey([m.id, m.activeSwipeIndex ?? 0, raw, voice, ttsConfig?.source, ttsConfig?.model]),
      body: {
        text,
        ...(speaker ? { speaker } : {}),
        ...(voice ? { voice } : {}),
        ...(!tags && lead ? { tone: lead[1].trim() } : {}),
      },
    };
  }

  // fresh: 다시 만들기 — the kept clip is dropped and made again (like RP's line popup).
  async function speakMessage(m, fresh = false) {
    const req = messageRequest(m);
    if (!stripCues(req.body.text).trim()) return;
    if (tts.activeLine() === req.key && !fresh) return tts.stop();
    if (fresh) {
      tts.stop();
      await tts.forget(req.key);
    }
    await tts.speak(req.key, req.body);
    voiceMade.add(req.key);
    if (alive) draw();
  }

  // 음성 다시 만들기, beside 음성 once this message has a clip (checked when its tools open; like RP's line popup).
  const voiceMade = new Set();
  const voiceChecked = new Set();
  function remakeVoice(m) {
    const { key } = messageRequest(m);
    if (!voiceChecked.has(key)) {
      voiceChecked.add(key);
      tts.isCached(key).then((yes) => yes && alive && (voiceMade.add(key), draw()));
    }
    if (!voiceMade.has(key) || tts.activeLine() === key) return null;
    return h(
      "button",
      {
        type: "button",
        class: "ma",
        "aria-label": "음성 다시 만들기",
        title: "음성 다시 만들기",
        onClick: (e) => {
          e.stopPropagation();
          picked = null;
          speakMessage(m, true).catch((error) => toast(`음성을 만들지 못했어요: ${error.message}`));
        },
      },
      icon(["M20 12a8 8 0 1 1-2.3-5.7", "M20 4v5h-5"], 15, 1.6),
    );
  }

  // Other replies to the same turn (the Engine's swipes): shown under a tapped message that has them.

  function tool(id, m) {
    picked = null;
    draw();
    if (id === "reply") return startReply(m);
    return runTool(id, { chatId, chat, message: m, reload: load, generate, go, speak: speakMessage });
  }

  /** Runs one generation; resolves true when a message was saved (autonomy needs to know). */
  async function generate(body) {
    if (busy) return false;
    let produced = false;
    busy = true;
    live = "";
    wait = null;
    offNote = null;
    draw();
    scroller.scrollTop = scroller.scrollHeight;
    abort = new AbortController();
    const done = body?.autonomous
      ? () => {}
      : startJob("답장 쓰는 중…", { label: "멈추기", fn: () => stopGenerating() }, { chat: chatId });
    try {
      await streamGenerate({
        chatId,
        body: { ...presence(), ...body },
        signal: abort.signal,
        onToken: (text) => {
          if (!alive) return;
          wait = null;
          // Follow the new text only for a reader at the bottom (someone reading older messages stays put).
          const follow = scroll.nearBottom();
          live = text;
          draw();
          if (follow) scroller.scrollTop = scroller.scrollHeight;
        },
        onPresence: (info) => {
          if (!alive || body?.autonomous) return;
          if (info.kind === "offline") offNote = info;
          else wait = info;
          draw();
        },
        onSaved: (saved) => {
          if (saved) produced = true;
          if (!alive || !saved) return;
          messages.push(saved);
          live = "";
          draw();
        },
      });
    } catch (error) {
      // A character's own (autonomous) message failing is not the user's error to see.
      if (error.name !== "AbortError" && !body?.autonomous) toast(`생성하지 못했어요: ${error.message}`);
    } finally {
      done();
      busy = false;
      live = null;
      wait = null;
      abort = null;
      if (alive) {
        const before = new Set(messages.map((m) => m.id));
        const follow = scroll.nearBottom();
        await load(false, true);
        loadPresence();
        ringCheck?.();
        if (follow) scroller.scrollTop = scroller.scrollHeight;
        // 자동 재생: the character messages this turn added, in order.
        if (ttsConfig && voiceSet?.convo && voiceSet.autoplay !== "off")
          tts.speakSequence(
            messages
              .filter((m) => m.role === "assistant" && !before.has(m.id))
              .map(messageRequest)
              .filter((request) => stripCues(request.body.text).trim()),
          );
        await recovery.check();
      }
    }
    return produced;
  }

  async function stopGenerating() {
    try {
      await stopGeneration(chatId);
      abort?.abort();
      await recovery.check();
    } catch (error) {
      toast(`중단하지 못했어요: ${error.message}`);
    }
  }

  async function send() {
    let text = input.value.trim();
    if (busy) return;
    const sending = pictures;
    // Nothing typed and no picture: like the Engine, the character goes on (a reply without a new message of mine).
    if (!text && !sending.length) return generate({});
    input.value = "";
    grow();
    hideMentions();
    if (text.startsWith("/") && !sending.length) return slash(text);
    pictures = [];
    drawPictures();
    // The Engine's 내 메시지 번역: the message goes out translated; if that fails, it goes out as written.
    if (chatMeta(chat).translateInput === true)
      text = await translateStickerInput(text, chatMeta(chat), chatId).catch((error) => {
        toast(
          error.code === "STICKER_TRANSLATION_CHANGED"
            ? stickerLabel("translationChanged")
            : "번역하지 못해서 원문으로 보냈어요",
        );
        return text;
      });
    auto?.userSent();
    const replyTo = replyDraft;
    setReply(null);
    const names = (chat?.characterIds || []).map((id) => index.get(id)?.name).filter(Boolean);
    const mentioned = text.includes("@") ? (await compose()).mentionedNames(text, names) : [];
    generate({
      userMessage: text || null,
      ...(replyTo ? { replyTo } : {}),
      ...(sending.length
        ? { attachments: sending.map(({ type, data, filename, name }) => ({ type, data, filename, name })) }
        : {}),
      ...(mentioned.length ? { mentionedCharacterNames: mentioned } : {}),
    });
  }

  async function slash(text) {
    // /scene (or /rp) [what kind of scene]: the Engine's scene start from this Convo; empty asks the planner to
    // build it from the conversation.
    if (/^\/games?\s*$/i.test(text.trim())) return gamesSheet();
    if (/^\/\S+/.test(text.trim())) {
      const { turnGames, gameForCommand } = await import("../lib/games.js");
      const g = gameForCommand(text, await turnGames());
      if (g) return openGame(g);
    }
    const sc = /^\/(scene|rp)(?:\s+([\s\S]*))?$/i.exec(text.trim());
    if (sc) {
      if (!sc[2]?.trim() && !messages.length)
        return toast("장면의 바탕이 될 대화가 없어요. /scene 뒤에 어떤 장면인지 적어 주세요");
      return beginScene({ prompt: sc[2]?.trim() || "", initiatorCharId: null, connectionId: null });
    }
    try {
      const note = await runSlash(text, {
        chatId,
        chat,
        messages,
        characters: (chat?.characterIds || [])
          .map((id) => ({ id, name: index.get(id)?.name || "" }))
          .filter((c) => c.name),
        generate,
        reload: load,
      });
      slashNote(note, chatId);
    } catch (error) {
      toast(error.message);
    }
  }

  function runQuick(q) {
    if (q.id === "guide") {
      const text = input.value.trim();
      if (!text) return toast("방향을 먼저 적어 주세요");
      input.value = "";
      grow();
      return generate({
        userMessage: null,
        smartResponse: true,
        generationGuide: GUIDE(text),
        generationGuideSource: "guide",
      });
    }
    if (composerTool(q, { chatId, input, grow, slash })) return;
    if (q.content.startsWith("/")) return slash(q.content);
    generate({ userMessage: q.content });
  }

  list.addEventListener("click", () => {
    if (picked) {
      picked = null;
      moreOpen = false;
      draw();
    }
  });
  const off = tts.onTts(() => {});
  let recoveredJob = null;
  const recovery = watchGeneration(chatId, {
    isAttached: () => !!abort,
    onState: (state) => {
      busy = state?.active === true;
      if (busy && !recoveredJob)
        recoveredJob = startJob("이 채팅에서 생성 중…", { label: "멈추기", fn: stopGenerating }, { chat: chatId });
      if (!busy) {
        recoveredJob?.();
        recoveredJob = null;
      }
      draw();
    },
    onSettled: () => load(false, true),
  });
  load(true);
  return {
    dispose: () => {
      strip.dispose();
      scroll.dispose();
      alive = false;
      stickerDialog?.close();
      recovery.dispose();
      recoveredJob?.();
      off();
      tts.stop();
      abort?.abort();
      clearInterval(callPoll);
      clearInterval(tick);
      auto?.stop();
      offVisible();
      call?.dispose();
    },
    onPrefs: draw,
  };
}
