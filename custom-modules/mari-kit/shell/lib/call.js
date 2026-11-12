// Calls in the shell, on top of the Engine's official Calls package (/api/conversation-calls). Ported from the
// Compact Translated Calls extension, without its own storage: the call and its lines live in the package,
// translation uses the chat's own translation settings (translateInput / autoTranslate), and replay uses the
// shell's voice cache.
//
// One screen while a call is up: face, name, time, the line being said, 마이크 (tap to talk, tap to send) and
// 종료; 글로 말하기 · 원문/번역 · 지금까지 대사 · 통화 설정 sit in ⋯.

import { h, icon, I, setChildren, dots } from "./h.js";
import { api } from "./api.js";
import { chatMeta } from "./data.js";
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

/** Engine translation request for one direction ("input": my words → theirs; "output": theirs → mine). */
export function translationBody(text, direction, meta, chatId) {
  const input = direction === "input";
  const target = input ? meta.translationInputTargetLang : meta.translationOutputTargetLang;
  const prompt = input ? meta.translationInputPrompt : meta.translationOutputPrompt;
  const provider = ["ai", "deepl", "deeplx", "google"].includes(meta.translationProvider)
    ? meta.translationProvider
    : "google";
  const body = {
    chatId,
    text,
    provider,
    targetLanguage:
      String(target || "").trim() || String(meta.translationTargetLang || "").trim() || (input ? "en" : "ko"),
  };
  if (provider === "ai") {
    if (meta.translationConnectionId) body.connectionId = meta.translationConnectionId;
    const effective = prompt === undefined ? meta.translationPrompt : prompt;
    if (typeof effective === "string") body.systemPrompt = effective;
  } else if (provider === "deepl" && meta.translationDeeplApiKey) body.deeplApiKey = meta.translationDeeplApiKey;
  else if (provider === "deeplx" && meta.translationDeeplxUrl) body.deeplxUrl = meta.translationDeeplxUrl;
  return body;
}

