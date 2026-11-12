// Which lorebooks a chat uses, by the Engine's own rule (client/src/lib/chat-lorebooks.ts, 2.5.2): a book counts when
// it is enabled and its scope covers this chat, and it is pinned to the chat (activeLorebookIds), global, tied to one
// of the chat's characters or to its persona, or made for this chat. A pinned book is unpinned; an automatic one is
// switched off for this chat through excludedLorebookIds.

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

export function scopeCovers(scope, chatId) {
  if (!scope || typeof scope !== "object") return true;
  if (scope.mode === "disabled") return false;
  if (scope.mode === "specific") return strings(scope.chatIds).includes(chatId);
  return true;
}

/** [{ book, reasons: ["Chat"|"Global"|"Character"|"Persona"], pinned, excluded }] for the books this chat uses. */
export function lorebookViews(lorebooks, chat, meta) {
  const pinned = new Set(strings(meta.activeLorebookIds));
  const excluded = new Set(strings(meta.excludedLorebookIds));
  const cast = strings(chat.characterIds);
  return (lorebooks || []).flatMap((book) => {
    if (book.enabled === false || !scopeCovers(book.scope, chat.id)) return [];
    const reasons = [];
    if (pinned.has(book.id)) reasons.push("Chat");
    if (book.isGlobal) reasons.push("Global");
    if (
      strings(book.characterIds).some((id) => cast.includes(id)) ||
      (book.characterId && cast.includes(book.characterId))
    )
      reasons.push("Character");
    if (chat.personaId && (strings(book.personaIds).includes(chat.personaId) || book.personaId === chat.personaId))
      reasons.push("Persona");
    if (book.chatId === chat.id && !reasons.includes("Chat")) reasons.push("Chat");
    return reasons.length ? [{ book, reasons, pinned: pinned.has(book.id), excluded: excluded.has(book.id) }] : [];
  });
}

export const REASON_LABEL = { Chat: "이 채팅", Global: "전체", Character: "캐릭터", Persona: "페르소나" };
