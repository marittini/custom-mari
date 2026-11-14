// The Engine's per-chat translation, in the shell: the same chat settings and stored fields as the Engine's screens.
//   autoTranslate            the server translates each reply into extra.translation (shown here)
//   translateInput           my message is translated before it is sent
//   showInputTranslateButton a 번역 button beside send translates the draft in place
//   translationDisplayOnly   a translated message shows only the translation

import { api, parseJson } from "./api.js";
import { startJob } from "./activity.js";

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
      // The Engine's default: the old single target language, else English.
      String(target || "").trim() || String(meta.translationTargetLang || "").trim() || "en",
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
/** One translation through the room's own settings; the same text is asked once per page. */
// Voice cues ([whispers], [laughs softly]): spoken by the TTS, never shown, so never sent to be translated.
const CUES = /\[[a-z][a-z ,.'-]{0,40}\]\s?/g;

export async function translate(text, direction, meta, chatId, validate) {
  const source = String(text);
  // Keep RP cues with their speaker wrappers: the Engine protects and restores them during translation.
  const body = translationBody(
    /<\/?audio_(?:character|persona)\b/i.test(source) ? source : source.replace(CUES, ""),
    direction,
    meta,
    chatId,
  );
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
  // 번역 중…: shown while the translation is being made (not for one already made).
  const done = startJob(direction === "input" ? "보낼 말 번역 중…" : "번역 중…");
  try {
    const result = await translated.get(key);
    validate?.(result);
    return result;
  } catch (error) {
    translated.delete(key);
    throw error;
  } finally {
    done();
  }
}

const STICKER_TOKEN = /sticker:[a-z0-9_]+:/g;

/** Whether two strings contain the same sticker tokens in the same order, including duplicates. */
export function stickerTokensMatch(source, translated) {
  const sourceTokens = String(source).match(STICKER_TOKEN) || [];
  const translatedTokens = String(translated).match(STICKER_TOKEN) || [];
  return (
    sourceTokens.length === translatedTokens.length &&
    sourceTokens.every((token, index) => token === translatedTokens[index])
  );
}

/** Translate Convo input without letting a translator rewrite a rendered sticker token. */
export async function translateStickerInput(text, meta, chatId) {
  const source = String(text);
  const tokens = source.match(STICKER_TOKEN) || [];
  if (!tokens.length) return translate(source, "input", meta, chatId);
  if (source.replace(STICKER_TOKEN, "").trim() === "") return source;

  return translate(source, "input", meta, chatId, (result) => {
    if (!stickerTokensMatch(source, result)) {
      throw Object.assign(new Error("Translation changed a sticker token."), { code: "STICKER_TRANSLATION_CHANGED" });
    }
  });
}

/** Raw saved translation: retain speaker tags and cues until after speech metadata has been parsed. */
export function savedTranslation(m) {
  const extra = typeof m?.extra === "string" ? parseJson(m.extra, {}) || {} : m?.extra || {};
  const text = typeof extra.translation === "string" ? extra.translation.trim() : "";
  if (!text || extra.translationHidden === true) return "";
  if (typeof extra.translationSource === "string" && extra.translationSource !== m.content) return "";
  return text;
}

// Voice cues are read by the TTS and never shown. The Engine's automatic translation sends a reply as written,
// so a translator may keep, translate ([속삭이며]) or re-bracket ((속삭이며)) them anywhere in a sentence: the
// screen hides every short bracketed piece of a translation, and short parenthesised ones too when the original
// reply had cues. Only what is shown changes; the stored translation stays as the Engine saved it.
const BRACKETED = /[ \t]*(?:\[[^\]\n]{1,40}\]|［[^］\n]{1,40}］|【[^】\n]{1,40}】)/g;
const PARENS = /[ \t]*(?:\([^()\n]{1,20}\)|（[^（）\n]{1,20}）)/g;
const HAS_CUES = /\[[a-z][a-z ,.'-]{0,40}\]/;
export function hideCues(text, original = "", trim = true) {
  let out = String(text).replace(BRACKETED, "");
  if (HAS_CUES.test(String(original))) out = out.replace(PARENS, "");
  out = out
    .replace(/(["“「『])[ \t]+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?…])/g, "$1");
  return trim ? out.trim() : out;
}

/** What a message shows: { main, sub } — the translation in place (display-only) or under the original. */
export function shownText(m, meta, original) {
  const tr = hideCues(savedTranslation(m), m.content);
  if (!tr) return { main: original, sub: "" };
  return meta?.translationDisplayOnly === true ? { main: tr, sub: "" } : { main: original, sub: tr };
}
