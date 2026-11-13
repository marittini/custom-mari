// Convo screen, messenger style: bubbles grouped by sender, a tap on a bubble shows its message tools
// (show / more / hidden, same choice as RP), and the composer offers the same quick-reply menu.
// Convo rooms keep the Engine's own memory system; Mari Kit's memory button is RP only.

import { quickButton } from "../lib/quick.js";
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
import { TOOL_DEFS, toolPlace } from "../lib/prefs.js";
import { toast, errorBox, avatar, avatarStack, olderButton, fitMenus, jumpTo } from "../lib/ui.js";
import { pickVoice, stripCues, inline } from "../lib/render.js";
import * as tts from "../lib/tts.js";
import { syncVoiceSettings } from "../lib/voice.js";
import { callsAvailable, callScreen, callPrefs } from "../lib/call.js";
import { shownText, translate } from "../lib/translate.js";
import { activeAutonomy, clearUnread } from "../lib/autonomy.js";
import { runSlash } from "../lib/slash.js";
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
  let me = null; // the persona's schedule state (Mari Kit 내 일정), when there is one
  let phoneBtn = null;
  let call = null; // the call screen, when the Calls package is installed
  let callPoll = null;
  let ringCheck = null; // looks for a ringing call (calls start from a character's message)
  let auto = null; // Convo autonomy while this chat is open
  let offVisible = () => {};

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
    onInput: grow,
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
          input.value = await translate(text, "input", chatMeta(chat), chatId);
          grow();
        } catch (error) {
          toast(`번역하지 못했어요: ${error.message}`);
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
  const quickLayer = h("div");
  const strip = activityStrip();
  mount.append(
    head,
    scroller,
    quickLayer,
    strip.el,
    h(
      "div",
      { class: "cmp", style: { background: "var(--paper)" } },
      quickButton({
        getChat: () => chat,
        go,
        changed: async () => {
          await load(false);
          await loadMe();
        },
      }),
      input,
      trBtn,
      qrBtn,
      sendBtn,
    ),
  );

  function grow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }

  async function load(first, tail = false) {
    try {
      const [c, chars] = await Promise.all([data.chat(chatId), data.characters(), win.reload(tail)]);
      if (!alive) return;
      chat = c;
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

  // "나 · 퇴근길 · 오후 7:00까지" under the name; tapping it opens 내 일정.
  const SCHED_LABEL = { online: "온라인", idle: "자리 비움", dnd: "방해 금지", offline: "오프라인" };
  async function loadMe() {
    try {
      me = await api.get(`/mari-kit/schedule/chat/${encodeURIComponent(chatId)}`);
    } catch {
      me = null;
    }
    if (!alive || !me) return;
    who.querySelector(".me-line")?.remove();
    const n = me.now;
    const line = h(
      "button",
      {
        type: "button",
        class: "me-line",
        onClick: (e) => {
          e.stopPropagation();
          go(`schedule/${encodeURIComponent(me.key)}/now/${encodeURIComponent(chatId)}`);
        },
      },
      n ? h("span", { class: `sdot ${n.status}` }) : null,
      n ? `나 · ${n.activity}` : "내 일정 만들기",
    );
    who.append(line);
  }
  /** The Engine's own presence fields, so its autonomy sees the user's planned status too. */
  function presence() {
    const n = me?.profile?.config?.enabled ? me.now : null;
    if (!n) return {};
    return {
      userStatus: n.status === "online" ? "active" : n.status === "dnd" ? "dnd" : "idle",
      userActivity: `${SCHED_LABEL[n.status]}; 설정상 현재 일정: ${n.activity}`.slice(0, 120),
    };
  }

  function toolsFor(m) {
    const usable = TOOL_DEFS.filter(
      (t) => !(t.assistantOnly && m.role !== "assistant") && !(t.id === "voice" && !ttsConfig),
    );
    return {
      shown: usable.filter((t) => toolPlace(t) === "show"),
      more: usable.filter((t) => toolPlace(t) === "more"),
    };
  }

  // An ended call stays in the conversation as one line (통화 설정 › 대화에 통화 대사 남기기).
  function callEvent(m) {
    if (m.role !== "system") return null;
    let extra = m.extra;
    try {
      if (typeof extra === "string") extra = JSON.parse(extra);
    } catch {}
    const ev = extra?.conversationCallEvent;
    return ev?.callId && ev.status === "ended" ? ev : null;
  }
  function shown() {
    const keepCalls = callPrefs().log;
    // System lines (dice, notices, other call states) show like the Engine's; an ended call only when kept.
    return win.list.filter((m) => m.role !== "system" || (callEvent(m) ? keepCalls : !!messageText(m).trim()));
  }

  async function setupCalls() {
    const first = await callsAvailable(chatId);
    if (!first || !alive) return;
    call = callScreen({
      chatId,
      chat,
      index,
      ttsConfig,
      mount,
      go,
      onEnded: async () => {
        await load();
        scroller.scrollTop = scroller.scrollHeight;
      },
    });
    phoneBtn.hidden = false;
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
  async function dial() {
    if (!call) return;
    if (chatMeta(chat).conversationCallsEnabled !== true || !callAudio) {
      toast(
        callAudio
          ? "이 방은 통화가 꺼져 있어요 · 통화 설정에서 켜 주세요"
          : "통화 음성이 꺼져 있어요 · 통화 설정에서 켜 주세요",
      );
      return go(`call-settings/${encodeURIComponent(chatId)}`);
    }
    try {
      call.open(await api.post("/conversation-calls/start", { chatId, mode: "audio", initiator: "user" }));
    } catch (error) {
      toast(`걸지 못했어요: ${error.message}`);
    }
  }

  function draw() {
    if (!chat) return;
    const items = [];
    if (win.more) items.push(olderButton(win, scroller, () => ((messages = shown()), draw())));
    const first = messages[0];
    if (first)
      items.push(
        h(
          "span",
          { style: { alignSelf: "center", padding: "0 0 20px", fontSize: "11px", color: "var(--ink-3)" } },
          shortTime(first.createdAt),
        ),
      );
    // Like the Engine's Convo, a blank line starts a new bubble.
    const meta = chatMeta(chat);
    const bubbles = [];
    for (const m of messages) {
      const ev = callEvent(m);
      if (ev) {
        bubbles.push({ m, ev, me: null, first: true, last: true });
        continue;
      }
      // System and narrator lines (dice, notices) sit in the middle like the Engine's cards.
      if (m.role === "system" || m.role === "narrator") {
        bubbles.push({ m, sys: true, text: messageText(m).trim(), me: null, first: true, last: true });
        continue;
      }
      const original = m.role === "assistant" ? stripCues(messageText(m)) : messageText(m);
      const { main, sub } = shownText(m, meta, original);
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
    const lastMine = messages.map((m) => m.role === "user").lastIndexOf(true);
    bubbles.forEach((bub, i) => {
      const { m, me } = bub;
      if (bub.ev) {
        items.push(
          h(
            "button",
            { type: "button", class: "callev", onClick: () => call?.logSheet(bub.ev.callId) },
            icon(I.phone, 13, 1.8),
            `음성 통화 · ${shortTime(m.createdAt)}`,
            h("span", null, "대사 보기 ›"),
          ),
        );
        return;
      }
      const prev = bubbles[i - 1];
      const next = bubbles[i + 1];
      // A run is one speaker's bubbles in a row: in a group, another character starts a new run.
      const sameRun = (o) =>
        o && !o.ev && !o.sys && !bub.sys && o.me === me && (me || o.m.characterId === m.characterId);
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
          style: {
            display: "flex",
            flexDirection: "column",
            alignItems: bub.sys ? "center" : me ? "flex-end" : "flex-start",
            marginTop: i === 0 ? "0" : firstOfRun ? "24px" : bub.first ? "14px" : "10px",
          },
        },
        speaker && firstOfRun ? avatar(speaker.avatar, speaker.name?.[0] || "·", 28) : null,
        speaker && firstOfRun ? h("span", { class: "who-name" }, speaker.name) : null,
        h(
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
          bub.sys ? inline(bub.text) : bub.text,
        ),
        bub.sub ? h("span", { class: "bub-tr" }, bub.sub) : null,
      );
      if (on && bub.last && (m.swipeCount || 1) > 1) wrap.append(swipeNav(m));
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
            shown.map((t) =>
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
            ),
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
      if (bub.last && messages.indexOf(m) === lastMine && !busy)
        wrap.append(
          h(
            "span",
            { style: { marginTop: "6px", paddingRight: "4px", fontSize: "11px", color: "var(--ink-3)" } },
            "읽음",
          ),
        );
      items.push(wrap);
    });
    if (busy) {
      const parts = String(live || "")
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);
      (parts.length ? parts : ["…"]).forEach((text, k) =>
        items.push(
          h(
            "div",
            { style: { display: "flex", marginTop: k === 0 ? "24px" : "10px" } },
            h("span", { class: "bub them", style: { cursor: "default" } }, text),
          ),
        ),
      );
    }
    if (!messages.length && !busy) items.push(h("div", { class: "empty" }, "첫 메시지를 보내 보세요."));
    setChildren(list, items);
    setChildren(sendBtn, icon(busy ? I.stop : I.send, busy ? 14 : 16, 2));
    sendBtn.setAttribute("aria-label", busy ? "멈춤" : "보내기");
    fitMenus(list);
  }

  function drawQuick() {
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

  /** One message as a speak request: tag-capable voices read the cues inline, others get the first as a tone. */
  function messageRequest(m) {
    const raw = messageText(m);
    const voice = pickVoice(ttsConfig, m.characterId);
    const speaker = index.get(m.characterId)?.name;
    const tags = voiceSet?.cueResolved === "tags";
    const lead = /^\s*\[([^\]\n]{1,80})\]\s*/.exec(raw);
    const text = tags ? raw : stripCues(raw);
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

  async function speakMessage(m) {
    const req = messageRequest(m);
    if (tts.activeLine() === req.key) return tts.stop();
    await tts.speak(req.key, req.body);
  }

  // Other replies to the same turn (the Engine's swipes): shown under a tapped message that has them.
  function swipeNav(m) {
    const i = m.activeSwipeIndex ?? 0;
    const n = m.swipeCount || 1;
    const set = async (to) => {
      try {
        await api.put(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(m.id)}/active-swipe`, {
          index: to,
        });
        await load();
      } catch (error) {
        toast(error.message);
      }
    };
    const stop = (fn) => (e) => (e.stopPropagation(), fn());
    return h(
      "div",
      { class: "hint", style: { display: "flex", alignItems: "center", gap: "4px", marginTop: "6px" } },
      h(
        "button",
        { type: "button", class: "ma", "aria-label": "이전 답", disabled: i <= 0, onClick: stop(() => set(i - 1)) },
        icon(I.back, 14),
      ),
      h("span", { style: { fontVariantNumeric: "tabular-nums" } }, `${i + 1} / ${n}`),
      h(
        "button",
        { type: "button", class: "ma", "aria-label": "다음 답", disabled: i >= n - 1, onClick: stop(() => set(i + 1)) },
        icon("M9 5l7 7-7 7", 14),
      ),
    );
  }

  function tool(id, m) {
    picked = null;
    draw();
    return runTool(id, { chatId, chat, message: m, reload: load, generate, go, speak: speakMessage });
  }

  /** Runs one generation; resolves true when a message was saved (autonomy needs to know). */
  async function generate(body) {
    if (busy) return false;
    let produced = false;
    busy = true;
    live = "";
    draw();
    scroller.scrollTop = scroller.scrollHeight;
    abort = new AbortController();
    const done = body?.autonomous
      ? () => {}
      : startJob("답장 쓰는 중…", { label: "멈추기", fn: () => stopGenerating() });
    try {
      await streamGenerate({
        chatId,
        body: { ...presence(), ...body },
        signal: abort.signal,
        onToken: (text) => {
          if (!alive) return;
          live = text;
          draw();
          scroller.scrollTop = scroller.scrollHeight;
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
      abort = null;
      if (alive) {
        const before = new Set(messages.map((m) => m.id));
        await load(false, true);
        ringCheck?.();
        scroller.scrollTop = scroller.scrollHeight;
        // 자동 재생: the character messages this turn added, in order.
        if (ttsConfig && voiceSet?.convo && voiceSet.autoplay !== "off")
          tts.speakSequence(messages.filter((m) => m.role === "assistant" && !before.has(m.id)).map(messageRequest));
      }
    }
    return produced;
  }

  async function stopGenerating() {
    try {
      await api.post("/generate/abort", { chatId });
    } catch {}
    abort?.abort();
  }

  async function send() {
    let text = input.value.trim();
    if (busy) return;
    // Nothing typed: like the Engine, the character goes on (a reply without a new message of mine).
    if (!text) return generate({});
    input.value = "";
    grow();
    if (text.startsWith("/")) return slash(text);
    // The Engine's 내 메시지 번역: the message goes out translated; if that fails, it goes out as written.
    if (chatMeta(chat).translateInput === true)
      text = await translate(text, "input", chatMeta(chat), chatId).catch(() => {
        toast("번역하지 못해서 원문으로 보냈어요");
        return text;
      });
    auto?.userSent();
    generate({ userMessage: text });
  }

  async function slash(text) {
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
  load(true);
  return {
    dispose: () => {
      strip.dispose();
      alive = false;
      off();
      tts.stop();
      abort?.abort();
      clearInterval(callPoll);
      auto?.stop();
      offVisible();
      call?.dispose();
    },
    onPrefs: draw,
  };
}