const translated = new Map();
async function translate(text, direction, meta, chatId) {
  const body = translationBody(text, direction, meta, chatId);
  const key = JSON.stringify(body);
  if (!translated.has(key))
    translated.set(
      key,
      api.post("/translate", body).then((r) => {
        const out = String(r?.translatedText || "").trim();
        if (!out) throw new Error("번역 결과가 비어 있어요");
        return out;
      }),
    );
  try {
    return await translated.get(key);
  } catch (error) {
    translated.delete(key);
    throw error;
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
  let busy = false;
  let timer = null;
  let minimized = false;
  const meta = () => chatMeta(ctx.chat);
  const lead = () => ctx.index.get(ctx.chat.characterIds?.[0]);
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
    // My lines: what I typed; theirs: the translation when 상대 말 번역 is on.
    if (m.participantKind === "user") {
      const orig = originals.get(m.id);
      return orig && orig !== m.content
        ? { top: showOriginal ? m.content : orig, bottom: showOriginal ? orig : m.content }
        : { top: m.content, bottom: "" };
    }
    if (meta().autoTranslate !== true) return { top: m.content, bottom: "" };
    try {
      const tr = await translate(m.content, "output", meta(), ctx.chatId);
      return showOriginal ? { top: m.content, bottom: tr } : { top: tr, bottom: m.content };
    } catch {
      return { top: m.content, bottom: "" };
    }
  }

  async function speakTurns(list, force = false) {
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
    if (ctx.ttsConfig && items.length && (!muted || force)) await tts.speakSequence(items);
  }

  async function sendText(text, inputMode = "typed") {
    if (!session || busy || !text.trim()) return;
    busy = true;
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
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      rec = null;
      draw();
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
        draw();
      }
    };
    rec = { recorder, chunks };
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
    rec?.recorder.stop();
    session = null;
    messages = [];
    layer.hidden = true;
    pill.hidden = true;
  }

  async function logSheet(id = session?.id) {
    if (!id) return;
    let rows = [];
    try {
      rows = (await api.get(`${BASE}/${encodeURIComponent(id)}/messages`)).filter(visible);
    } catch (error) {
      return toast(error.message);
    }
    const list = h(
      "div",
      { style: { padding: "4px 20px 24px", overflowY: "auto" } },
      h("div", { class: "empty" }, "불러오는 중…"),
    );
    sheet(list, { label: "통화 대사" });
    const lines = await Promise.all(rows.map(async (m) => ({ m, ...(await shown(m)) })));
    setChildren(
      list,
      lines.length
        ? lines.map(({ m, top, bottom }) =>
            h(
              "div",
              { class: "tline2" },
              h(
                "span",
                { style: { display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" } },
                h(
                  "span",
                  { class: "label" },
                  m.participantKind === "user" ? "나" : ctx.index.get(m.characterId)?.name || "상대",
                ),
                h("span", { style: { fontFamily: "var(--font-read)", fontSize: "15px", lineHeight: "1.55" } }, top),
                bottom ? h("span", { style: { fontSize: "12px", color: "var(--ink-3)" } }, bottom) : null,
              ),
              m.participantKind === "character" && m.kind === "speech" && ctx.ttsConfig
                ? h(
                    "button",
                    { type: "button", class: "ib", "aria-label": "다시 듣기", onClick: () => speakTurns([m], true) },
                    icon("M8 5v14l11-7z", 13, 0),
                  )
                : null,
            ),
          )
        : h("div", { class: "empty" }, "남은 대사가 없어요"),
    );
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
  const prevEl = h("p", { class: "cx-prev" });
  const capEl = h("button", {
    type: "button",
    class: "cx-cap",
    "aria-live": "polite",
    onClick: () => ((showOriginal = !showOriginal), draw()),
  });
  const input = h("textarea", {
    class: "cx-in",
    rows: 1,
    "aria-label": "할 말",
    onInput: () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
    },
    onFocus: () => layer.classList.add("typing"),
    onBlur: () => setTimeout(() => document.activeElement !== input && layer.classList.remove("typing"), 120),
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
  const logBtn = ctl("대사", "M5 6h14M5 12h14M5 18h9", () => logSheet());
  const endBtn = h(
    "button",
    { type: "button", class: "cx-key", onClick: () => end(true) },
    h("span", { class: "cx-round end" }, icon(I.hangup, 26, 1.8)),
    h("small", null, "종료"),
  );
  const keys = h("div", { class: "cx-keys" }, flipBtn, micBtn, endBtn, soundBtn, logBtn);
  const reply = h("div", { class: "cx-reply" }, input, sendBtn);
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
    h("div", { class: "cx-who" }, faceEl, nameEl, timeEl),
    h("div", { class: "cx-say" }, prevEl, capEl),
    ringRow,
    keys,
    reply,
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
  async function draw() {
    if (!session) return;
    const seq = ++drawSeq;
    const who = lead();
    const ringing = session.status === "ringing";
    const started = Date.parse(session.startedAt || session.createdAt || "") || Date.now();
    timeEl.textContent = ringing
      ? "전화가 왔어요"
      : rec
        ? "듣는 중 · 마이크를 다시 누르면 보내요"
        : busy
          ? "…"
          : fmt(Date.now() - started);
    pill.textContent = `${who?.name || "통화"} · ${fmt(Date.now() - started)}`;
    pill.hidden = !minimized || ringing;
    layer.hidden = minimized;
    if (minimized) return;
    if (faceFor !== who?.id) {
      faceFor = who?.id;
      setChildren(faceEl, avatar(who?.avatar, who?.name?.[0] || "·", 96));
      nameEl.textContent = who?.name || "통화";
      backdrop.style.backgroundImage = who?.avatar ? `url("${thumb(who.avatar, 240)}")` : "";
    }
    layer.classList.toggle("ringing", ringing);
    ringRow.hidden = !ringing;
    keys.hidden = ringing;
    reply.hidden = ringing;
    micBtn.classList.toggle("on", !!rec);
    soundBtn.classList.toggle("on", muted);
    soundBtn.querySelector("small").textContent = muted ? "소리 꺼짐" : "소리";
    flipBtn.classList.toggle("on", showOriginal);
    sendBtn.disabled = busy;
    input.placeholder = meta().translateInput === true ? "한국어로 써도 옮겨서 전해요" : "할 말을 쓰세요";
    if (ringing) {
      prevEl.textContent = "";
      setChildren(capEl);
      return;
    }
    const recent = messages.slice(-2);
    const rows = await Promise.all(recent.map(async (m) => ({ m, ...(await shown(m)) })));
    if (seq !== drawSeq || !session) return;
    const cur = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[0] : null;
    const key = rows.map((r) => r.m.id + r.top).join("|") + showOriginal;
    if (capEl.dataset.key === key) return;
    capEl.dataset.key = key;
    prevEl.textContent = prev ? `${prev.m.participantKind === "user" ? "나" : nameEl.textContent} · ${prev.top}` : "";
    setChildren(
      capEl,
      cur
        ? [
            cur.m.participantKind === "user" ? h("small", { class: "cx-me" }, "나") : null,
            h("span", null, cur.top),
            cur.bottom ? h("small", null, cur.bottom) : null,
          ]
        : h("small", null, "연결됐어요 · 아래에 할 말을 쓰세요"),
    );
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
  return { log: p.callLog !== false };
}
export function setCallPrefs(patch) {
  setPrefs({ ...(patch.log !== undefined ? { callLog: patch.log } : {}) });
}
