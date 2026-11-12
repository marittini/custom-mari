#!/usr/bin/env node
// After an upstream Engine update: does the shell's chat-settings list (mari-kit/shell/lib/engine-sections.js) still
// cover every section the Engine's Chat Settings shows? Reads the sections a running Engine renders for a Convo and
// an RP chat (with two characters, so group sections appear) and reports new ones the shell does not list and listed
// ones the Engine no longer has. Run it against an Engine whose data can be thrown away (it creates a character and
// two chats); needs Playwright's Chromium.
//
//   node custom-modules/scripts/check-engine-sections.mjs [http://127.0.0.1:7860]

import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const base = (process.argv[2] || process.env.ENGINE_URL || "http://127.0.0.1:7860").replace(/\/$/, "");
const { ENGINE_SECTIONS } = await import(
  pathToFileURL(join(here, "..", "mari-kit", "shell", "lib", "engine-sections.js")).href
);
const { chromium } = createRequire(resolve(here, "..", "..", "package.json"))("playwright");

const H = { "content-type": "application/json", "x-marinara-csrf": "1" };
const post = async (path, body) => {
  const res = await fetch(`${base}/api${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
};
const a = await post("/characters", { data: { name: "Probe A", description: "probe" } });
const b = await post("/characters", { data: { name: "Probe B", description: "probe" } });

const browser = await chromium.launch();
const problems = [];
for (const mode of ["conversation", "roleplay"]) {
  const chat = await post("/chats", { name: `probe ${mode}`, mode, characterIds: [a.id, b.id] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((id) => {
    sessionStorage.setItem("mari-kit:engine-tab", "1");
    localStorage.setItem("marinara-active-chat-id", id);
  }, chat.id);
  const page = await ctx.newPage();
  await page.goto(`${base}/`);
  await page.waitForFunction(() => globalThis.__MARINARA_HOST__?.stores?.chat, null, { timeout: 60000 });
  await page.waitForFunction((id) => globalThis.__MARINARA_HOST__.stores.chat.getState().activeChatId === id, chat.id, {
    timeout: 30000,
  });
  await page.evaluate(() => globalThis.__MARINARA_HOST__.stores.chat.getState().setShouldOpenSettings(true));
  await page.waitForSelector("[data-chat-settings-section]", { timeout: 30000 });
  await page.waitForTimeout(1500);
  const engine = await page.evaluate(() =>
    [...document.querySelectorAll("[data-chat-settings-section]")].map((e) =>
      e.getAttribute("data-chat-settings-section"),
    ),
  );
  await ctx.close();

  const listed = Object.values(ENGINE_SECTIONS)
    .flat()
    .filter(([, , modes]) => modes.includes(mode))
    .flatMap(([, ids]) => ids);
  const covers = (sectionId) => listed.some((id) => sectionId === id || sectionId === `${mode}-${id}`);
  for (const id of engine)
    if (!covers(id)) problems.push(`${mode}: new Engine section "${id}" is not in the shell list`);
  for (const [label, ids, modes] of Object.values(ENGINE_SECTIONS).flat()) {
    if (!modes.includes(mode) || !ids.length) continue;
    if (!ids.some((id) => engine.includes(id) || engine.includes(`${mode}-${id}`)))
      problems.push(`${mode}: shell row "${label}" (${ids.join("/")}) has no Engine section any more`);
  }
  console.log(`${mode}: ${engine.length} Engine sections`);
}
await browser.close();
if (problems.length) {
  console.error(`Mari shell chat settings are out of step with the Engine:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("OK Mari shell chat settings list every Engine section");
