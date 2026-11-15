// Convo reactions and replies, in the Engine's own data (packages/shared/src/types/chat.ts MessageReaction,
// messageReplySchema; client lib/reactions.ts): one entry per emoji with who reacted ("user" for the user, character
// ids for characters), saved whole with PATCH …/extra { reactions }; a reply is { messageId, name, content } sent as
// the generate request's replyTo. Pure, so custom-modules/tests can check it.

export const USER = "user";
/** The quick row above a tapped bubble (the Engine opens its full picker; this is the shortcut). */
export const QUICK = ["❤️", "😂", "😮", "😢", "👍", "🔥"];
/** The ＋ sheet. */
export const MORE =
  "😀 😆 🤣 🥹 😊 😍 🥰 😘 😎 🤔 🫠 😳 🥺 😭 😤 😡 😱 🤯 😴 🙄 😏 🤭 🫣 🤗 👏 🙌 🙏 💪 👀 🤝 ✌️ 👌 💯 ✨ 🎉 💀 💖 💔 💕 🌙 ☀️ 🌧️ 🍀 🍰 ☕ 🎵 📸 🫶".split(
    " ",
  );

const parse = (extra) => {
  if (typeof extra !== "string") return extra || {};
  try {
    return JSON.parse(extra) || {};
  } catch {
    return {};
  }
};

/** The message's reactions, cleaned: [{ emoji, by: [...], imageUrl?, segment?, segmentSpeaker? }]. */
export function reactionsOf(message) {
  const list = parse(message?.extra).reactions;
  return Array.isArray(list)
    ? list.filter((r) => r && typeof r.emoji === "string" && r.emoji && Array.isArray(r.by) && r.by.length)
    : [];
}

const same = (r, emoji) => r.emoji === emoji && (r.segment ?? null) === null;

/** The Engine's toggleReaction for the user on the whole message: add, or take back. */
export function toggleReaction(list, emoji, imageUrl = null, reactor = USER) {
  const next = list.map((r) => ({ ...r, by: [...r.by] }));
  const hit = next.find((r) => same(r, emoji));
  if (!hit) {
    next.push({ emoji, by: [reactor], ...(imageUrl ? { imageUrl } : {}) });
    return next;
  }
  if (hit.by.includes(reactor)) hit.by = hit.by.filter((x) => x !== reactor);
  else hit.by.push(reactor);
  if (!hit.imageUrl && imageUrl) hit.imageUrl = imageUrl;
  return next.filter((r) => r.by.length);
}

/** The list without one reactor on that emoji (the whole emoji goes when nobody is left). */
export function removeReactor(list, emoji, reactor) {
  return list
    .map((r) => (same(r, emoji) ? { ...r, by: r.by.filter((x) => x !== reactor) } : { ...r, by: [...r.by] }))
    .filter((r) => r.by.length);
}

/** A reply snapshot for the generate request (the Engine's messageReplySchema limits). */
export function replyFor(message, name, content) {
  const text = String(content || "").trim();
  if (!message?.id || !text || String(message.id).startsWith("__")) return null;
  return { messageId: String(message.id), name: String(name || "누군가").slice(0, 200), content: text.slice(0, 16000) };
}

/** A user message's reply quote, when it has a valid one. */
export function replyOf(message) {
  const r = parse(message?.extra).replyTo;
  return r &&
    typeof r.messageId === "string" &&
    typeof r.name === "string" &&
    typeof r.content === "string" &&
    r.content
    ? r
    : null;
}

/** "하루, 나" — who reacted, for the label. */
export function reactorNames(r, nameOf) {
  return r.by.map((id) => (id === USER ? "나" : nameOf(id) || "누군가")).join(", ");
}
