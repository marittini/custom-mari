// Calls in the shell, on top of the Engine's official Calls package (/api/conversation-calls). Ported from the
// Compact Translated Calls extension, without its own storage: the call and its lines live in the package,
// translation uses the chat's own translation settings (translateInput / autoTranslate), and replay uses the
// shell's voice cache.
//
// One screen while a call is up: face, name, time and what is happening (말하는 중 · 듣는 중), a subtitle window
// that builds up from the start of the call (each line with its translation; tap a character's line to hear it
// again; 듣는 중… / 알아듣는 중… / 답하는 중… while waiting), keys (원문 · 마이크 · 소리 · 자막), 종료 on its own
// row, and a reply box with ☺ (emoji, kaomoji). 자막 chooses face-first or subtitles-first and the text size.

import { h, icon, I, setChildren, dots } from "./h.js";
import { api } from "./api.js";
import { chatMeta } from "./data.js";
import { translate } from "./translate.js";
import { pickVoice } from "./render.js";
import { prefs, setPrefs } from "./prefs.js";
import { toast, sheet, popMenu, avatar, thumb } from "./ui.js";
import * as tts from "./tts.js";

const BASE = "/conversation-calls";

/** The chat's call status when the Calls package is installed (404 when it is not), else null. */
export async function callsAvailable(chatId) {
  try {
    return (await api.get(`${BASE}/chat/${encodeURIComponent(chatId)}/status`)) || {};
  } catch {
    return null;
  }
}

