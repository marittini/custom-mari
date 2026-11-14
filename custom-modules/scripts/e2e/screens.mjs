// Screen tour for the Mari shell: opens every main screen at 360px, as the owner's phone shows it, and reports for
// each one the data it moved (transfer), whether the page scrolls sideways (fail), sideways scrollers inside it
// (warning: a tab or chip hidden in a sideways scroll), and page errors (fail). With `shots`, keeps a screenshot of
// each screen there.

import { join } from "node:path";
import { mkdir } from "node:fs/promises";

/** The screens to visit, from the seeded ids: { convo, group, rp, a, persona }. */
export function tourScreens(ids) {
  const e = encodeURIComponent;
  return [
    ["홈", "home"],
    ["대화 목록", "convos"],
    ["서재", "library"],
    ["설정", "settings"],
    ["Convo 1:1", `convo/${e(ids.convo)}`],
    ["Convo 단체", `convo/${e(ids.group)}`],
    ["RP", `rp/${e(ids.rp)}`],
    ["채팅 설정 Convo", `chat-settings/${e(ids.convo)}`],
    ["채팅 설정 RP", `chat-settings/${e(ids.rp)}`],
    ["통화 설정", `call-settings/${e(ids.convo)}`],
    ["번역 설정", `translation/${e(ids.rp)}`],
    ["캐릭터 프로필", `character/${e(ids.a)}`],
    ["캐릭터 편집", `edit/character/${e(ids.a)}`],
    ["페르소나 편집", `edit/persona/${e(ids.persona)}`],
    ["내 일정", `schedule/default/now/${e(ids.convo)}`],
    ["캐릭터 일정", `char-schedule/${e(ids.convo)}/${e(ids.a)}`],
    ["기억 서재", `memory/${e(ids.rp)}`],
    ["메시지 검색", `search/${e(ids.rp)}`],
    ["음성", "voice"],
    ["라디오", "radio"],
    ["크레딧", "credit"],
    ["읽기 설정", "reader"],
    ["폴더 관리", "folders/convo"],
    ["그룹 관리", "groups/characters"],
    ["생성 중", "generations"],
  ];
}

/** Waits until no request has been in flight for `quiet` ms (or `max` ms passed). */
function settle(page, { quiet = 700, max = 10000 } = {}) {
  return new Promise((resolve) => {
    let inflight = 0;
    let timer = null;
    const start = Date.now();
    const arm = () => {
      clearTimeout(timer);
      if (inflight === 0) timer = setTimeout(done, quiet);
    };
    const up = () => {
      inflight += 1;
      clearTimeout(timer);
    };
    const down = () => {
      inflight = Math.max(0, inflight - 1);
      arm();
    };
    const cap = setTimeout(done, max);
    function done() {
      clearTimeout(timer);
      clearTimeout(cap);
      page.off("request", up);
      page.off("requestfinished", down);
      page.off("requestfailed", down);
      resolve(Date.now() - start);
    }
    page.on("request", up);
    page.on("requestfinished", down);
    page.on("requestfailed", down);
    arm();
  });
}

/** Which screen modules (shell/screens/<mod>.js) each shell-e2e flow goes through, so a change can run only the
 *  flows that reach it. Keep it in step with the flows. */
export const FLOW_SCREENS = {
  home: ["home", "credit"],
  "fresh-open": ["home", "settings", "convos"],
  back: ["convos", "convo", "chat-settings"],
  "convo-send": ["convo", "convos"],
  "rp-send": ["rp"],
  "group-speakers": ["convo"],
  "chat-settings": ["chat-settings"],
  cover: ["chat-settings", "convos"],
  autonomy: ["convo", "convos"],
  "convo-presence": ["convo"],
  "convo-schedule": ["convo", "convos", "char-schedule"],
};

/** Runs the tour (only screens drawn by `mods`, if given). Returns { rows, failed }. app: the shell URL. */
export async function screenTour({ browser, app, ids, mods = null, shots = null, log = console.log }) {
  if (shots) await mkdir(shots, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 780 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  let errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let bytes = 0;
  page.on("requestfinished", async (r) => {
    const s = await r.sizes().catch(() => null);
    if (s) bytes += s.responseBodySize + s.responseHeadersSize;
  });
  await page.goto(app);
  await page.waitForSelector(".dock");
  await settle(page);

  const rows = [];
  let failed = 0;
  const screens = tourScreens(ids).filter(([, hash]) => !mods || mods.includes(hash.split("/")[0]));
  for (const [name, hash] of screens) {
    errors = [];
    bytes = 0;
    const waiting = settle(page);
    await page.evaluate((h) => (location.hash = `#/${h}`), hash); // in-app move, as a tap does
    await waiting;
    await page.waitForTimeout(150);
    const check = await page.evaluate(() => {
      const wide = document.documentElement.scrollWidth - innerWidth;
      const sideways = [];
      for (const el of document.querySelectorAll("body *")) {
        if (el.scrollWidth <= el.clientWidth + 1) continue;
        const ox = getComputedStyle(el).overflowX;
        if (ox !== "auto" && ox !== "scroll") continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const cls =
          typeof el.className === "string" && el.className.trim()
            ? `.${el.className.trim().split(/\s+/).join(".")}`
            : "";
        sideways.push(`${el.tagName.toLowerCase()}${cls}`);
      }
      return { wide, sideways: [...new Set(sideways)].slice(0, 4) };
    });
    const bad = check.wide > 1 || errors.length > 0;
    if (bad) failed += 1;
    rows.push({ name, hash, kb: bytes / 1024, ...check, errors: [...errors] });
    if (shots)
      await page.screenshot({ path: join(shots, `${String(rows.length).padStart(2, "0")}-${hash.split("/")[0]}.png`) });
  }
  await ctx.close();

  log("Screens at 360px (transfer when moving there in the app):");
  for (const r of rows) {
    const notes = [
      r.wide > 1 ? `PAGE SCROLLS SIDEWAYS +${r.wide}px` : "",
      r.errors.length ? `ERROR ${r.errors[0].slice(0, 120)}` : "",
      r.sideways.length ? `sideways: ${r.sideways.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    log(
      `  ${r.wide > 1 || r.errors.length ? "FAIL" : "ok  "} ${r.name.padEnd(14)} ${r.kb.toFixed(1).padStart(7)}KB  ${notes}`,
    );
  }
  if (shots) log(`  screenshots: ${shots}`);
  return { rows, failed };
}
