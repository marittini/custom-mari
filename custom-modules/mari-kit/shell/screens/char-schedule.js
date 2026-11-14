// 캐릭터 일정: one character's week, as the Engine keeps it on the character card (extensions.conversationSchedule).
//   #/char-schedule/<chatId>/<characterId>[/<Day>]
// Day tabs (today first selected), the blocks with the current one marked, the routine summary, and the Engine's own
// AI: 이 날 다시 만들기 (POST /conversation/schedule/draft, saved on the card like the Engine's editor) and 이 주 다시
// 만들기 (POST /conversation/schedule/generate). 고치기 edits the blocks in place (time, status, activity; add, delete,
// copy a day onto others) and saves the card like the Engine's schedule editor; its other settings (talkativeness,
// check-in moments, summary, import/export) stay in the Engine's editor.

import { h, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data, characterIndex } from "../lib/data.js";
import { pageHead, toast, errorBox, ask, openEngine, hbox, sheet } from "../lib/ui.js";
import { startJob } from "../lib/activity.js";
import {
  DAYS,
  DAY_KO,
  STATUS_KO,
  STATUSES,
  adjacentBlocks,
  dayIndex,
  rangeLabel,
  timeZoneOf,
  wallClock,
  blockRange,
} from "../lib/presence.js";
import {
  changed,
  copyDay,
  draftDays,
  joinTime,
  newBlock,
  overlaps,
  problems,
  scheduleWith,
  splitTime,
} from "../lib/schedule-edit.js";

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
  let draft = null; // the days being edited (고치기), or null
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

  const saveCard = (next) =>
    api.patch(`/characters/${encodeURIComponent(characterId)}`, {
      data: { extensions: { conversationSchedule: next } },
      skipVersionSnapshot: true,
    });

  // ── 고치기: the blocks of every day as a draft; nothing is saved until 저장 ──
  const startEdit = () => ((draft = draftDays(schedule)), draw());
  async function stopEdit() {
    if (draft && changed(schedule, draft) && !(await ask("고친 내용을 저장하지 않고 닫을까요?", { ok: "버리기" })))
      return false;
    draft = null;
    draw();
    return true;
  }
  async function saveEdit() {
    const bad = problems(draft);
    if (bad.length) {
      day = bad[0].day;
      draw();
      return toast(`${DAY_KO[bad[0].day]}요일 ${bad[0].index + 1}번째 칸: ${bad[0].why}`);
    }
    busy = true;
    draw();
    try {
      await saveCard(scheduleWith(schedule, draft));
      draft = null;
      toast("일정을 저장했어요");
    } catch (error) {
      toast(`저장하지 못했어요: ${error.message}`);
    } finally {
      busy = false;
      if (alive) await load();
    }
  }
  function copyTo() {
    const picked = new Set();
    const box = h("div", { class: "psheet" });
    const s = sheet(box, { label: "다른 요일에 복사" });
    const paint = () =>
      setChildren(
        box,
        h("b", { class: "psheet-title" }, `${DAY_KO[day]}요일 일정을 어디에 복사할까요?`),
        h(
          "div",
          { class: "chips", role: "group", "aria-label": "복사할 요일" },
          DAYS.filter((d) => d !== day).map((d) =>
            h(
              "button",
              {
                type: "button",
                class: picked.has(d) ? "chip on" : "chip",
                "aria-pressed": picked.has(d) ? "true" : "false",
                onClick: () => (picked.has(d) ? picked.delete(d) : picked.add(d), paint()),
              },
              `${DAY_KO[d]}요일`,
            ),
          ),
          h(
            "button",
            {
              type: "button",
              class: "chip",
              onClick: () => (DAYS.forEach((d) => d !== day && picked.add(d)), paint()),
            },
            "모두",
          ),
        ),
        h("p", { class: "hint", style: { margin: "0" } }, "고른 요일의 칸은 이 요일 칸으로 바뀌어요. 저장해야 남아요."),
        h(
          "button",
          {
            type: "button",
            class: "pill main",
            disabled: !picked.size,
            style: { minHeight: "48px" },
            onClick: () => {
              draft = copyDay(draft, day, [...picked]);
              s.close();
              toast(`${[...picked].map((d) => DAY_KO[d]).join("·")}요일에 복사했어요`);
              draw();
            },
          },
          picked.size ? `${picked.size}개 요일에 복사` : "요일을 골라 주세요",
        ),
      );
    paint();
  }
  function blockEditor(b, i, warn) {
    const set = (patch, redraw = false) => {
      draft[day][i] = { ...draft[day][i], ...patch };
      if (redraw) draw();
    };
    const t = splitTime(b.time);
    const from = h("input", { type: "time", class: "inp", value: t.from, "aria-label": `${i + 1}번째 칸 시작` });
    const to = h("input", { type: "time", class: "inp", value: t.to, "aria-label": `${i + 1}번째 칸 끝` });
    const onTime = () => set({ time: joinTime(from.value, to.value) }, true);
    from.addEventListener("change", onTime);
    to.addEventListener("change", onTime);
    return h(
      "div",
      { class: warn ? "eblk warn" : "eblk" },
      h(
        "div",
        { class: "eblk-t" },
        from,
        h("span", { "aria-hidden": "true" }, "–"),
        to,
        h(
          "button",
          {
            type: "button",
            class: "eblk-x",
            "aria-label": `${i + 1}번째 칸 지우기`,
            onClick: () => (draft[day].splice(i, 1), draw()),
          },
          "×",
        ),
      ),
      h(
        "div",
        { class: "chips", role: "radiogroup", "aria-label": `${i + 1}번째 칸 상태` },
        STATUSES.map((st) =>
          h(
            "button",
            {
              type: "button",
              class: st === b.status ? "chip on" : "chip",
              role: "radio",
              "aria-checked": st === b.status ? "true" : "false",
              onClick: () => set({ status: st }, true),
            },
            dot(st),
            STATUS_KO[st],
          ),
        ),
      ),
      h("input", {
        class: "inp",
        value: b.activity,
        maxlength: 200,
        placeholder: `하는 일 (비우면 '${STATUS_KO[b.status]}')`,
        "aria-label": `${i + 1}번째 칸 하는 일`,
        onInput: (e) => set({ activity: e.target.value }),
      }),
      warn ? h("p", { class: "hint eblk-warn" }, warn) : null,
    );
  }
  function editView() {
    const blocks = draft[day] || [];
    const why = new Map(problems({ [day]: blocks }).map((p) => [p.index, p.why]));
    for (const [a, b] of overlaps(blocks)) {
      if (!why.has(a)) why.set(a, `${b + 1}번째 칸과 시간이 겹쳐요`);
      if (!why.has(b)) why.set(b, `${a + 1}번째 칸과 시간이 겹쳐요`);
    }
    return [
      h(
        "div",
        { class: "eblks" },
        blocks.length
          ? blocks.map((b, i) => blockEditor(b, i, why.get(i)))
          : h("div", { class: "empty" }, "이 날은 칸이 없어요"),
      ),
      h(
        "div",
        { class: "wacts" },
        h(
          "button",
          { type: "button", class: "pill", onClick: () => ((draft[day] = [...blocks, newBlock(blocks)]), draw()) },
          "＋ 칸 추가",
        ),
        h("button", { type: "button", class: "pill", onClick: copyTo }, "다른 요일에 복사…"),
      ),
      h(
        "p",
        { class: "hint" },
        "저장할 때 칸은 시간 순서로 정리돼요. 겹치는 칸은 엔진에서도 앞 칸이 먼저예요. 저장하면 이 캐릭터의 모든 채팅에 적용돼요.",
      ),
      h(
        "div",
        { class: "ebar" },
        h("button", { type: "button", class: "pill", disabled: busy, onClick: stopEdit }, "취소"),
        h(
          "button",
          { type: "button", class: "pill main", disabled: busy || !changed(schedule, draft), onClick: saveEdit },
          busy ? "저장하는 중…" : "저장",
        ),
      ),
    ];
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
      await saveCard(updated);
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
      pageHead(draft ? `${name}의 일정 고치기` : `${name}의 일정`, {
        label: "캐릭터 일정",
        back: async () => {
          if (draft && !(await stopEdit())) return;
          back(`convo/${encodeURIComponent(chatId)}`);
        },
      }),
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
      draft ? editView() : null,
      draft
        ? null
        : h(
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
      !draft && schedule.routineSummary
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
      draft
        ? null
        : h(
            "div",
            { class: "wacts" },
            h("button", { type: "button", class: "pill main", disabled: busy, onClick: startEdit }, "칸 고치기"),
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
              "말수·먼저 말 걸기 설정 · 엔진",
            ),
          ),
      draft
        ? null
        : h(
            "p",
            { class: "hint" },
            "말수, 먼저 말 거는 때, 생활 요약, 가져오기·내보내기는 엔진의 일정 편집기에 있어요. 엔진 화면은 처음 열 때 몇 MB를 받아요.",
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
