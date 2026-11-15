// A character's Convo presence, computed the way the Engine does (packages/shared/src/utils/conversation-presence.ts,
// client lib/conversation-presence-status.ts): the week schedule on the character card, a manual override, the
// chat's time zone. The chat list and the header use the chat's own cached copy (no request); the status sheet
// reads GET /conversation/status/:chatId for the fresh one. Pure, so custom-modules/tests can check it.

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_KO = {
  Monday: "월",
  Tuesday: "화",
  Wednesday: "수",
  Thursday: "목",
  Friday: "금",
  Saturday: "토",
  Sunday: "일",
};
export const STATUS_KO = { online: "온라인", idle: "자리 비움", dnd: "바쁨", offline: "오프라인" };
export const STATUSES = ["online", "idle", "dnd", "offline"];
const VALID = new Set(STATUSES);

/** The wall clock in a time zone as a local Date (the Engine's toConversationScheduleWallClockDate). */
export function wallClock(date, timeZone) {
  if (!timeZone) return date;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(date)
        .map((p) => [p.type, p.value]),
    );
    const h = Number(parts.hour);
    return new Date(+parts.year, +parts.month - 1, +parts.day, h === 24 ? 0 : h, +parts.minute, +parts.second);
  } catch {
    return date;
  }
}

export const dayIndex = (date) => (date.getDay() + 6) % 7;
function parseClock(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** "06:00-08:00" → { start, end } in minutes; a block that ends past midnight ends after 1440. */
export function blockRange(block) {
  const [a, b] = String(block?.time || "").split("-");
  const start = parseClock(a);
  let end = parseClock(b);
  if (start === null || end === null) return null;
  if (end <= start) end += 1440;
  return { start, end };
}

/** { previous, current, next } around `now` (a wall-clock Date), over yesterday, today and tomorrow. */
export function adjacentBlocks(schedule, now) {
  const days = schedule?.days || {};
  const today = dayIndex(now);
  const items = [];
  for (const offset of [-1, 0, 1]) {
    const day = DAYS[(today + offset + 7) % 7];
    for (const block of Array.isArray(days[day]) ? days[day] : []) {
      const r = blockRange(block);
      if (r) items.push({ block, day, offset, start: offset * 1440 + r.start, end: offset * 1440 + r.end });
    }
  }
  items.sort((x, y) => x.start - y.start);
  const cur = now.getHours() * 60 + now.getMinutes();
  let previous = null;
  let current = null;
  let next = null;
  for (const it of items) {
    if (it.start <= cur && cur < it.end) current = it;
    else if (it.end <= cur) previous = it;
    else if (it.start > cur && !next) next = it;
  }
  return { previous, current, next };
}

export function currentStatus(schedule, now) {
  const { current } = adjacentBlocks(schedule, now);
  return current && VALID.has(current.block.status)
    ? { status: current.block.status, activity: current.block.activity || "" }
    : { status: "online", activity: "free time" };
}

export function activeOverride(override, now = new Date()) {
  if (!override || typeof override !== "object" || !VALID.has(override.status)) return null;
  if (typeof override.expiresAt === "string") {
    const t = Date.parse(override.expiresAt);
    if (!override.expiresAt || Number.isNaN(t) || t <= now.getTime()) return null;
  }
  return override;
}

/** The Engine's getEffectiveCurrentStatus. */
export function effectiveStatus(schedule, override, now = new Date(), scheduleNow = now) {
  const scheduled = schedule ? currentStatus(schedule, scheduleNow) : { status: "online", activity: "free time" };
  const o = activeOverride(override, now);
  if (!o) return scheduled;
  return {
    status: o.status,
    activity: typeof o.activity === "string" ? o.activity.trim() : scheduled.activity,
    override: o,
  };
}

const timeZoneOf = (meta) => meta?.conversationTimeZone || meta?.promptTimeZone || "";

/**
 * One character's presence from the chat's cached copy (the Engine's resolveLiveConversationStatus), or null when
 * it has neither a schedule nor an override. { status, activity, until, override, schedule }.
 */
export function presenceOf(meta, characterId, now = new Date(), fresh = null) {
  // A character who left a call is "offline" only for that call (lib/call.js); everywhere else they keep the
  // status they had before.
  const left = meta?.conversationStatusOverrides?.[characterId]?.mariCallLeft;
  if (left) {
    const overrides = { ...meta.conversationStatusOverrides };
    if (left.prev) overrides[characterId] = left.prev;
    else delete overrides[characterId];
    // (the Engine's fresh reading counts the call status, so this one is worked out from the chat's own copy)
    return presenceOf({ ...meta, conversationStatusOverrides: overrides }, characterId, now);
  }
  const schedulesOn = meta?.conversationSchedulesEnabled !== false;
  const override = fresh ? fresh.override : meta?.conversationStatusOverrides?.[characterId];
  const schedule = schedulesOn ? (fresh ? fresh.schedule : meta?.characterSchedules?.[characterId]) : null;
  if (!activeOverride(override, now) && !schedule) {
    if (fresh?.status)
      return { status: fresh.status, activity: fresh.activity || "", until: "", override: null, schedule: null };
    const snap = meta?.conversationCharacterStatuses?.[characterId];
    return snap?.status && VALID.has(snap.status)
      ? { status: snap.status, activity: snap.activity || "", until: "", override: null, schedule: null }
      : null;
  }
  const scheduleNow = wallClock(now, timeZoneOf(meta));
  const eff = effectiveStatus(schedule, override, now, scheduleNow);
  let until = "";
  if (!eff.override && schedule) {
    const { current, next } = adjacentBlocks(schedule, scheduleNow);
    const end = current ? current.end : next ? next.start : null;
    if (end !== null) until = clockLabel(((end % 1440) + 1440) % 1440);
  }
  return {
    status: eff.status,
    activity: eff.activity === "free time" ? "" : eff.activity,
    until,
    override: eff.override || null,
    schedule,
  };
}

/** Minutes after midnight → "오후 6:00". */
export function clockLabel(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${String(m).padStart(2, "0")}`;
}
/** "18:00-23:30" → "오후 6:00 – 오후 11:30". */
export function rangeLabel(time) {
  const [a, b] = String(time || "").split("-");
  const x = parseClock(a);
  const y = parseClock(b);
  return x === null || y === null ? String(time || "") : `${clockLabel(x)} – ${clockLabel(y)}`;
}

/** The rest of today and the next days' blocks, up to `limit` (the Engine's getUpcomingScheduleBlocks). */
export function upcomingBlocks(schedule, now, limit = 4) {
  const days = schedule?.days || {};
  const today = dayIndex(now);
  const cur = now.getHours() * 60 + now.getMinutes();
  const out = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const day = DAYS[(today + offset) % 7];
    (Array.isArray(days[day]) ? days[day] : []).forEach((block) => {
      const r = blockRange(block);
      if (!r || (offset === 0 && r.start <= cur)) return;
      out.push({ day, offset, block, startsAt: offset * 1440 + r.start });
    });
  }
  return out.sort((a, b) => a.startsAt - b.startsAt).slice(0, limit);
}

/** The header line: "바쁨 · 카페 알바 · 오후 6:00까지" (the status word unless online; the dots alone are too quiet). */
export function presenceLine(p) {
  if (!p) return "";
  const parts = [];
  if (p.status !== "online" || !p.activity) parts.push(STATUS_KO[p.status] || "");
  if (p.activity) parts.push(p.activity);
  if (p.until) parts.push(`${p.until}까지`);
  return parts.filter(Boolean).join(" · ");
}

/** "방금", "8분 전", "3시간 전", "2일 전", "3주 전", "5개월 전". */
export function agoLabel(iso, now = new Date()) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}일 전`;
  if (s < 35 * 86400) return `${Math.floor(s / (7 * 86400))}주 전`;
  if (s < 365 * 86400) return `${Math.floor(s / (30 * 86400))}개월 전`;
  return `${Math.floor(s / (365 * 86400))}년 전`;
}

export { timeZoneOf };
