import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  translationFeature,
  composePrompt,
  composeRoom,
  normalizeRoom,
  INHERIT_PRESET_ID,
  FIT_LIMIT,
  TAG_RULE,
} from "../mari-kit/src/translation.server.mjs";

const app = {
  handlers: new Map(),
  get(path, handler) {
    this.handlers.set(`GET ${path}`, handler);
  },
  post(path, handler) {
    this.handlers.set(`POST ${path}`, handler);
  },
  put(path, handler) {
    this.handlers.set(`PUT ${path}`, handler);
  },
};
let chat = {
  id: "chat-1",
  connectionId: "chat-connection",
  characterIds: ["char-1"],
  personaId: "persona-1",
  metadata: {
    translationProvider: "ai",
    translationInputPrompt: "original input prompt",
    translationOutputPrompt: "original output prompt",
    translationTargetLang: "en",
    translationInputTargetLang: "ja",
  },
};
const docs = new Map();
let documentWrites = 0;
let metadataWrites = 0;
let modelCalls = 0;
let failNextMetadataPatch = false;
let modelContent = '{"glossary":[{"original":"Aster","translation":"アスター"}]}';
let activeReply = null;
let closeReplyDuringModelCall = false;
let lastModelSignal = null;
let lastModelMessages = null;
const runtime = {
  persistence: {
    getChat: async () => chat,
    patchChatMetadata: async (_id, patch) => {
      if (failNextMetadataPatch) {
        failNextMetadataPatch = false;
        throw new Error("metadata write failed");
      }
      chat = { ...chat, metadata: { ...chat.metadata, ...patch } };
      metadataWrites += 1;
    },
    listMessages: async () => [{ role: "user", content: "Aster said hello" }],
    documents: {
      getById: async (_packageId, id) => docs.get(id) ?? null,
      create: async (doc) => {
        if (docs.has(doc.id)) throw new Error("duplicate");
        docs.set(doc.id, { ...doc, revision: 1 });
        documentWrites += 1;
      },
      update: async ({ id, expectedRevision, ...update }) => {
        const current = docs.get(id);
        if (!current || current.revision !== expectedRevision) return false;
        docs.set(id, { ...current, ...update, revision: current.revision + 1 });
        documentWrites += 1;
        return true;
      },
    },
  },
  resources: {
    listCharacters: async () => [{ id: "char-1", data: { name: "Aster", description: "A pilot." } }],
    listPersonas: async () => [{ id: "persona-1", data: { name: "Reader", description: "A visitor." } }],
    listLorebooks: async () => [],
  },
  languageModels: {
    resolve: async () => ({
      name: "FakeModel",
      chatComplete: async (_messages, options) => {
        modelCalls += 1;
        lastModelMessages = _messages;
        lastModelSignal = options.signal;
        if (closeReplyDuringModelCall) activeReply.raw.emit("close");
        return { content: modelContent };
      },
    }),
  },
  json: { parseJsonish: JSON.parse },
  logger: { debugOverride() {}, warn() {} },
  isDebugAgentsEnabled: () => false,
};
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
translationFeature.routes(app, { runtime, httpError });
const call = (method, path, body = {}, requestRaw = null, replyRaw = null) =>
  app.handlers.get(`${method} ${path}`)(
    { params: { chatId: "chat-1" }, body, ...(requestRaw ? { raw: requestRaw } : {}) },
    replyRaw ? { raw: replyRaw } : undefined,
  );

assert.equal(normalizeRoom({ incomingPrompt: "  ", outgoingPrompt: " custom " }).incomingPrompt, null);
assert.equal(normalizeRoom({ incomingPrompt: "  custom  " }).incomingPrompt, "  custom  ");
const custom = composeRoom(
  {
    ...normalizeRoom({
      incomingPrompt: "CUSTOM IN",
      outgoingPrompt: "CUSTOM OUT",
      glossary: [{ source: "Aster", target: "アスター" }],
    }),
  },
  { incoming: "saved in", outgoing: "saved out" },
);
assert.match(custom.incoming.text, /^CUSTOM IN/);
assert.match(custom.outgoing.text, /^CUSTOM OUT/);
assert.match(custom.incoming.text, /Aster → アスター/);
assert.match(custom.outgoing.text, /アスター → Aster/);
assert.equal(custom.incoming.basePrompt, "CUSTOM IN");
assert.throws(
  () => composePrompt({ presetId: INHERIT_PRESET_ID, original: "x".repeat(FIT_LIMIT - 100) }),
  /combined prompt is over the limit/,
  "required tag instructions must fit under the final limit",
);
assert.ok(TAG_RULE.length > 0);

const initialRoom = await call("PUT", "/translation/:chatId", {
  incomingPrompt: "incoming v1",
  outgoingPrompt: "outgoing v1",
});
assert.equal(initialRoom.status.incoming.targetLanguage, "English");
assert.equal(initialRoom.status.outgoing.targetLanguage, "Japanese");
const roomId = "mari-kit:translation:chat-1";
assert.deepEqual(docs.get(roomId).data.originals, {
  incoming: "original output prompt",
  outgoing: "original input prompt",
});

