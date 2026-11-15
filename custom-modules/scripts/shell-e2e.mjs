#!/usr/bin/env node
// Mari shell flow tests at phone size, against a running Engine with Mari Kit installed whose data can be thrown away
// (it creates a connection to a local fake model, characters, personas and chats). Each flow is what a user does:
// open the app, move around and back, send in Convo and RP, group speakers, chat settings views, a chat cover,
// characters writing first. Also prints the transfer of the first visit, and tours every main screen at 360px
// (transfer per screen, sideways page scroll, page errors; e2e/screens.mjs). Needs Playwright's Chromium.
//
//   node custom-modules/scripts/shell-e2e.mjs [http://127.0.0.1:7860] [--only flow,flow] [--screens mod,mod]
//                                             [--shots <dir>] [--coverage <file>] [--crawl] [--resources]
//   --only: just these flows (none: "--only -"). --screens: tour only the screens drawn by these screen modules
//   (shell/screens/<mod>.js; "-" for none). Without either, everything runs, with the first-visit transfer.
//   --coverage: write which shell functions and Engine routes each passing flow used (e2e/coverage.mjs), so the
//   scoped verify.mjs later runs only the flows a change reaches.

import { chromium, devices } from "./e2e/playwright.mjs";
import { dirname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { startFakeLlm } from "./e2e/fake-llm.mjs";
import { crawlScreens, layoutFaults, offscreenText, screenTour } from "./e2e/screens.mjs";
import { routeOf, summarize } from "./e2e/coverage.mjs";
import { writeFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const list = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1].split(",").filter((x) => x && x !== "-") : null;
const only = list("--only");
const tourMods = list("--screens");
const crawl = args.includes("--crawl");
const resources = args.includes("--resources");
const coverageOut = args.includes("--coverage") ? resolve(args[args.indexOf("--coverage") + 1]) : null;
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
const base = (args.find((a) => a.startsWith("http")) || process.env.ENGINE_URL || "http://127.0.0.1:7860").replace(
  /\/$/,
  "",
);
const APP = `${base}/api/mari-kit/app`;

const H = { "content-type": "application/json", "x-marinara-csrf": "1" };
async function api(method, path, body) {
  const res = await fetch(`${base}/api${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
const ids = (v) => (typeof v === "string" ? JSON.parse(v) : v) || [];
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
/** Uploads a tiny picture as a global sticker or custom emoji (the Engine's multipart route). */
async function uploadPicture(route, name) {
  const form = new FormData();
  form.append("name", name);
  form.append("file", new Blob([Buffer.from(PNG, "base64")], { type: "image/png" }), `${name}.png`);
  const res = await fetch(`${base}/api${route}/upload`, {
    method: "POST",
    headers: { "x-marinara-csrf": "1" },
    body: form,
  });
  if (!res.ok) throw new Error(`upload ${route}: ${res.status} ${await res.text()}`);
  return res.json();
}
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
// The Engine's scene planner asks for a JSON plan; the fake answers with one that casts the offered characters.
const scenePlan = (req) => {
  const system = String(req.messages?.find((m) => m.role === "system")?.content || "");
  if (!system.includes("creative scene planner")) return null;
  const ids = [...(/<available_character_ids>\n([^<]*)/.exec(system)?.[1] || "").matchAll(/"([^"]+)"/g)].map(
    (m) => m[1],
  );
  return JSON.stringify({
    name: "Scene: e2e 비 오는 밤",
    description: "비가 그치지 않는 밤, 둘은 처마 밑에 섰다.",
    scenario: "e2e hidden plot",
    firstMessage: '*빗소리가 가까워졌다.* "왔어?"',
    background: null,
    characterIds: ids,
    systemPrompt: "Write in first person, past tense.",
    rating: "sfw",
    relationshipHistory: "e2e",
    participationGuide: "마음대로 해 보세요.",
  });
};
const llm = await startFakeLlm({ scenario: scenePlan });
const conn = await api("POST", "/connections", {
  name: "e2e fake",
  provider: "custom",
  baseUrl: llm.url,
  model: "fixture",
});
const a = await api("POST", "/characters", { data: { name: "Aoi", description: "e2e" } });
const b = await api("POST", "/characters", { data: { name: "Ren", description: "e2e" } });
const persona = await api("POST", "/characters/personas", { name: "Mari", description: "e2e" });
await api("POST", "/characters/personas", { name: "Mari 2", description: "e2e" });
const newChat = (name, mode, characterIds) =>
  api("POST", "/chats", { name, mode, characterIds, connectionId: conn.id });
const convo = await newChat("e2e convo", "conversation", [a.id]);
const group = await newChat("e2e group", "conversation", [a.id, b.id]);
const rp = await newChat("e2e rp", "roleplay", [a.id]);
const other = await newChat("e2e other", "conversation", [b.id]);
// Text with no place to break (Japanese has no spaces; a long link) must still wrap at 360px on every screen that
// shows messages: the screen tour fails on a sentence that runs off the screen.
const LONG_JA = "大丈夫だよ、今日はどうだった？ずっと待ってたんだからね、もう少し早く電話してくれてもよかったのに。";
const LONG_LINK = `https://example.com/${"e2e".repeat(30)}`;
await api("POST", `/chats/${convo.id}/messages`, { role: "assistant", characterId: a.id, content: LONG_JA });
await api("POST", `/chats/${rp.id}/messages`, {
  role: "assistant",
  characterId: a.id,
  content: `「${LONG_JA}」\n\n${LONG_LINK}`,
});
// Its own character, because a status override lives on the character card (the Engine's presence).
const yui = await api("POST", "/characters", { data: { name: "Yui", description: "e2e" } });
const presence = await newChat("e2e presence", "conversation", [yui.id]);
// A character with a week schedule (the Engine keeps it on the card): mornings away, the rest busy.
const rin = await api("POST", "/characters", { data: { name: "Rin", description: "e2e" } });
{
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const day = [
    { time: "00:00-12:00", activity: "e2e morning", status: "idle" },
    { time: "12:00-00:00", activity: "e2e shift", status: "dnd" },
  ];
  const days = Object.fromEntries(
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => [d, day]),
  );
  await api("PATCH", `/characters/${rin.id}`, {
    data: {
      extensions: {
        conversationSchedule: {
          weekStart: monday.toISOString(),
          days,
          inactivityThresholdMinutes: 120,
          talkativeness: 50,
          routineSummary: "e2e routine",
        },
      },
    },
    skipVersionSnapshot: true,
  });
}
const scheduled = await newChat("e2e schedule", "conversation", [rin.id]);
await api("PATCH", `/chats/${scheduled.id}/metadata`, { conversationSchedulesEnabled: true });

const browser = await chromium.launch();
async function phone() {
  // A phone, at the 360px width every screen must fit (a Pixel 7 is 412px: narrow-screen faults hid there).
  const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 360, height: 780 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Every screen and sheet a flow shows is checked for layout faults as it appears (e2e/screens.mjs layoutFaults);
  // they are kept here, outside the page, so a reload in the middle of a flow does not lose them.
  const faults = new Set();
  await page.exposeBinding("__mariFault", (_source, f) => faults.add(f));
  // Right before the next frame after any change (once per frame: a screen that keeps changing is still checked,
  // and a flow that moves on at once does not skip it), and once more when the flow ends.
  await page.addInitScript(`(() => {
    const layoutFaults = ${layoutFaults.toString()};
    const check = () => layoutFaults().forEach((f) => window.__mariFault(location.hash + " " + f));
    window.__mariCheck = check;
    let t = 0;
    new MutationObserver(() => {
      if (!t) t = requestAnimationFrame(() => ((t = 0), check()));
    }).observe(document, { childList: true, subtree: true });
  })()`);
  if (coverageOut) {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    page.on("request", (r) => {
      const route = routeOf(r.url());
      if (route) recording.routes.add(route);
    });
    // A reload or a move to another page drops what ran before it from the coverage: such a record is partial.
    page.on("load", () => (recording.navigations += 1)); // a document load (a hash move is not one)
    recording.pages.push(page);
  }
  return { ctx, page, errors, faults };
}
// What the running flow used (with --coverage): its pages' coverage and the Engine routes they called.
let recording = { pages: [], routes: new Set(), navigations: 0 };
const coverage = {};
async function keepCoverage(name) {
  const files = {};
  for (const p of recording.pages) summarize(await p.coverage.stopJSCoverage().catch(() => []), files);
  coverage[name] = {
    files,
    routes: [...recording.routes].sort(),
    // More than the first load of each page: the record misses what ran before the reload or the move.
    partial: recording.navigations > recording.pages.length,
  };
}
const hash = (page) => page.evaluate(() => location.hash);
// With --shots, flows keep a screenshot of the states worth a look (an edit form, a sheet) next to the tour's.
const snap = (page, name) => (shots ? page.screenshot({ path: join(shots, `flow-${name}.png`) }) : null);
if (shots) await mkdir(shots, { recursive: true });
const goIn = (page, h) => page.evaluate((x) => (location.hash = x), h); // in-app move, as a tap does
// The Convo composer's ＋ menu (도구): open it and pick one item.
async function tool(page, name) {
  await page.getByRole("button", { name: "도구", exact: true }).click();
  await page.getByRole("menuitem", { name }).click();
}
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
    // 보기 설정 › 형광펜에 프로필 대사 색 쓰기: the speaker's 대사 색 (dialogueColor) marks their spoken lines.
    const row = await api("GET", `/characters/${a.id}`);
    const card = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    await api("PATCH", `/characters/${a.id}`, {
      data: { extensions: { ...(card.extensions || {}), dialogueColor: "#3366cc" } },
      skipVersionSnapshot: true,
    });
    await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem("mari-shell") || "{}");
      localStorage.setItem("mari-shell", JSON.stringify({ ...p, highlight: true, hlColor: true }));
    });
    await page.reload();
    const dlg = page.locator(".read .dlg").first();
    await dlg.waitFor({ timeout: 15000 });
    const bg = await dlg.evaluate((e) => getComputedStyle(e).backgroundColor);
    // A faint blue wash, not the grey: blue clearly above red.
    const [r, , b] = (bg.match(/[\d.]+/g) || []).map(Number);
    if (!(b > r)) throw new Error(`대사 형광펜 is not the speaker's colour: ${bg}`);
    await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem("mari-shell") || "{}");
      localStorage.setItem("mari-shell", JSON.stringify({ ...p, highlight: false, hlColor: false }));
    });
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

  // The Engine's presence: an offline character does not answer (and Mari says why); an away one answers later,
  // with nothing extra in the chat (no "곧 답해요" row, no 지금 답하게); 멈추기 in the strip ends the wait.
  // Pictures on messages; day separator and times.
  async "convo-presence"({ page }) {
    // The status override lives on the character card (extensions.conversationStatusOverride).
    const status = async (st) => {
      const row = await api("GET", `/characters/${yui.id}`);
      const card = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      const override = {
        status: st,
        activity: "e2e",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600e3).toISOString(),
      };
      await api("PATCH", `/characters/${yui.id}`, {
        data: { extensions: { ...(card.extensions || {}), conversationStatusOverride: override } },
        skipVersionSnapshot: true,
      });
    };
    await status("offline");
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(presence.id)}`);
    await page.waitForSelector(".cmp textarea");
    const say = async (text) => {
      await page.locator(".cmp textarea").fill(text);
      await page.getByRole("button", { name: "보내기" }).click();
    };
    await say("자?");
    await until(() => page.locator(".pnote").filter({ hasText: "오프라인" }).isVisible(), 15000, "offline note");
    await status("idle");
    const before = await messageCount(presence.id);
    await say("@Yui 일어났어?");
    await page.locator(".act").getByText("답장 쓰는 중…").waitFor();
    await page.waitForTimeout(1500);
    if (await page.locator(".pwait").count()) throw new Error("a waiting row shows for an away character");
    if (await page.getByRole("button", { name: "지금 답하게" }).count()) throw new Error("지금 답하게 is back");
    if (await page.locator(".pnote").count()) throw new Error("the offline note stayed after sending again");
    await until(async () => (await messageCount(presence.id)) > before, 5000, "my message saved");
    await page.locator(".act").getByRole("button", { name: "멈추기" }).click();
    await until(async () => !(await page.locator(".act").getByText("답장 쓰는 중…").count()), 10000, "stopped");
    await status("online");
    // A picture on a message (a user upload: data URL) and the message tools from its viewer.
    const msgs = await api("GET", `/chats/${presence.id}/messages`);
    const last = msgs[msgs.length - 1];
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    await api("PATCH", `/chats/${presence.id}/messages/${last.id}/extra`, {
      attachments: [{ type: "image/png", data: png, name: "e2e.png" }],
    });
    await goIn(page, "#/convos");
    await goIn(page, `#/convo/${encodeURIComponent(presence.id)}`);
    await page.locator(".att-i").first().click();
    await page.locator(".att-view img").waitFor();
    await page.getByRole("button", { name: "메시지 도구" }).click();
    await page.getByRole("toolbar", { name: "메시지 도구" }).waitFor();
    if (!(await page.locator(".daysep").filter({ hasText: "오늘" }).count())) throw new Error("no 오늘 separator");
    if (!(await page.locator(".btime").count())) throw new Error("no message times");
  },

  // A character's schedule (the Engine's presence card): the line under the name, the status sheet (change the
  // status and back), the week view, and the dot on the chat's picture in the list.
  async "convo-schedule"({ page }) {
    const now = new Date().getHours() < 12 ? "e2e morning" : "e2e shift";
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(scheduled.id)}`);
    const line = page.locator(".me-line");
    await until(async () => (await line.innerText()).includes(now), 10000, `status line shows ${now}`);
    await line.click();
    await page.locator(".pcard").first().waitFor();
    if (!(await page.locator(".pcard-next .blk").count())) throw new Error("no upcoming blocks in the sheet");
    await page.getByRole("button", { name: "상태 바꾸기" }).click();
    await page.getByRole("radio", { name: "오프라인" }).click();
    await until(async () => (await line.innerText()).includes("오프라인"), 10000, "header follows the manual status");
    await until(
      () => page.getByRole("button", { name: "일정대로 되돌리기" }).isVisible(),
      5000,
      "back-to-schedule button",
    );
    await page.getByRole("button", { name: "일정대로 되돌리기" }).click();
    await until(async () => (await line.innerText()).includes(now), 10000, "back on the schedule");
    await page.getByRole("button", { name: "주간 일정 ›" }).click();
    await until(async () => (await hash(page)).startsWith("#/char-schedule/"), 5000, "week view");
    await until(async () => (await page.locator(".daytabs button").count()) === 7, 5000, "seven day tabs");
    if ((await page.locator(".wblocks .r").count()) !== 2) throw new Error("week view should list 2 blocks");
    await page.locator(".daytabs button").nth(6).click();
    await page.locator(".wblocks").getByText("e2e shift").waitFor();
    // 칸 고치기: add a block on Sunday, set it, copy Sunday onto Monday, save on the card.
    await page.getByRole("button", { name: "칸 고치기" }).click();
    await page.getByRole("button", { name: "＋ 칸 추가" }).click();
    const added = page.locator(".eblk").last();
    // A long activity next to a time that crosses noon: the time keeps its line, the activity wraps (owner's
    // screenshot: "오전 10:00 – 오후 1:00" broken one letter per line).
    await added.getByLabel(/하는 일$/).fill("e2e 산책 겸 하트랜드 타워 원거리 감시 및 데이터 수집");
    await added.getByRole("radio", { name: "바쁨" }).click();
    await snap(page, "schedule-edit");
    await page.getByRole("button", { name: "다른 요일에 복사…" }).click();
    await page.getByRole("button", { name: "월요일", exact: true }).click();
    await snap(page, "schedule-copy");
    await page.getByRole("button", { name: "1개 요일에 복사" }).click();
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page.locator(".wblocks").getByText("e2e 산책 겸", { exact: false }).waitFor({ timeout: 10000 });
    const card = await api("GET", `/characters/${rin.id}`);
    const saved = (typeof card.data === "string" ? JSON.parse(card.data) : card.data).extensions.conversationSchedule;
    for (const d of ["Sunday", "Monday"]) {
      const b = saved.days[d].find((x) => x.activity.startsWith("e2e 산책"));
      if (!b || b.status !== "dnd" || saved.days[d].length !== 3)
        throw new Error(`${d} not saved: ${JSON.stringify(saved.days[d])}`);
    }
    if (saved.routineSummary !== "e2e routine") throw new Error("saving the blocks lost the routine summary");
    await goIn(page, "#/convos");
    await page.locator(`a[href="#/convo/${encodeURIComponent(scheduled.id)}"] .avp .sdot`).waitFor({ timeout: 10000 });
  },

  // 날씨 (Mari Kit weather): from chat settings, turn it on, pick my place and the character's from the built-in
  // cities, put it in this room; the status sheet shows the row and opens the same screen.
  async "convo-weather"({ page }) {
    const room = () => api("GET", `/mari-kit/weather/${convo.id}`);
    await open(page);
    await goIn(page, `#/chat-settings/${encodeURIComponent(convo.id)}/kit`);
    await page.getByRole("button", { name: /^날씨/ }).click();
    await until(async () => (await hash(page)).startsWith("#/weather/"), 5000, "weather screen");
    await page.getByRole("switch", { name: /Mari Kit 날씨/ }).click();
    await until(async () => (await api("GET", "/mari-kit/settings")).features?.weather === true, 5000, "feature on");
    await page.getByRole("button", { name: "고르기" }).first().click();
    await page.locator(".sheet").getByRole("button", { name: /^서울/ }).click();
    await until(async () => (await room()).userLocation?.name === "서울", 8000, "my place saved");
    await page.getByRole("switch", { name: /이 방에 날씨 넣기/ }).click();
    await until(async () => (await room()).room?.enabled === true, 8000, "room on");
    await page.getByRole("button", { name: "고르기" }).click();
    await page.locator(".sheet").getByRole("button", { name: /^부산/ }).click();
    await until(async () => (await room()).room?.characterLocation?.name === "부산", 8000, "character place saved");
    await page.locator(".wx-sum").first().waitFor({ timeout: 10000 });
    await snap(page, "weather");
    await page.getByRole("button", { name: "뒤로" }).click();
    await until(async () => (await hash(page)).startsWith("#/chat-settings/"), 5000, "back to chat settings");
    await goIn(page, `#/convo/${encodeURIComponent(convo.id)}`);
    await page.locator(".me-line").click();
    await page.getByRole("button", { name: /^날씨 · / }).click();
    await until(async () => (await hash(page)).startsWith("#/weather/"), 5000, "weather from the status sheet");
    await api("PUT", `/mari-kit/weather/${convo.id}`, { enabled: false, characterLocation: null });
    await api("PUT", "/mari-kit/weather/user", { location: null });
    await api("PATCH", "/mari-kit/settings", { features: { weather: false } });
  },

  // Scenes (the Engine's flow): a character's invitation, the setup sheet (POV and tense remembered in the Engine's
  // settings), plan and create, the scene chat's bar; back in the Convo the banner and its replies-here switch; end
  // the scene and its summary arrives in the Convo.
  async "convo-scene"({ page }) {
    const msg = await api("POST", `/chats/${convo.id}/messages`, {
      role: "assistant",
      characterId: a.id,
      content: "비 오는데, 잠깐 나올래?",
    });
    await api("PATCH", `/chats/${convo.id}/messages/${msg.id}/extra`, {
      sceneRequest: { prompt: "e2e 비 오는 밤 산책", initiatorCharId: a.id, initiatorCharName: a.name || "Aoi" },
    });
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(convo.id)}`);
    await page.locator(".scncard").getByRole("button", { name: "장면 준비하기" }).click();
    await page.getByRole("radio", { name: "1인칭" }).click();
    await page.getByRole("radio", { name: "과거" }).click();
    await snap(page, "scene-setup");
    await page.getByRole("button", { name: "장면 짜기" }).click();
    await until(async () => (await hash(page)).startsWith("#/rp/"), 20000, "into the scene");
    const sceneId = decodeURIComponent((await hash(page)).split("/")[2]);
    const sm = await meta(sceneId);
    if (sm.sceneStatus !== "active" || sm.sceneOriginChatId !== convo.id) throw new Error("not a scene chat");
    const ui = await api("GET", "/app-settings/ui");
    const saved = JSON.parse(ui.value || "{}").scenePromptPreferences;
    if (saved?.pov !== "first_person" || saved?.tense !== "past") throw new Error("scene choices not remembered");
    await page.locator(".scnend").getByRole("button", { name: "장면 끝내기" }).waitFor();
    await snap(page, "scene-bar");
    await page.getByRole("button", { name: "‹ 대화로" }).click();
    await until(async () => (await hash(page)).startsWith("#/convo/"), 5000, "back to the Convo");
    await page.locator(".scnbar").waitFor();
    await page.getByRole("switch", { name: /여기서도 답하게/ }).click();
    await until(async () => (await meta(sceneId)).sceneOriginRepliesAllowed === true, 5000, "replies here");
    await page.locator(".scncard").getByRole("button", { name: "진행 중인 장면으로" }).waitFor();
    await page.locator(".scnbar").getByRole("button", { name: "장면으로 가기" }).click();
    await until(async () => (await hash(page)).startsWith("#/rp/"), 5000, "to the scene");
    await page.getByRole("button", { name: "장면 끝내기" }).click();
    await page.getByRole("button", { name: "끝내기", exact: true }).click();
    await until(async () => (await hash(page)).startsWith("#/convo/"), 20000, "back after the end");
    await until(
      async () =>
        (await api("GET", `/chats/${convo.id}/messages`)).some(
          (m) => m.role === "narrator" && /returned from their scene/.test(m.content),
        ),
      10000,
      "summary in the Convo",
    );
    if ((await meta(convo.id)).activeSceneChatId) throw new Error("the Convo still points at the scene");
    await until(async () => !(await page.locator(".scnbar").count()), 5000, "banner gone");
  },

  // The ☺ media panel (the Engine's): where the keyboard was, the text box as wide as before; an emoji and a kaomoji
  // go in at the caret and into the recents the Engine reads; a custom emoji (★) as ":name:", shown as a picture in
  // the sent message; ":smi" completes; a sticker sent at once; the chat's emoji selection; /games with none
  // installed; the Engine opened with a command typed for the visitor.
  async "convo-media"({ page }) {
    await uploadPicture("/custom-stickers", "e2e_wave");
    await uploadPicture("/custom-emojis", "e2e_blob");
    // A standard ":heart:" in a saved message still shows as ❤️ (the 23KB emoji list now loads only for such a
    // message, after the chat's own emojis are in).
    await api("POST", `/chats/${convo.id}/messages`, {
      role: "assistant",
      characterId: a.id,
      content: "고마워 :heart:",
    });
    await page.setViewportSize({ width: 360, height: 780 });
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(convo.id)}`);
    await page.locator(".bub").filter({ hasText: "고마워 ❤️" }).first().waitFor({ timeout: 10000 });
    const box = page.locator(".cin");
    await box.waitFor();
    const before = (await box.boundingBox()).width;
    await page.getByRole("button", { name: "도구", exact: true }).click();
    await snap(page, "tools-menu");
    await page.getByRole("menuitem", { name: "이모지·스티커" }).click();
    await page.locator(".mpanel").waitFor();
    const during = (await box.boundingBox()).width;
    if (Math.abs(during - before) > 1) throw new Error(`text box changed width with the panel: ${before} → ${during}`);
    await page.locator(".mp-e").filter({ hasText: "😂" }).first().click();
    await page.getByRole("tab", { name: "카오모지" }).click();
    await page.locator(".mp-k").first().click();
    const typed = await box.inputValue();
    if (!typed.startsWith("😂")) throw new Error(`emoji not inserted: ${typed}`);
    if (typed.length < 4) throw new Error(`kaomoji not inserted: ${typed}`);
    const recents = await page.evaluate(() => JSON.parse(localStorage.getItem("marinara-recent-media-v1") || "{}"));
    if (recents.emoji?.[0]?.value !== "😂" || !recents.kaomoji?.length)
      throw new Error("recents not shared with the Engine");
    await snap(page, "media-panel");
    // ★ custom emoji → ":e2e_blob:", sent and drawn as a picture.
    await page.getByRole("tab", { name: "이모지" }).click();
    await page.getByRole("tab", { name: "내 이모지" }).click();
    await page.getByRole("button", { name: ":e2e_blob:" }).click();
    if (!(await box.inputValue()).includes(":e2e_blob:")) throw new Error("custom emoji not inserted");
    await box.click(); // the keyboard comes back in place of the panel
    if (await page.locator(".mpanel").isVisible()) throw new Error("panel stayed open over the keyboard");
    const sent = await box.inputValue();
    await page.getByRole("button", { name: "보내기" }).click();
    await until(
      async () => (await api("GET", `/chats/${convo.id}/messages`)).some((m) => m.content === sent),
      10000,
      "message with emojis sent",
    );
    await page.locator(".bub.me img.cemoji").first().waitFor({ timeout: 10000 });
    // ":smi" completes from the Engine's shortcodes.
    await box.click();
    await box.pressSequentially(":smi");
    await page
      .locator(".mbox")
      .getByRole("option", { name: /:smile:/ })
      .click();
    if (!(await box.inputValue()).includes("😄")) throw new Error(`shortcode not completed: ${await box.inputValue()}`);
    await box.fill("");
    // A sticker sent at once (after the reply to the emoji message is written: until then 보내기 is 멈추기).
    await page.getByRole("button", { name: "보내기" }).waitFor({ timeout: 20000 });
    await tool(page, "이모지·스티커");
    await page.getByRole("tab", { name: "스티커" }).click();
    await page.getByRole("button", { name: "e2e_wave" }).first().click();
    await page.getByRole("button", { name: "바로 보내기" }).click();
    await until(
      async () => (await api("GET", `/chats/${convo.id}/messages`)).some((m) => m.content === "sticker:e2e_wave:"),
      10000,
      "sticker sent",
    );
    // How characters are offered emojis, from the panel.
    await tool(page, "이모지·스티커");
    await page.getByRole("tab", { name: "스티커" }).click();
    await page.getByRole("button", { name: "캐릭터 고르는 방식" }).click();
    await page.getByRole("radio", { name: "무작위" }).click();
    await until(async () => (await meta(convo.id)).customEmojiSelection?.mode === "random", 5000, "selection saved");
    await page.locator(".psheet").getByRole("button", { name: "닫기", exact: true }).click();
    // /games with nothing installed says so.
    await box.click();
    await box.fill("/games");
    await page.getByRole("button", { name: "보내기" }).click();
    await page.getByText("설치한 게임이 없어요").waitFor();
    await page.keyboard.press("Escape");
    // The Engine opens at this chat with a command typed (what a game pick does).
    await page.evaluate((id) => {
      sessionStorage.setItem("mari-kit:engine-tab", "1");
      sessionStorage.setItem("mari-kit:open", JSON.stringify({ chatId: id, draft: "/help " }));
      localStorage.setItem("marinara-active-chat-id", id);
      location.href = "/";
    }, convo.id);
    await until(
      async () => (await page.locator("textarea").evaluateAll((els) => els.map((e) => e.value))).includes("/help "),
      45000,
      "command typed in the Engine's composer",
    );
  },

  // The work rule (lib/work.js): a new reply is its own button; the schedule regeneration sits in a box, asks first
  // and does nothing when cancelled; an overwrite in 내 일정 can be undone for 10 seconds and really comes back.
  async safety({ page }) {
    const generated = [];
    page.on("request", (r) => r.url().includes("/conversation/schedule/generate") && generated.push(r.url()));
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(convo.id)}`);
    await page.getByRole("textbox", { name: "메시지" }).waitFor();
    // A new reply is 다시 생성 in the message tools; there is no separate 새 답 button.
    if (await page.getByRole("button", { name: "새 답 만들기" }).count()) throw new Error("새 답 is back");
    // 대화 기능: the regeneration is in its own box below the people, and asks.
    await goIn(page, `#/chat-settings/${encodeURIComponent(scheduled.id)}/convo`);
    const box = page.locator(".workbox").first();
    await box.waitFor();
    await box.getByRole("button", { name: "모두 다시 만들기…" }).click();
    await page.getByText("이번 주 일정을 AI로 다시 만들까요?").waitFor();
    await page.getByRole("button", { name: "취소", exact: true }).click();
    await page.waitForTimeout(500);
    if (generated.length) throw new Error("cancelled regeneration still sent a request");
    // 내 일정: 빈 시간 · 겹침 고치기 changes the day; 되돌리기 brings the old blocks back.
    const base = "/mari-kit/schedule/default";
    const today = (await api("GET", base)).today;
    const before = [
      { time: "09:00-10:00", activity: "e2e 공부", status: "dnd" },
      { time: "13:00-14:00", activity: "e2e 점심", status: "online" },
    ];
    await api("PUT", `${base}/day/${today}`, { blocks: before, repair: false });
    const blocksNow = async () => (await api("GET", base)).profile.days[today].map((b) => b.time).join(",");
    const original = await blocksNow();
    await goIn(page, `#/schedule/default/week/${encodeURIComponent(convo.id)}`);
    await page.getByRole("button", { name: "빈 시간 · 겹침 고치기" }).click();
    await until(async () => (await blocksNow()) !== original, 8000, "repair changed the day");
    await page.locator(".act-toast").getByRole("button", { name: "되돌리기" }).click();
    await until(async () => (await blocksNow()) === original, 8000, "되돌리기 restored the day");
    await snap(page, "safety-week");
  },

  // Menus (0.25): chat settings in labelled groups; switches for every room live in 설정 › 모든 방 공통 기능 (linked
  // from chat settings); one "can a character call me" switch in 통화 설정 that writes both Engine keys; the
  // commands folded in groups.
  async menus({ page }) {
    await open(page);
    await goIn(page, `#/chat-settings/${encodeURIComponent(convo.id)}`);
    for (const g of ["이 채팅의 AI", "등장과 세계", "기능", "도구", "모든 방 공통"])
      await page.locator(".gsec").filter({ hasText: g }).first().waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: /대사 음성 · 번역 · 기억 · 날씨/ }).click();
    await until(async () => (await hash(page)) === "#/settings/shared", 5000, "settings/shared");
    const weather = page.locator("#shared").getByRole("switch", { name: /날씨/ });
    await weather.waitFor({ timeout: 8000 });
    const was = (await api("GET", "/mari-kit/settings")).features?.weather === true;
    await weather.click();
    await until(
      async () => (await api("GET", "/mari-kit/settings")).features?.weather === !was,
      5000,
      "weather switched",
    );
    await page.locator("#shared").getByRole("switch", { name: /날씨/ }).click();
    await until(async () => (await api("GET", "/mari-kit/settings")).features?.weather === was, 5000, "weather back");
    await goIn(page, `#/chat-settings/${encodeURIComponent(convo.id)}/convo`);
    await page.getByRole("switch", { name: /명령 쓰기/ }).waitFor();
    if ((await page.locator("details.fgroup").count()) !== 3) throw new Error("commands should fold into 3 groups");
    if (await page.getByText("캐릭터가 전화 걸기", { exact: true }).count()) throw new Error("duplicate call switch");
    await goIn(page, `#/call-settings/${encodeURIComponent(convo.id)}`);
    const call = page.getByRole("switch", { name: /캐릭터가 먼저 전화 걸기/ });
    await call.waitFor();
    const before = await meta(convo.id);
    const on = before.conversationCommandToggles?.call !== false;
    await call.click();
    await until(
      async () => {
        const m = await meta(convo.id);
        return (m.conversationCommandToggles?.call !== false) === !on && m.conversationCharactersCanCall === !on;
      },
      5000,
      "both call keys written",
    );
    await snap(page, "menus-call");
  },

  // The call screen's subtitles and records (0.26), against the Calls package's API answered in the browser (the
  // package is not installed in the test Engine): the subtitle window with every line, the waiting line while a
  // reply is written, 자막 (subtitles first, larger text), and the call card in the Convo opening the full record.
  // Running work belongs to its room: memory organizing started in room A shows in A (its strip, or the note on
  // 기억 서재), never in room B. 기억: 묶음 can be 1, and the counts behind "정리 대기" are shown.
  async "memory-jobs"({ page }) {
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(convo.id)}`);
    await page.getByRole("textbox", { name: "메시지" }).waitFor();
    await page.evaluate(async (chat) => {
      // The same module instance the shell loaded (its versioned address), so the strip sees the job.
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((n) => n.endsWith("/lib/activity.js"));
      const { startJob } = await import(url);
      window.__stopJob = startJob("기억 정리 중…", null, { chat });
    }, convo.id);
    await page.locator(".act").getByText("기억 정리 중…").waitFor();
    await goIn(page, `#/convo/${encodeURIComponent(group.id)}`);
    await page.getByRole("textbox", { name: "메시지" }).waitFor();
    if (await page.getByText("기억 정리 중…").count()) throw new Error("room A's job shows in room B");
    await goIn(page, `#/memory/${encodeURIComponent(convo.id)}`);
    await page.locator(".jobnote").getByText("기억 정리 중…").waitFor();
    await page.evaluate(() => window.__stopJob());
    if (await page.locator(".jobnote").count()) throw new Error("the note stays after the job ended");
    await api("PATCH", `/mari-kit/memory/${convo.id}/settings`, { chunkMessages: 1 });
    const { status } = await api("GET", `/mari-kit/memory/${convo.id}`);
    if (status.chunkMessages !== 1) throw new Error(`묶음 1 not kept: ${status.chunkMessages}`);
    await page.reload();
    await page.getByText(/전체 \d+ · 정리됨 \d+/).waitFor();
    await api("PATCH", `/mari-kit/memory/${convo.id}/settings`, { chunkMessages: 24 });
  },
  async "call-subtitles"({ page }) {
    const sid = "e2e-call";
    const lines = [
      {
        id: "c1",
        participantKind: "character",
        characterId: a.id,
        kind: "speech",
        content: `もしもし？遅かったね。${LONG_JA}`,
        extra: {},
      },
      { id: "u1", participantKind: "user", kind: "speech", content: "응 미안", extra: {} },
      {
        id: "c2",
        participantKind: "character",
        characterId: a.id,
        kind: "speech",
        content: `괜찮아, 오늘 어땠어? ${LONG_JA}`,
        extra: {},
      },
    ];
    const session = { id: sid, chatId: convo.id, status: "active", startedAt: new Date().toISOString() };
    await page.route("**/api/conversation-calls/**", async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      const json = (body) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (url.includes("/status")) return json({ activeCall: null, ringingCall: null });
      if (url.endsWith("/start")) return json(session);
      if (url.endsWith(`/${sid}/messages`) && method === "GET") return json(lines);
      if (url.endsWith(`/${sid}/messages`) && method === "POST") {
        await new Promise((r) => setTimeout(r, 1500));
        const body = JSON.parse(route.request().postData() || "{}");
        lines.push({ id: "u2", participantKind: "user", kind: "speech", content: body.content, extra: {} });
        lines.push({
          id: "c3",
          participantKind: "character",
          characterId: a.id,
          kind: "speech",
          content: "좋네!",
          extra: {},
        });
        return json({ userMessage: { id: "u2" }, assistantMessages: [], session });
      }
      if (url.endsWith(`/${sid}/end`)) return json({ ok: true });
      return json({});
    });
    await page.route("**/api/tts/config", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: false, callAudioEnabled: true }),
      }),
    );
    await api("PATCH", `/chats/${convo.id}/metadata`, { conversationCallsEnabled: true });
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(convo.id)}`);
    await page.getByRole("button", { name: "전화 걸기" }).first().click();
    await page.locator(".sheet").getByRole("button", { name: "전화 걸기" }).click();
    await page.locator(".cx-subs .cx-line").filter({ hasText: "오늘 어땠어" }).waitFor({ timeout: 10000 });
    // Default: the line being said, large, with only the one before it.
    if ((await page.locator(".cx-subs.one .cx-line").count()) > 2)
      throw new Error("default caption should be one line");
    await page.locator(".cx-subs.one .cx-line.now").filter({ hasText: "오늘 어땠어" }).waitFor({ timeout: 3000 });
    const capPx = await page.locator(".cx-line.now .cx-t").evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    if (capPx < 21) throw new Error(`caption should be large, got ${capPx}px`);
    await snap(page, "call-caption");
    const offCap = await page.evaluate(offscreenText);
    if (offCap.length) throw new Error(`call caption runs off the screen: ${offCap.join(" | ")}`);
    await page.locator(".cx-in").fill("좋았어");
    await page.locator(".cx-send").click();
    await page.locator(".cx-line.wait").filter({ hasText: "답하는 중" }).waitFor({ timeout: 3000 });
    await page.locator(".cx-subs .cx-line").filter({ hasText: "좋네!" }).waitFor({ timeout: 10000 });
    await page.locator(".cx-in").blur();
    await page.getByRole("button", { name: "자막" }).click();
    await page.getByRole("radio", { name: "지난 대사까지" }).click();
    await page.getByRole("radio", { name: "크게", exact: true }).click();
    if (!(await page.locator(".callx.subs-first[data-size='l']").count())) throw new Error("자막 choices not applied");
    if ((await page.locator(".cx-subs:not(.one) .cx-line").count()) < 3)
      throw new Error("지난 대사까지 should show every line");
    const offList = await page.evaluate(offscreenText);
    if (offList.length) throw new Error(`call subtitles run off the screen: ${offList.join(" | ")}`);
    await page.keyboard.press("Escape");
    await page
      .locator(".scrim")
      .last()
      .click()
      .catch(() => {});
    await snap(page, "call-subtitles");
    await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem("mari-shell") || "{}");
      p.callSubMode = "face";
      p.callSubSize = "m";
      localStorage.setItem("mari-shell", JSON.stringify(p));
    });
    // The call card in the Convo opens the full record.
    const ev = await api("POST", `/chats/${convo.id}/messages`, { role: "system", content: "" });
    await api("PATCH", `/chats/${convo.id}/messages/${ev.id}/extra`, {
      conversationCallEvent: { callId: sid, status: "ended", durationMs: 125000, summary: null },
    });
    await page.locator(".cx-endrow").getByRole("button").click();
    await page.locator(".callcard").filter({ hasText: "대사" }).first().waitFor({ timeout: 10000 });
    await page.locator(".callsep").filter({ hasText: "통화 종료 · 내가 끊음" }).first().waitFor({ timeout: 8000 });
    await page.locator(".callcard").first().click();
    await page.locator(".tlog").getByText("통화 기록").first().waitFor();
    await page.locator(".tlog").getByRole("button", { name: "전체 복사" }).waitFor();
    const offLog = await page.evaluate(offscreenText);
    if (offLog.length) throw new Error(`call record runs off the screen: ${offLog.join(" | ")}`);
    await api("PATCH", `/chats/${convo.id}/metadata`, { conversationCallsEnabled: false });
    await page.unroute("**/api/conversation-calls/**");
    await page.unroute("**/api/tts/config");
  },

  // A character hangs up by itself ([end_call] after its last words, the package's call command): the screen says
  // so, ends the call, and the Convo keeps "통화 종료 · <name>가 끊음" under the call card. The first call also makes
  // the hang-up guide (a global lorebook whose one entry reaches calls only).
  async "call-hangup"({ page }) {
    const sid = "e2e-hangup";
    const session = { id: sid, chatId: convo.id, status: "active", startedAt: new Date().toISOString() };
    const lines = [
      { id: "h1", participantKind: "character", characterId: a.id, kind: "speech", content: "응?", extra: {} },
    ];
    let ended = 0;
    await page.route("**/api/conversation-calls/**", async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      const json = (body) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (url.includes("/status")) return json({ activeCall: null, ringingCall: null });
      if (url.endsWith("/start")) return json(session);
      if (url.endsWith(`/${sid}/messages`) && method === "GET") return json(lines);
      if (url.endsWith(`/${sid}/messages`) && method === "POST") {
        lines.push({ id: "h2", participantKind: "user", kind: "speech", content: "나 이제 자야겠다", extra: {} });
        lines.push({
          id: "h3",
          participantKind: "character",
          characterId: a.id,
          kind: "speech",
          content: "그래, 잘 자.",
          extra: {},
        });
        return json({
          userMessage: { id: "h2" },
          assistantMessages: [],
          turns: [
            { speakerName: "Aoi", mode: "voice", content: "그래, 잘 자.", characterId: a.id },
            { speakerName: "Aoi", mode: "command", content: "[end_call]", command: "[end_call]", characterId: a.id },
          ],
          session,
        });
      }
      if (url.endsWith(`/${sid}/end`)) {
        ended += 1;
        // The package writes its ended note into the Convo, as the real /end does.
        const ev = await api("POST", `/chats/${convo.id}/messages`, {
          role: "system",
          content: "Call ended after 1m 2s",
        });
        await api("PATCH", `/chats/${convo.id}/messages/${ev.id}/extra`, {
          conversationCallEvent: { callId: sid, status: "ended", durationMs: 62000, summary: null },
        });
        return json({ ...session, status: "ended" });
      }
      return json({});
    });
    await page.route("**/api/tts/config", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: false, callAudioEnabled: true }),
      }),
    );
    await api("PATCH", `/chats/${convo.id}/metadata`, { conversationCallsEnabled: true });
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(convo.id)}`);
    await page.getByRole("button", { name: "전화 걸기" }).first().click();
    await page.locator(".sheet").getByRole("button", { name: "전화 걸기" }).click();
    await page.locator(".cx-subs .cx-line").filter({ hasText: "응?" }).waitFor({ timeout: 10000 });
    await page.locator(".cx-in").fill("나 이제 자야겠다");
    await page.locator(".cx-send").click();
    await page.locator(".cx-time").filter({ hasText: "전화를 끊었어요" }).waitFor({ timeout: 10000 });
    await snap(page, "call-hung-up");
    await until(async () => ended === 1, 8000, "the screen ended the call after the character hung up");
    await page.locator(".callsep").filter({ hasText: "통화 종료 · " }).last().waitFor({ timeout: 10000 });
    await until(
      async () => (await page.locator(".callsep").last().innerText()).includes("끊음"),
      8000,
      "통화 종료 says who hung up",
    );
    // Under the call card, not above it.
    const order = await page.evaluate(() => {
      const card = [...document.querySelectorAll(".callcard")].pop();
      const line = [...document.querySelectorAll(".callsep")].pop();
      return card && line ? card.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING : -1;
    });
    if (!order) throw new Error("통화 종료 should sit under the call card");
    await snap(page, "call-ended-line");
    // The guide exists once, global, reaching calls only (its key never appears in a chat).
    const page1 = await api("GET", "/lorebooks?limit=20&offset=0&search=" + encodeURIComponent("Mari Kit · 통화"));
    const book = (page1.items || page1).find((b) => (b.tags || []).includes("mari-kit-call"));
    if (!book || book.isGlobal !== true || book.enabled === false) throw new Error("hang-up guide lorebook missing");
    const entries = await api("GET", `/lorebooks/${book.id}/entries`);
    const entry = (entries.items || entries)[0];
    if (!entry || !entry.content.includes("[end_call]") || entry.constant === true || entry.order > -100)
      throw new Error("hang-up guide entry is not the call-only first entry");
    await api("PATCH", `/chats/${convo.id}/metadata`, { conversationCallsEnabled: false });
    await page.unroute("**/api/conversation-calls/**");
    await page.unroute("**/api/tts/config");
  },

  // A character's call nobody answered: a ring older than 통화 설정 › 전화 울리는 시간 (the app was closed) is not rung
  // again but declined at once and kept as 부재중 전화 with 다시 걸기; its 전화가 왔어요 line goes.
  async "call-missed"({ page }) {
    const sid = "e2e-missed";
    const ringing = {
      id: sid,
      chatId: convo.id,
      status: "ringing",
      initiator: "character",
      initiatorCharacterId: a.id,
      createdAt: new Date(Date.now() - 45000).toISOString(),
    };
    const ring = await api("POST", `/chats/${convo.id}/messages`, { role: "system", content: "Incoming call" });
    await api("PATCH", `/chats/${convo.id}/messages/${ring.id}/extra`, {
      conversationCallEvent: { callId: sid, status: "ringing", mode: "audio", initiator: "character" },
    });
    let declined = 0;
    await page.route("**/api/conversation-calls/**", async (route) => {
      const url = route.request().url();
      const json = (body) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (url.includes("/status")) return json({ activeCall: null, ringingCall: declined ? null : ringing });
      if (url.endsWith(`/${sid}/decline`)) {
        declined += 1;
        // The package's own note, as the real /decline writes it.
        const ev = await api("POST", `/chats/${convo.id}/messages`, {
          role: "system",
          content: "Call declined",
          characterId: a.id,
        });
        await api("PATCH", `/chats/${convo.id}/messages/${ev.id}/extra`, {
          conversationCallEvent: { callId: sid, status: "declined", mode: "audio", initiator: "character" },
        });
        return json({ ...ringing, status: "declined" });
      }
      return json({});
    });
    await page.route("**/api/tts/config", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: false, callAudioEnabled: true }),
      }),
    );
    await api("PATCH", `/chats/${convo.id}/metadata`, { conversationCallsEnabled: true });
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(convo.id)}`);
    const line = page.locator(".callsep").filter({ hasText: "부재중 전화" });
    await line.last().waitFor({ timeout: 10000 });
    if (await page.locator(".callx:not([hidden]).ringing").count()) throw new Error("a stale ring should not ring");
    if (declined !== 1) throw new Error(`a missed call is declined once, got ${declined}`);
    await line.last().getByRole("button", { name: "다시 걸기" }).waitFor();
    if (await page.locator(".callsep").filter({ hasText: "전화가 왔어요" }).count())
      throw new Error("전화가 왔어요 should go once the call has a later note");
    await until(
      async () =>
        (await api("GET", `/chats/${convo.id}/messages`)).some(
          (m) => m.content === "Call declined" && JSON.stringify(m.extra || "").includes("mariMissed"),
        ),
      8000,
      "the declined note is marked missed (kept after a reload)",
    );
    await snap(page, "call-missed");
    await api("PATCH", `/chats/${convo.id}/metadata`, { conversationCallsEnabled: false });
    await page.unroute("**/api/conversation-calls/**");
    await page.unroute("**/api/tts/config");
  },

  // A group call: a character who leaves ([leave_call]) is dimmed in the people row and set offline for this call
  // only (the Engine's status, which the package reads to pick who speaks); 다시 부르기 sets them back, and so does
  // the end of the call.
  async "call-group"({ page }) {
    const sid = "e2e-group-call";
    const session = { id: sid, chatId: group.id, status: "active", startedAt: new Date().toISOString() };
    const lines = [
      { id: "g1", participantKind: "character", characterId: a.id, kind: "speech", content: "다 모였네", extra: {} },
    ];
    await page.route("**/api/conversation-calls/**", async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      const json = (body) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (url.includes("/status")) return json({ activeCall: null, ringingCall: null });
      if (url.endsWith("/start")) return json(session);
      if (url.endsWith(`/${sid}/messages`) && method === "GET") return json(lines);
      if (url.endsWith(`/${sid}/messages`) && method === "POST") {
        lines.push({ id: `g${lines.length + 1}`, participantKind: "user", kind: "speech", content: "응", extra: {} });
        return json({
          userMessage: { id: `g${lines.length}` },
          assistantMessages: [],
          turns: [
            { speakerName: "Bea", mode: "voice", content: "난 먼저 갈게", characterId: b.id },
            { speakerName: "Bea", mode: "command", content: "[leave_call]", characterId: b.id },
          ],
          session,
        });
      }
      if (url.endsWith(`/${sid}/end`)) return json({ ...session, status: "ended" });
      return json({});
    });
    await page.route("**/api/tts/config", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: false, callAudioEnabled: true }),
      }),
    );
    await api("PATCH", `/chats/${group.id}/metadata`, { conversationCallsEnabled: true });
    // The status is the Engine's own, on the character card (it reaches every room until the call ends).
    const leftMark = async () => {
      const row = await api("GET", `/characters/${b.id}`);
      const card = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      const o = card?.extensions?.conversationStatusOverride;
      return o?.status === "offline" ? o : null;
    };
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(group.id)}`);
    await page.getByRole("button", { name: "전화 걸기" }).first().click();
    await page.locator(".sheet").getByRole("button", { name: "전화 걸기" }).click();
    await page.locator(".cx-ppl .cx-p").nth(1).waitFor({ timeout: 10000 });
    const send = async () => {
      await page.locator(".cx-in").fill("응");
      await page.locator(".cx-send").click();
      await page.locator(".cx-p.off").filter({ hasText: "나감" }).waitFor({ timeout: 10000 });
      await page.locator(".cx-in").blur();
    };
    await send();
    await until(async () => !!(await leftMark()), 8000, "the one who left is offline for this call");
    const cached = (await meta(group.id)).conversationStatusOverrides?.[b.id];
    if (cached?.status !== "offline") throw new Error("the chat's copy (which the package reads) is not refreshed");
    if ((await page.locator(".cx-name").innerText()).includes(b.name)) throw new Error("the name line keeps who left");
    await snap(page, "call-group-left");
    await page.locator(".cx-p.off").filter({ hasText: "나감" }).click();
    await page
      .locator(".sheet")
      .getByRole("button", { name: /다시 부르기/ })
      .click();
    await until(async () => !(await leftMark()), 8000, "다시 부르기 sets the status back");
    if (await page.locator(".cx-p.off").count()) throw new Error("the one called back is still dimmed");
    await send();
    await until(async () => !!(await leftMark()), 8000, "left again");
    await page.locator(".cx-endrow").getByRole("button").click();
    await until(async () => !(await leftMark()), 8000, "the end of the call sets the status back");
    await api("PATCH", `/chats/${group.id}/metadata`, { conversationCallsEnabled: false });
    await page.unroute("**/api/conversation-calls/**");
    await page.unroute("**/api/tts/config");
  },

  // Call translations are kept with Mari Kit: the call log opened again (even after a reload) asks for none.
  async "call-translation-kept"({ page }) {
    const sid = "e2e-call-tr";
    const lines = [
      { id: "t0", callId: sid, participantKind: "user", kind: "text", content: "Hi", extra: {} },
      {
        id: "t1",
        callId: sid,
        participantKind: "character",
        characterId: a.id,
        kind: "speech",
        content: "Hello there",
        extra: {},
      },
      {
        id: "t2",
        callId: sid,
        participantKind: "character",
        characterId: a.id,
        kind: "speech",
        content: "See you",
        extra: {},
      },
    ];
    let translated = 0;
    await page.route("**/api/conversation-calls/**", async (route) => {
      const url = route.request().url();
      const json = (body) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (url.includes("/status")) return json({ activeCall: null, ringingCall: null });
      if (url.endsWith(`/${sid}/messages`)) return json(lines);
      return json({});
    });
    await page.route("**/api/translate", async (route) => {
      translated += 1;
      const body = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ translatedText: `번역: ${body.text || ""}` }),
      });
    });
    const ev = await api("POST", `/chats/${convo.id}/messages`, { role: "system", content: "Call ended after 1m" });
    await api("PATCH", `/chats/${convo.id}/messages/${ev.id}/extra`, {
      conversationCallEvent: { callId: sid, status: "ended", durationMs: 60000, summary: null },
    });
    await api("PATCH", `/chats/${convo.id}/metadata`, { autoTranslate: true });
    // My lines carry the persona's name and can be voiced too.
    await api("PATCH", `/chats/${convo.id}`, { personaId: persona.id });
    await page.route("**/api/tts/config", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: true, callAudioEnabled: true, voice: "e2e" }),
      }),
    );
    const openLog = async () => {
      await goIn(page, `#/convo/${encodeURIComponent(convo.id)}`);
      await page.locator(".callcard").last().click();
      await page.locator(".tlog .tline2").nth(1).waitFor({ timeout: 10000 });
      await page.locator(".tlog").getByText("번역: ").first().waitFor({ timeout: 10000 });
    };
    await open(page);
    await openLog();
    const first = translated;
    if (first < 2) throw new Error(`the first open translates each line, got ${first}`);
    const mine = page.locator(".tlog .tline2").first();
    if (!(await mine.innerText()).includes("Mari")) throw new Error("my call lines should carry the persona name");
    await mine.getByRole("button", { name: "다시 듣기" }).waitFor({ timeout: 3000 });
    await page.waitForTimeout(1200); // (saved after a short pause)
    await page.reload();
    await openLog();
    if (translated !== first) throw new Error(`reopened call log asked for ${translated - first} translations`);
    await api("PATCH", `/chats/${convo.id}/metadata`, { autoTranslate: false });
    await api("PATCH", `/chats/${convo.id}`, { personaId: null });
    await page.unroute("**/api/conversation-calls/**");
    await page.unroute("**/api/translate");
    await page.unroute("**/api/tts/config");
  },

  // Reactions and replies (the Engine's data): react from the quick row and take it back, see a character's
  // reaction, reply to a message (sent as replyTo) and see its quote.
  async "convo-react"({ page }) {
    let msgs = await api("GET", `/chats/${convo.id}/messages`);
    if (!msgs.some((m) => m.role === "assistant")) {
      await api("POST", `/chats/${convo.id}/messages`, { role: "assistant", characterId: a.id, content: "e2e hello" });
      msgs = await api("GET", `/chats/${convo.id}/messages`);
    }
    const target = [...msgs].reverse().find((m) => m.role === "assistant");
    await api("PATCH", `/chats/${convo.id}/messages/${target.id}/extra`, { reactions: [{ emoji: "😂", by: [a.id] }] });
    const reactionsNow = async () => {
      const m = (await api("GET", `/chats/${convo.id}/messages`)).find((x) => x.id === target.id);
      const extra = typeof m.extra === "string" ? JSON.parse(m.extra) : m.extra;
      return extra?.reactions || [];
    };
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(convo.id)}`);
    const bubble = page.locator(`[data-mid="${target.id}"]`);
    await bubble.locator(".rx").filter({ hasText: "😂" }).waitFor();
    await bubble.locator(".bub").last().click();
    // The bar is slim: six reactions, then ＋ for any emoji (the media panel's emoji tab), which then comes first.
    await snap(page, "react-bar");
    await page.getByRole("button", { name: "다른 반응" }).click();
    const any = page.locator(".mpanel .mp-e").nth(3);
    await any.waitFor();
    await snap(page, "react-panel");
    const pickedEmoji = (await any.innerText()).trim();
    await any.click();
    await until(
      async () => (await reactionsNow()).some((r) => r.emoji === pickedEmoji && r.by.includes("user")),
      5000,
      "reaction from the emoji panel saved",
    );
    if (await page.locator(".mpanel").isVisible()) throw new Error("the emoji panel stayed open after a reaction");
    await bubble.locator(".rx.mine").click();
    await until(async () => !(await reactionsNow()).some((r) => r.emoji === pickedEmoji), 5000, "panel reaction back");
    await bubble.locator(".bub").last().click();
    const first = (await page.locator(".rxbar button").first().innerText()).trim();
    if (first !== pickedEmoji) throw new Error(`the recent reaction is not first on the bar: ${first}`);
    await page.getByRole("button", { name: "❤️ 반응" }).click();
    await until(
      async () => (await reactionsNow()).some((r) => r.emoji === "❤️" && r.by.includes("user")),
      5000,
      "reaction saved",
    );
    await bubble.locator(".rx.mine").click();
    await until(async () => !(await reactionsNow()).some((r) => r.emoji === "❤️"), 5000, "reaction taken back");
    if (!(await reactionsNow()).some((r) => r.emoji === "😂")) throw new Error("the character's reaction was lost");
    // A long press shows who reacted; the character's reaction can be removed (asked first).
    await bubble.locator(".rx").filter({ hasText: "😂" }).click({ delay: 700 });
    await snap(page, "reactors");
    await page.getByRole("button", { name: /의 😂 반응 지우기$/ }).click();
    await page.getByRole("button", { name: "지우기", exact: true }).click();
    await until(async () => !(await reactionsNow()).some((r) => r.emoji === "😂"), 5000, "character reaction removed");
    if (await bubble.locator(".rx").count()) throw new Error("the removed reaction is still drawn");
    await bubble.locator(".bub").last().click();
    await page.getByRole("button", { name: "답장" }).first().click();
    await page.locator(".rbar").waitFor();
    await page.locator(".cmp textarea").fill("e2e reply");
    await page.getByRole("button", { name: "보내기" }).click();
    await until(
      async () =>
        (await api("GET", `/chats/${convo.id}/messages`)).some((m) => {
          const x = typeof m.extra === "string" ? JSON.parse(m.extra) : m.extra;
          return m.content === "e2e reply" && x?.replyTo?.messageId === target.id;
        }),
      10000,
      "reply sent with replyTo",
    );
    await page.locator(".rquote").first().waitFor();
    if (await page.locator(".rbar").isVisible()) throw new Error("reply bar stayed after sending");
  },

  // The composer (the Engine's ConversationInput): @mention a character in a group, send a picture made small on
  // the phone, and the user's own status (상태 시트 › 나) going out with the next message and into the Engine's
  // settings.
  async "convo-compose"({ page }) {
    const bodies = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/generate") && r.method() === "POST") bodies.push(JSON.parse(r.postData() || "{}"));
    });
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(group.id)}`);
    const box = page.locator(".cmp textarea");
    await box.waitFor();
    await box.click();
    await box.pressSequentially("@R");
    await page.locator(".mbox").getByRole("option", { name: /Ren/ }).click();
    if ((await box.inputValue()) !== "@Ren ")
      throw new Error(`mention inserted as ${JSON.stringify(await box.inputValue())}`);
    await box.pressSequentially("사진 봐");
    // A 900×600 PNG, made in the page, picked through the hidden file input.
    const png = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 900;
      c.height = 600;
      const g = c.getContext("2d");
      g.fillStyle = "#88a";
      g.fillRect(0, 0, 900, 600);
      return c.toDataURL("image/png").split(",")[1];
    });
    await page
      .locator('.cmp input[type="file"]')
      .setInputFiles({ name: "e2e.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await page.locator(".picbar .pic").waitFor();
    await page.getByRole("button", { name: "보내기" }).click();
    await until(async () => bodies.length > 0, 10000, "generate request");
    const sent = bodies[0];
    if (!sent.mentionedCharacterNames?.includes("Ren")) throw new Error("mentionedCharacterNames missing Ren");
    const att = sent.attachments?.[0];
    if (!att || !/^image\/(webp|jpeg)$/.test(att.type) || !att.data.startsWith(`data:${att.type};base64,`))
      throw new Error(`picture not sent as a small image: ${att?.type}`);
    await until(
      async () =>
        (await api("GET", `/chats/${group.id}/messages`)).some((m) => {
          const x = typeof m.extra === "string" ? JSON.parse(m.extra) : m.extra;
          return m.role === "user" && x?.attachments?.length;
        }),
      10000,
      "picture saved on the message",
    );
    if (await page.locator(".picbar").isVisible()) throw new Error("picture bar stayed after sending");
    // My status: 방해 금지 from the status sheet, saved for the Engine too, sent with the next message.
    await page.locator(".me-line").click();
    await page.getByRole("radio", { name: "방해 금지" }).click();
    await until(
      async () => {
        const ui = await api("GET", "/app-settings/ui");
        return JSON.parse(ui.value || "{}").userStatusManual === "dnd";
      },
      5000,
      "Engine settings got the status",
    );
    await page.keyboard.press("Escape");
    await page.goto(APP);
    await goIn(page, `#/convo/${encodeURIComponent(group.id)}`);
    await box.waitFor();
    await box.fill("e2e status");
    await page.getByRole("button", { name: "보내기" }).click();
    await until(async () => bodies.some((b) => b.userMessage === "e2e status"), 10000, "second message");
    if (bodies.find((b) => b.userMessage === "e2e status").userStatus !== "dnd") throw new Error("userStatus not dnd");
    // Put the Engine's setting back for the other flows.
    const ui = await api("GET", "/app-settings/ui");
    const value = {
      ...JSON.parse(ui.value || "{}"),
      userStatusManual: "active",
      userActivity: "",
      __updatedAt: Date.now(),
    };
    await api("PUT", "/app-settings/ui", { value: JSON.stringify(value) });
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
  recording = { pages: [], routes: new Set(), navigations: 0 };
  const s = await phone();
  const t = Date.now();
  try {
    await run(s);
    await s.page.evaluate(() => window.__mariCheck?.()).catch(() => {});
    await s.page.waitForTimeout(100);
    if (s.faults.size) throw new Error(`layout: ${[...s.faults].slice(0, 4).join(" | ")}`);
    console.log(`PASS ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    if (coverageOut) await keepCoverage(name);
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
if (!only && !tourMods) console.log(`First visit to 홈: ${Math.round((await firstVisit()) / 1024)}KB`);
if (tourMods ? tourMods.length : !only) {
  const tour = await screenTour({
    mods: tourMods,
    browser,
    app: APP,
    ids: { convo: convo.id, group: group.id, rp: rp.id, a: a.id, persona: persona.id },
    shots,
    resources,
  });
  failed += tour.failed;
}
// --crawl: every safe button on every toured screen (the sheets no flow opens).
if (crawl) {
  const result = await crawlScreens({
    browser,
    app: APP,
    mods: tourMods,
    ids: { convo: convo.id, group: group.id, rp: rp.id, a: a.id, persona: persona.id },
  });
  failed += result.failed;
}
if (coverageOut) await writeFile(coverageOut, JSON.stringify(coverage));
await browser.close();
llm.close();
if (failed) {
  console.error(`${failed} Mari shell flow(s) failed`);
  process.exit(1);
}
console.log("OK Mari shell flows");
