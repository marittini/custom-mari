#!/usr/bin/env node
// Mari shell flow tests at phone size, against a running Engine with Mari Kit installed whose data can be thrown away
// (it creates a connection to a local fake model, characters, personas and chats). Each flow is what a user does:
// open the app, move around and back, send in Convo and RP, group speakers, chat settings views, a chat cover,
// characters writing first. Also prints the transfer of the first visit, and tours every main screen at 360px
// (transfer per screen, sideways page scroll, page errors; e2e/screens.mjs). Needs Playwright's Chromium.
//
//   node custom-modules/scripts/shell-e2e.mjs [http://127.0.0.1:7860] [--only flow,flow] [--screens mod,mod]
//                                             [--shots <dir>]
//   --only: just these flows (none: "--only -"). --screens: tour only the screens drawn by these screen modules
//   (shell/screens/<mod>.js; "-" for none). Without either, everything runs, with the first-visit transfer.

import { chromium, devices } from "./e2e/playwright.mjs";
import { dirname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { startFakeLlm } from "./e2e/fake-llm.mjs";
import { screenTour } from "./e2e/screens.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const list = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1].split(",").filter((x) => x && x !== "-") : null;
const only = list("--only");
const tourMods = list("--screens");
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
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, errors };
}
const hash = (page) => page.evaluate(() => location.hash);
// With --shots, flows keep a screenshot of the states worth a look (an edit form, a sheet) next to the tour's.
const snap = (page, name) => (shots ? page.screenshot({ path: join(shots, `flow-${name}.png`) }) : null);
if (shots) await mkdir(shots, { recursive: true });
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

  // The Engine's presence: an offline character does not answer (and Mari says why); an away one answers later,
  // with 지금 답하게 to ask again without the wait. Pictures on messages; day separator and times.
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
    await until(
      () => page.locator(".pwait.delayed").filter({ hasText: "자리를 비웠어요" }).isVisible(),
      15000,
      "away note",
    );
    if (await page.locator(".pnote").count()) throw new Error("the offline note stayed after sending again");
    await page.getByRole("button", { name: "지금 답하게" }).click();
    await until(async () => (await messageCount(presence.id)) > before + 1, 10000, "reply now answered");
    await until(async () => !(await page.locator(".pwait").count()), 5000, "notice gone after the answer");
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
    await added.getByLabel(/하는 일$/).fill("e2e 산책");
    await added.getByRole("radio", { name: "바쁨" }).click();
    await snap(page, "schedule-edit");
    await page.getByRole("button", { name: "다른 요일에 복사…" }).click();
    await page.getByRole("button", { name: "월요일", exact: true }).click();
    await snap(page, "schedule-copy");
    await page.getByRole("button", { name: "1개 요일에 복사" }).click();
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page.locator(".wblocks").getByText("e2e 산책").waitFor({ timeout: 10000 });
    const card = await api("GET", `/characters/${rin.id}`);
    const saved = (typeof card.data === "string" ? JSON.parse(card.data) : card.data).extensions.conversationSchedule;
    for (const d of ["Sunday", "Monday"]) {
      const b = saved.days[d].find((x) => x.activity === "e2e 산책");
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
    await page.setViewportSize({ width: 360, height: 780 });
    await open(page);
    await goIn(page, `#/convo/${encodeURIComponent(convo.id)}`);
    const box = page.locator(".cin");
    await box.waitFor();
    const before = (await box.boundingBox()).width;
    await page.getByRole("button", { name: "이모지·스티커" }).click();
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
    // A sticker sent at once.
    await page.getByRole("button", { name: "이모지·스티커" }).click();
    await page.getByRole("tab", { name: "스티커" }).click();
    await page.getByRole("button", { name: "e2e_wave" }).first().click();
    await page.getByRole("button", { name: "바로 보내기" }).click();
    await until(
      async () => (await api("GET", `/chats/${convo.id}/messages`)).some((m) => m.content === "sticker:e2e_wave:"),
      10000,
      "sticker sent",
    );
    // How characters are offered emojis, from the panel.
    await page.getByRole("button", { name: "이모지·스티커" }).click();
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
    await page.locator(".sw-row").last().waitFor();
    if (!(await page.locator(".sw-row").last().getByRole("button", { name: "다음 답" }).isDisabled()))
      throw new Error("다음 답 should be disabled on the newest reply");
    await page.locator(".sw-row").last().getByRole("button", { name: "새 답 만들기" }).waitFor();
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
if (!only && !tourMods) console.log(`First visit to 홈: ${Math.round((await firstVisit()) / 1024)}KB`);
if (tourMods ? tourMods.length : !only) {
  const tour = await screenTour({
    mods: tourMods,
    browser,
    app: APP,
    ids: { convo: convo.id, group: group.id, rp: rp.id, a: a.id, persona: persona.id },
    shots,
  });
  failed += tour.failed;
}
await browser.close();
llm.close();
if (failed) {
  console.error(`${failed} Mari shell flow(s) failed`);
  process.exit(1);
}
console.log("OK Mari shell flows");
