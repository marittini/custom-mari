import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "../scripts/e2e/playwright.mjs";
import { translationFeature } from "../mari-kit/src/translation.server.mjs";

// This is an integration proof around the real screen and the real package routes. The host runtime and
// model are intentionally small in-memory fixtures; no Engine or provider account is started.
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const shell = resolve(root, "custom-modules/mari-kit/shell");
const serverRequire = createRequire(resolve(root, "packages/server/package.json"));
const Fastify = serverRequire("fastify");
const app = Fastify({ logger: false });
const chatId = "translation-screen-proof";
let chat;
let roomDocument;
let documentWrites = 0;
let metadataWrites = 0;
let modelCalls = 0;
let translateRequests = [];
let delayScan = false;
let releaseScan;
let delayPreview = false;
let previewWaiting = false;
let releasePreview;
let lastPutBody = null;
let modelConnection = "FixtureModel";
let modelContent =
  '{"glossary":[{"original":"Aster","translation":"アスター"},{"original":"Mira","translation":"ミラ"}]}';

const reset = () => {
  chat = {
    id: chatId,
    connectionId: "connection-1",
    characterIds: ["char-1"],
    personaId: "persona-1",
    metadata: {
      translationProvider: "ai",
      translationOutputPrompt: "Saved response prompt",
      translationInputPrompt: "Saved draft prompt",
      translationTargetLang: "en",
      translationInputTargetLang: "ja",
    },
  };
  roomDocument = null;
  documentWrites = 0;
  metadataWrites = 0;
  modelCalls = 0;
  translateRequests = [];
  delayScan = false;
  delayPreview = false;
  previewWaiting = false;
  lastPutBody = null;
  modelConnection = "FixtureModel";
  modelContent =
    '{"glossary":[{"original":"Aster","translation":"アスター"},{"original":"Mira","translation":"ミラ"}]}';
};
reset();

