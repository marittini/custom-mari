// RP reading screen: the story as a page, a tap on a spoken line opens its voice popover (ME-personal style),
// message tools follow the viewer's show / more / hidden choice, and the composer offers the quick-reply menu
// (guide reply + the Engine's own custom quick replies).

import { quickButton } from "../lib/quick.js";
import { swipeNav } from "../lib/swipes.js";
import { chatScrolling } from "../lib/scrolling.js";
import { activityStrip, startJob } from "../lib/activity.js";
import { h, icon, dots, I, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data, characterIndex, chatTitle, chatMeta, messageText, messageWindow, charLabel } from "../lib/data.js";
import { TOOL_DEFS, toolPlace, prefs } from "../lib/prefs.js";
import { olderButton, topBar, toast, errorBox, fitMenus, jumpTo } from "../lib/ui.js";
import { parseMessage, inline, buildPronunciations, applyPronunciations, pickVoice } from "../lib/render.js";
import * as tts from "../lib/tts.js";
import { syncVoiceSettings } from "../lib/voice.js";
import { runSlash } from "../lib/slash.js";
import {
  GUIDE,
  quickReplies,
  runTool as sharedTool,
  streamGenerate,
  composerTool,
  slashNote,
  hiddenFromAI,
  toolLabel,
} from "../lib/actions.js";
import { savedTranslation, shownText, translate } from "../lib/translate.js";

