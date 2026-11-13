// Turns a stored message into paragraphs of text and spoken lines.
// A line is either Mari Kit voice markup (<audio_character id="…">…</audio_…>, written by the main model when
// TTS guidance is on) or, without markup, a quoted passage ("…", “…”, 「…」).

import { h } from "./h.js";

const OPEN = /<audio_(character|persona)\s+id="([A-Za-z0-9_-]{1,200})">/gi;
const QUOTE = /(["“「『])([^"”」』\n]{1,600})(["”」』])/g;

function stripMarkup(text) {
  return text
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** [{ kind: "text"|"line", text, speakerId?, speakerKind?, cue? }] per paragraph, plus the flat line list. */
export function parseMessage(content, fallbackSpeakerId) {
  const source = String(content ?? "").replace(/\r\n/g, "\n");
  const tagged = OPEN.test(source);
  OPEN.lastIndex = 0;
  const segments = [];
  if (tagged) {
    let at = 0;
    for (const m of source.matchAll(OPEN)) {
      if (m.index > at) segments.push({ kind: "text", text: source.slice(at, m.index) });
      const start = m.index + m[0].length;
      const rest = source.slice(start);
      const close = rest.search(new RegExp(`</audio_${m[1]}\\s*>`, "i"));
      const next = rest.search(/<audio_(?:character|persona)\s/i);
      const ends = [close, next].filter((x) => x >= 0);
      const end = ends.length ? Math.min(...ends) : rest.length;
      let body = rest.slice(0, end);
      const cueMatch = /^\s*(["“]?)\s*\[([^\]\n]{1,80})\]\s*/.exec(body);
      const cue = cueMatch ? cueMatch[2].trim() : "";
      if (cueMatch) body = cueMatch[1] + body.slice(cueMatch[0].length);
      segments.push({ kind: "line", text: body, speakerKind: m[1].toLowerCase(), speakerId: m[2], cue });
      const closeLen = close === end ? (rest.slice(close).match(/^<\/audio_[a-z]+\s*>/i)?.[0].length ?? 0) : 0;
      at = start + end + closeLen;
    }
    if (at < source.length) segments.push({ kind: "text", text: source.slice(at) });
  } else {
    let at = 0;
    for (const m of source.matchAll(QUOTE)) {
      if (m.index > at) segments.push({ kind: "text", text: source.slice(at, m.index) });
      segments.push({
        kind: "line",
        text: m[0],
        speakerKind: "character",
        speakerId: fallbackSpeakerId || null,
        cue: "",
      });
      at = m.index + m[0].length;
    }
    if (at < source.length) segments.push({ kind: "text", text: source.slice(at) });
  }
  // Split text segments at blank lines into paragraphs.
  const paragraphs = [[]];
  const lines = [];
  for (const seg of segments) {
    if (seg.kind === "line") {
      seg.index = lines.length;
      const raw = seg.text;
      seg.text = stripCues(raw);
      seg.spoken = stripMarkup(raw)
        .replace(/^["“”「『]+|["“”」』]+$/g, "")
        .trim();
      lines.push(seg);
      paragraphs[paragraphs.length - 1].push(seg);
      continue;
    }
    const pieces = seg.text.split(/\n\s*\n/);
    pieces.forEach((piece, i) => {
      if (i > 0) paragraphs.push([]);
      if (piece) paragraphs[paragraphs.length - 1].push({ kind: "text", text: piece });
    });
  }
  return { paragraphs: paragraphs.filter((p) => p.some((s) => s.kind === "line" || s.text.trim())), lines };
}

// ElevenLabs-style audio tags ([sighs], [short pause]) are read aloud by the TTS but not shown.
const CUE = /\[[a-z][a-z ,.'-]{0,40}\]\s?/g;
export function stripCues(text) {
  return String(text ?? "").replace(CUE, "");
}

/** Inline markdown (*em*, **strong**) and line breaks as DOM nodes; other markup is shown as text. */
const DIALOGUE = /(“[^”\n]+”|"[^"\n]+"|「[^」\n]+」|『[^』\n]+』)/;
const DIALOGUE_ONE = /^(“[^”\n]+”|"[^"\n]+"|「[^」\n]+」|『[^』\n]+』)$/;

export function inline(text) {
  const out = [];
  const clean = String(text).replace(/<\/?[a-z][^>]*>/gi, "");
  const re = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|\n/g;
  // Spoken lines get a span so 보기 설정 › 대사 형광펜 can mark them.
  const plain = (t) => {
    for (const part of t.split(DIALOGUE))
      if (part) out.push(DIALOGUE_ONE.test(part) ? h("span", { class: "dlg" }, part) : part);
  };
  let at = 0;
  for (const m of clean.matchAll(re)) {
    if (m.index > at) plain(clean.slice(at, m.index));
    if (m[0] === "\n") out.push(h("br"));
    else if (m[1] !== undefined) out.push(h("strong", null, m[1]));
    else out.push(h("em", null, m[2]));
    at = m.index + m[0].length;
  }
  if (at < clean.length) plain(clean.slice(at));
  return out;
}

const LATIN = /[A-Za-z0-9]/;
const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Same rule as Mari Kit's TTS: the full phonetic name and, when word counts match, each word on its own. */
export function buildPronunciations(participants) {
  const pairs = new Map();
  const add = (from, to) => {
    const k = from.trim();
    const v = to.trim();
    if (k.length < 2 || !v || k === v || pairs.has(k)) return;
    pairs.set(k, v);
  };
  for (const { name, phoneticName } of participants ?? []) {
    if (typeof name !== "string" || typeof phoneticName !== "string" || !phoneticName.trim()) continue;
    add(name, phoneticName);
    const a = name.trim().split(/\s+/);
    const b = phoneticName.trim().split(/\s+/);
    if (a.length > 1 && a.length === b.length) a.forEach((part, i) => add(part, b[i]));
  }
  return [...pairs].map(([from, to]) => ({ from, to })).sort((x, y) => y.from.length - x.from.length);
}

export function applyPronunciations(text, list) {
  if (!text || !list?.length) return text;
  const pattern = new RegExp(
    list
      .map(
        ({ from }) =>
          `${LATIN.test(from[0]) ? "(?<![A-Za-z0-9])" : ""}${esc(from)}${LATIN.test(from[from.length - 1]) ? "(?![A-Za-z0-9])" : ""}`,
      )
      .join("|"),
    "gu",
  );
  return text.replace(pattern, (found) => list.find((e) => e.from === found)?.to ?? found);
}

export function pickVoice(config, speakerId) {
  const fallback = typeof config?.voice === "string" ? config.voice : "";
  if (config?.voiceMode !== "per-character" || !speakerId) return fallback;
  const own = (config.voiceAssignments || []).find(
    (r) => r?.characterId === speakerId && typeof r.voice === "string" && r.voice.trim(),
  );
  return own ? own.voice.trim() : fallback;
}
