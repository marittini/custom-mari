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
import { chatMeta, data } from "./data.js";
import { translate } from "./translate.js";
import { pickVoice } from "./render.js";
import { prefs, setPrefs } from "./prefs.js";
import { toast, sheet, popMenu, avatar, thumb } from "./ui.js";
import * as tts from "./tts.js";
import { subject } from "./convo-bits.js";
import { presenceOf } from "./presence.js";

const BASE = "/conversation-calls";

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
      : inCall()
          .map((c) => c.name)
          .join(", ") ||
        cast()
          .map((c) => c.name)
          .join(", ") ||
        "통화";

  // A group call: who is on it. The package does not remember who left ([leave_call] is only a note), so a
  // character who leaves is set "offline" for the rest of the call — the Engine's own status, which the package
  // reads on every turn to choose who may speak. The status lives on the character card, so they show offline in
  // every room until the call ends; then their earlier status is put back (on the next open, if the app closed
  // first; it also expires by itself after 3 hours). This device remembers what it changed (prefs().callLeft).
  const leftList = () => ({ ...(prefs().callLeft || {}) }); // character id → { callId, chatId, prev }
  const leftHere = (id) => !!session && leftList()[id]?.callId === session.id;
  let statuses = null; // the Engine's fresh reading, once this screen has asked (after a leave or a call back)
  const away = (c) =>
    !leftHere(c.id) && presenceOf(chatMeta(ctx.chat), c.id, new Date(), statuses?.[c.id])?.status === "offline";
  const inCall = () => cast().filter((c) => !leftHere(c.id) && !away(c));
  const saveOverride = (characterId, override) =>
    api.patch(`/characters/${encodeURIComponent(characterId)}`, {
      data: { extensions: { conversationStatusOverride: override } },
      skipVersionSnapshot: true,
    });
  // The package reads the chat's copy of the statuses, which the Engine refreshes from the cards here.
  const syncStatuses = () =>
    api
      .get(`/conversation/status/${encodeURIComponent(ctx.chatId)}`)
      .then((st) => ((statuses = st?.statuses || statuses), st))
      .catch(() => null);
  async function leave(characterId) {
    if (leftHere(characterId)) return;
    try {
      const st = await syncStatuses();
      const prev = st?.statuses?.[characterId]?.override || null;
      setPrefs({ callLeft: { ...leftList(), [characterId]: { callId: session.id, chatId: ctx.chatId, prev } } });
      await saveOverride(characterId, {
        status: "offline",
        activity: "left the call",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
      });
      await syncStatuses();
    } catch {}
  }
  async function putBack(characterId) {
    const mark = leftList()[characterId];
    if (!mark) return;
    await saveOverride(characterId, mark.prev || null);
    const rest = leftList();
    delete rest[characterId];
    setPrefs({ callLeft: rest });
  }
  async function rejoin(characterId) {
    try {
      await putBack(characterId);
      await syncStatuses();
      notice = `${subject(ctx.index.get(characterId)?.name || "상대")} 다시 들어왔어요`;
      const shownNotice = notice;
      setTimeout(() => notice === shownNotice && ((notice = ""), draw()), 4000);
    } catch (error) {
      toast(error.message);
    }
    draw(true);
  }
  /** Puts back everyone this device set offline for a call (all calls but `keep`). */
  async function restoreLeft(keep = null) {
    const ids = Object.entries(leftList())
      .filter(([, m]) => m.callId !== keep)
      .map(([id]) => id);
    if (!ids.length) return;
    for (const id of ids) await putBack(id).catch(() => {});
    await syncStatuses();
  }
  function peopleRow() {
    const list = cast();
    if (list.length < 2 || session?.status !== "active") return null;
    return list.map((c) => {
      const left = leftHere(c.id);
      const off = !left && away(c);
      return h(
        "button",
        {
          type: "button",
          class: left || off ? "cx-p off" : "cx-p",
          "aria-label": left ? `${c.name} · 나감` : off ? `${c.name} · 자리 없음` : c.name,
          onClick: () => personMenu(c, left),
        },
        avatar(c.avatar, c.name?.[0] || "·", 36),
        h("span", { class: "cx-pn" }, c.name),
        left || off ? h("small", null, left ? "나감" : "자리 없음") : null,
      );
    });
  }
  function personMenu(c, left) {
    const box = h("div", { class: "psheet" });
    const s = sheet(box, { label: c.name });
    setChildren(
      box,
      left
        ? h(
            "button",
            { type: "button", class: "grow", onClick: () => (s.close(), rejoin(c.id)) },
            h("span", null, `${c.name} 다시 부르기`, h("small", null, "다음 차례부터 다시 말해요")),
          )
        : null,
      h(
        "button",
        { type: "button", class: "grow", onClick: () => (s.close(), ctx.go(`character/${encodeURIComponent(c.id)}`)) },
        h("span", null, "프로필 보기"),
      ),
    );
  }
  // My lines carry the chat's persona name (and voice), read once when a call or its record opens.
  let persona = null; // { id, name }
  const loadPersona = async () =>
    persona || (persona = { id: ctx.chat.personaId || null, name: await data.personaName(ctx.chat.personaId) });
  const speakerName = (m) =>
    m.participantKind === "user" ? persona?.name || "나" : ctx.index.get(m.characterId)?.name || "상대";
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

  let guideChecked = false;
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
      await afterTurns(res);
    } catch {
      // A failed check-in just waits for the next quiet stretch.
    } finally {
      busy = false;
      draw();
    }
  }

  // A character's call rings for 통화 설정 › 전화 울리는 시간, then becomes a missed call (the package itself never
  // stops ringing). A ring found later than that (the app was closed) is missed at once, without ringing.
  let ringTimer = null;
  function open(s) {
    clearTimeout(ringTimer);
    if (s?.status === "ringing") {
      const left = callPrefs().ringSec * 1000 - (Date.now() - (Date.parse(s.createdAt || "") || Date.now()));
      if (left <= 0) return miss(s);
      ringTimer = setTimeout(() => session?.id === s.id && session.status === "ringing" && miss(s), left);
    }
    session = s;
    restoreLeft(s.id);
    loadPersona();
    // 캐릭터가 알아서 전화 끊기 (on unless turned off in 설정): made once, at the first call.
    if (!guideChecked) {
      guideChecked = true;
      import("./call-guide.js").then((g) => g.ensureGuide()).catch(() => {});
    }
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

  // Translations made in a call are kept with Mari Kit (one record per call): the call log and a reopened call show
  // them without asking the model again. Read once per call, only in rooms that translate.
  const kept = new Map(); // call id → Promise<{ lines: { id: { source, text } }, mine: { id: typed } }>
  const translates = () => meta().autoTranslate === true || meta().translateInput === true;
  function keptFor(callId) {
    if (!callId || !translates()) return Promise.resolve({ lines: {}, mine: {} });
    if (!kept.has(callId))
      kept.set(
        callId,
        api.get(`/mari-kit/translation/call/${encodeURIComponent(callId)}`).catch(() => ({ lines: {}, mine: {} })),
      );
    return kept.get(callId);
  }
  const unsaved = new Map(); // call id → { lines, mine } waiting to be saved
  let saveTimer = null;
  function keep(callId, part) {
    if (!callId) return;
    const add = unsaved.get(callId) || { lines: {}, mine: {} };
    Object.assign(add.lines, part.lines);
    Object.assign(add.mine, part.mine);
    unsaved.set(callId, add);
    keptFor(callId).then((k) => (Object.assign(k.lines, part.lines || {}), Object.assign(k.mine, part.mine || {})));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      for (const [id, body] of unsaved) {
        unsaved.delete(id);
        api.put(`/mari-kit/translation/call/${encodeURIComponent(id)}`, body).catch(() => {});
      }
    }, 800);
  }

  async function shown(m) {
    // My lines: what I typed; theirs: the translation when 받은 말 자동 번역 is on (translated once, kept).
    const callId = m.callId || session?.id;
    if (m.participantKind === "user") {
      const orig = originals.get(m.id) ?? (await keptFor(callId)).mine[m.id];
      return orig && orig !== m.content
        ? { top: showOriginal ? m.content : orig, bottom: showOriginal ? orig : m.content }
        : { top: m.content, bottom: "" };
    }
    if (meta().autoTranslate !== true) return { top: m.content, bottom: "" };
    try {
      const key = `${m.id}|${m.content}`;
      if (!trCache.has(key)) {
        const saved = (await keptFor(callId)).lines[m.id];
        if (saved?.source === m.content) trCache.set(key, saved.text);
        else {
          trCache.set(key, await translate(m.content, "output", meta(), ctx.chatId));
          keep(callId, { lines: { [m.id]: { source: m.content, text: trCache.get(key) } } });
        }
      }
      const tr = trCache.get(key);
      return showOriginal ? { top: m.content, bottom: tr } : { top: tr, bottom: m.content };
    } catch {
      return { top: m.content, bottom: "" };
    }
  }

  // force: even while muted (a tap on 다시 듣기). fresh: make the clip again (다시 만들기) instead of the kept one.
  // A character's spoken line, or any line of mine (in the persona's voice, from the call record).
  const voiced = (m) => (m.participantKind === "character" ? m.kind === "speech" : m.participantKind === "user");
  async function speakTurns(list, force = false, fresh = false) {
    const items = list
      .filter((m) => voiced(m) && m.content)
      .map((m) => {
        const mine = m.participantKind === "user";
        const voice = pickVoice(ctx.ttsConfig, mine ? persona?.id : m.characterId);
        const tone = m.extra?.turn?.tone || undefined;
        const speaker = mine ? persona?.name : ctx.index.get(m.characterId)?.name;
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

  // What the characters did besides talking (the package's call commands): [end_call] hangs up for everyone once
  // their last words have played; [leave_call] means only that character left. The package saves the command and
  // leaves ending the call to the screen, like its own call surface does.
  const END_CALL = /\[(end_call|end|hang_?up)\b/i;
  const LEAVE_CALL = /\[leave_call\b/i;
  let notice = "";
  async function afterTurns(res) {
    await speakTurns(res?.assistantMessages || []);
    const commands = (res?.turns || []).filter((t) => t?.mode === "command");
    for (const t of commands.filter((c) => LEAVE_CALL.test(c.content || c.command || ""))) {
      if (t.characterId && session) await leave(t.characterId);
      const left =
        (notice = `${subject(ctx.index.get(t.characterId)?.name || t.speakerName || "상대")} 통화에서 나갔어요`);
      draw(true);
      setTimeout(() => notice === left && ((notice = ""), draw()), 4000);
    }
    // The last one on the line left: the call is over.
    const leaver = commands.find((c) => LEAVE_CALL.test(c.content || c.command || ""));
    const ender =
      commands.find((c) => END_CALL.test(c.content || c.command || "")) ||
      (leaver && session && !inCall().length ? leaver : null);
    if (!ender || !session) return;
    // Nobody is answering any more: the waiting line goes, the last words stay as the caption.
    phase = null;
    pendingText = "";
    notice = `${subject(ctx.index.get(ender.characterId)?.name || ender.speakerName || "상대")} 전화를 끊었어요`;
    draw();
    // Long enough to read who hung up (and the last caption) before the screen closes.
    await new Promise((r) => setTimeout(r, 1800));
    if (session) await end(true, ender.characterId || "character");
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
      if (res?.userMessage) {
        originals.set(res.userMessage.id, text.trim());
        if (content !== text.trim()) keep(session?.id, { mine: { [res.userMessage.id]: text.trim() } });
      }
      if (res?.session) session = res.session;
      await refresh();
      await afterTurns(res);
      lastActivity = Date.now();
      if (session && session.status !== "active") end(false);
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
        await afterTurns(body);
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
  // Nobody answered: the package's decline, marked as missed by the Convo (부재중 전화, not 거절한 전화).
  const missed = new Set(); // (the package's decline writes a note each time: once per call)
  async function miss(s) {
    if (missed.has(s.id)) return;
    missed.add(s.id);
    try {
      await api.post(`${BASE}/${encodeURIComponent(s.id)}/decline`);
    } catch {
      missed.delete(s.id);
      return;
    }
    if (session?.id === s.id) close();
    ctx.onEnded?.({ callId: s.id, missed: true });
  }
  // by: who hung up — "user" (the hang-up button), a character id ([end_call]), or null (ended elsewhere).
  async function end(ask = true, by = ask ? "user" : null) {
    if (!session) return;
    const callId = session.id;
    tts.stop();
    if (ask) {
      try {
        await api.post(`${BASE}/${encodeURIComponent(callId)}/end`);
      } catch (error) {
        toast(error.message);
      }
    }
    close();
    await restoreLeft();
    ctx.onEnded?.({ callId, by });
  }
  function close() {
    clearInterval(timer);
    clearTimeout(ringTimer);
    if (rec) {
      rec.discard = true;
      rec.recorder.stop();
    }
    session = null;
    messages = [];
    notice = "";
    layer.hidden = true;
    pill.hidden = true;
  }

  /** The whole call as lines: the call screen's ⋯ and the call card in the Convo. ev: the ended-call event, if any. */
  async function logSheet(id = session?.id, ev = null) {
    if (!id) return;
    let rows = [];
    try {
      [rows] = await Promise.all([
        api.get(`${BASE}/${encodeURIComponent(id)}/messages`).then((r) => r.filter(visible)),
        loadPersona(),
      ]);
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
                voiced(m) && ctx.ttsConfig
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
  const pplEl = h("div", { class: "cx-ppl", role: "group", "aria-label": "통화 중인 사람", hidden: true });
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
    h("div", { class: "cx-who" }, faceEl, h("div", { class: "cx-whotext" }, nameEl, timeEl), pplEl),
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
    timeEl.textContent = notice
      ? notice
      : ringing
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
    const people = peopleRow();
    pplEl.hidden = !people;
    if (people) setChildren(pplEl, people);
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
                  h("small", { class: "cx-who2" }, speakerName({ participantKind: "user" })),
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
    restoreLeft,
    get session() {
      return session;
    },
    dispose() {
      clearInterval(timer);
      clearTimeout(ringTimer);
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
    ringSec: [20, 30, 60].includes(p.callRingSec) ? p.callRingSec : 30,
  };
}
export function setCallPrefs(patch) {
  setPrefs({
    ...(patch.log !== undefined ? { callLog: patch.log } : {}),
    ...(patch.subMode !== undefined ? { callSubMode: patch.subMode } : {}),
    ...(patch.subSize !== undefined ? { callSubSize: patch.subSize } : {}),
    ...(patch.ringSec !== undefined ? { callRingSec: patch.ringSec } : {}),
  });
}
