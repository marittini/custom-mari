import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "marinara-translation-voice-markup-"));
process.env.DATA_DIR = dataDir;
process.env.FILE_STORAGE_DIR = join(dataDir, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "true";
process.env.LOG_LEVEL = "silent";
process.env.PROVIDER_LOCAL_URLS_ENABLED = "true";

const requireServer = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const Fastify = requireServer("fastify") as typeof import("fastify").default;
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { translateRoutes } = await import("../../packages/server/src/routes/translate.routes.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const { createConnectionsStorage } = await import("../../packages/server/src/services/storage/connections.storage.js");
const { translateGeneratedMessage } = await import("../../packages/server/src/services/translation.service.js");
const { getChatTranslationConfig } = await import("../../packages/shared/src/index.js");

const SOURCE = [
  "Narration: The room is dim.",
  '<audio_character id="char-aya">"[whispers] Hello there."</audio_character>',
  '<audio_persona id="persona-mari">"[sighs] I see you."</audio_persona>',
  '<audio_character id="char-ren">"[angry] Leave now."</audio_character>',
  '<audio_character id="char-aya">"[laughs] Glad you\'re here."</audio_character>',
].join("\n");
const TRANSLATED = [
  "서술: 방은 어둡다.",
  '<audio_character id="char-aya">"[whispers] 안녕."</audio_character>',
  '<audio_persona id="persona-mari">"[sighs] 널 봤어."</audio_persona>',
  '<audio_character id="char-ren">"[angry] 지금 떠나."</audio_character>',
  '<audio_character id="char-aya">"[laughs] 와줘서 기뻐."</audio_character>',
].join("\n");
const MARKER_RE = /ZXMV[0-9A-F]{8}_\d+XZ/gi;
let providerBehavior: "normal" | "drop" | "duplicate" | "reorder" = "normal";
const requests: Array<{ input: string; markers: string[] }> = [];
const provider = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const user = body.messages.findLast((message: { role: string }) => message.role === "user");
  const input =
    String(user?.content ?? "")
      .split("\n\n")
      .at(-1) ?? "";
  const markers = input.match(MARKER_RE) ?? [];
  requests.push({ input, markers });
  let translated = input
    .replace(/<\/?audio_(?:character|persona)\b[^>]*>/gi, "")
    .replace(/\[(?:whispers|sighs|angry|laughs)\]\s*/gi, "")
    .replace("Narration: The room is dim.", "서술: 방은 어둡다.")
    .replace("Hello there.", "안녕.")
    .replace("I see you.", "널 봤어.")
    .replace("Leave now.", "지금 떠나.")
    .replace("Glad you're here.", "와줘서 기뻐.");
  if (providerBehavior === "drop" && markers.length) translated = translated.replace(markers[0]!, "");
  if (providerBehavior === "duplicate" && markers.length) {
    translated = translated.replace(markers[0]!, `${markers[0]}${markers[0]}`);
  }
  if (providerBehavior === "reorder" && markers.length > 1) {
    let index = 0;
    translated = translated.replace(MARKER_RE, () => `ZXTMP${index++}XZ`);
    translated = translated.replace(
      /ZXTMP(\d+)XZ/g,
      (_match, value: string) => markers[markers.length - 1 - Number(value)]!,
    );
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content: translated }, finish_reason: "stop" }] }));
});

const db = await getDB();
const chats = createChatsStorage(db);
const app = Fastify();
app.decorate("db", db);
await app.register(translateRoutes, { prefix: "/api/translate" });
try {
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  assert(address && typeof address === "object");
  const connection = await createConnectionsStorage(db).create({
    name: "Voice-markup translation fixture",
    provider: "custom",
    model: "fixture-model",
    apiKey: "fixture",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    treatAsLocalEndpoint: true,
  });
  assert(connection);
  const chat = await chats.create({ name: "Voice-markup translation", mode: "roleplay", characterIds: [] });
  const config = getChatTranslationConfig(chat.id, {
    translationProvider: "ai",
    translationConnectionId: connection.id,
    translationOutputTargetLang: "Korean",
    translationOutputPrompt: "Translate the dialogue and narration.",
  });
  const payload = {
    chatId: chat.id,
    text: SOURCE,
    provider: "ai",
    targetLanguage: "Korean",
    connectionId: connection.id,
    systemPrompt: config.outputSystemPrompt,
  };

  const manualStart = requests.length;
  const manual = await app.inject({ method: "POST", url: "/api/translate/", payload });
  assert.equal(manual.statusCode, 200, manual.body);
  assert.equal(requests.length, manualStart + 1, "one provider request for manual translation");
  assert.equal(manual.json().translatedText, TRANSLATED, "manual API restores speaker IDs, cues, and narration");
  assert(requests.at(-1)!.markers.length >= 12, "markup and cue tokens reach the provider");
  assert(requests.at(-1)!.markers.every((marker) => /^ZXMV[0-9A-F]{8}_\d+XZ$/i.test(marker)));

  const savedMessage = await chats.createMessage({ chatId: chat.id, role: "assistant", content: SOURCE });
  const savedSwipeBefore = await chats.getSwipes(savedMessage.id);
  const automaticStart = requests.length;
  await translateGeneratedMessage(db, {
    chatId: chat.id,
    messageId: savedMessage.id,
    swipeIndex: 0,
    mode: "roleplay",
    config,
  });
  assert.equal(requests.length, automaticStart + 1, "one provider request for automatic translation");
  const saved = await chats.getMessage(savedMessage.id);
  const savedExtra = JSON.parse(saved!.extra);
  assert.equal(savedExtra.translation, TRANSLATED);
  assert.equal(savedExtra.translationSource, SOURCE);
  assert.equal(saved!.content, SOURCE, "automatic translation leaves the source message unchanged");
  assert.equal((await chats.getSwipes(savedMessage.id))[0]!.content, savedSwipeBefore[0]!.content);

  const plain = await chats.createMessage({
    chatId: chat.id,
    role: "assistant",
    content: "Narration: The room is dim.",
  });
  const plainStart = requests.length;
  await translateGeneratedMessage(db, {
    chatId: chat.id,
    messageId: plain.id,
    swipeIndex: 0,
    mode: "roleplay",
    config,
  });
  assert.equal(requests.length, plainStart + 1, "one provider request for untagged text");
  assert.equal(JSON.parse((await chats.getMessage(plain.id))!.extra).translation, "서술: 방은 어둡다.");

  for (const behavior of ["drop", "duplicate", "reorder"] as const) {
    providerBehavior = behavior;
    const invalid = await chats.createMessage({ chatId: chat.id, role: "assistant", content: SOURCE });
    const count = requests.length;
    await assert.rejects(
      translateGeneratedMessage(db, {
        chatId: chat.id,
        messageId: invalid.id,
        swipeIndex: 0,
        mode: "roleplay",
        config,
      }),
      { statusCode: 422 },
    );
    assert.equal(requests.length, count + 1, `${behavior}: one provider request`);
    const unchanged = await chats.getMessage(invalid.id);
    assert.equal(unchanged!.content, SOURCE, `${behavior}: source remains unchanged`);
    assert.equal(
      JSON.parse(unchanged!.extra).translation,
      undefined,
      `${behavior}: corrupted translation is not saved`,
    );
  }
  providerBehavior = "normal";
  console.log("translation-voice-markup: manual/automatic speaker markup, cues and corruption controls passed");
} finally {
  await app.close();
  provider.closeAllConnections();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await closeDB();
  rmSync(dataDir, { recursive: true, force: true });
}
