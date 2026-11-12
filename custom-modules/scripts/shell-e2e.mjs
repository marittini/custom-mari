#!/usr/bin/env node
// Mari shell flow tests at phone size, against a running Engine with Mari Kit installed whose data can be thrown away
// (it creates a connection to a local fake model, characters, personas and chats). Each flow is what a user does:
// open the app, move around and back, send in Convo and RP, group speakers, chat settings views, a chat cover,
// characters writing first. Also prints the transfer of the first visit. Needs Playwright's Chromium.
//
//   node custom-modules/scripts/shell-e2e.mjs [http://127.0.0.1:7860] [--only name,name]

import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { startFakeLlm } from "./e2e/fake-llm.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const base = (args.find((a) => a.startsWith("http")) || process.env.ENGINE_URL || "http://127.0.0.1:7860").replace(
  /\/$/,
  "",
);
const APP = `${base}/api/mari-kit/app`;
const { chromium, devices } = createRequire(resolve(here, "..", "..", "package.json"))("playwright");

const H = { "content-type": "application/json", "x-marinara-csrf": "1" };
async function api(method, path, body) {
  const res = await fetch(`${base}/api${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
const ids = (v) => (typeof v === "string" ? JSON.parse(v) : v) || [];
const meta = async (id) => {
  const c = await api("GET", `/chats/${id}`);
  return typeof c.metadata === "string" ? JSON.parse(c.metadata) : c.metadata || {};
};
const messageCount = async (id) => (await api("GET", `/chats/${id}/messages`)).length;
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

// ── Seed ──
const llm = await startFakeLlm();
const conn = await api("POST", "/connections", {
  name: "e2e fake",
  provider: "custom",
  baseUrl: llm.url,
  model: "fixture",
});
const a = await api("POST", "/characters", { data: { name: "Aoi", description: "e2e" } });
const b = await api("POST", "/characters", { data: { name: "Ren", description: "e2e" } });
await api("POST", "/characters/personas", { name: "Mari", description: "e2e" });
await api("POST", "/characters/personas", { name: "Mari 2", description: "e2e" });
const newChat = (name, mode, characterIds) =>
  api("POST", "/chats", { name, mode, characterIds, connectionId: conn.id });
const convo = await newChat("e2e convo", "conversation", [a.id]);
const group = await newChat("e2e group", "conversation", [a.id, b.id]);
const rp = await newChat("e2e rp", "roleplay", [a.id]);
const other = await newChat("e2e other", "conversation", [b.id]);

const browser = await chromium.launch();
async function phone() {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, errors };
}
const hash = (page) => page.evaluate(() => location.hash);
const goIn = (page, h) => page.evaluate((x) => (location.hash = x), h); // in-app move, as a tap does
async function open(page) {
  await page.goto(APP);
  await page.waitForSelector(".dock");
}

const flows = {
  // A fresh open starts on 홈 even from a remembered address; a reload keeps the screen.
  // 홈: radio, connections and the 남은 크레딧 receipt (no chat lists: those are 대화 and 서재).
  async home({ page }) {
    await open(page);
    await page.waitForSelector(".rc .rchd");
    if (await page.getByText("이어 읽기").count()) throw new Error("홈 still shows 이어 읽기");
    await page
      .locator(".rc")
      .getByRole("button", { name: /크레딧|계정 추가/ })
      .click();
    await until(async () => (await hash(page)) === "#/credit", 5000, "credit settings open");
    await page.getByRole("button", { name: "뒤로" }).first().click();
    await until(
      async () => ["", "#/home"].includes(await hash(page)) && (await page.locator(".rc").isVisible()),
      5000,
      "back to 홈",
    );
  },

  async "fresh-open"({ page }) {
    await page.goto(`${APP}#/settings`);
    await until(async () => (await hash(page)).startsWith("#/home"), 8000, "fresh open lands on 홈");
    await page.getByRole("button", { name: "대화" }).click();
    await until(async () => (await hash(page)) === "#/convos", 5000, "dock opens 대화");
    await page.reload();
    await page.waitForSelector(".dock");
    if ((await hash(page)) !== "#/convos") throw new Error(`reload moved to ${await hash(page)}`);
  },

  // Back returns the way the user came and never loops.
  async back({ page }) {
    await open(page);
    await page.getByRole("button", { name: "대화" }).click();
    await page.locator(`a[href="#/convo/${encodeURIComponent(convo.id)}"]`).click();
    await page.getByRole("button", { name: "채팅 설정" }).click();
    await until(async () => (await hash(page)).startsWith("#/chat-settings/"), 5000, "chat settings");
    await page.getByRole("button", { name: "뒤로" }).first().click();
    await until(async () => (await hash(page)).startsWith("#/convo/"), 5000, "back to the chat");
    await page.getByRole("button", { name: "대화 목록" }).click();
    await until(async () => (await hash(page)) === "#/convos", 5000, "back to 대화");
  },

  async "convo-send"({ page }) {
    const before = await messageCount(convo.id);
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(convo.id)}`);
    await page.getByRole("textbox", { name: "메시지" }).fill("안녕");
    await page.getByRole("button", { name: "보내기" }).click();
    await until(
      () => page.getByText("네가 젖으면 내가 곤란해", { exact: false }).first().isVisible(),
      20000,
      "reply shown",
    );
    if ((await messageCount(convo.id)) < before + 2) throw new Error("messages were not saved");
    // The 대화 list shows the new last line (its cached copy must notice the chat changed).
    await goIn(page, "#/convos");
    await until(
      async () =>
        (await page.locator(`a[href="#/convo/${encodeURIComponent(convo.id)}"]`).innerText()).includes("곤란해"),
      8000,
      "list preview updated",
    );
  },

  async "rp-send"({ page }) {
    await open(page);
    await goIn(page, `#/rp/${encodeURIComponent(rp.id)}`);
    await page.locator("textarea").fill("문을 연다.");
    await page.getByRole("button", { name: "보내기" }).click();
    await until(() => page.locator(".read").filter({ hasText: "곤란해" }).first().isVisible(), 20000, "RP reply shown");
  },

  // Several characters: each reply is labeled with its speaker.
  async "group-speakers"({ page }) {
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(group.id)}`);
    await page.getByRole("textbox", { name: "메시지" }).fill("둘 다 안녕");
    await page.getByRole("button", { name: "보내기" }).click();
    await until(() => page.locator(".who").first().isVisible(), 25000, "speaker name shown");
    const names = await page.locator(".who").allTextContents();
    if (!names.some((n) => /Aoi|Ren/.test(n))) throw new Error(`speaker labels: ${names.join(", ")}`);
  },

  // Every chat settings view opens without an error, for both modes.
  async "chat-settings"({ page, errors }) {
    await open(page);
    for (const chat of [convo, rp]) {
      for (const view of ["", "translation", "cast", "author", "lorebooks", "cover", "kit", "view", "all"]) {
        await goIn(page, `#/chat-settings/${encodeURIComponent(chat.id)}${view ? `/${view}` : ""}`);
        await page.waitForTimeout(700);
        if (await page.locator(".err").count())
          throw new Error(`${chat.mode} ${view || "home"}: ${await page.locator(".err").first().textContent()}`);
      }
    }
    if (errors.length) throw new Error(errors.join(" | "));
  },

  // A chat cover is made small in the browser (WebP) and shows in the list.
  async cover({ page }) {
    await open(page);
    await goIn(page, `#/chat-settings/${encodeURIComponent(other.id)}/cover`);
    const png = await page.evaluate(() => {
      const c = Object.assign(document.createElement("canvas"), { width: 900, height: 900 });
      const g = c.getContext("2d");
      g.fillStyle = "#777";
      g.fillRect(0, 0, 900, 900);
      return c.toDataURL("image/png").split(",")[1];
    });
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "c.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await until(() => page.locator(".toast").filter({ hasText: "표지를 바꿨어요" }).isVisible(), 10000, "cover saved");
    const m = await meta(other.id);
    const url = JSON.stringify(m).match(/\/shell\/cover\/[^"?]+\.webp/)?.[0];
    if (!url) throw new Error("no cover saved in the chat");
    await goIn(page, "#/convos");
    await until(
      async () =>
        (await page.locator(`a[href="#/convo/${encodeURIComponent(other.id)}"]`).innerHTML()).includes("cover"),
      5000,
      "cover in the list",
    );
  },

  // Characters write first (the Engine's Convo autonomy): in the open chat, and in another chat with an unread
  // badge and a notice. The Engine's own wait of several minutes is cut short by answering its check once.
  async autonomy({ page }) {
    for (const id of [convo.id, other.id])
      await api("PATCH", `/chats/${id}/metadata`, { autonomousMessages: true, autonomousUnreadCount: 0 });
    const charOf = { [convo.id]: a.id, [other.id]: b.id };
    const fired = new Set();
    await page.route("**/api/conversation/autonomous/check", (route) => {
      const { chatId } = JSON.parse(route.request().postData());
      if (!charOf[chatId] || fired.has(chatId)) return route.continue();
      fired.add(chatId);
      return route.fulfill({
        json: { shouldTrigger: true, characterIds: [charOf[chatId]], reason: "user_inactivity", inactivityMs: 1 },
      });
    });
    const before = { open: await messageCount(convo.id), other: await messageCount(other.id) };
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(convo.id)}`);
    await until(async () => (await messageCount(convo.id)) > before.open, 40000, "open chat: character wrote first");
    await until(
      () => page.locator(".toast").filter({ hasText: "새 메시지" }).isVisible(),
      40000,
      "notice for the other chat",
    );
    if ((await messageCount(other.id)) <= before.other) throw new Error("other chat got no message");
    await goIn(page, "#/convos");
    await until(
      () => page.locator(`a[href="#/convo/${encodeURIComponent(other.id)}"] .unread`).isVisible(),
      5000,
      "unread badge",
    );
    await goIn(page, `#/convo/${encodeURIComponent(other.id)}`);
    await until(async () => !Number((await meta(other.id)).autonomousUnreadCount), 5000, "opening clears unread");
    for (const id of [convo.id, other.id]) await api("PATCH", `/chats/${id}/metadata`, { autonomousMessages: false });
  },
};

// First visit transfer (empty cache), reported with the results.
async function firstVisit() {
  const { ctx, page } = await phone();
  let bytes = 0;
  page.on("requestfinished", async (r) => {
    const s = await r.sizes().catch(() => null);
    if (s) bytes += s.responseBodySize + s.responseHeadersSize;
  });
  await open(page);
  await page.waitForLoadState("networkidle");
  await ctx.close();
  return bytes;
}

let failed = 0;
for (const [name, run] of Object.entries(flows)) {
  if (only && !only.includes(name)) continue;
  const s = await phone();
  const t = Date.now();
  try {
    await run(s);
    console.log(`PASS ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message.split("\n")[0]}`);
    const shot = join(tmpdir(), `shell-e2e-${name}.png`);
    await s.page.screenshot({ path: shot }).then(
      () => console.log(`     screen: ${shot}`),
      () => {},
    );
  }
  await s.ctx.close();
}
if (!only) console.log(`First visit to 홈: ${Math.round((await firstVisit()) / 1024)}KB`);
await browser.close();
llm.close();
if (failed) {
  console.error(`${failed} Mari shell flow(s) failed`);
  process.exit(1);
}
console.log("OK Mari shell flows");
