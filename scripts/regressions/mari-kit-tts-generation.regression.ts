import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dataDir = mkdtempSync(join(tmpdir(), "marinara-mari-kit-tts-generation-"));
process.env.DATA_DIR = dataDir;
process.env.FILE_STORAGE_DIR = join(dataDir, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "true";
process.env.LOG_LEVEL = "silent";
process.env.PROVIDER_LOCAL_URLS_ENABLED = "true";

const requireServer = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const Fastify = requireServer("fastify") as typeof import("fastify").default;
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { generateRoutes } = await import("../../packages/server/src/routes/generate.routes.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const { createCharactersStorage } = await import("../../packages/server/src/services/storage/characters.storage.js");
const { createConnectionsStorage } = await import("../../packages/server/src/services/storage/connections.storage.js");
const { createPromptsStorage } = await import("../../packages/server/src/services/storage/prompts.storage.js");
const { characterDataSchema } = await import("../../packages/shared/dist/index.js");
const { parseVoiceLines } = await import("../../custom-modules/mari-kit/src/client.js");
const { installPackage } = await import("../../custom-modules/scripts/install.mjs");
const { capabilityModuleRuntime } =
  await import("../../packages/server/src/services/capability-packages/capability-module-runtime.service.js");
const { capabilityPackageManager } =
  await import("../../packages/server/src/services/capability-packages/package-manager.service.js");
const { initializeCapabilityAgentRegistry } =
  await import("../../packages/server/src/services/capability-packages/capability-agent-registry.service.js");

type ProviderBody = { messages: Array<{ role: string; content: unknown }> };
const providerBodies: ProviderBody[] = [];
const REPLY = "The room is quiet.";
const provider = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString()) as ProviderBody;
  providerBodies.push(body);
  const prompt = body.messages
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
    .join("\n");
  const participant = prompt.match(/"kind":"character","id":"([A-Za-z0-9_-]{1,200})"/);
  const reply =
    prompt.includes("<voice_markup>") && participant
      ? `<audio_character id="${participant[1]}">"[low] ${REPLY}"</audio_character>`
      : REPLY;
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: reply } }] })}\n\n`);
  response.end(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
  );
});

const db = await getDB();
const app = Fastify();
app.decorate("db", db);
await app.register(generateRoutes, { prefix: "/api/generate" });
const chats = createChatsStorage(db);
const characters = createCharactersStorage(db);
const { manifest } = await installPackage({ dataDir: dataDir, id: "mari-kit" });
assert.equal(manifest.id, "mari-kit");
await capabilityModuleRuntime.start(app);
await initializeCapabilityAgentRegistry();
assert(capabilityModuleRuntime.runtimeState().live.includes("mari-kit"), "Mari Kit package runtime activated");

try {
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const alice = await characters.create(characterDataSchema.parse({ name: "Aya" }));
  const bob = await characters.create(characterDataSchema.parse({ name: "Ren" }));
  const persona = await characters.createPersona("Mari", "Voice fixture", undefined, { phoneticName: "Mah-ree" });
  assert(alice && bob && persona);

  const settings = await app.inject({
    method: "PATCH",
    url: "/api/mari-kit/settings",
    payload: { features: { tts: true } },
  });
  assert.equal(settings.statusCode, 200, settings.body);
  const status = await app.inject({ method: "GET", url: "/api/mari-kit/status" });
  assert.equal(status.statusCode, 200, status.body);
  assert.equal(status.json().packageId, "mari-kit");
  assert(status.json().implemented.includes("tts"));
  const voice = await app.inject({ method: "PATCH", url: "/api/mari-kit/tts/settings", payload: { rp: true } });
  assert.equal(voice.statusCode, 200, voice.body);

  const connection = await createConnectionsStorage(db).create({
    name: "TTS prompt fixture",
    provider: "custom",
    baseUrl: `${base}/v1`,
    model: "fixture-model",
    apiKey: "fixture",
    maxContext: 32768,
    maxTokensOverride: 256,
  });
  assert(connection);
  const preset = await createPromptsStorage(db).create({
    name: "Mari Kit generation fixture",
    parameters: { maxTokens: 256, maxContext: 32768 },
    wrapFormat: "xml",
  });
  assert(preset);
  const presets = createPromptsStorage(db);
  await presets.createSection({ presetId: preset.id, identifier: "rules", name: "Rules", content: "Follow rules." });
  await presets.createSection({
    presetId: preset.id,
    identifier: "history",
    name: "Chat History",
    isMarker: true,
    markerConfig: { type: "chat_history" },
  });

  const makeChat = async (name: string, withPreset: boolean) => {
    const chat = await chats.create({
      name,
      mode: "roleplay",
      characterIds: [alice.id, bob.id],
      personaId: persona.id,
      connectionId: connection.id,
      ...(withPreset ? { promptPresetId: preset.id } : {}),
    });
    assert(chat);
    await chats.patchMetadata(chat.id, {
      enableAgents: true,
      activeAgentIds: ["mari-kit"],
      enableTools: false,
      crossChatAwareness: false,
    });
    await chats.createMessage({ chatId: chat.id, role: "user", content: "I enter the room." });
    return chat;
  };

  const run = async (label: string, chatId: string, expectsGuidance: boolean) => {
    providerBodies.length = 0;
    const response = await app.inject({
      method: "POST",
      url: "/api/generate/",
      payload: { chatId, streaming: true },
    });
    assert.equal(response.statusCode, 200, `${label}: ${response.body}`);
    assert(!response.body.includes('"type":"error"'), `${label}: ${response.body}`);
    assert.equal(providerBodies.length, 1, `${label}: one provider request per turn`);
    const body = providerBodies[0]!;
    const sent = body.messages.map((message) => `${message.role}: ${String(message.content)}`).join("\n");
    if (expectsGuidance) {
      assert(sent.includes("<voice_markup>"), `${label}: provider request includes Mari Kit voice guidance`);
      for (const id of [alice.id, bob.id, persona.id]) assert(sent.includes(`"id":"${id}"`), `${label}: ${id}`);
    } else {
      assert(!sent.includes("<voice_markup>"), `${label}: global TTS-off control omits voice guidance`);
    }
    const saved = await chats.listMessages(chatId);
    const expectedReply = expectsGuidance
      ? `<audio_character id="${alice.id}">"[low] ${REPLY}"</audio_character>`
      : REPLY;
    assert.equal(saved.at(-1)?.content, expectedReply, `${label}: provider response is saved unchanged`);
    if (expectsGuidance) {
      assert.deepEqual(
        parseVoiceLines(saved.at(-1)?.content),
        [{ kind: "character", id: alice.id, cue: "low", text: REPLY }],
        `${label}: stored speaker ID survives voice-line parsing`,
      );
    }
  };

  const noPreset = await makeChat("Mari Kit TTS without prompt preset", false);
  await run("no preset, TTS on", noPreset.id, true);
  const withPreset = await makeChat("Mari Kit TTS with prompt preset", true);
  await run("preset, TTS on", withPreset.id, true);

  const memoryOn = await app.inject({
    method: "PATCH",
    url: "/api/mari-kit/settings",
    payload: { features: { tts: true, memory: true } },
  });
  assert.equal(memoryOn.statusCode, 200, memoryOn.body);
  const snapshotName = readdirSync(join(dataDir, "capability-runtime-snapshots")).find((name) =>
    name.startsWith("mari-kit-"),
  );
  assert(snapshotName, "loader created Mari Kit's verified runtime snapshot");
  const { memoryFeature } = await import(
    pathToFileURL(join(dataDir, "capability-runtime-snapshots", snapshotName, "memory.server.mjs")).href
  );
  const originalMemoryPromptContext = memoryFeature.promptContext;
  let delayedMemoryReads = 0;
  memoryFeature.promptContext = async (request, context) => {
    const { runtime } = context;
    const documents = runtime.persistence.documents;
    const delayedDocuments = {
      ...documents,
      getById: async (packageId, id) => {
        const document = await documents.getById(packageId, id);
        if (packageId === "mari-kit" && id === `mari-kit:memory:${request.chatId}`) {
          delayedMemoryReads += 1;
          await new Promise((resolve) => setTimeout(resolve, 2200));
        }
        return document;
      },
    };
    return originalMemoryPromptContext(request, {
      ...context,
      runtime: { ...runtime, persistence: { ...runtime.persistence, documents: delayedDocuments } },
    });
  };
  try {
    const slowMemory = await makeChat("Mari Kit slow Memory prompt context", false);
    await run("TTS should survive delayed Memory document", slowMemory.id, true);
    assert.equal(delayedMemoryReads, 1, "the real Memory hook read its real host document before being delayed");
  } finally {
    memoryFeature.promptContext = originalMemoryPromptContext;
  }

  const globalOff = await app.inject({
    method: "PATCH",
    url: "/api/mari-kit/settings",
    payload: { features: { tts: false } },
  });
  assert.equal(globalOff.statusCode, 200, globalOff.body);
  const rpStillOn = await app.inject({
    method: "PATCH",
    url: "/api/mari-kit/tts/settings",
    payload: { rp: true },
  });
  assert.equal(rpStillOn.statusCode, 200, rpStillOn.body);
  const offControl = await makeChat("Mari Kit TTS global-off control", false);
  await run("global TTS off with RP preference on", offControl.id, false);

  console.log("mari-kit-tts-generation: provider prompt, participant IDs, package timeout and TTS gate passed");
} finally {
  await capabilityModuleRuntime.stop();
  await app.close();
  await new Promise<void>((resolve, reject) => provider.close((error) => (error ? reject(error) : resolve())));
  await closeDB();
  rmSync(dataDir, { recursive: true, force: true });
}