// The user changes only the Engine's response prompt. Reapplying Mari's user-input prompt must not capture
// the still-written response prompt as its own original or replace the saved outgoing original.
chat = { ...chat, metadata: { ...chat.metadata, translationOutputPrompt: "manual response prompt" } };
await call("PUT", "/translation/:chatId", {
  incomingPrompt: "incoming v2",
  outgoingPrompt: "outgoing v1",
});
assert.deepEqual(docs.get(roomId).data.originals, {
  incoming: "manual response prompt",
  outgoing: "original input prompt",
});
failNextMetadataPatch = true;
await assert.rejects(call("POST", "/translation/:chatId/restore"), /metadata write failed/);
assert.equal(docs.get(roomId).data.applied, true, "failed restore keeps its originals available for retry");
assert.equal(docs.get(roomId).data.originals.incoming, "manual response prompt");
await call("POST", "/translation/:chatId/restore");
assert.equal(chat.metadata.translationOutputPrompt, "manual response prompt");
assert.equal(chat.metadata.translationInputPrompt, "original input prompt");

// Legacy shared prompt remains the original for both directions and restore reinstates it.
const { translationInputPrompt, translationOutputPrompt, ...legacyMetadata } = chat.metadata;
chat = { ...chat, metadata: { ...legacyMetadata, translationPrompt: "legacy shared prompt" } };
await call("PUT", "/translation/:chatId", {
  incomingPrompt: "legacy test incoming",
  outgoingPrompt: "legacy test outgoing",
});
assert.deepEqual(docs.get(roomId).data.originals, {
  incoming: "legacy shared prompt",
  outgoing: "legacy shared prompt",
});
await call("POST", "/translation/:chatId/restore");
assert.equal(chat.metadata.translationOutputPrompt, "legacy shared prompt");
assert.equal(chat.metadata.translationInputPrompt, "legacy shared prompt");

// One side with an overlong inherited prompt reports its own error without breaking GET for the other side.
chat = {
  ...chat,
  metadata: {
    ...chat.metadata,
    translationOutputPrompt: "short prompt",
    translationInputPrompt: "x".repeat(FIT_LIMIT + 1),
  },
};
docs.get(roomId).data.outgoingPrompt = null;
const status = await call("GET", "/translation/:chatId");
assert.match(status.status.outgoing.error, /base prompt alone is over the limit/);
assert.equal(status.status.incoming.error, undefined);
chat = { ...chat, metadata: { ...chat.metadata, translationInputPrompt: "legacy shared prompt" } };

const writesBeforePreview = [documentWrites, metadataWrites, modelCalls];
const preview = await call("POST", "/translation/:chatId/preview", {
  incomingPrompt: "preview incoming",
  outgoingPrompt: null,
  side: "incoming",
});
assert.match(preview.incoming.text, /^preview incoming/);
assert.equal(preview.incoming.basePrompt, "preview incoming");
assert.equal(preview.outgoing, undefined);
assert.deepEqual([documentWrites, metadataWrites, modelCalls], writesBeforePreview);

const replyRaw = new EventEmitter();
replyRaw.writableEnded = false;
activeReply = { raw: replyRaw };
closeReplyDuringModelCall = true;
const scan = await call("POST", "/translation/:chatId/scan", { kind: "glossary" }, null, replyRaw);
assert.deepEqual(scan.glossary, [{ source: "Aster", target: "アスター", notes: "" }]);
assert.ok(lastModelSignal instanceof AbortSignal);
assert.equal(lastModelSignal.aborted, true, "a disconnected response aborts the provider call");
assert.equal(replyRaw.listenerCount("close"), 0, "scan removes the close listener when finished");
assert.equal(modelCalls, writesBeforePreview[2] + 1);

closeReplyDuringModelCall = false;
modelContent = "";
const { translationOutputTargetLang, translationTargetLang, ...withoutTargetLanguage } = chat.metadata;
chat = { ...chat, metadata: withoutTargetLanguage };
const world = await call("POST", "/translation/:chatId/scan", { kind: "world" });
assert.deepEqual(world, { kind: "world", connection: "FakeModel", text: "" });
assert.match(lastModelMessages[0].content, /English/);
assert.doesNotMatch(lastModelMessages[0].content, /{{target}}/);
await assert.rejects(call("POST", "/translation/:chatId/scan", { kind: "glossary" }), /The model returned nothing/);
modelContent = "not json";
await assert.rejects(call("POST", "/translation/:chatId/scan", { kind: "speech" }), /did not return JSON/);

// The legacy native panel omits customPrompt fields: switching one preset resets only that side's override.
await call("PUT", "/translation/:chatId", {
  incomingPrompt: "legacy panel incoming override",
  outgoingPrompt: "keep outgoing override",
});
await call("PUT", "/translation/:chatId", { incomingPresetId: "builtin-roleplay" });
assert.equal(docs.get(roomId).data.incomingPrompt, null);
assert.equal(docs.get(roomId).data.outgoingPrompt, "keep outgoing override");

console.log("translation directions: per-side prompts, safe originals, preview and glossary scan contract passed");
