import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "marinara-shell-message-prompt-cache-"));
process.env.DATA_DIR = dataDir;
process.env.FILE_STORAGE_DIR = join(dataDir, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "true";
process.env.LOG_LEVEL = "silent";
const requireServer = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const Fastify = requireServer("fastify") as typeof import("fastify").default;
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { chatsRoutes, withoutPromptOnlyExtra } = await import("../../packages/server/src/routes/chats.routes.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");

const db = await getDB();
const app = Fastify();
app.decorate("db", db);
await app.register(chatsRoutes, { prefix: "/api/chats" });

try {
  const chats = createChatsStorage(db);
  const chat = await chats.create({ name: "Shell prompt cache", mode: "roleplay", characterIds: [] });
  assert.ok(chat);
  const cachedPrompt = [{ role: "system", content: "x".repeat(100_000) }];
  const originalExtra = {
    cachedPrompt,
    mariWorkspaceContinuity: "prompt-only continuity",
    translation: "번역 내용",
    translationSource: "source",
    audio: { url: "/audio/example.wav" },
    speaker: "Aya",
    otherFeatureData: { keep: true },
  };
  const saved = await chats.createMessage({
    chatId: chat.id,
    role: "assistant",
    content: "Visible reply.",
    extra: originalExtra,
  });
  assert.ok(saved);

  const read = async (query = "") => {
    const response = await app.inject({
      method: "GET",
      url: `/api/chats/${chat.id}/messages${query}`,
    });
    assert.equal(response.statusCode, 200, response.body);
    return {
      body: response.json() as Array<{ content: string; extra: string }>,
      bytes: Buffer.byteLength(response.payload),
    };
  };
  const sizes: Array<{ route: string; fullBytes: number; compactBytes: number }> = [];
  const assertCompactPair = async (query: string, description: string) => {
    const full = await read(query);
    const compact = await read(`${query}${query ? "&" : "?"}includePromptCache=false`);
    sizes.push({ route: description, fullBytes: full.bytes, compactBytes: compact.bytes });
    const fullExtra = JSON.parse(full.body[0]!.extra) as Record<string, unknown>;
    const compactExtra = JSON.parse(compact.body[0]!.extra) as Record<string, unknown>;
    assert.ok(Array.isArray(fullExtra.cachedPrompt), `${description}: default keeps cachedPrompt`);
    assert.equal(compactExtra.cachedPrompt, undefined, `${description}: compact query omits cachedPrompt`);
    assert.equal(
      fullExtra.mariWorkspaceContinuity,
      undefined,
      "existing continuity filtering remains enabled by default",
    );
    assert.equal(
      compactExtra.mariWorkspaceContinuity,
      undefined,
      "existing continuity filtering remains enabled in compact mode",
    );
    for (const key of ["translation", "translationSource", "audio", "speaker", "otherFeatureData"])
      assert.deepEqual(
        compactExtra[key],
        originalExtra[key as keyof typeof originalExtra],
        `${description}: preserve ${key}`,
      );
    assert.ok(full.bytes - compact.bytes > 95_000, `${description}: significant response bytes are removed`);
  };

  await assertCompactPair("", "unpaginated route");
  await assertCompactPair("?limit=20", "paginated route");

  const [objectExtra, serializedExtra] = withoutPromptOnlyExtra(
    [
      { extra: { cachedPrompt, translation: "keep", mariWorkspaceContinuity: "remove" } },
      { extra: JSON.stringify({ cachedPrompt, speaker: "Aya", mariWorkspaceContinuity: "remove" }) },
    ],
    { includePromptCache: false },
  );
  assert.equal(
    (objectExtra!.extra as Record<string, unknown>).cachedPrompt,
    undefined,
    "object extras omit prompt cache",
  );
  assert.equal((objectExtra!.extra as Record<string, unknown>).translation, "keep");
  assert.equal(
    (serializedExtra!.extra as string).includes('"cachedPrompt"'),
    false,
    "serialized extras omit prompt cache",
  );
  assert.equal((serializedExtra!.extra as string).includes('"speaker":"Aya"'), true);

  const stored = await chats.getMessage(saved.id);
  const storedExtra = JSON.parse(stored!.extra) as Record<string, unknown>;
  assert.deepEqual(
    storedExtra.cachedPrompt,
    cachedPrompt,
    "response projection leaves the stored prompt cache unchanged",
  );
  assert.equal(storedExtra.mariWorkspaceContinuity, originalExtra.mariWorkspaceContinuity);
  assert.equal(storedExtra.translation, originalExtra.translation);
  assert.deepEqual(storedExtra.audio, originalExtra.audio);
  console.info("Shell message prompt-cache regression passed.");
  console.info(JSON.stringify({ uncompressedResponseSizes: sizes }));
} finally {
  await app.close();
  await closeDB();
  rmSync(dataDir, { recursive: true, force: true });
}