const runtime = {
  persistence: {
    getChat: async (id) => (id === chatId ? chat : null),
    patchChatMetadata: async (_id, patch) => {
      chat = { ...chat, metadata: { ...chat.metadata, ...patch } };
      metadataWrites += 1;
    },
    listMessages: async () => [{ role: "user", content: "Aster waved to Mira." }],
    documents: {
      getById: async (_packageId, id) => (id === `mari-kit:translation:${chatId}` ? roomDocument : null),
      create: async (doc) => {
        if (roomDocument) throw new Error("duplicate fixture document");
        roomDocument = { ...doc, revision: 1 };
        documentWrites += 1;
      },
      update: async ({ id, expectedRevision, ...update }) => {
        if (id !== `mari-kit:translation:${chatId}` || !roomDocument || roomDocument.revision !== expectedRevision)
          return false;
        roomDocument = { ...roomDocument, ...update, revision: roomDocument.revision + 1 };
        documentWrites += 1;
        return true;
      },
    },
  },
  resources: {
    listCharacters: async () => [{ id: "char-1", data: { name: "Aster", description: "Pilot" } }],
    listPersonas: async () => [{ id: "persona-1", data: { name: "Reader" } }],
    listLorebooks: async () => [],
  },
  languageModels: {
    resolve: async () => ({
      name: modelConnection,
      chatComplete: async (_messages, options) => {
        modelCalls += 1;
        if (delayScan)
          await new Promise((resolveWait) => {
            releaseScan = resolveWait;
          });
        if (options.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
        return { content: modelContent };
      },
    }),
  },
  json: { parseJsonish: JSON.parse },
  logger: { debugOverride() {}, warn() {} },
  isDebugAgentsEnabled: () => false,
};
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
app.addHook("preHandler", async (request) => {
  if (request.method === "PUT" && request.url.includes("/mari-kit/translation/")) lastPutBody = request.body;
});
app.addHook("onSend", async (request, _reply, payload) => {
  if (delayPreview && request.url.endsWith("/preview")) {
    previewWaiting = true;
    await new Promise((resolveWait) => {
      releasePreview = resolveWait;
    });
  }
  return payload;
});
await app.register(async (instance) => translationFeature.routes(instance, { runtime, httpError }), {
  prefix: "/api/mari-kit",
});
app.post("/api/translate", async (request) => {
  translateRequests.push(request.body);
  return { translatedText: "fixture translation" };
});
app.get("/__test/state", async () => ({
  chat,
  roomDocument,
  documentWrites,
  metadataWrites,
  modelCalls,
  translateRequests,
  lastPutBody,
  previewWaiting,
}));
app.post("/__test/reset", async () => {
  reset();
  return { ok: true };
});
app.post("/__test/model", async (request) => {
  modelConnection = request.body.connection || "FixtureModel";
  modelContent = request.body.content ?? modelContent;
  return { ok: true };
});
app.post("/__test/provider", async (request) => {
  chat = { ...chat, metadata: { ...chat.metadata, translationProvider: request.body.provider } };
  return { ok: true };
});
app.post("/__test/delay-scan", async () => {
  delayScan = true;
  return { ok: true };
});
app.post("/__test/release-scan", async () => {
  releaseScan?.();
  delayScan = false;
  return { ok: true };
});
app.post("/__test/delay-preview", async () => {
  delayPreview = true;
  previewWaiting = false;
  return { ok: true };
});
app.post("/__test/release-preview", async () => {
  releasePreview?.();
  delayPreview = false;
  return { ok: true };
});
app.get("/", async (_request, reply) =>
  reply.type("text/html").send(`<!doctype html>
<html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/shell/shell.css"></head>
<body class="app mk"><main id="app"></main><script type="module">
import { translationScreen } from "/shell/screens/translation.js";
const mount = document.querySelector("#app");
window.openTranslation = () => { window.screenHandle?.dispose(); mount.replaceChildren(); window.screenHandle = translationScreen({ mount, args: ["${chatId}"], back: () => { window.didBack = true; } }); };
window.closeTranslation = () => { window.screenHandle?.dispose(); window.screenHandle = null; mount.replaceChildren(); };
window.openTranslation();
</script></body></html>`),
);
app.get("/shell/*", async (request, reply) => {
  const rel = request.params["*"];
  const path = resolve(shell, rel);
  if (!path.startsWith(shell + sep)) return reply.code(404).send("not found");
  try {
    const content = await readFile(path);
    if (path.endsWith(".js")) reply.type("text/javascript; charset=utf-8");
    else if (path.endsWith(".css")) reply.type("text/css; charset=utf-8");
    else reply.type("application/octet-stream");
    return reply.send(content);
  } catch {
    return reply.code(404).send("not found");
  }
});

const address = await app.listen({ host: "127.0.0.1", port: 0 });
const launchOptions = { headless: true, args: ["--no-sandbox"] };
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
else {
  try {
    await access("/usr/bin/chromium");
    launchOptions.executablePath = "/usr/bin/chromium";
  } catch {}
}
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({
  viewport: { width: 360, height: 850 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const transfer = { bytes: 0, requests: [], pending: [], capture: true };
page.on("response", async (response) => {
  const url = response.url();
  if (!transfer.capture || !url.startsWith(address) || url.includes("/__test/")) return;
  transfer.pending.push(
    (async () => {
      try {
        const body = await response.body();
        transfer.bytes += body.byteLength;
        transfer.requests.push({ path: new URL(url).pathname, bytes: body.byteLength });
      } catch {}
    })(),
  );
});

async function state() {
  return page.request.get(`${address}/__test/state`).then((res) => res.json());
}
async function resetPage() {
  await page.request.post(`${address}/__test/reset`);
  await page.evaluate(() => window.openTranslation());
  await page.getByText("공통 단어장", { exact: true }).waitFor();
}
async function clickButton(text, exact = true) {
  await page.getByRole("button", { name: text, exact }).click();
}
function areaIn(sectionTitle) {
  return page.locator("section.fld").filter({ hasText: sectionTitle }).locator("textarea").first();
}
function directionSection(title) {
  return page.locator("section.fld").filter({ hasText: title }).first();
}

try {
  await page.goto(address);
  await page.getByText("공통 단어장", { exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
  await Promise.all(transfer.pending);
  transfer.capture = false;

  // Real glossary scan response shape, candidate review, selection and merge into the unsaved draft.
  await (await areaIn("말투 메모 · 받는 답장에 적용")).fill("still-editing-voice-note");
  await directionSection("공통 단어장").getByRole("button", { name: "AI로 찾기" }).click();
  await page.getByText("2개 후보를 찾았어요. 추가할 항목을 고르세요.").waitFor();
  assert.equal(
    await areaIn("말투 메모 · 받는 답장에 적용").inputValue(),
    "still-editing-voice-note",
    "typing an unsaved note survives a concurrent scan",
  );
  assert.equal(await page.locator('input[aria-label="Aster를 추가"]').count(), 1);
  const glossary = areaIn("공통 단어장");
  await glossary.fill("Aster = keep this existing rendering");
  await page.getByRole("button", { name: "선택한 항목 추가" }).click();
  assert.match(await glossary.inputValue(), /Aster = keep this existing rendering/);
  assert.match(await glossary.inputValue(), /Mira = ミラ/);
  assert.equal(
    (await glossary.inputValue()).match(/Aster =/g)?.length,
    1,
    "a candidate cannot duplicate or overwrite a term typed while review was open",
  );
  assert.equal(await page.locator('input[aria-label="Aster를 추가"]').count(), 1);
  assert.equal(
    await page.locator('input[aria-label="Aster를 추가"]').isDisabled(),
    true,
    "existing term remains visible but cannot be added twice",
  );
  const afterScan = await state();
  assert.equal(afterScan.documentWrites, 0, "scan and candidate merge do not write before Apply");
  assert.equal(afterScan.metadataWrites, 0);
  assert.equal(afterScan.modelCalls, 1, "one provider call per scan");

  // Preview and copy-preset are read-only; preset text is loaded into the correct editable direction.
  const incoming = directionSection("받는 답장 · AI → 내 언어");
  const outgoing = directionSection("보내는 글 · 내 언어 → AI 언어");
  await incoming.locator("select").selectOption("builtin-roleplay");
  await incoming.locator("details summary").click();
  await incoming.locator("button").filter({ hasText: "선택한 프리셋 지침 불러오기" }).click();
  await incoming.getByText("선택한 프리셋 지침을 편집 칸에 불러왔어요. 바꾼 뒤 적용하세요.").waitFor();
  const incomingPrompt = await incoming.locator("textarea").first();
  const loadedIncoming = await incomingPrompt.inputValue();
  assert.ok(loadedIncoming.length > 100, "preset base prompt was copied into the incoming editor");
  await incomingPrompt.fill("CUSTOM RESPONSE DIRECTION");
  await incoming.locator("button").filter({ hasText: "실제 적용 지침 미리보기" }).click();
  await incoming.getByText(/CUSTOM RESPONSE DIRECTION/).waitFor();
  let snapshot = await state();
  assert.equal(snapshot.documentWrites, 0);
  assert.equal(snapshot.metadataWrites, 0);
  assert.equal(snapshot.modelCalls, 1, "preview makes no model call");

  // If an in-flight preset request answers after the user edits the same field, it must not replace the edit.
  await page.request.post(`${address}/__test/delay-preview`);
  await incoming.locator("button").filter({ hasText: "선택한 프리셋 지침 불러오기" }).click();
  await page.waitForFunction(async () => (await (await fetch("/__test/state")).json()).previewWaiting);
  await incomingPrompt.fill("CUSTOM RESPONSE DIRECTION EDITED");
  await page.request.post(`${address}/__test/release-preview`);
  await incoming.getByText("입력값이 바뀌어 불러오기를 취소했어요. 다시 눌러 주세요.").waitFor();
  assert.equal(
    await incomingPrompt.inputValue(),
    "CUSTOM RESPONSE DIRECTION EDITED",
    "a stale preset response cannot overwrite a newer edit",
  );
  await incomingPrompt.fill("CUSTOM RESPONSE DIRECTION");

  await outgoing.locator("select").selectOption("builtin-roleplay");
  await outgoing.locator("details summary").click();
  await outgoing.locator("button").filter({ hasText: "선택한 프리셋 지침 불러오기" }).click();
  await outgoing.getByText("선택한 프리셋 지침을 편집 칸에 불러왔어요. 바꾼 뒤 적용하세요.").waitFor();
  const outgoingPrompt = await outgoing.locator("textarea").first();
  await outgoingPrompt.fill("CUSTOM DRAFT DIRECTION");
  await glossary.fill("Aster = アスター\nMira = ミラ");
  await clickButton("적용");
  await page.getByText("이 채팅의 번역 지침에 적용했어요").waitFor();
  snapshot = await state();
  assert.equal(
    snapshot.chat.metadata.translationOutputPrompt.startsWith("CUSTOM RESPONSE DIRECTION"),
    true,
    `incoming prompt mismatch; screen=${JSON.stringify(await incomingPrompt.inputValue())}; PUT=${JSON.stringify(snapshot.lastPutBody)}; metadata=${JSON.stringify(snapshot.chat.metadata)}`,
  );
  assert.equal(
    snapshot.chat.metadata.translationInputPrompt.startsWith("CUSTOM DRAFT DIRECTION"),
    true,
    `outgoing prompt mismatch; screen=${JSON.stringify(await outgoingPrompt.inputValue())}; PUT=${JSON.stringify(snapshot.lastPutBody)}; metadata=${JSON.stringify(snapshot.chat.metadata)}`,
  );
  assert.match(snapshot.chat.metadata.translationOutputPrompt, /Aster → アスター/);
  assert.match(snapshot.chat.metadata.translationInputPrompt, /アスター → Aster/, "draft direction reverses glossary");

  // Reload reads each saved direction independently. The actual shell translate helper then sends the
  // matching saved metadata fields to the Engine endpoint (which is stubbed only at that final boundary).
  await page.reload();
  await page.getByText("공통 단어장", { exact: true }).waitFor();
  assert.equal(await areaIn("받는 답장 · AI → 내 언어").inputValue(), "CUSTOM RESPONSE DIRECTION");
  assert.equal(await areaIn("보내는 글 · 내 언어 → AI 언어").inputValue(), "CUSTOM DRAFT DIRECTION");
  const savedMeta = (await state()).chat.metadata;
  await page.evaluate(async (meta) => {
    const { translate } = await import("/shell/lib/translate.js");
    await translate("response direction proof", "output", meta, "translation-screen-proof");
    await translate("draft direction proof", "input", meta, "translation-screen-proof");
  }, savedMeta);
  snapshot = await state();
  const outputRequest = snapshot.translateRequests.find((row) => row.text === "response direction proof");
  const inputRequest = snapshot.translateRequests.find((row) => row.text === "draft direction proof");
  assert.equal(outputRequest.systemPrompt, snapshot.chat.metadata.translationOutputPrompt);
  assert.equal(outputRequest.targetLanguage, "en");
  assert.equal(inputRequest.systemPrompt, snapshot.chat.metadata.translationInputPrompt);
  assert.equal(inputRequest.targetLanguage, "ja");

  // Google provider produces the visible compatibility note without silently switching providers.
  await page.request.post(`${address}/__test/reset`);
  await page.request.post(`${address}/__test/model`, { data: { connection: "Google fixture" } });
  await page.request.post(`${address}/__test/provider`, { data: { provider: "google" } });
  await page.evaluate(() => window.openTranslation());
  await page.getByText(/현재 공급자는 AI 지침과 단어장을 사용하지 않습니다/).waitFor();
  assert.equal((await state()).chat.metadata.translationProvider, "google");

  // Independent side preview: one oversized side reports its own error and leaves the other usable.
  await page.request.post(`${address}/__test/reset`);
  const sideResult = await page.request.post(`${address}/api/mari-kit/translation/${chatId}/preview`, {
    data: { incomingPrompt: "usable incoming", outgoingPrompt: "x".repeat(5100), side: "incoming" },
  });
  assert.equal(sideResult.ok(), true, "a preview of one side is not blocked by an invalid other side");
  assert.match((await sideResult.json()).incoming.text, /^usable incoming/);
  const invalidOther = await page.request.post(`${address}/api/mari-kit/translation/${chatId}/preview`, {
    data: { incomingPrompt: "usable incoming", outgoingPrompt: "x".repeat(5100), side: "outgoing" },
  });
  assert.equal(invalidOther.status(), 400);

  // A rejected over-limit save leaves the current text in the screen so the user can correct it.
  await page.evaluate(() => window.openTranslation());
  await page.getByText("공통 단어장", { exact: true }).waitFor();
  await directionSection("받는 답장 · AI → 내 언어").locator("details summary").click();
  await (await areaIn("받는 답장 · AI → 내 언어")).fill("x".repeat(5100));
  await clickButton("적용");
  await page.getByText(/적용하지 못했어요/).waitFor();
  const retained = await areaIn("받는 답장 · AI → 내 언어").inputValue();
  assert.equal(retained.length, 5100, "failed save preserves the draft");

  // Navigation abort path: the browser cancels the request, disposal makes the old screen inert, and a new
  // screen instance can be opened without the late result mutating the page.
  await page.request.post(`${address}/__test/reset`);
  await page.request.post(`${address}/__test/delay-scan`);
  await page.evaluate(() => window.openTranslation());
  await page.getByText("공통 단어장", { exact: true }).waitFor();
  await directionSection("공통 단어장").getByRole("button", { name: "AI로 찾기" }).click();
  await page.getByRole("button", { name: "읽기 취소" }).waitFor();
  await page.waitForFunction(async () => (await (await fetch("/__test/state")).json()).modelCalls > 0);
  await clickButton("읽기 취소");
  await page.getByText("읽기를 취소했어요.").waitFor();
  await page.request.post(`${address}/__test/release-scan`);

  await page.request.post(`${address}/__test/delay-scan`);
  await directionSection("공통 단어장").getByRole("button", { name: "AI로 찾기" }).click();
  await page.waitForFunction(async () => (await (await fetch("/__test/state")).json()).modelCalls > 1);
  await page.evaluate(() => window.closeTranslation());
  await page.evaluate(() => window.openTranslation());
  await page.getByText("공통 단어장", { exact: true }).waitFor();
  await page.request.post(`${address}/__test/release-scan`);
  assert.equal(await page.locator('input[aria-label="Aster를 추가"]').count(), 0);

  // Fit at the owner-required 360px size. Capture a screenshot as a review artifact and report raw bytes
  // for the actual screen's HTML, local modules and stylesheet (API payloads are tracked separately).
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.equal(
    dimensions.scrollWidth,
    dimensions.clientWidth,
    `360px page has no horizontal overflow: ${JSON.stringify(dimensions)}`,
  );
  const screenshot = process.env.TRANSLATION_SCREENSHOT || "/tmp/translation-screen-proof.png";
  await page.screenshot({ path: screenshot, fullPage: true });
  const screenBytes = transfer.bytes;
  const requestList = transfer.requests;
  console.log(
    `translation screen proof: browser and Fastify integration passed; initial screen response bodies ${screenBytes} bytes across ${requestList.length} shell/API resources (raw, uncompressed, excludes headers); model calls ${(await state()).modelCalls}; screenshot ${screenshot}`,
  );
} finally {
  await context.close();
  await browser.close();
  await app.close();
}
