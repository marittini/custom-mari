// 캐릭터 일정: one character's week, as the Engine keeps it on the character card (extensions.conversationSchedule).
//   #/char-schedule/<chatId>/<characterId>[/<Day>]
// Day tabs (today first selected), the blocks with the current one marked, the routine summary, and the Engine's own
// AI: 이 날 다시 만들기 (POST /conversation/schedule/draft, saved on the card like the Engine's editor) and 이 주 다시
// 만들기 (POST /conversation/schedule/generate). Editing single blocks opens the Engine's schedule editor for now.

import { h, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data, characterIndex } from "../lib/data.js";
import { pageHead, toast, errorBox, ask, openEngine, hbox } from "../lib/ui.js";
import { startJob } from "../lib/activity.js";
import {
  DAYS,
  DAY_KO,
  STATUS_KO,
  adjacentBlocks,
  dayIndex,
  rangeLabel,
  timeZoneOf,
  wallClock,
  blockRange,
} from "../lib/presence.js";

const dot = (status) => h("span", { class: `sdot ${status}` });

export function charScheduleScreen({ mount, args, go, back }) {
  const chatId = args[0] || "";
  const characterId = args[1] || "";
  let day = DAYS.includes(args[2]) ? args[2] : null;
  let alive = true;
  let chat = null;
  let name = "캐릭터";
  let schedule = null;
  let busy = false;
  const body = h("div", { class: "scroll", style: { padding: "0 20px 32px" } });
  const head = h("div");
  mount.append(head, body);

  const meta = () => {
    try {
      return typeof chat?.metadata === "string" ? JSON.parse(chat.metadata) : chat?.metadata || {};
    } catch {
      return {};
    }
  };
  const tz = () => timeZoneOf(meta()) || Intl.DateTimeFormat().resolvedOptions().timeZone || "";

  async function load() {
    try {
      const [c, chars, st] = await Promise.all([
        data.chat(chatId),
        data.characters(),
        api.get(`/conversation/status/${encodeURIComponent(chatId)}`),
      ]);
      if (!alive) return;
      chat = c;
      name = characterIndex(chars).get(characterId)?.name || "캐릭터";
      schedule = st?.statuses?.[characterId]?.schedule || null;
      if (!day) day = DAYS[dayIndex(wallClock(new Date(), tz()))];
      draw();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  }

  async function run(label, fn) {
    if (busy) return;
    busy = true;
    let stopped = false;
    // The Engine's AI call cannot be cancelled once sent; 멈추기 drops its answer.
    const done = startJob(label, { label: "멈추기", fn: () => ((stopped = true), done(), (busy = false), draw()) });
    draw();
    try {
      await fn(() => stopped);
    } catch (error) {
      if (!stopped) toast(`하지 못했어요: ${error.message}`);
    } finally {
      if (!stopped) done();
      busy = false;
      if (alive) await load();
    }
  }

  const regenDay = async () => {
    if (!(await ask(`${DAY_KO[day]}요일 일정을 AI로 다시 만들까요? 지금 일정은 바뀌어요.`, { ok: "다시 만들기" })))
      return;
    run(`${name}의 ${DAY_KO[day]}요일 다시 만드는 중…`, async (stopped) => {
      const res = await api.post("/conversation/schedule/draft", {
        chatId,
        characterId,
        mode: "day",
        day,
        schedule,
        timeZone: tz() || undefined,
      });
      if (stopped() || !Array.isArray(res?.blocks)) return;
      const updated = {
        ...schedule,
        days: { ...schedule.days, [res.day || day]: res.blocks },
        weekStart: res.weekStart || schedule.weekStart,
      };
      await api.patch(`/characters/${encodeURIComponent(characterId)}`, {
        data: { extensions: { conversationSchedule: updated } },
        skipVersionSnapshot: true,
      });
      toast(`${DAY_KO[day]}요일을 다시 만들었어요`);
    });
  };
  const regenWeek = async () => {
    if (
      schedule &&
      !(await ask(`${name}의 이번 주 일정을 AI로 다시 만들까요? 지금 일정은 바뀌어요.`, { ok: "다시 만들기" }))
    )
      return;
    run(`${name}의 일주일 만드는 중…`, async (stopped) => {
      const res = await api.post("/conversation/schedule/generate", {
        chatId,
        characterIds: [characterId],
        forceRefresh: true,
        timeZone: tz() || undefined,
      });
      if (stopped()) return;
      const r = res?.results?.[characterId]?.status || "";
      if (r.startsWith("error")) throw new Error(r.slice(6).trim() || "AI가 일정을 만들지 못했어요");
      toast("일정을 만들었어요");
    });
  };

  function draw() {
    setChildren(
      head,
      pageHead(`${name}의 일정`, { label: "캐릭터 일정", back: () => back(`convo/${encodeURIComponent(chatId)}`) }),
    );
    if (!chat) return setChildren(body, h("div", { class: "empty" }, "불러오는 중…"));
    if (!schedule)
      return setChildren(
        body,
        h("div", { class: "empty" }, `${name}에게는 아직 일정이 없어요.`),
        h(
          "button",
          {
            type: "button",
            class: "pill main",
            disabled: busy,
            onClick: regenWeek,
            style: { minHeight: "48px", width: "100%" },
          },
          "AI로 일정 만들기",
        ),
      );
    const wall = wallClock(new Date(), tz());
    const today = DAYS[dayIndex(wall)];
    const { current } = adjacentBlocks(schedule, wall);
    const blocks = (Array.isArray(schedule.days?.[day]) ? schedule.days[day] : [])
      .map((b) => ({ b, r: blockRange(b) }))
      .sort((x, y) => (x.r?.start ?? 0) - (y.r?.start ?? 0));
    setChildren(
      body,
      h(
        "div",
        { class: "daytabs", role: "tablist", "aria-label": "요일" },
        DAYS.map((d) =>
          h(
            "button",
            {
              type: "button",
              role: "tab",
              class: d === day ? "on" : null,
              "aria-selected": d === day ? "true" : "false",
              onClick: () => ((day = d), draw()),
            },
            DAY_KO[d],
            d === today ? h("i", { "aria-label": "오늘" }) : null,
          ),
        ),
      ),
      h(
        "div",
        { class: "list wblocks" },
        blocks.length
          ? blocks.map(({ b }) => {
              const now = current && current.day === day && current.block === b;
              return h(
                "div",
                { class: now ? "r two static now-blk" : "r two static" },
                h("span", { class: "wb-t" }, rangeLabel(b.time)),
                h(
                  "span",
                  { class: "wb-a" },
                  dot(b.status),
                  h("span", null, b.activity || STATUS_KO[b.status]),
                  now ? h("small", null, "지금") : null,
                ),
              );
            })
          : h("div", { class: "empty" }, "이 날은 일정이 없어요"),
      ),
      schedule.routineSummary
        ? hbox(
            "평소 생활",
            schedule.routineSummary.length > 140
              ? h(
                  "details",
                  { class: "routine" },
                  h("summary", null, `${schedule.routineSummary.slice(0, 120)}… 펼치기`),
                  h("p", null, schedule.routineSummary),
                )
              : h("p", { class: "routine" }, schedule.routineSummary),
          )
        : null,
      h(
        "div",
        { class: "wacts" },
        h(
          "button",
          { type: "button", class: "pill", disabled: busy, onClick: regenDay },
          `${DAY_KO[day]}요일 다시 만들기`,
        ),
        h("button", { type: "button", class: "pill", disabled: busy, onClick: regenWeek }, "이 주 다시 만들기"),
        h(
          "button",
          {
            type: "button",
            class: "pill",
            onClick: () => openEngine(chatId, { character: characterId, tab: "convo" }),
          },
          "칸별로 고치기 · 엔진",
        ),
      ),
      h(
        "p",
        { class: "hint" },
        "엔진 화면은 처음 열 때 몇 MB를 받아요. 칸별 고치기는 다음 업데이트에서 Mari 안으로 옮겨요.",
      ),
    );
  }

  draw();
  load();
  return {
    dispose: () => {
      alive = false;
    },
  };
}
