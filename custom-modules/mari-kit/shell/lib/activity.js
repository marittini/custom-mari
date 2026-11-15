// What is happening right now, shown in one strip above the composer (RP and Convo): a reply being written,
// a translation, memory being organized, a voice clip being made or played — each with its stop button.
// Every job belongs to the chat it was started in (the chat in the address then, or `chat` given), so a room
// shows only its own work: memory organizing in room A never shows in room B. Screens without a strip show the
// room's jobs as a small note above the dock while that room's screens are open. Jobs started outside any chat
// (설정, 홈) show everywhere. Voice state comes from lib/tts.js.

import { h, setChildren } from "./h.js";
import * as tts from "./tts.js";

const jobs = new Map(); // id -> { label, stop?: { label, fn }, chat: id | null }
const strips = new Map(); // draw -> chat id
let next = 0;
let voiceChat = null;

/** The chat the address is in (#/convo/<id>, #/rp/<id>, #/memory/<id>/…, #/chat-settings/<id>/…, …), or null. */
export function routeChat(hash = location.hash) {
  const m = /^#\/(convo|rp|memory|chat-settings|weather|char-schedule|call-settings|reader)\/([^/?#]+)/.exec(hash);
  return m ? decodeURIComponent(m[2]) : null;
}
const mine = (job, chat) => job.chat === null || job.chat === chat;

let note = null;
function drawNote() {
  const chat = routeChat();
  const shownInStrip = [...strips.values()].includes(chat);
  const rows = shownInStrip ? [] : [...jobs.values()].filter((j) => mine(j, chat));
  if (!rows.length) {
    note?.remove();
    note = null;
    return;
  }
  const frame = document.querySelector(".app");
  if (!frame) return;
  if (!note || !note.isConnected) {
    note = h("div", { class: "jobnote", role: "status", "aria-live": "polite" });
    frame.append(note);
  }
  const r = rows[rows.length - 1];
  setChildren(
    note,
    h("span", { class: "act-dot", "aria-hidden": "true" }),
    h("span", { class: "act-t" }, rows.length > 1 ? `${r.label} 외 ${rows.length - 1}개` : r.label),
    r.stop ? h("button", { type: "button", class: "act-stop", onClick: () => r.stop.fn() }, r.stop.label) : null,
  );
}
const redraw = () => {
  strips.forEach((_, fn) => fn());
  drawNote();
};
globalThis.addEventListener?.("hashchange", redraw); // (absent when a test imports this outside a browser)

/**
 * Shows `label` (with an optional stop button { label, fn }) until the returned function is called. The job
 * belongs to `chat` (default: the chat in the address now; null for work that is not a chat's).
 */
export function startJob(label, stop = null, { chat = routeChat() } = {}) {
  const id = ++next;
  jobs.set(id, { label, stop, chat: chat ?? null });
  redraw();
  return () => {
    jobs.delete(id);
    redraw();
  };
}

/** The strip for one chat's screen (RP, Convo). */
export function activityStrip(chat = routeChat()) {
  const el = h("div", { class: "act", role: "status", "aria-live": "polite", hidden: true });
  const draw = () => {
    const rows = [...jobs.values()].filter((j) => mine(j, chat));
    const voice = tts.ttsState();
    if (voice.phase && (voiceChat === null || voiceChat === chat))
      rows.push({
        label:
          voice.phase === "loading"
            ? `음성 만드는 중…${voice.label ? ` · ${voice.label}` : ""}`
            : `재생 중${voice.label ? ` · ${voice.label}` : ""}`,
        playing: voice.phase === "playing",
        stop: { label: "멈춤", fn: () => tts.stop() },
      });
    el.hidden = !rows.length;
    setChildren(
      el,
      rows.map((r) =>
        h(
          "div",
          { class: "act-row" },
          h("span", { class: r.playing ? "act-dot play" : "act-dot", "aria-hidden": "true" }),
          h("span", { class: "act-t" }, r.label),
          r.stop ? h("button", { type: "button", class: "act-stop", onClick: () => r.stop.fn() }, r.stop.label) : null,
        ),
      ),
    );
  };
  strips.set(draw, chat);
  const off = tts.onTts(() => {
    // A clip belongs to the room it started in.
    const { phase } = tts.ttsState();
    if (phase && !voiceChat) voiceChat = routeChat();
    if (!phase) voiceChat = null;
    draw();
  });
  draw();
  drawNote();
  return {
    el,
    dispose() {
      strips.delete(draw);
      off();
      drawNote();
    },
  };
}
