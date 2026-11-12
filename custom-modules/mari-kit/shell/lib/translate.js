// The Engine's per-chat translation, in the shell: the same chat settings and stored fields as the Engine's screens.
//   autoTranslate            the server translates each reply into extra.translation (shown here)
//   translateInput           my message is translated before it is sent
//   showInputTranslateButton a 번역 button beside send translates the draft in place
//   translationDisplayOnly   a translated message shows only the translation

import { api, parseJson } from "./api.js";

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
export async function translate(text, direction, meta, chatId) {
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

/** A message's saved translation, when it is shown and still matches the text on screen (not an older swipe). */
export function savedTranslation(m) {
  const extra = typeof m?.extra === "string" ? parseJson(m.extra, {}) || {} : m?.extra || {};
  const text = typeof extra.translation === "string" ? extra.translation.trim() : "";
  if (!text || extra.translationHidden === true) return "";
  if (typeof extra.translationSource === "string" && extra.translationSource !== m.content) return "";
  return text;
}

/** What a message shows: { main, sub } — the translation in place (display-only) or under the original. */
export function shownText(m, meta, original) {
  const tr = savedTranslation(m);
  if (!tr) return { main: original, sub: "" };
  return meta?.translationDisplayOnly === true ? { main: tr, sub: "" } : { main: original, sub: tr };
}
