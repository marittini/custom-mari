import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerationRunner } from "../../packages/server/src/routes/generate.routes.js";
import { createGenerationEventSink, type GenerationEventSink } from "../../packages/server/src/routes/generate/sse.js";

const dir = mkdtempSync(join(tmpdir(), "marinara-generation-registry-cleanup-"));
process.env.DATA_DIR = dir;
process.env.FILE_STORAGE_DIR = join(dir, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "true";
process.env.LOG_LEVEL = "silent";
process.env.PROVIDER_LOCAL_URLS_ENABLED = "true";
const requireServer = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const Fastify = requireServer("fastify") as typeof import("fastify").default;
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { generateRoutes } = await import("../../packages/server/src/routes/generate.routes.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const { createConnectionsStorage } = await import("../../packages/server/src/services/storage/connections.storage.js");

let holdNextGeneration = false;
let heldProviderResponse: ServerResponse | null = null;
let generationRequestEntered: (() => void) | undefined;
let nextGenerationRequest = new Promise<void>((resolve) => {
  generationRequestEntered = resolve;
});
const provider = createServer(async (request, response) => {
  for await (const _chunk of request) void _chunk;
  if (request.url === "/api/extra/abort") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
    heldProviderResponse?.end(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
    heldProviderResponse = null;
    return;
  }
  if (holdNextGeneration) {
    holdNextGeneration = false;
    heldProviderResponse = response;
    generationRequestEntered?.();
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Reply." }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
  );
});
const db = await getDB();
const app = Fastify();
app.decorate("db", db);
app.decorate("activeGenerations", new Map());
let runner: GenerationRunner | undefined;
await app.register(generateRoutes, {
  prefix: "/api/generate",
  onRunnerReady: (ready) => {
    runner = ready;
  },
});

try {
  await app.ready();
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  assert.ok(address && typeof address === "object");
  const connection = await createConnectionsStorage(db).create({
    name: "Registry cleanup fixture",
    provider: "custom",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "fixture",
    apiKey: "fixture",
  });
  const chat = await createChatsStorage(db).create({
    name: "Registry cleanup fixture",
    mode: "conversation",
    characterIds: [],
    connectionId: connection.id,
    promptPresetId: null,
  });
  assert.ok(chat);
  assert.ok(runner);
  await createChatsStorage(db).patchMetadata(chat.id, { enableAgents: false });

  const activeGenerations = (app as unknown as { activeGenerations: Map<string, { abortController: AbortController }> })
    .activeGenerations;
  const input = { chatId: chat.id };
  const failingSink = (start: () => void): GenerationEventSink => ({
    kind: "generation-event-sink",
    ended: false,
    started: false,
    start,
    emit: () => false,
    header: () => {},
    finish: () => {},
  });

  const existing = { abortController: new AbortController() };
  activeGenerations.set(chat.id, existing);
  let duplicateStatus = 0;
  await runner(
    input,
    createGenerationEventSink({
      onEvent: () => {},
      onFinish: ({ statusCode }) => {
        duplicateStatus = statusCode;
      },
    }),
  );
  assert.equal(duplicateStatus, 409, "A duplicate invocation is rejected before it registers its own record");
  assert.equal(
    activeGenerations.get(chat.id),
    existing,
    "The duplicate invocation must preserve the active run's record",
  );
  activeGenerations.delete(chat.id);

  await assert.rejects(
    runner(
      input,
      failingSink(() => {
        throw new Error("injected SSE setup failure");
      }),
    ),
    /injected SSE setup failure/,
  );
  assert.equal(
    activeGenerations.has(chat.id),
    false,
    "The invocation wrapper releases its own registry entry on setup throw",
  );

  const replacement = { abortController: new AbortController() };
  await assert.rejects(
    runner(
      input,
      failingSink(() => {
        activeGenerations.set(chat.id, replacement);
        throw new Error("injected SSE setup failure after replacement");
      }),
    ),
    /injected SSE setup failure after replacement/,
  );
  assert.equal(
    activeGenerations.get(chat.id),
    replacement,
    "Cleanup for an earlier invocation must preserve a different generation's registry entry",
  );
  activeGenerations.delete(chat.id);

  const status = async () => {
    const response = await app.inject({ method: "GET", url: `/api/generate/status/${chat.id}` });
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as { active: boolean };
  };
  holdNextGeneration = true;
  const generation = app.inject({
    method: "POST",
    url: "/api/generate/",
    payload: { chatId: chat.id, userMessage: "Hold this reply." },
  });
  let providerWaitTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      nextGenerationRequest,
      new Promise<never>((_resolve, reject) => {
        providerWaitTimeout = setTimeout(() => reject(new Error("Fake provider was not reached")), 5000);
      }),
    ]);
  } finally {
    if (providerWaitTimeout) clearTimeout(providerWaitTimeout);
  }
  assert.equal((await status()).active, true, "A pending provider request remains visible in server generation status");
  const aborted = await app.inject({
    method: "POST",
    url: "/api/generate/abort",
    payload: { chatId: chat.id },
  });
  assert.equal(aborted.statusCode, 200, aborted.body);
  assert.equal(aborted.json().aborted, true);
  const stopped = await generation;
  assert.equal(stopped.statusCode, 200, stopped.body);
  assert.equal((await status()).active, false, "Status clears after the aborted generation unwinds");

  nextGenerationRequest = new Promise<void>((resolve) => {
    generationRequestEntered = resolve;
  });
  const followUp = await app.inject({
    method: "POST",
    url: "/api/generate/",
    payload: { chatId: chat.id, userMessage: "Try again." },
  });
  assert.equal(followUp.statusCode, 200, followUp.body);
  assert.ok(!followUp.body.includes('"type":"error"'), followUp.body);
  assert.equal((await status()).active, false, "A follow-up generation can run after abort cleanup");

  console.info("Generation registry cleanup regression passed.");
} finally {
  provider.closeAllConnections();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await app.close();
  await closeDB();
  rmSync(dir, { recursive: true, force: true });
}
