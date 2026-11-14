// Browser proof for the real Mari Kit Convo screen and sticker module. Engine routes are
// backed by a small in-memory fixture, so this verifies the shell contract, not server storage.
import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(repoRoot, "custom-modules/mari-kit");
const require = createRequire(resolve(repoRoot, "package.json"));
const { chromium } = require("playwright");
let systemChromium = false;
try {
  await access("/usr/bin/chromium");
  systemChromium = true;
} catch {}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2ioAAAAASUVORK5CYII=",
  "base64",
);
let chatMeta = { autoTranslate: false };
let stickers = [{ id: "g1", name: "wave", url: "/api/custom-stickers/file/g1", contentType: "image/png" }];
const calls = [];
let messages = [
  { id: "seed", role: "assistant", content: "sticker:wave:", createdAt: "2026-11-14T12:00:00Z", characterId: "char1" },
];
let failUpload = false;
let translated = "";
let blockStickerLoad = false;
let generated = [];
let nextId = 2;
const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${await readFile(`${root}/shell/shell.css`, "utf8")}</style></head><body><main id="app" class="app mk"></main><script type="module" src="/fixture.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/") {
    res.setHeader("content-type", "text/html");
    return res.end(html);
  }
  if (url.pathname === "/fixture.js") {
    res.setHeader("content-type", "text/javascript");
    return res.end(`import { convoScreen } from '/shell/screens/convo.js';
      window.fixture = { go:[], screen:null, open(){ const app=document.querySelector('#app'); app.replaceChildren(); this.screen=convoScreen({mount:app,args:['chat1'],go:(x)=>this.go.push(x),back:(x)=>this.go.push(x)}); }, dispose(){this.screen?.dispose();this.screen=null;} }; fixture.open();`);
  }
  if (url.pathname === "/__fixture" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const change = JSON.parse(raw || "{}");
    if (change.meta) chatMeta = change.meta;
    if (change.translated !== undefined) translated = change.translated;
    if (change.messages) messages = change.messages;
    if (change.blockStickerLoad !== undefined) blockStickerLoad = change.blockStickerLoad;
    return json(res, 200, { ok: true });
  }
  if (url.pathname.startsWith("/shell/")) {
    const file = resolve(root, `shell/${url.pathname.slice("/shell/".length)}`);
    if (!file.startsWith(resolve(root, "shell") + sep)) {
      res.statusCode = 403;
      return res.end();
    }
    try {
      const data = await readFile(file);
      res.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : "text/css");
      return res.end(data);
    } catch {
      res.statusCode = 404;
      return res.end();
    }
  }
  if (!url.pathname.startsWith("/api/")) {
    res.statusCode = 404;
    return res.end();
  }
  const path = url.pathname.slice(4);
  let raw = Buffer.alloc(0);
  for await (const chunk of req) raw = Buffer.concat([raw, chunk]);
  const bodyText = raw.toString();
  let body = {};
  if ((req.headers["content-type"] || "").includes("application/json") && bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {}
  }
  if (path === "/chats/chat1")
    return json(res, 200, {
      id: "chat1",
      title: "Mika",
      personaId: "p1",
      characterIds: ["char1"],
      metadata: JSON.stringify(chatMeta),
    });
  if (path === "/mari-kit/shell/characters") return json(res, 200, [{ id: "char1", name: "Mika" }]);
  if (path === "/characters/summaries") return json(res, 200, []);
  if (path === "/chats/chat1/messages") return json(res, 200, messages);
  if (path === "/app-settings/ui") return json(res, 200, { value: { enableStreaming: true } });
  if (path === "/tts/config" || path.startsWith("/mari-kit/schedule/")) return json(res, 200, {});
  if (path === "/custom-stickers" && req.method === "GET") {
    if (blockStickerLoad) await new Promise((r) => setTimeout(r, 500));
    return json(res, 200, stickers);
  }
  if (path === "/characters/personas/p1/gallery")
    return json(res, 200, [
      { customKind: "sticker", customName: "wave", url: "/api/gallery/persona-wave" },
      { customKind: "sticker", customName: "persona_only", url: "/api/gallery/persona-only" },
    ]);
  if (path === "/characters/char1/gallery")
    return json(res, 200, [
      { customKind: "sticker", customName: "wave", url: "/api/gallery/char-wave" },
      { customKind: "sticker", customName: "char_only", url: "/api/gallery/char-only" },
    ]);
  if (path === "/translate") {
    calls.push({ kind: "translate", body });
    return json(res, 200, { translatedText: translated || body.text });
  }
  if (path === "/custom-stickers/upload" && req.method === "POST") {
    calls.push({ kind: "upload", contentType: req.headers["content-type"], body: bodyText });
    if (failUpload) return json(res, 409, { error: "duplicate sticker" });
    const name = /name="name"\r\n\r\n([^\r]+)/.exec(bodyText)?.[1] || "upload";
    const item = {
      id: `g${nextId++}`,
      name,
      url: `/api/custom-stickers/file/g${nextId - 1}`,
      contentType: "image/png",
    };
    stickers.push(item);
    return json(res, 201, item);
  }
  if (path.startsWith("/custom-stickers/") && req.method === "PATCH") {
    calls.push({ kind: "rename", path, body });
    const id = path.split("/").at(-1);
    const item = stickers.find((x) => x.id === id);
    if (item) item.name = body.name;
    return json(res, 200, item || {});
  }
  if (path.startsWith("/custom-stickers/") && req.method === "DELETE") {
    calls.push({ kind: "delete", path });
    stickers = stickers.filter((x) => x.id !== path.split("/").at(-1));
    return json(res, 200, { ok: true });
  }
  if (path === "/generate" && req.method === "POST") {
    calls.push({ kind: "generate", body });
    generated.push(body);
    const saved = {
      id: `m${nextId++}`,
      role: "user",
      content: body.userMessage || "",
      createdAt: new Date().toISOString(),
    };
    messages.push(saved);
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    res.end(`data: ${JSON.stringify({ type: "message_saved", data: saved })}\n\ndata: [DONE]\n\n`);
    return;
  }
  if (path === "generation-status" || path.endsWith("/generation-status") || path.includes("generation"))
    return json(res, 200, { active: false });
  if (path === "/custom-stickers/file/g1" || path.startsWith("/custom-stickers/file/")) {
    res.setHeader("content-type", "image/png");
    return res.end(png);
  }
  if (path.startsWith("/gallery/")) {
    res.setHeader("content-type", "image/png");
    return res.end(png);
  }
  json(res, 200, {});
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
const browser = await chromium.launch({
  ...(systemChromium ? { executablePath: "/usr/bin/chromium" } : {}),
  headless: true,
  args: ["--no-sandbox"],
});
const assert = (ok, msg) => {
  if (!ok) throw new Error(`STICKER UI PROOF FAILED: ${msg}`);
};
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.getByRole("textbox", { name: "메시지" }).waitFor();
  await page.getByRole("button", { name: "스티커 열기" }).click();
  await page.getByRole("dialog", { name: "스티커" }).waitFor();
  await page.getByRole("button", { name: /wave, Mika/ }).waitFor();
  await page.getByRole("button", { name: /persona_only/ }).waitFor();
  await page.getByRole("button", { name: /char_only/ }).waitFor();
  assert(
    (await page.getByRole("button", { name: /wave, Mika/ }).count()) === 1,
    "character gallery shadows persona and global sticker with same name",
  );
  await page.getByRole("button", { name: /wave, Mika/ }).click();
  const composer = page.getByRole("textbox", { name: "메시지" });
  await composer.fill("keep this draft");
  await composer.evaluate((el) => {
    el.setSelectionRange(5, 9);
  });
  // Open the picker again and verify insertion at the selection preserves text around it.
  await page.getByRole("button", { name: "스티커 열기" }).click();
  await page.getByRole("button", { name: /char_only/ }).click();
  assert(
    (await composer.inputValue()) === "keep \nsticker:char_only:\n draft",
    "insertion preserves prefix/suffix and uses exact sticker token",
  );
  await page.getByRole("button", { name: "스티커 열기" }).click();
  await page.getByRole("button", { name: "스티커 추가" }).click();
  await page.getByRole("textbox", { name: "이름" }).fill("fresh");
  await page.getByLabel("이미지 파일").setInputFiles({ name: "tiny.png", mimeType: "image/png", buffer: png });
  failUpload = true;
  await page.getByRole("button", { name: "스티커 저장" }).click();
  await page.getByRole("alert").waitFor();
  assert(
    (await page.getByRole("textbox", { name: "이름" }).inputValue()) === "fresh",
    "409 upload failure retains the draft name",
  );
  failUpload = false;
  await page.getByRole("button", { name: "스티커 저장" }).click();
  await page.getByRole("button", { name: /fresh, 전체/ }).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".sticker-pick img")].every((img) => img.complete && img.naturalWidth > 0),
  );
  assert(
    calls.filter((x) => x.kind === "upload").length === 2 &&
      calls.at(-1).contentType.startsWith("multipart/form-data; boundary="),
    "upload uses multipart boundary and retry retains draft",
  );
  await page.getByRole("button", { name: "전체 스티커 관리" }).click();
  await page.getByRole("button", { name: /wave, 전체/ }).waitFor();
  await page.getByRole("button", { name: "이름 변경" }).first().click();
  await page.getByRole("textbox", { name: "이름" }).fill("renamed");
  await page.getByRole("button", { name: "스티커 저장" }).click();
  assert(
    calls.some((x) => x.kind === "rename" && x.body.name === "renamed"),
    "global rename calls Engine API",
  );
  await page.getByRole("button", { name: "삭제" }).first().click();
  await page.getByRole("dialog", { name: "확인" }).getByRole("button", { name: "확인" }).click();
  assert(
    calls.some((x) => x.kind === "delete"),
    "global delete calls Engine API after confirmation",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "스티커" }).waitFor({ state: "detached" });
  await composer.fill("sticker:wave:");
  const beforeGenerate = generated.length;
  await page.getByRole("button", { name: "보내기" }).click();
  await page.waitForFunction(() => window.fixture);
  await page.waitForTimeout(1000);
  assert(
    generated.length === beforeGenerate + 1 && generated.at(-1).userMessage === "sticker:wave:",
    `send generates exact sticker-only body; got ${JSON.stringify(generated.slice(beforeGenerate))}, calls=${JSON.stringify(calls.slice(-5))}, value=${await composer.inputValue()}, toast=${await page
      .locator(".toast")
      .textContent()
      .catch(() => "")}`,
  );
  assert(!calls.some((x) => x.kind === "translate"), "sticker-only input skips translation");
  await page.evaluate(async () =>
    fetch("/__fixture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meta: { translateInput: true }, translated: "token removed" }),
    }),
  );
  await page.evaluate(() => {
    fixture.dispose();
    fixture.open();
  });
  await composer.waitFor();
  await composer.fill("hello sticker:fresh:");
  const mixedBefore = generated.length;
  await page.getByRole("button", { name: "보내기" }).click();
  await page.waitForFunction(() =>
    document.querySelector(".toast")?.textContent.includes("번역에서 스티커 토큰이 바뀌어 원문을 유지했어요"),
  );
  await page.waitForFunction(() => document.querySelector(".bub.me"));
  assert(
    generated.length === mixedBefore + 1 && generated.at(-1).userMessage === "hello sticker:fresh:",
    "corrupting translation keeps original mixed sticker input",
  );
  assert(
    calls.some((x) => x.kind === "translate"),
    "mixed sticker input uses translate API",
  );
  const displayMessage = {
    id: "display-only",
    role: "assistant",
    characterId: "char1",
    content: "look sticker:fresh:",
    extra: { translation: "translated without media", translationSource: "look sticker:fresh:" },
    createdAt: new Date().toISOString(),
  };
  await page.evaluate(
    async (m) =>
      fetch("/__fixture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meta: { translationDisplayOnly: true }, messages: [m] }),
      }),
    displayMessage,
  );
  await page.reload();
  await page.waitForSelector(".bub");
  await page.waitForSelector(".bub .sticker-image");
  assert(
    (await page.locator(".bub-tr").textContent()) === "translated without media",
    "display-only translation without sticker token keeps original image and shows translated text below",
  );
  await page.getByRole("button", { name: "스티커 열기" }).click();
  await page.getByRole("button", { name: /fresh, 전체/ }).waitFor();
  const bounds = await page.locator(".sheet").boundingBox();
  const viewport = page.viewportSize();
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width, "picker fits narrow mobile viewport");
  assert(
    !/\bnull\b/.test(await page.locator(".sticker-body").innerText()),
    "picker renders no standalone null placeholders",
  );
  const screenshot = resolve(tmpdir(), "mari-kit-stickers-mobile-picker.png");
  await page.screenshot({ path: screenshot });
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector(".app").classList.add("dark"));
  assert(
    (await page.locator(".app").evaluate((el) => getComputedStyle(el).getPropertyValue("--paper").trim())) ===
      "#000000",
    "dark theme applies to actual shell surface",
  );
  assert(errors.length === 0, `browser page errors: ${errors.join("; ")}`);
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        checks: [
          "real convo screen picker + gallery collision",
          "composer insertion at selection",
          "multipart upload with 409 retention/retry, rename and delete",
          "sticker-only send skips translation",
          "corrupt translation retains mixed original",
          "display-only missing token preserves image and translated text",
          "reload persistence, narrow mobile fit, dark surface",
        ],
        screenshot,
        engineApi: "in-memory fixture; production route validation/storage not exercised",
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
