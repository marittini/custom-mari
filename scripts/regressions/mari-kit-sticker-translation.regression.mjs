import assert from "node:assert/strict";
import { stickerTokensMatch, translateStickerInput } from "../../custom-modules/mari-kit/shell/lib/translate.js";

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const responses = [];
const requests = [];
globalThis.document = { querySelector: () => null };
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/translate");
  const body = JSON.parse(options.body);
  requests.push(body);
  const translatedText = responses.shift();
  return Response.json({ translatedText });
};

const meta = { translationProvider: "google", translationInputTargetLang: "en" };
try {
  const beforeStickerOnly = requests.length;
  assert.equal(
    await translateStickerInput("sticker:wave:\n sticker:ok_2: ", meta, "chat-1"),
    "sticker:wave:\n sticker:ok_2: ",
  );
  assert.equal(requests.length, beforeStickerOnly, "sticker-only input bypasses translation");

  responses.push("Hello sticker:wave: and sticker:wave:!");
  assert.equal(
    await translateStickerInput("Hola sticker:wave: y sticker:wave:!", meta, "chat-1"),
    "Hello sticker:wave: and sticker:wave:!",
  );
  assert.equal(requests.length, 1, "mixed input makes one translation request");

  for (const [input, output, label] of [
    ["a sticker:keep: b", "a sticker:changed: b", "altered"],
    ["a sticker:missing: b", "a b", "removed"],
    ["sticker:first: then sticker:second:", "sticker:second: then sticker:first:", "reordered"],
    ["c sticker:keep: d", "c sticker:keep: sticker:added: d", "added"],
  ]) {
    responses.push(output);
    await assert.rejects(translateStickerInput(input, meta, "chat-1"), (error) => {
      assert.equal(error.code, "STICKER_TRANSLATION_CHANGED", `${label} token change has a stable error code`);
      return true;
    });
  }

  const retryInput = "Retry this sticker:stable: please";
  responses.push("Retry this sticker:changed: please");
  await assert.rejects(translateStickerInput(retryInput, meta, "chat-1"), (error) => {
    assert.equal(error.code, "STICKER_TRANSLATION_CHANGED");
    return true;
  });
  responses.push("Retry this sticker:stable: please, translated");
  assert.equal(
    await translateStickerInput(retryInput, meta, "chat-1"),
    "Retry this sticker:stable: please, translated",
    "a rejected translation is evicted so the same draft can retry",
  );

  responses.push("Ordinary translated text");
  assert.equal(await translateStickerInput("Plain source text", meta, "chat-1"), "Ordinary translated text");
  assert.equal(requests.length, 8, "each mixed or ordinary translation and retry uses one request");
  assert.equal(stickerTokensMatch("sticker:a: sticker:a:", "sticker:a: sticker:a:"), true);
  assert.equal(stickerTokensMatch("sticker:a: sticker:b:", "sticker:b: sticker:a:"), false);
  console.log("Mari Kit sticker translation: bypass, exact token preservation and ordinary translation passed");
} finally {
  globalThis.fetch = originalFetch;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}
