// RP reading screen: the story as a page, a tap on a spoken line opens its voice popover (ME-personal style),
// message tools follow the viewer's show / more / hidden choice, and the composer offers the quick-reply menu
// (guide reply + the Engine's own custom quick replies).

import { h, icon, dots, I, setChildren } from "../lib/h.js";
import { api, parseJson } from "../lib/api.js";
import { data, characterIndex, chatTitle, chatMeta, messageText } from "../lib/data.js";
import { TOOL_DEFS, toolPlace, prefs } from "../lib/prefs.js";
import { topBar, toast, errorBox } from "../lib/ui.js";
import { parseMessage, inline, buildPronunciations, applyPronunciations, pickVoice } from "../lib/render.js";
import * as tts from "../lib/tts.js";
import { GUIDE, quickReplies, runTool as sharedTool, streamGenerate } from "../lib/actions.js";

export function rpScreen({ mount, args, go }) {
  const chatId = args[0];
  let alive = true;
  let chat = null;
  let index = new Map();
  let messages = [];
  let participants = [];
  let ttsConfig = null;
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
        onClick: () => (history.length > 1 ? history.back() : go("library")),
      },
      icon(I.back),
    ),
    h("div", { class: "ttl" }, title, sub),
    memBtn,
    h("button", { type: "button", class: "ib", "aria-label": "채팅 설정", onClick: openSettings }, icon(I.sliders, 19)),
  );
  const page = h("main", { class: "rp" });
  const scroller = h("div", { class: "scroll" }, page);
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
  const sendBtn = h(
    "button",
    { type: "button", class: "cb send", "aria-label": "보내기", onClick: () => (busy ? stopGenerating() : send()) },
    icon(I.send, 16, 2),
  );
  const quickLayer = h("div");
  const composer = h("div", { class: "cmp" }, input, qrBtn, sendBtn);
  mount.append(head, scroller, quickLayer, composer);

  function grow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }

  // ── data ───────────────────────────────
  async function load(first) {
    try {
      const [c, chars, msgs] = await Promise.all([data.chat(chatId), data.characters(), data.messages(chatId)]);
      if (!alive) return;
      chat = c;
      index = characterIndex(chars);
      messages = Array.isArray(msgs) ? msgs : [];
      title.textContent = chatTitle(chat, index);
      sub.textContent = [
        (chat.characterIds || [])
          .map((id) => index.get(id)?.name)
          .filter(Boolean)
          .join(", "),
        `메시지 ${messages.length}`,
      ]
        .filter(Boolean)
        .join(" · ");
      if (first) await loadExtras();
      draw();
      if (first) requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));
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
    const usesKit = meta.enableAgents === true && (meta.activeAgentIds || []).includes("mari-kit");
    if (ttsConfig && settings?.features?.tts && usesKit) {
      participants =
        (await api.get(`/mari-kit/tts/participants/${encodeURIComponent(chatId)}`).catch(() => null))?.participants ||
        [];
    }
    quick = quickReplies(ui, I.guide);
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
    if (!memory.waiting) return toast("정리할 메시지가 없어요");
    memory.busy = true;
    drawMemory();
    let calls = 0;
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
    return {
      key: tts.hashKey([spoken, line.cue, voice, ttsConfig?.source, ttsConfig?.model]),
      body: {
        text: spoken,
        ...(speaker ? { speaker } : {}),
        ...(line.cue ? { tone: line.cue } : {}),
        ...(voice ? { voice } : {}),
      },
    };
  }

  function linePopover(m, line) {
    const req = speakRequest(line);
    const playing = tts.activeLine() === req.key;
    const has = cachedLines.has(req.key);
    const play = async (fresh) => {
      if (playing && !fresh) return tts.stop();
      if (!line.spoken) return toast("읽을 대사가 없어요");
      try {
        if (fresh) await tts.forget(req.key);
        await tts.speak(req.key, req.body);
        cachedLines.add(req.key);
      } catch (error) {
        toast(`재생하지 못했어요: ${error.message}`);
      }
      draw();
    };
    return h(
      "span",
      { class: "host" },
      h(
        "span",
        { class: "pop", role: "group", "aria-label": `${line.index + 1}번째 대사` },
        h(
          "button",
          {
            type: "button",
            class: "pb",
            "aria-label": playing ? "멈춤" : has ? "재생" : "음성 만들기",
            onClick: (e) => {
              e.stopPropagation();
              play(false);
            },
          },
          icon(playing ? I.stop : has ? I.play : I.plus, 12, 2),
        ),
        has
          ? h(
              "button",
              {
                type: "button",
                class: "pb",
                "aria-label": "다시 생성",
                onClick: (e) => {
                  e.stopPropagation();
                  play(true);
                },
              },
              icon(["M20 12a8 8 0 1 1-2.3-5.7", "M20 4v5h-5"], 12, 2),
            )
          : null,
      ),
    );
  }

  function assistantBlock(m, isLast) {
    const parsed = parseMessage(messageText(m), m.characterId);
    const paragraphs = parsed.paragraphs.map((para) =>
      h(
        "p",
        { style: { textAlign: prefs().align } },
        para.map((seg) => {
          if (seg.kind === "text") return inline(seg.text);
          const key = `${m.id}:${seg.index}`;
          const on = picked === key;
          const node = h(
            "span",
            {
              class: on ? "line on" : "line",
              role: ttsConfig ? "button" : false,
              tabindex: ttsConfig ? 0 : false,
              "aria-expanded": ttsConfig ? (on ? "true" : "false") : false,
              onClick: ttsConfig
                ? (e) => {
                    e.stopPropagation();
                    picked = on ? null : key;
                    draw();
                  }
                : null,
            },
            inline(seg.text),
          );
          return on && ttsConfig ? [node, linePopover(m, seg)] : node;
        }),
      ),
    );
    const extra = parseJson(m.extra, {}) || {};
    const translation = typeof extra.translation === "string" && !extra.translationHidden ? extra.translation : "";
    return h(
      "div",
      { class: "read", "data-message-id": m.id },
      paragraphs,
      translation
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
      (m.swipeCount || 1) > 1 ? swipeNav(m) : null,
      isLast && !busy ? tools(m) : null,
    );
  }

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
    return h(
      "div",
      { class: "hint", style: { display: "flex", alignItems: "center", gap: "4px", marginTop: "8px" } },
      h(
        "button",
        { type: "button", class: "ma", "aria-label": "이전 답", disabled: i <= 0, onClick: () => set(i - 1) },
        icon(I.back, 14),
      ),
      h("span", { style: { fontVariantNumeric: "tabular-nums" } }, `${i + 1} / ${n}`),
      h(
        "button",
        { type: "button", class: "ma", "aria-label": "다음 답", disabled: i >= n - 1, onClick: () => set(i + 1) },
        icon("M9 5l7 7-7 7", 14),
      ),
    );
  }

  function tools(m) {
    const usable = TOOL_DEFS.filter((t) => !t.convoOnly && !(t.assistantOnly && m.role !== "assistant"));
    const shown = usable.filter((t) => toolPlace(t) === "show");
    const more = usable.filter((t) => toolPlace(t) === "more");
    const open = moreFor === m.id;
    return h(
      "div",
      { class: "tools" },
      shown.map((t) =>
        h(
          "button",
          { type: "button", class: "ma", "aria-label": t.label, title: t.label, onClick: () => runTool(t.id, m) },
          icon(t.icon, 16, 1.6),
        ),
      ),
      more.length
        ? h(
            "button",
            {
              type: "button",
              class: "ma",
              "aria-label": "더보기",
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
                t.label,
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
    const blocks = visible.map((m, i) =>
      m.role === "user" ? h("div", { class: "umsg" }, messageText(m)) : assistantBlock(m, i === lastIdx),
    );
    if (busy)
      blocks.push(
        live ? h("div", { class: "read" }, h("p", null, inline(live))) : h("div", { class: "typing" }, "쓰는 중…"),
      );
    if (!blocks.length) blocks.push(h("div", { class: "empty" }, "아직 메시지가 없어요."));
    setChildren(page, blocks);
    sendBtn.setAttribute("aria-label", busy ? "멈춤" : "보내기");
    setChildren(sendBtn, icon(busy ? I.stop : I.send, busy ? 14 : 16, 2));
    clampPopover();
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
    try {
      await streamGenerate({
        chatId,
        body,
        signal: abort.signal,
        onToken: (text) => {
          if (!alive) return;
          live = text;
          draw();
          if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160)
            scroller.scrollTop = scroller.scrollHeight;
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
      busy = false;
      live = null;
      abort = null;
      if (alive) {
        await load();
        refreshMemory();
        scroller.scrollTop = scroller.scrollHeight;
      }
    }
  }

  async function stopGenerating() {
    try {
      await api.post(`/generate/abort`, { chatId });
    } catch {}
    abort?.abort();
  }

  function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    grow();
    generate({ userMessage: text });
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
    if (q.content.startsWith("/")) return toast("슬래시 명령은 엔진 화면에서 써 주세요");
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
      tts.stop();
      abort?.abort();
    },
    onPrefs: draw,
  };
}
