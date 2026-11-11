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
import { toast, sheet, popMenu, avatar } from "./ui.js";
import * as tts from "./tts.js";

const BASE = "/conversation-calls";

/** Is the Calls package installed? (404 when it is not.) */
export async function callsAvailable(chatId) {
  try {
    await api.get(`${BASE}/chat/${encodeURIComponent(chatId)}/status`);
    return true;
  } catch {
    return false;
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

  function open(s) {
    session = s;
    minimized = false;
    clearInterval(timer);
    timer = setInterval(() => {
      if (session?.status === "active") draw();
    }, 1000);
    refresh();
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

  async function speakTurns(list) {
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
    if (ctx.ttsConfig && items.length) await tts.speakSequence(items);
  }

  async function sendText(text, inputMode = "typed") {
    if (!session || busy || !text.trim()) return;
    busy = true;
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
      open(await api.post(`${BASE}/${encodeURIComponent(session.id)}/accept`));
      const rows = messages.filter((m) => m.participantKind === "character");
      speakTurns(rows.slice(-1));
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

  function typeSheet() {
    const input = h("textarea", {
      class: "cin",
      rows: 1,
      placeholder: meta().translateInput === true ? "한국어로 써도 옮겨서 전해요" : "할 말",
    });
    const s = sheet(
      h(
        "div",
        { class: "cmp", style: { borderTop: "0" } },
        input,
        h(
          "button",
          {
            type: "button",
            class: "cb send",
            "aria-label": "보내기",
            onClick: () => (s.close(), sendText(input.value)),
          },
          icon(I.send, 16, 2),
        ),
      ),
      { label: "글로 말하기" },
    );
    setTimeout(() => input.focus(), 50);
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
                    { type: "button", class: "ib", "aria-label": "다시 듣기", onClick: () => speakTurns([m]) },
                    icon("M8 5v14l11-7z", 13, 0),
                  )
                : null,
            ),
          )
        : h("div", { class: "empty" }, "남은 대사가 없어요"),
    );
  }

  let drawSeq = 0;
  async function draw() {
    if (!session) return;
    const seq = ++drawSeq;
    const who = lead();
    const ringing = session.status === "ringing";
    const started = Date.parse(session.startedAt || session.createdAt || "") || Date.now();
    const time = ringing
      ? "음성 통화"
      : `${fmt(Date.now() - started)}${rec ? " · 듣는 중 · 다시 누르면 보내요" : busy ? " · …" : ""}`;
    pill.textContent = `${who?.name || "통화"} · ${fmt(Date.now() - started)}`;
    pill.hidden = !minimized || ringing;
    layer.hidden = minimized;
    if (minimized) return;
    const last = [...messages].reverse().find((m) => m.participantKind === "character");
    const cap = last ? await shown(last) : null;
    if (seq !== drawSeq || !session) return;
    setChildren(
      layer,
      h(
        "div",
        { class: "callx-top" },
        h(
          "button",
          { type: "button", class: "ib", "aria-label": "대화 보기", onClick: () => ((minimized = true), draw()) },
          icon(I.down, 22, 1.8),
        ),
        ringing
          ? null
          : h(
              "button",
              {
                type: "button",
                class: "ib",
                "aria-label": "통화 메뉴",
                onClick: () =>
                  popMenu([
                    { label: "글로 말하기", onClick: typeSheet },
                    {
                      label: showOriginal ? "번역으로 보기" : "원문으로 보기",
                      onClick: () => ((showOriginal = !showOriginal), draw()),
                    },
                    { label: "지금까지 대사", onClick: () => logSheet() },
                    {
                      label: "통화 설정",
                      sub: "›",
                      onClick: () => ctx.go(`call-settings/${encodeURIComponent(ctx.chatId)}`),
                    },
                  ]),
              },
              dots(),
            ),
      ),
      h(
        "div",
        { class: "callx-mid" },
        avatar(who?.avatar, who?.name?.[0] || "·", 104),
        h("b", null, who?.name || "통화"),
        h("span", { class: "label", style: { fontVariantNumeric: "tabular-nums" } }, time),
        ringing
          ? null
          : h(
              "button",
              {
                type: "button",
                class: "callx-cap",
                "aria-label": "원문과 번역 바꾸기",
                onClick: () => ((showOriginal = !showOriginal), draw()),
              },
              h("span", null, cap?.top || ""),
              cap?.bottom ? h("small", null, cap.bottom) : null,
            ),
      ),
      ringing
        ? h(
            "div",
            { class: "callx-btns", style: { gap: "88px" } },
            h(
              "button",
              { type: "button", class: "o soft", "aria-label": "거절", onClick: decline },
              icon("M6 6l12 12M18 6L6 18", 22, 1.8),
            ),
            h(
              "button",
              { type: "button", class: "o hard", "aria-label": "받기", onClick: accept },
              icon(I.phone, 22, 1.7),
            ),
          )
        : h(
            "div",
            { class: "callx-btns" },
            h(
              "button",
              {
                type: "button",
                class: "o soft",
                "aria-label": rec ? "보내기" : "말하기",
                "aria-pressed": rec ? "true" : "false",
                disabled: busy && !rec,
                onClick: toggleMic,
              },
              icon(I.mic, 22, 1.6),
            ),
            h(
              "button",
              { type: "button", class: "o hard", "aria-label": "통화 종료", onClick: () => end(true) },
              icon(I.hangup, 24, 1.8),
            ),
          ),
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