const visible = (m) => m && m.extra?.hiddenFromUser !== true && !["command", "system"].includes(m.kind);
const fmt = (ms) =>
  `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/**
 * The call screen over a Convo. ctx: { chatId, chat, index, ttsConfig, mount, go, onEnded }.
 * Returns { open(session), dispose(), session }.
 */
export function callScreen(ctx) {
  let session = null;
  let messages = [];
  let originals = new Map(); // my message id → what I typed before translation
  let showOriginal = false;
  let rec = null; // { recorder, chunks }
  let pendingText = ""; // what I just typed, shown as my line until the call has it
  let busy = false;
  let phase = null; // "recognizing" (my voice being turned into text) | "waiting" (a reply is being written)
  const trCache = new Map(); // message id → its translation (each line is translated once)
  let timer = null;
  let minimized = false;
  const meta = () => chatMeta(ctx.chat);
  const cast = () => (ctx.chat.characterIds || []).map((id) => ctx.index.get(id)).filter(Boolean);
  /** The face on screen: whoever spoke last, else the character who called, else the room's first character. */
  const lead = () => {
    const lastSpeaker = [...messages].reverse().find((m) => m.participantKind === "character")?.characterId;
    return ctx.index.get(lastSpeaker || session?.initiatorCharacterId) || cast()[0];
  };
  const callName = () =>
    session?.status === "ringing"
      ? ctx.index.get(session.initiatorCharacterId)?.name || cast()[0]?.name || "통화"
      : cast()
          .map((c) => c.name)
          .join(", ") || "통화";
  const speakerName = (m) => (m.participantKind === "user" ? "나" : ctx.index.get(m.characterId)?.name || "상대");
  const layer = h("div", { class: "callx", hidden: true });
  const pill = h("button", {
    type: "button",
    class: "callpill",
    hidden: true,
    onClick: () => ((minimized = false), draw()),
  });
  ctx.mount.append(layer, pill);

  async function refresh() {
    if (!session) return;
    try {
      const rows = await api.get(`${BASE}/${encodeURIComponent(session.id)}/messages`);
      messages = (Array.isArray(rows) ? rows : []).filter(visible);
    } catch {}
    draw();
  }

  // Quiet for a while → the package's silence check-in (the character may ask whether the user is still there).
  const QUIET_MS = 150_000;
  let lastActivity = Date.now();
  async function checkIn() {
    if (!session || busy || rec || session.status !== "active") return;
    busy = true;
    lastActivity = Date.now();
    try {
      const res = await api.post(`${BASE}/${encodeURIComponent(session.id)}/idle`, { quietMs: QUIET_MS });
      if (res?.session) session = res.session;
      await refresh();
      await speakTurns(res?.assistantMessages || []);
    } catch {
      // A failed check-in just waits for the next quiet stretch.
    } finally {
      busy = false;
      draw();
    }
  }

  function open(s) {
    session = s;
    minimized = false;
    lastActivity = Date.now();
    clearInterval(timer);
    timer = setInterval(() => {
      if (session?.status !== "active") return;
      draw();
      if (Date.now() - lastActivity > QUIET_MS && document.visibilityState === "visible") checkIn();
    }, 1000);
    return refresh();
  }

  async function shown(m) {
    // My lines: what I typed; theirs: the translation when 받은 말 자동 번역 is on (translated once, kept).
    if (m.participantKind === "user") {
      const orig = originals.get(m.id);
      return orig && orig !== m.content
        ? { top: showOriginal ? m.content : orig, bottom: showOriginal ? orig : m.content }
        : { top: m.content, bottom: "" };
    }
    if (meta().autoTranslate !== true) return { top: m.content, bottom: "" };
    try {
      const key = `${m.id}|${m.content}`;
      if (!trCache.has(key)) trCache.set(key, await translate(m.content, "output", meta(), ctx.chatId));
      const tr = trCache.get(key);
      return showOriginal ? { top: m.content, bottom: tr } : { top: tr, bottom: m.content };
    } catch {
      return { top: m.content, bottom: "" };
    }
  }

  // force: even while muted (a tap on 다시 듣기). fresh: make the clip again (다시 만들기) instead of the kept one.
  async function speakTurns(list, force = false, fresh = false) {
    const items = list
      .filter((m) => m.participantKind === "character" && m.kind === "speech" && m.content)
      .map((m) => {
        const voice = pickVoice(ctx.ttsConfig, m.characterId);
        const tone = m.extra?.turn?.tone || undefined;
        const speaker = ctx.index.get(m.characterId)?.name;
        return {
          key: tts.hashKey(["call", m.id, m.content, voice]),
          body: {
            text: m.content,
            ...(speaker ? { speaker } : {}),
            ...(voice ? { voice } : {}),
            ...(tone ? { tone } : {}),
          },
        };
      });
    if (!ctx.ttsConfig || !items.length || (muted && !force)) return;
    if (fresh) await Promise.all(items.map((i) => tts.forget(i.key)));
    await tts.speakSequence(items);
  }

  async function sendText(text, inputMode = "typed") {
    if (!session || busy || !text.trim()) return;
    busy = true;
    phase = "waiting";
    pendingText = text.trim();
    lastActivity = Date.now();
    draw();
    try {
      let content = text.trim();
      if (inputMode === "typed" && meta().translateInput === true)
        content = await translate(content, "input", meta(), ctx.chatId);
      const res = await api.post(`${BASE}/${encodeURIComponent(session.id)}/messages`, { content, inputMode });
      if (res?.userMessage) originals.set(res.userMessage.id, text.trim());
      if (res?.session) session = res.session;
      await refresh();
      await speakTurns(res?.assistantMessages || []);
      lastActivity = Date.now();
      if (session?.status !== "active") end(false);
    } catch (error) {
      toast(`보내지 못했어요: ${error.message}`);
    } finally {
      busy = false;
      phase = null;
      pendingText = "";
      draw();
    }
  }

  // 마이크: tap to start, tap again to send what was said (the package transcribes it).
  async function toggleMic() {
    if (rec) {
      rec.recorder.stop();
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return toast("마이크를 쓸 수 없어요 · 브라우저 권한을 확인해 주세요");
    }
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    const me = { recorder, chunks, discard: false };
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      rec = null;
      draw();
      // Hung up while talking: the half sentence is dropped quietly (it used to show "알아듣지 못했어요").
      if (me.discard || !session) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (blob.size < 2000) return;
      const form = new FormData();
      form.append("kind", "audio");
      // Follow the Engine's call input setting: Whisper transcription, or the model's own audio input.
      const mode = ctx.ttsConfig?.callAudioInputMode || "local_whisper";
      if (mode === "local_whisper" || mode === "transcribe") form.append("transcriptionMode", "local_whisper");
      else form.append("nativePreferred", "true");
      form.append("file", blob, "speech.webm");
      busy = true;
      phase = "recognizing";
      draw();
      try {
        const res = await fetch(`/api${BASE}/${encodeURIComponent(session.id)}/media`, {
          method: "POST",
          body: form,
          headers: { "x-marinara-csrf": "1" },
          credentials: "same-origin",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || res.status);
        if (body?.session) session = body.session;
        await refresh();
        await speakTurns(body?.assistantMessages || []);
      } catch (error) {
        toast(`알아듣지 못했어요: ${error.message}`);
      } finally {
        busy = false;
        phase = null;
        draw();
      }
    };
    rec = me;
    recorder.start();
    draw();
  }

  async function accept() {
    try {
      await open(await api.post(`${BASE}/${encodeURIComponent(session.id)}/accept`));
      // The caller's opening line, when their call carried one.
      speakTurns(messages.filter((m) => m.extra?.conversationCallAutoplay === true));
    } catch (error) {
      toast(error.message);
    }
  }
  async function decline() {
    try {
      await api.post(`${BASE}/${encodeURIComponent(session.id)}/decline`);
    } catch {}
    close();
    ctx.onEnded?.();
  }
  async function end(ask = true) {
    if (!session) return;
    tts.stop();
    if (ask) {
      try {
        await api.post(`${BASE}/${encodeURIComponent(session.id)}/end`);
      } catch (error) {
        toast(error.message);
      }
    }
    close();
    ctx.onEnded?.();
  }
  function close() {
    clearInterval(timer);
    if (rec) {
      rec.discard = true;
      rec.recorder.stop();
    }
    session = null;
    messages = [];
    layer.hidden = true;
    pill.hidden = true;
  }

  /** The whole call as lines: the call screen's ⋯ and the call card in the Convo. ev: the ended-call event, if any. */
  async function logSheet(id = session?.id, ev = null) {
    if (!id) return;
    let rows = [];
    try {
      rows = (await api.get(`${BASE}/${encodeURIComponent(id)}/messages`)).filter(visible);
    } catch (error) {
      return toast(error.message);
    }
    const list = h("div", { class: "tlog" }, h("div", { class: "empty" }, "불러오는 중…"));
    sheet(list, { label: "통화 기록" });
    const paint = async () => {
      const lines = await Promise.all(rows.map(async (m) => ({ m, ...(await shown(m)) })));
      const text = lines.map(({ m, top }) => `${speakerName(m)}: ${top}`).join("\n");
      setChildren(
        list,
        h(
          "div",
          { class: "tlog-head" },
          h("b", null, "통화 기록"),
          h(
            "span",
            { class: "hint" },
            [ev?.durationMs ? fmt(ev.durationMs) : "", `대사 ${lines.length}줄`].filter(Boolean).join(" · "),
          ),
        ),
        ev?.summary ? h("p", { class: "tlog-sum" }, ev.summary) : null,
        h(
          "div",
          { class: "tlog-acts" },
          meta().autoTranslate === true
            ? h(
                "button",
                { type: "button", class: "pill", onClick: () => ((showOriginal = !showOriginal), paint()) },
                showOriginal ? "번역 먼저" : "원문 먼저",
              )
            : null,
          h(
            "button",
            {
              type: "button",
              class: "pill",
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(text);
                  toast("통화 기록을 복사했어요");
                } catch {
                  toast("복사하지 못했어요");
                }
              },
            },
            "전체 복사",
          ),
        ),
        lines.length
          ? lines.map(({ m, top, bottom }) =>
              h(
                "div",
                { class: "tline2" },
                h(
                  "span",
                  { style: { display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" } },
                  h("span", { class: "label" }, speakerName(m)),
                  h("span", { style: { fontFamily: "var(--font-read)", fontSize: "15px", lineHeight: "1.55" } }, top),
                  bottom ? h("span", { style: { fontSize: "12px", color: "var(--ink-3)" } }, bottom) : null,
                ),
                m.participantKind === "character" && m.kind === "speech" && ctx.ttsConfig
                  ? h(
                      "span",
                      { style: { display: "flex", flexShrink: "0" } },
                      h(
                        "button",
                        {
                          type: "button",
                          class: "ib",
                          "aria-label": "다시 듣기",
                          onClick: () => speakTurns([m], true),
                        },
                        icon("M8 5v14l11-7z", 13, 0),
                      ),
                      h(
                        "button",
                        {
                          type: "button",
                          class: "ib",
                          "aria-label": "음성 다시 만들기",
                          onClick: () => speakTurns([m], true, true),
                        },
                        icon(["M20 12a8 8 0 1 1-2.3-5.7", "M20 4v5h-5"], 14, 1.8),
                      ),
                    )
                  : null,
              ),
            )
          : h("div", { class: "empty" }, "남은 대사가 없어요"),
      );
    };
    paint();
  }

  /** 자막: the line being said, large (the default), or every line so far; and the text size (this browser). */
  function subtitleSheet() {
    const box = h("div", { class: "psheet pad" });
    const s = sheet(box, { label: "자막" });
    const paint = () => {
      const p = callPrefs();
      const chips = (label, list, value, set) =>
        h(
          "div",
          { class: "scn-row" },
          h("span", { class: "label" }, label),
          h(
            "div",
            { class: "chips", role: "radiogroup", "aria-label": label },
            list.map(([v, t]) =>
              h(
                "button",
                {
                  type: "button",
                  class: v === value ? "chip on" : "chip",
                  role: "radio",
                  "aria-checked": v === value ? "true" : "false",
                  onClick: () => (set(v), paint(), draw(true)),
                },
                t,
              ),
            ),
          ),
        );
      setChildren(
        box,
        h("b", { class: "psheet-title" }, "자막"),
        chips(
          "보기",
          [
            ["face", "지금 대사 크게"],
            ["subs", "지난 대사까지"],
          ],
          p.subMode,
          (v) => setCallPrefs({ subMode: v }),
        ),
        chips(
          "글자",
          [
            ["s", "작게"],
            ["m", "보통"],
            ["l", "크게"],
          ],
          p.subSize,
          (v) => setCallPrefs({ subSize: v }),
        ),
        h(
          "button",
          { type: "button", class: "pill", style: { minHeight: "44px" }, onClick: () => (s.close(), logSheet()) },
          "통화 기록 전체 보기",
        ),
      );
    };
    paint();
  }

  // A phone call, not a chat page: always dark, the caller's face blurred behind, name and clock on top, the
  // line being said as a live caption, round buttons and the reply box below. Built once; draw() only updates
  // the clock, caption and button states, so a reply being typed keeps its text and focus. While the reply box
  // has focus the button row (with 종료) steps away, so a tap meant for the keyboard can't end the call.
  let muted = false;
  const backdrop = h("div", { class: "cx-bg", "aria-hidden": "true" });
  const timeEl = h("span", { class: "cx-time" });
  const nameEl = h("b", { class: "cx-name" });
  const faceEl = h("span", { class: "cx-face" });
  // The subtitle window: every line of the call so far, newest at the bottom; it follows new lines unless the user
  // scrolled up to read.
  const subsEl = h("div", { class: "cx-subs", "aria-live": "polite", "aria-label": "자막" });
  let follow = true;
  subsEl.addEventListener("scroll", () => {
    follow = subsEl.scrollHeight - subsEl.scrollTop - subsEl.clientHeight < 40;
  });
  const input = h("textarea", {
    class: "cx-in",
    rows: 1,
    "aria-label": "할 말",
    onInput: () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
    },
    onFocus: () => (layer.classList.add("typing"), panel?.hide()),
    onBlur: () =>
      setTimeout(() => document.activeElement !== input && !panel?.open && layer.classList.remove("typing"), 120),
    onKeydown: (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) {
        e.preventDefault();
        submit();
      }
    },
  });
  const sendBtn = h(
    "button",
    { type: "button", class: "cx-send", "aria-label": "보내기", onClick: () => submit() },
    icon(I.send, 16, 2),
  );
  const ctl = (label, path, onClick) =>
    h(
      "button",
      { type: "button", class: "cx-key", onClick },
      h("span", { class: "cx-round" }, icon(path, 22, 1.6)),
      h("small", null, label),
    );
  const flipBtn = ctl(
    "원문",
    "M4 6h9M8.5 4v2M6 6c.8 3.5 3 6 6 7M11 6c-.8 3.5-3 6-6 7M13 20l3.5-8 3.5 8M14.2 17.5h4.6",
    () => ((showOriginal = !showOriginal), draw()),
  );
  const micBtn = ctl("마이크", I.mic, () => toggleMic());
  const soundBtn = ctl("소리", "M4 10v4h4l5 4V6L8 10zM16 9a4 4 0 0 1 0 6", () => {
    muted = !muted;
    if (muted) tts.stop();
    draw();
  });
  const subBtn = ctl("자막", "M4 6h16v12H4zM7 14h4M13 14h4M7 10h10", () => subtitleSheet());
  // ☺ while calling: the Convo's emoji and kaomoji panel, into this reply box (loaded on the first tap).
  let panel = null;
  const panelHost = h("div", { class: "cx-panel" });
  const emojiBtn = h(
    "button",
    {
      type: "button",
      class: "cx-emo",
      "aria-label": "이모지",
      onClick: async () => {
        if (panel?.open) {
          panel.hide();
          return input.focus();
        }
        if (!panel) {
          const { mediaPanel } = await import("./media-panel.js");
          panel = mediaPanel({
            tabs: ["emoji", "kaomoji"],
            media: async () => ({ stickers: { list: [] }, emojis: { list: [] } }),
            onInsert: (text) => {
              const a = input.selectionStart ?? input.value.length;
              input.setRangeText(text, a, input.selectionEnd ?? a, "end");
              input.dispatchEvent(new Event("input"));
            },
            onSticker: () => {},
            manage: async () => {},
          });
          setChildren(panelHost, panel.el);
        }
        input.blur();
        panel.show();
        layer.classList.add("typing");
      },
    },
    icon(
      [
        "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
        "M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8",
        "M9 9.5h.01M15 9.5h.01",
      ],
      18,
      1.6,
    ),
  );
  const endBtn = h(
    "button",
    { type: "button", class: "cx-key", onClick: () => end(true) },
    h("span", { class: "cx-round end" }, icon(I.hangup, 26, 1.8)),
    h("small", null, "종료"),
  );
  // 종료 sits on its own row below, like a phone's red button, away from 마이크 (a double tap on the mic used to
  // land on it).
  const keys = h("div", { class: "cx-keys" }, flipBtn, micBtn, soundBtn, subBtn);
  const endRow = h("div", { class: "cx-endrow" }, endBtn);
  const reply = h("div", { class: "cx-reply" }, emojiBtn, input, sendBtn);
  const ringRow = h(
    "div",
    { class: "cx-ring" },
    h(
      "button",
      { type: "button", class: "cx-key", onClick: () => decline() },
      h("span", { class: "cx-round end" }, icon(I.hangup, 26, 1.8)),
      h("small", null, "거절"),
    ),
    h(
      "button",
      { type: "button", class: "cx-key", onClick: () => accept() },
      h("span", { class: "cx-round take" }, icon(I.phone, 24, 1.7)),
      h("small", null, "받기"),
    ),
  );
  setChildren(
    layer,
    backdrop,
    h(
      "div",
      { class: "cx-top" },
      h(
        "button",
        { type: "button", class: "cx-ib", "aria-label": "대화 보기", onClick: () => ((minimized = true), draw()) },
        icon(I.down, 22, 1.8),
      ),
      h("span", { class: "cx-kind" }, "음성 통화"),
      h(
        "button",
        {
          type: "button",
          class: "cx-ib",
          "aria-label": "통화 설정",
          onClick: () => ctx.go(`call-settings/${encodeURIComponent(ctx.chatId)}`),
        },
        dots(),
      ),
    ),
    h("div", { class: "cx-who" }, faceEl, h("div", { class: "cx-whotext" }, nameEl, timeEl)),
    subsEl,
    ringRow,
    keys,
    endRow,
    reply,
    panelHost,
  );

  function submit() {
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    input.style.height = "auto";
    sendText(text);
  }

  let drawSeq = 0;
  let faceFor = null;
  async function draw(force = false) {
    if (!session) return;
    const seq = ++drawSeq;
    const who = lead();
    const ringing = session.status === "ringing";
    const started = Date.parse(session.startedAt || session.createdAt || "") || Date.now();
    const speaking = tts.ttsState().phase === "playing";
    const p = callPrefs();
    timeEl.textContent = ringing
      ? "전화가 왔어요"
      : rec
        ? "듣는 중 · 마이크를 다시 누르면 보내요"
        : speaking
          ? `${who?.name || "상대"}가 말하는 중 · ${fmt(Date.now() - started)}`
          : fmt(Date.now() - started);
    pill.textContent = `${callName()} · ${fmt(Date.now() - started)}`;
    pill.hidden = !minimized || ringing;
    layer.hidden = minimized;
    if (minimized) return;
    layer.classList.toggle("subs-first", p.subMode === "subs");
    layer.dataset.size = p.subSize;
    nameEl.textContent = callName();
    if (faceFor !== who?.id) {
      faceFor = who?.id;
      setChildren(faceEl, avatar(who?.avatar, who?.name?.[0] || "·", 96));
      backdrop.style.backgroundImage = who?.avatar ? `url("${thumb(who.avatar, 240)}")` : "";
    }
    layer.classList.toggle("ringing", ringing);
    ringRow.hidden = !ringing;
    keys.hidden = ringing;
    endRow.hidden = ringing;
    reply.hidden = ringing;
    subsEl.hidden = ringing;
    micBtn.classList.toggle("on", !!rec);
    soundBtn.classList.toggle("on", muted);
    soundBtn.querySelector("small").textContent = muted ? "소리 꺼짐" : "소리";
    flipBtn.classList.toggle("on", showOriginal);
    sendBtn.disabled = busy;
    input.placeholder = meta().translateInput === true ? "한국어로 써도 옮겨서 전해요" : "할 말을 쓰세요";
    if (ringing) return;
    // The waiting line at the bottom: my voice being heard or turned into text, or the reply being written.
    const waiting = rec
      ? { me: true, text: "듣는 중…" }
      : phase === "recognizing"
        ? { me: true, text: "알아듣는 중…" }
        : phase === "waiting"
          ? { me: false, text: `${who?.name || "상대"}가 답하는 중…` }
          : null;
    const key = `${messages.map((m) => m.id + m.content.length).join("|")}|${showOriginal}|${waiting?.text || ""}|${pendingText}`;
    if (!force && subsEl.dataset.key === key) return;
    // 지금 대사 크게 (the default): only the line being said, large in the middle, with the one before it small
    // above, as a phone caption; 지난 대사까지: every line, scrolling.
    const one = p.subMode !== "subs";
    const list = one ? messages.slice(pendingText ? -1 : -2) : messages;
    const rows = await Promise.all(list.map(async (m) => ({ m, ...(await shown(m)) })));
    if (seq !== drawSeq || !session) return;
    subsEl.dataset.key = key;
    subsEl.classList.toggle("one", one);
    const group = cast().length > 1;
    const lastChar = one ? null : [...rows].reverse().find((r) => r.m.participantKind === "character");
    const showPending =
      pendingText && !rows.some((r) => r.m.participantKind === "user" && originals.get(r.m.id) === pendingText);
    const nowRow = one && !showPending ? rows[rows.length - 1] : null;
    const line = ({ m, top, bottom }) => {
      const me = m.participantKind === "user";
      const replay = !me && m.kind === "speech" && ctx.ttsConfig;
      return h(
        replay ? "button" : "div",
        {
          ...(replay
            ? { type: "button", onClick: () => speakTurns([m], true), "aria-label": `다시 듣기: ${top}` }
            : {}),
          class: `cx-line${me ? " me" : ""}${m === lastChar?.m || m === nowRow?.m ? " now" : one ? " prev" : ""}`,
        },
        me || group ? h("small", { class: "cx-who2" }, `${speakerName(m)}${replay ? " ▶" : ""}`) : null,
        h("span", { class: "cx-t" }, top),
        bottom ? h("small", { class: "cx-tr" }, bottom) : null,
      );
    };
    setChildren(
      subsEl,
      rows.length || waiting || pendingText
        ? [
            rows.map(line),
            showPending
              ? h(
                  "div",
                  { class: `cx-line me${one ? " now" : ""}` },
                  h("small", { class: "cx-who2" }, "나"),
                  h("span", { class: "cx-t" }, pendingText),
                )
              : null,
            waiting
              ? h(
                  "div",
                  { class: `cx-line wait${waiting.me ? " me" : ""}` },
                  h("span", { class: "cx-t" }, waiting.text),
                )
              : null,
          ]
        : h("div", { class: "cx-line wait" }, h("span", { class: "cx-t" }, "연결됐어요 · 말하거나 아래에 써 보세요")),
    );
    if (follow) subsEl.scrollTop = subsEl.scrollHeight;
  }

  return {
    open,
    logSheet,
    get session() {
      return session;
    },
    dispose() {
      clearInterval(timer);
      rec?.recorder.stop();
      layer.remove();
      pill.remove();
    },
  };
}

/** Shell-only call preferences (this browser). */
export function callPrefs() {
  const p = prefs();
  return {
    log: p.callLog !== false,
    subMode: p.callSubMode === "subs" ? "subs" : "face",
    subSize: ["s", "m", "l"].includes(p.callSubSize) ? p.callSubSize : "m",
  };
}
export function setCallPrefs(patch) {
  setPrefs({
    ...(patch.log !== undefined ? { callLog: patch.log } : {}),
    ...(patch.subMode !== undefined ? { callSubMode: patch.subMode } : {}),
    ...(patch.subSize !== undefined ? { callSubSize: patch.subSize } : {}),
  });
}
