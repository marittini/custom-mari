import assert from "node:assert/strict";
import {
  loadStickers,
  resolveStickers,
  stickerContent,
  withoutStickerTokens,
} from "../../custom-modules/mari-kit/shell/lib/stickers.js";

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
globalThis.document = {
  documentElement: { lang: "ko" },
  createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  createElement: (tag) => ({
    tagName: tag.toUpperCase(),
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  }),
};

const global = { id: "g1", name: "wave", url: "/api/custom-stickers/file/global.gif" };
const persona = { customKind: "sticker", customName: "wave", url: "/api/avatars/file/persona.webp" };
const character = { customKind: "sticker", customName: "wave", url: "/api/avatars/file/character.png" };
const onlyPersona = { ...persona, customName: "persona_only" };
try {
  const personaSet = resolveStickers([global], [persona]);
  assert.equal(personaSet.map.get("wave"), persona.url, "persona gallery overrides global names");
  const set = resolveStickers([global], [persona], [{ name: "Aya", images: [character] }]);
  assert.equal(set.map.get("wave"), character.url, "character gallery wins the same collision as the native UI");
  assert.equal(set.list[0].source, "Aya");
  assert.equal(set.list[0].editable, false, "gallery sources cannot be edited as global stickers");
  assert.equal(set.globals[0].id, global.id, "a shadowed global remains available for library management");
  assert.equal(
    resolveStickers([], [], [{ images: [persona] }, { images: [character] }]).map.get("wave"),
    character.url,
    "later cast members preserve native precedence",
  );

  const out = stickerContent("Hi sticker:wave: sticker:missing: <script>alert(1)</script> sticker:wave:", set.map);
  const images = out.filter((node) => node.tagName === "IMG");
  assert.equal(images.length, 2, "the Engine token has no leading colon and may repeat");
  assert.equal(images[0].attrs.src, character.url);
  assert.equal(images[0].attrs.alt, "sticker:wave:");
  assert.equal(images[0].attrs.loading, "lazy");
  const text = out
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent)
    .join("");
  assert.ok(text.includes("sticker:missing:"), "unknown or deleted stickers stay legible");
  assert.ok(text.includes("<script>alert(1)</script>"), "message markup stays literal text");
  assert.equal(withoutStickerTokens("sticker:wave:"), "", "a sticker-only message has no spoken identifier");
  assert.equal(
    withoutStickerTokens("[happy] Hi! sticker:wave:"),
    "[happy] Hi!",
    "speech keeps dialogue and delivery cues",
  );
  for (const url of ["https://example.com/tracker.png", "//example.com/x.png", "javascript:alert(1)", "/api/../x.png"])
    assert.equal(
      stickerContent("sticker:wave:", new Map([["wave", url]])).some((node) => node.tagName === "IMG"),
      false,
    );

  const requests = [];
  let failGallery = false;
  let failGlobals = false;
  globalThis.fetch = async (url, options) => {
    requests.push(url);
    assert.equal(options.method, "GET");
    if (url === "/api/custom-stickers")
      return Response.json(failGlobals ? { error: "unavailable" } : [global], { status: failGlobals ? 503 : 200 });
    if (url === "/api/characters/personas/p1/gallery") return Response.json([persona, onlyPersona]);
    if (url === "/api/characters/c%2F1/gallery")
      return Response.json(failGallery ? { error: "not found" } : [character], { status: failGallery ? 404 : 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  const chat = { personaId: "p1", characterIds: ["c/1", "c/1"] };
  const loaded = await loadStickers(chat, new Map([["c/1", { name: "Aya" }]]));
  assert.equal(loaded.map.get("persona_only"), onlyPersona.url, "the persona request uses its own array slot");
  assert.equal(loaded.map.get("wave"), character.url);
  assert.equal(
    requests.filter((path) => path.includes("c%2F1")).length,
    1,
    "duplicate cast IDs do not duplicate reads",
  );
  failGallery = true;
  assert.equal((await loadStickers(chat)).map.get("wave"), persona.url, "unavailable gallery preserves other sources");
  failGlobals = true;
  await assert.rejects(loadStickers(chat), /unavailable/, "global read errors remain visible to the picker");
  console.log("Mari stickers: native precedence, rendering, safe URLs and source loading passed");
} finally {
  globalThis.fetch = originalFetch;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}