export function rpScreen({ mount, args, go, back }) {
  const chatId = args[0];
  let alive = true;
  let chat = null;
  let index = new Map();
  let messages = [];
  const win = messageWindow(chatId);
  let total = null; // characters in the whole chat, for the header
  let participants = [];
  let ttsConfig = null;
  let voiceSet = null; // Mari Kit voice settings (cue form, autoplay)
  let memory = null; // { waiting, busy } when Mari Kit memory is on for this chat
  let busy = false;
  let live = null; // streaming assistant text
  let picked = null; // `${messageId}:${lineIndex}`
  let cachedLines = new Set();
  let moreFor = null;
  let qrOpen = false;
  let quick = [];
  let abort = null;

  const title = h("span", { class: "h" });
  const sub = h("span", { class: "sub" });
  const memBtn = h("button", { type: "button", class: "ib", hidden: true, onClick: organize });
  const head = h(
    "header",
    { class: "top" },
    h(
      "button",
      {
        type: "button",
        class: "ib",
        "aria-label": "뒤로",
        onClick: () => back("library"),
      },
      icon(I.back),
    ),
    h("div", { class: "ttl" }, title, sub),
    memBtn,
    h("button", { type: "button", class: "ib", "aria-label": "채팅 설정", onClick: openSettings }, icon(I.sliders, 19)),
  );
  const page = h("main", { class: "rp" });
  const scroller = h("div", { class: "scroll rpf" }, page);
  const input = h("textarea", {
    class: "cin",
    rows: 1,
    placeholder: "이어서 쓰기…",
    "aria-label": "이어서 쓰기",
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
  const quickBtn = quickButton({
    getChat: () => chat,
    getMemory: () => memory,
    organize: () => organize(),
    go,
    changed: async () => {
      await load(false);
      await loadExtras();
    },
  });
  const composer = h("div", { class: "cmp" }, quickBtn, input, trBtn, qrBtn, sendBtn);
  // 지금 하는 일 (reply being written, translating, voice) with a stop button, right above the composer.
  const strip = activityStrip();
  const scroll = chatScrolling(scroller);
  mount.append(head, scroller, scroll.anchor, quickLayer, strip.el, composer);

  function grow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }

  // ── data ───────────────────────────────
  async function load(first, tail = false) {
    try {
      const [c, chars, , count] = await Promise.all([
        data.chat(chatId),
        data.characters(),
        win.reload(tail),
        // Read fresh each time: the screen's length counts what was just written.
        api
          .get(`/mari-kit/shell/previews?ids=${encodeURIComponent(chatId)}&fresh=${encodeURIComponent(chatId)}`)
          .catch(() => null),
      ]);
      if (!alive) return;
      chat = c;
      trBtn.hidden = chatMeta(chat).showInputTranslateButton !== true;
      index = characterIndex(chars);
      messages = win.list;
      total = Number.isFinite(count?.[chatId]?.chars) ? count[chatId].chars : null;
      title.textContent = chatTitle(chat, index);
      sub.textContent = [
        (chat.characterIds || [])
          .map((id) => index.get(id)?.name)
          .filter(Boolean)
          .join(", "),
        total === null ? "" : charLabel(total),
      ]
        .filter(Boolean)
        .join(" · ");
      if (first) await loadExtras();
      // Opened from a search hit (#/rp/<chat>/<message>): read back to it.
      if (first && args[1] && (await win.until(args[1]))) messages = win.list;
      draw();
      if (first) requestAnimationFrame(() => jumpTo(page, args[1]) || (scroller.scrollTop = scroller.scrollHeight));
    } catch (error) {
      if (alive) setChildren(page, errorBox(error));
    }
  }

  async function loadExtras() {
    const meta = chatMeta(chat);
    const [settings, ui, config] = await Promise.all([
      api.get("/mari-kit/settings").catch(() => null),
      data.engineUi(),
      api.get("/tts/config").catch(() => null),
    ]);
    ttsConfig = config?.enabled ? config : null;
    voiceSet = ttsConfig ? await syncVoiceSettings(config) : null;
    const usesKit = meta.enableAgents === true && (meta.activeAgentIds || []).includes("mari-kit");
    if (ttsConfig && settings?.features?.tts && usesKit) {
      participants =
        (await api.get(`/mari-kit/tts/participants/${encodeURIComponent(chatId)}`).catch(() => null))?.participants ||
        [];
    }
    quick = quickReplies(ui, I.guide, "roleplay");
    qrBtn.hidden = quick.length === 0;
    if (settings?.features?.memory && usesKit) {
      memory = { waiting: 0, busy: false };
      refreshMemory();
    }
  }

  async function refreshMemory() {
    if (!memory) return;
    try {
      const res = await api.get(`/mari-kit/memory/${encodeURIComponent(chatId)}`);
      memory.waiting = res?.status?.waitingMessages ?? 0;
    } catch {}
    drawMemory();
  }

  function drawMemory() {
    memBtn.hidden = !memory;
    if (!memory) return;
    memBtn.setAttribute("aria-label", memory.busy ? "기억 정리 중" : `기억 정리 · 메시지 ${memory.waiting}개 대기`);
    setChildren(
      memBtn,
      icon(I.memory, 19),
      memory.busy
        ? h("span", { class: "spin" })
        : memory.waiting
          ? h("span", { class: "badge" }, String(memory.waiting))
          : null,
    );
  }

  async function organize() {
    if (!memory || memory.busy) return;
    if (!memory.waiting) return go(`memory/${encodeURIComponent(chatId)}`); // nothing waiting: open the memory library
    memory.busy = true;
    drawMemory();
    let calls = 0;
    const done = startJob("기억 정리 중…");
    try {
      for (let i = 0; i < 20; i += 1) {
        const res = await api.post(`/mari-kit/memory/${encodeURIComponent(chatId)}/organize`, { force: true });
        calls += res?.calls || 0;
        memory.waiting = res?.status?.waitingMessages ?? 0;
        if (!res?.organized || !res?.status?.readyChunk) break;
      }
      toast(calls ? `기억을 정리했어요 (모델 호출 ${calls}번)` : "정리할 내용이 없었어요");
    } catch (error) {
      toast(`정리하지 못했어요: ${error.message}`);
    } finally {
      done();
      memory.busy = false;
      drawMemory();
    }
  }

  // ── drawing ────────────────────────────
  function lineKey(m, i) {
    return `${m.id}:${m.activeSwipeIndex ?? 0}:${i}`;
  }

  function speakRequest(line) {
    const speakerId = line.speakerId;
    const voice = pickVoice(ttsConfig, speakerId);
    const spoken = applyPronunciations(line.spoken, buildPronunciations(participants));
    const speaker = participants.find((p) => p.id === speakerId)?.name || index.get(speakerId)?.name;
    // Tag-capable voices read the cue inline; others get it as a tone.
    const inlineCue = voiceSet?.cueResolved === "tags" && line.cue;
    return {
      key: tts.hashKey([spoken, line.cue, voice, ttsConfig?.source, ttsConfig?.model]),
      body: {
        text: inlineCue ? `[${line.cue}] ${spoken}` : spoken,
        ...(speaker ? { speaker } : {}),
        ...(line.cue && !inlineCue ? { tone: line.cue } : {}),
        ...(voice ? { voice } : {}),
      },
    };
  }

  function lineButton(line) {
    const req = speakRequest(line);
    const state = tts.ttsState();
    const mine = state.key === req.key;
    return h(
      "button",
      {
        type: "button",
        class: mine ? "lb on" : "lb",
        "aria-label": mine ? "멈춤" : "대사 듣기",
        onClick: async (e) => {
          e.stopPropagation();
          if (mine) return tts.stop();
          try {
            await tts.speak(req.key, req.body, req.body.speaker);
            cachedLines.add(req.key);
          } catch (error) {
            toast(`재생하지 못했어요: ${error.message}`);
          }
        },
      },
      mine && state.phase === "loading" ? h("span", { class: "act-dot" }) : icon(mine ? I.stop : I.play, 11, 2),
    );
  }

  // TTS is off in the Engine: say so where the user tapped, with the way to turn it on.
  function voiceOffPopover() {
    return h(
      "span",
      { class: "host" },
      h(
        "span",
        { class: "pop", role: "group", style: { padding: "6px 10px", fontSize: "13px", gap: "8px" } },
        "엔진 음성(TTS)이 꺼져 있어요",
        h(
          "button",
          { type: "button", class: "pill", style: { minHeight: "32px" }, onClick: () => go("voice") },
          "켜기 ›",
        ),
      ),
    );
  }

  // Tapping a spoken line opens this small popup under it: 듣기 / 멈춤, and 다시 만들기 once a clip exists.
  function linePopover(m, line) {
    const req = speakRequest(line);
    const state = tts.ttsState();
    const mine = state.key === req.key;
    const has = cachedLines.has(req.key);
    const play = async (fresh) => {
      if (mine && !fresh) return tts.stop();
      if (!line.spoken) return toast("읽을 대사가 없어요");
      try {
        if (fresh) await tts.forget(req.key);
        await tts.speak(req.key, req.body, req.body.speaker);
        cachedLines.add(req.key);
      } catch (error) {
        toast(`재생하지 못했어요: ${error.message}`);
      }
      draw();
    };
    const button = (label, ic, onClick) =>
      h(
        "button",
        {
          type: "button",
          class: "pb",
          onClick: (e) => {
            e.stopPropagation();
            onClick();
          },
        },
        ic,
        label,
      );
    return h(
      "span",
      { class: "host" },
      h(
        "span",
        { class: "pop", role: "group", "aria-label": `${line.index + 1}번째 대사` },
        mine && state.phase === "loading"
          ? button("만드는 중… 멈춤", h("span", { class: "act-dot" }), () => tts.stop())
          : mine
            ? button("멈춤", icon(I.stop, 14, 2), () => play(false))
            : button("듣기", icon(I.play, 14, 2), () => play(false)),
        has && !mine
          ? button("다시 만들기", icon(["M20 12a8 8 0 1 1-2.3-5.7", "M20 4v5h-5"], 14, 2), () => play(true))
          : null,
      ),
    );
  }

  // Keeps an open line popup inside the screen (a line can end at the right edge).
  function fitPopover() {
    const pop = page.querySelector(".pop");
    if (!pop) return;
    pop.style.transform = "";
    const r = pop.getBoundingClientRect();
    const right = r.right - (innerWidth - 12);
    const left = 12 - r.left;
    if (right > 0) pop.style.transform = `translateX(${-Math.min(right, r.left - 12)}px)`;
    else if (left > 0) pop.style.transform = `translateX(${left}px)`;
  }

  function assistantBlock(m, isLast) {
    const parsed = parseMessage(messageText(m), m.characterId);
    // speakAs(seg): the line of the ORIGINAL that a shown line reads aloud (itself, or for a translation shown in
    // the original's place, the original line at the same position).
    const draw_ = (shown, speakAs, tag) =>
      shown.paragraphs.map((para) =>
        h(
          "p",
          { style: { textAlign: prefs().align } },
          para.map((seg) => {
            if (seg.kind === "text") return inline(seg.text);
            const line = speakAs(seg);
            const key = `${m.id}:${tag}${seg.index}`;
            const on = picked === key;
            const node = h(
              "span",
              {
                class: on ? "line on" : "line",
                role: "button",
                tabindex: 0,
                "aria-expanded": on ? "true" : "false",
                onClick: (e) => {
                  e.stopPropagation();
                  picked = on ? null : key;
                  draw();
                },
              },
              inline(seg.text),
            );
            // A small play/stop right after each spoken line (설정 › 음성 › Mari 화면 대사 옆 ▶), one tap to listen.
            const quick = ttsConfig && prefs().lineVoice === true && line?.spoken ? lineButton(line) : null;
            if (!on) return quick ? [node, quick] : node;
            return [node, quick, !ttsConfig ? voiceOffPopover() : line ? linePopover(m, line) : null];
          }),
        ),
      );
    const paragraphs = draw_(parsed, (seg) => seg, "");
    const translation = savedTranslation(m);
    // 원문 대신 번역: the translation takes the original's place; its quoted lines read the original's lines in order.
    const only = translation && chatMeta(chat).translationDisplayOnly === true;
    return h(
      "div",
      { class: hiddenFromAI(m) ? "read hid" : "read", "data-message-id": m.id },
      only ? draw_(parseMessage(translation, m.characterId), (seg) => parsed.lines[seg.index], "t") : paragraphs,
      translation && !only
        ? h(
            "div",
            {
              class: "hint",
              style: {
                marginTop: "12px",
                fontSize: "calc(var(--read-size) - 2px)",
                lineHeight: "var(--read-leading)",
                whiteSpace: "pre-wrap",
              },
            },
            translation,
          )
        : null,
      // Other replies to this turn; on the newest reply always, so › can ask for a new one.
      (m.swipeCount || 1) > 1 || (isLast && m.role === "assistant")
        ? swipeNav({
            chatId,
            message: m,
            reload: () => load(),
            regenerate: isLast ? () => generate({ regenerateMessageId: m.id }) : null,
            busy,
          })
        : null,
      busy ? null : tools(m, !isLast),
    );
  }

  // The last reply shows its tools in a row; every other message keeps them behind one small ⋯ (compact).
  function tools(m, compact = false) {
    const usable = TOOL_DEFS.filter(
      (t) => !t.convoOnly && !(t.assistantOnly && m.role !== "assistant") && !(compact && t.id === "regen"),
    );
    const shown = compact ? [] : usable.filter((t) => toolPlace(t) === "show");
    // Every message follows 설정 › 메시지 도구: 숨김 never shows; on older messages 표시 and 더보기 share the ⋯.
    const placed = usable.filter((t) => toolPlace(t) !== "hidden");
    const more = compact ? placed : placed.filter((t) => toolPlace(t) === "more");
    const open = moreFor === m.id;
    return h(
      "div",
      { class: compact ? "tools compact" : "tools" },
      shown.map((t) =>
        h(
          "button",
          {
            type: "button",
            class: "ma",
            "aria-label": toolLabel(t, m),
            title: toolLabel(t, m),
            onClick: () => runTool(t.id, m),
          },
          icon(t.icon, 16, 1.6),
        ),
      ),
      more.length
        ? h(
            "button",
            {
              type: "button",
              class: "ma",
              "aria-label": compact ? "메시지 도구" : "더보기",
              "aria-expanded": open ? "true" : "false",
              onClick: (e) => {
                e.stopPropagation();
                moreFor = open ? null : m.id;
                draw();
              },
            },
            dots(16),
          )
        : null,
      open
        ? h(
            "div",
            { class: "tmenu", role: "menu", style: { right: "10px", bottom: "40px" } },
            more.map((t) =>
              h(
                "button",
                {
                  type: "button",
                  role: "menuitem",
                  onClick: () => {
                    moreFor = null;
                    runTool(t.id, m);
                  },
                },
                h("span", { style: { display: "flex", color: "var(--ink-2)" } }, icon(t.icon, 16, 1.6)),
                toolLabel(t, m),
              ),
            ),
          )
        : null,
    );
  }

  function draw() {
    if (!chat) return;
    const visible = messages.filter((m) => m.role !== "system" || messageText(m).trim());
    const lastIdx = visible.length - 1;
    // In a group story, a small name marks where another character's reply starts.
    const group = (chat.characterIds || []).length > 1;
    const blocks = [];
    visible.forEach((m, i) => {
      if (m.role === "user") {
        const { main, sub } = shownText(m, chatMeta(chat), messageText(m));
        return blocks.push(
          h(
            "div",
            { class: hiddenFromAI(m) ? "umsg hid" : "umsg", "data-message-id": m.id },
            main,
            sub ? h("small", { class: "umsg-tr" }, sub) : null,
            busy ? null : tools(m, true),
          ),
        );
      }
      const before = visible[i - 1];
      const speaker = group && m.characterId ? index.get(m.characterId) : null;
      if (speaker && !(before?.role === "assistant" && before.characterId === m.characterId))
        blocks.push(h("div", { class: "rp-who" }, speaker.name));
      blocks.push(assistantBlock(m, i === lastIdx));
    });
    if (win.more) blocks.unshift(olderButton(win, scroller, () => ((messages = win.list), draw())));
    if (busy)
      blocks.push(
        live ? h("div", { class: "read" }, h("p", null, inline(live))) : h("div", { class: "typing" }, "쓰는 중…"),
      );
    if (!blocks.length) blocks.push(h("div", { class: "empty" }, "아직 메시지가 없어요."));
    setChildren(page, blocks);
    sendBtn.setAttribute("aria-label", busy ? "멈춤" : "보내기");
    setChildren(sendBtn, icon(busy ? I.stop : I.send, busy ? 14 : 16, 2));
    clampPopover();
    fitMenus(page);
    fitPopover();
    refreshCached(visible);
  }

  // Same rule as ME-personal: keep the popover under its line and inside the reading column.
  function clampPopover() {
    const pop = page.querySelector(".pop");
    if (!pop) return;
    const host = pop.parentElement;
    const box = page.getBoundingClientRect();
    const at = host.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.left = `${Math.min(box.right - at.left - w - 8, Math.max(box.left - at.left + 8, -w + 12))}px`;
  }

  async function refreshCached(visible) {
    if (!ttsConfig) return;
    const last = visible.filter((m) => m.role === "assistant").slice(-3);
    let changed = false;
    for (const m of last)
      for (const line of parseMessage(messageText(m), m.characterId).lines) {
        const { key } = speakRequest(line);
        if (!cachedLines.has(key) && (await tts.isCached(key))) {
          cachedLines.add(key);
          changed = true;
        }
      }
    if (changed && alive && picked) draw();
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

  // ── generation ─────────────────────────
  async function generate(body) {
    if (busy) return;
    busy = true;
    live = "";
    picked = null;
    draw();
    scroller.scrollTop = scroller.scrollHeight;
    abort = new AbortController();
    const done = startJob("답장 쓰는 중…", { label: "멈추기", fn: () => stopGenerating() });
    try {
      await streamGenerate({
        chatId,
        body,
        signal: abort.signal,
        onToken: (text) => {
          if (!alive) return;
          // Follow the new text only for a reader at the bottom (checked before the screen grows).
          const follow = scroll.nearBottom();
          live = text;
          draw();
          if (follow) scroller.scrollTop = scroller.scrollHeight;
        },
        onSaved: (saved) => {
          if (alive && saved?.role === "user") {
            messages.push(saved);
            draw();
          }
        },
      });
    } catch (error) {
      if (error.name !== "AbortError") toast(`생성하지 못했어요: ${error.message}`);
    } finally {
      done();
      busy = false;
      live = null;
      abort = null;
      if (alive) {
        const follow = scroll.nearBottom();
        await load(false, true);
        refreshMemory();
        // A reader who scrolled up to older lines is left where they are.
        if (follow) scroller.scrollTop = scroller.scrollHeight;
        autoplay();
      }
    }
  }

  /** Reads the new reply aloud when 자동 재생 is on: characters only, or the persona's lines too. */
  function autoplay() {
    if (!ttsConfig || !voiceSet || voiceSet.autoplay === "off" || !voiceSet.rp) return;
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (!last) return;
    const lines = parseMessage(messageText(last), last.characterId).lines.filter(
      (l) => l.spoken && (voiceSet.autoplay === "all" || l.speakerKind !== "persona"),
    );
    tts.speakSequence(lines.map((l) => speakRequest(l)));
  }

  async function stopGenerating() {
    try {
      await api.post(`/generate/abort`, { chatId });
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

  function runTool(id, m) {
    return sharedTool(id, { chatId, chat, message: m, reload: load, generate, go });
  }

  function openSettings() {
    go(`chat-settings/${encodeURIComponent(chatId)}`);
  }

  page.addEventListener("click", () => {
    if (picked || moreFor) {
      picked = null;
      moreFor = null;
      draw();
    }
  });
  const off = tts.onTts(() => alive && draw());
  load(true);
  return {
    dispose: () => {
      alive = false;
      off();
      strip.dispose();
      scroll.dispose();
      tts.stop();
      abort?.abort();
    },
    onPrefs: draw,
  };
}
