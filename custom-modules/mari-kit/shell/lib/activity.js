// What is happening right now, shown in one strip above the composer (RP and Convo): a reply being written,
// a translation, memory being organized, a voice clip being made or played — each with its stop button.
// Jobs come from anywhere (startJob); voice state comes from lib/tts.js. Screens without a strip get a toast.

import { h, setChildren } from "./h.js";
import { busyNote } from "./ui.js";
import * as tts from "./tts.js";

const jobs = new Map(); // id -> { label, stop?: { label, fn } }
const strips = new Set();
let next = 0;
const redraw = () => strips.forEach((fn) => fn());

/** Shows `label` (with an optional stop button { label, fn }) until the returned function is called. */
export function startJob(label, stop = null) {
  if (!strips.size) return busyNote(label);
  const id = ++next;
  jobs.set(id, { label, stop });
  redraw();
  return () => {
    jobs.delete(id);
    redraw();
  };
}

export function activityStrip() {
  const el = h("div", { class: "act", role: "status", "aria-live": "polite", hidden: true });
  const draw = () => {
    const rows = [...jobs.values()];
    const voice = tts.ttsState();
    if (voice.phase)
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
  strips.add(draw);
  const off = tts.onTts(draw);
  draw();
  return {
    el,
    dispose() {
      strips.delete(draw);
      off();
    },
  };
}
