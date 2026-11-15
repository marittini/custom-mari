// What the Convo media panel and messages share with the Engine (ConversationInput, use-recent-media,
// custom-emoji-render): recently used picks (the same browser storage key, so the Engine and Mari show the same
// recents), the ":name" completion while typing, and ":name:" tokens shown as the chat's custom emoji or a standard
// emoji. The Engine's emoji lists and search come from vendor/emoji.js (bundled from the Engine at build). Pure apart
// from emojiData() and the storage default, so custom-modules/tests can check it.

export const RECENT_KEY = "marinara-recent-media-v1";
export const RECENT_LIMIT = 8;
const KINDS = ["emoji", "kaomoji", "gif", "sticker"];

/** The Engine's emoji catalog, search, shortcodes and kaomoji (~30KB compressed), read the first time it is needed. */
let vendor = null;
export const emojiData = () =>
  (vendor ||= import("../vendor/emoji.js").catch((e) => ((vendor = null), Promise.reject(e))));

const store = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};
const cleanItem = (row) => {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  if (typeof row.value !== "string" || !row.value.trim() || row.value.length > 4096) return null;
  return {
    value: row.value,
    ...(typeof row.label === "string" && row.label.trim() ? { label: row.label.slice(0, 256) } : {}),
    ...(typeof row.previewUrl === "string" && row.previewUrl.trim() && row.previewUrl.length <= 4096
      ? { previewUrl: row.previewUrl }
      : {}),
  };
};

/** { emoji, kaomoji, gif, sticker }: each the newest first, at most 8 (the Engine's normalizeState). */
export function readRecents(storage = store()) {
  let raw = null;
  try {
    raw = JSON.parse(storage?.getItem(RECENT_KEY) || "null");
  } catch {}
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(
    KINDS.map((k) => [k, Array.isArray(src[k]) ? src[k].map(cleanItem).filter(Boolean).slice(0, RECENT_LIMIT) : []]),
  );
}

/** The Engine's rememberRecentMedia: the pick goes first, an older copy of it drops out. */
export function rememberRecent(kind, item, storage = store()) {
  const row = cleanItem(item);
  if (!row || !KINDS.includes(kind)) return readRecents(storage);
  const now = readRecents(storage);
  const next = { ...now, [kind]: [row, ...now[kind].filter((x) => x.value !== row.value)].slice(0, RECENT_LIMIT) };
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

/** A ":query" being typed at a word start just before the caret (the Engine's rule): { start, query } or null. */
export function shortcodeAt(text, caret) {
  const m = /(?:^|\s):([a-z0-9_]+)$/i.exec(String(text || "").slice(0, caret));
  return m ? { start: caret - m[1].length - 1, query: m[1].toLowerCase() } : null;
}

/**
 * Completions for ":query" (the Engine's order): the chat's custom emojis whose name contains it (those starting
 * with it first), then standard shortcodes not shadowed by a custom name; at most 10.
 * custom: [{ name, url }], standard(query, limit) → [{ name, emoji }].
 */
export function shortcodeChoices(query, custom, standard) {
  const q = String(query || "").toLowerCase();
  const mine = (custom || [])
    .filter((e) => e.name.includes(q))
    .sort((a, b) => Number(b.name.startsWith(q)) - Number(a.name.startsWith(q)))
    .map((e) => ({ kind: "custom", name: e.name, url: e.url }));
  const names = new Set(mine.map((e) => e.name));
  const std = (standard ? standard(q, 10) : [])
    .filter((e) => !names.has(e.name))
    .map((e) => ({ kind: "standard", name: e.name, emoji: e.emoji }));
  return [...mine, ...std].slice(0, 10);
}

/** What a completion puts in the text: the emoji itself, or ":name:" for a custom one, then a space. */
export const completionText = (c) => `${c.kind === "standard" ? c.emoji : `:${c.name}:`} `;

/** `insert` placed over text[start, end): the new text and where the caret goes. */
export function insertAt(text, start, end, insert) {
  const s = String(text || "");
  return { text: s.slice(0, start) + insert + s.slice(end), caret: start + insert.length };
}

/**
 * A message text split around ":name:" tokens (the Engine's renderInlineWithCustomEmojis): a known custom emoji
 * becomes { url, alt }, a standard shortcode { emoji }, anything else stays text. jumbo: the text is only custom
 * emojis and spaces (shown large).
 */
export function emojiParts(text, customMap, resolveStandard = null) {
  const s = String(text ?? "");
  const map = customMap instanceof Map ? customMap : new Map();
  if (!s.includes(":")) return { parts: [{ text: s }], jumbo: false };
  const re = /:([a-z0-9_]+):/gi;
  let known = 0;
  const rest = s.replace(re, (full, name) => (map.has(name) ? ((known += 1), "") : full));
  const jumbo = known > 0 && rest.trim() === "";
  const parts = [];
  let last = 0;
  for (const m of s.matchAll(re)) {
    const url = map.get(m[1]);
    const std = !url && resolveStandard ? resolveStandard(m[1]) : null;
    if (!url && !std) continue;
    if (m.index > last) parts.push({ text: s.slice(last, m.index) });
    parts.push(url ? { url, alt: m[0] } : { emoji: std });
    last = m.index + m[0].length;
  }
  if (last < s.length || !parts.length) parts.push({ text: s.slice(last) });
  return { parts, jumbo };
}

/** True when a text has something that looks like a ":name:" token (worth loading the emoji sources for). */
export const hasEmojiToken = (text) => /:[a-z0-9_]+:/i.test(String(text || ""));
