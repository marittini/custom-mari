// Mari Kit must follow Engine's synced streaming preference, while preserving
// saved messages and translating the stored (tagged) source text.
import assert from "node:assert/strict";

const source = '<audio_character id="c1">[low] Hello</audio_character>';
const events = [
  { type: "token", data: "Hello" },
  { type: "token", data: " there" },
  { type: "message_saved", data: { id: "m1", role: "assistant", content: source } },
];
let uiServer = { enableStreaming: true, __updatedAt: 30 };
let localUi = { enableStreaming: false };
let localUpdatedAt = 20;
let uiReads = 0;
const generateBodies = [];
const translations = [];
const savedExtras = [];

globalThis.localStorage = {
  getItem(key) {
    if (key === "marinara-engine-ui") return JSON.stringify({ state: localUi });
    if (key === "marinara-engine-ui-updated-at") return String(localUpdatedAt);
    return null;
  },
};
globalThis.document = { querySelector: () => null };

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input), "http://localhost");
  const body = init.body ? JSON.parse(init.body) : null;
  if (url.pathname === "/api/app-settings/ui") {
    uiReads += 1;
    return Response.json({ value: JSON.stringify(uiServer) });
  }
  if (url.pathname === "/api/generate") {
    generateBodies.push(body);
    const stream = new ReadableStream({
      start(controller) {
        for (const event of events) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  }
  if (url.pathname === "/api/translate") {
    translations.push(body);
    return Response.json({ translatedText: '<audio_character id="c1">[low] 안녕</audio_character>' });
  }
  if (url.pathname.endsWith("/extra") && init.method === "PATCH") {
    savedExtras.push(body);
    return Response.json({ ok: true });
  }
  throw new Error(`Unexpected request: ${init.method || "GET"} ${url.pathname}`);
};

const { streamGenerate, runTool } = await import("../../custom-modules/mari-kit/shell/lib/actions.js");

// A newer server copy wins over the older browser copy; token callbacks are
// shown and saved-message callbacks still run.
let shown = [];
let saved = [];
await streamGenerate({
  chatId: "chat-a",
  body: {},
  onToken: (text) => shown.push(text),
  onSaved: (message) => saved.push(message),
});
assert.equal(generateBodies.at(-1).streaming, true);
assert.deepEqual(shown, ["Hello", "Hello there"]);
assert.equal(saved.length, 1);
assert.equal(uiReads, 1, "read the current setting for this generation");

// A newer local copy wins. No partial token is rendered, but the saved reply
// still reaches the caller and the setting is fetched again for the next turn.
uiServer = { enableStreaming: true, __updatedAt: 10 };
localUi = { enableStreaming: false };
localUpdatedAt = 20;
shown = [];
saved = [];
await streamGenerate({
  chatId: "chat-a",
  body: {},
  onToken: (text) => shown.push(text),
  onSaved: (m) => saved.push(m),
});
assert.equal(generateBodies.at(-1).streaming, false);
assert.deepEqual(shown, []);
assert.equal(saved.length, 1);
assert.equal(uiReads, 2, "force a fresh UI setting read for every generation");

// Manual translation must send the stored voice markup, even when displayText
// has stripped it for the visible message.
const message = { id: "m-original", role: "assistant", content: source, extra: { displayText: "Hello" } };
await runTool("translate", {
  chatId: "chat-a",
  chat: { metadata: "{}" },
  message,
  reload: async () => {},
});
assert.equal(translations.length, 1);
assert.equal(translations[0].text, source);
assert.equal(savedExtras.length, 1);
assert.equal(savedExtras[0].translationSource, source);
assert.equal(savedExtras[0].translation, '<audio_character id="c1">[low] 안녕</audio_character>');

console.log("Mari Kit shell generation regression passed.");
