// Editing a character's week block by block, as the Engine's schedule editor does (CharacterScheduleEditorModal):
// each block is { time: "HH:MM-HH:MM", activity, status }; add, change, delete, and copy one day onto others. The
// whole schedule is saved on the character card (extensions.conversationSchedule). Pure, so custom-modules/tests can
// check it.

import { DAYS, STATUSES, blockRange } from "./presence.js";

const pad = (n) => String(n).padStart(2, "0");
const wrap = (min) => ((min % 1440) + 1440) % 1440;
const clock = (min) => `${pad(Math.floor(wrap(min) / 60))}:${pad(wrap(min) % 60)}`;

/** A copy of the week's blocks to edit (the Engine's cloneDays). */
export function draftDays(schedule) {
  const days = {};
  for (const d of DAYS)
    days[d] = (Array.isArray(schedule?.days?.[d]) ? schedule.days[d] : []).map((b) => ({
      time: String(b?.time || ""),
      activity: String(b?.activity || ""),
      status: STATUSES.includes(b?.status) ? b.status : "online",
    }));
  return days;
}

/** "07:00-09:30" → { from: "07:00", to: "09:30" } for the two time boxes ("" where it cannot be read). */
export function splitTime(time) {
  const r = blockRange({ time });
  return r ? { from: clock(r.start), to: clock(r.end) } : { from: "", to: "" };
}
export const joinTime = (from, to) => `${from}-${to}`;

/**
 * The block a ＋ adds: the day's first free time, up to an hour (the Engine always adds 09:00-10:00, free time;
 * that is the fallback when the day is full).
 */
export function newBlock(blocks) {
  // A block past midnight also counts for this day's early hours (yesterday's is usually the same).
  const taken = blocks.map((b) => blockRange(b)).filter(Boolean);
  const free = (m) => !taken.some((r) => (r.start <= m && m < r.end) || m < r.end - 1440);
  for (let start = 0; start < 1440; start += 30) {
    if (!free(start)) continue;
    let end = start;
    while (end < start + 60 && end < 1440 && free(end)) end += 30;
    return { time: joinTime(clock(start), clock(end)), activity: "", status: "online" };
  }
  return { time: "09:00-10:00", activity: "", status: "online" };
}

/** Blocks in time order (unreadable times last), as they are shown and saved. */
export function sortBlocks(blocks) {
  return [...blocks].sort((a, b) => (blockRange(a)?.start ?? 9999) - (blockRange(b)?.start ?? 9999));
}

/** What stops a save: [{ day, index, why }] for blocks whose time cannot be read or starts and ends together. */
export function problems(days) {
  const out = [];
  for (const d of DAYS)
    (days[d] || []).forEach((b, index) => {
      const { from, to } = splitTime(b.time);
      if (!from || !to) out.push({ day: d, index, why: "시간을 읽을 수 없어요" });
      else if (from === to) out.push({ day: d, index, why: "시작과 끝이 같아요" });
    });
  return out;
}

/** Pairs of blocks on one day that overlap (a warning: the Engine saves them, the earlier one wins). */
export function overlaps(blocks) {
  const rs = blocks.map((b, i) => ({ i, r: blockRange(b) })).filter((x) => x.r);
  const out = [];
  for (let a = 0; a < rs.length; a++)
    for (let b = a + 1; b < rs.length; b++)
      if (rs[a].r.start < rs[b].r.end && rs[b].r.start < rs[a].r.end) out.push([rs[a].i, rs[b].i]);
  return out;
}

/** The days with `from`'s blocks copied over each target day. */
export function copyDay(days, from, targets) {
  const next = { ...days };
  for (const d of targets) if (d !== from) next[d] = (days[from] || []).map((b) => ({ ...b }));
  return next;
}

/** The schedule to save: the card's schedule with the edited days, activities trimmed, blocks in order. */
export function scheduleWith(schedule, days) {
  const clean = {};
  for (const d of DAYS)
    clean[d] = sortBlocks(days[d] || []).map((b) => ({ ...b, activity: b.activity.replace(/\s+/g, " ").trim() }));
  return { ...schedule, days: clean };
}

/** True when the edited days differ from the saved schedule. */
export function changed(schedule, days) {
  return JSON.stringify(draftDays(schedule)) !== JSON.stringify(draftDays({ days }));
}
