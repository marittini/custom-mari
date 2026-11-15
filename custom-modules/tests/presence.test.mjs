// Character presence computed like the Engine (shell/lib/presence.js): blocks across midnight, gaps, overrides,
// the header line and the upcoming list.
import assert from "node:assert/strict";
import {
  adjacentBlocks,
  activeOverride,
  effectiveStatus,
  presenceLine,
  presenceOf,
  upcomingBlocks,
} from "../mari-kit/shell/lib/presence.js";

const all = (blocks) =>
  Object.fromEntries(
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => [d, blocks]),
  );
const schedule = {
  days: all([
    { time: "09:00-18:00", activity: "카페 알바", status: "dnd" },
    { time: "23:00-07:00", activity: "잠", status: "offline" },
  ]),
};
const at = (h, m = 0) => new Date(2026, 10, 14, h, m); // a Saturday

// A block that crosses midnight is found from the day it started on.
assert.equal(adjacentBlocks(schedule, at(2)).current.block.activity, "잠");
assert.equal(adjacentBlocks(schedule, at(10)).current.block.activity, "카페 알바");
// A gap: online and free time, like the Engine.
assert.deepEqual(effectiveStatus(schedule, null, at(20), at(20)), { status: "online", activity: "free time" });

// Overrides: expired ones do not count; a missing expiry never ends.
const past = { status: "offline", activity: "x", createdAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-01T01:00:00Z" };
assert.equal(activeOverride(past, at(10)), null);
assert.equal(activeOverride({ status: "idle", createdAt: "x", expiresAt: null }, at(10)).status, "idle");
assert.equal(activeOverride({ status: "nope" }), null);
const forced = effectiveStatus(schedule, { status: "idle", activity: null, createdAt: "x" }, at(10), at(10));
assert.equal(forced.status, "idle");
assert.equal(forced.activity, "카페 알바"); // null activity falls back to the schedule's

// From chat metadata: the line with the status word and when it ends.
const meta = { characterSchedules: { c1: schedule } };
const p = presenceOf(meta, "c1", at(10));
assert.equal(p.status, "dnd");
assert.equal(p.until, "오후 6:00");
assert.equal(presenceLine(p), "바쁨 · 카페 알바 · 오후 6:00까지");
assert.equal(presenceLine(presenceOf(meta, "c1", at(20))), "온라인 · 오후 11:00까지");
assert.equal(presenceOf({ ...meta, conversationSchedulesEnabled: false }, "c1", at(10)), null);
assert.equal(presenceOf({}, "c9", at(10)), null);

// Upcoming: today's later blocks first, then the next days.
const next = upcomingBlocks(schedule, at(10), 3);
assert.deepEqual(
  next.map((b) => [b.offset, b.block.activity]),
  [
    [0, "잠"],
    [1, "카페 알바"],
    [1, "잠"],
  ],
);

// Someone who left a call is offline for that call only (lib/call.js): the Convo shows what they had before.
{
  const later = new Date(Date.now() + 3600_000).toISOString();
  const left = (prev) => ({
    conversationStatusOverrides: {
      c: { status: "offline", expiresAt: later, mariCallLeft: { callId: "x", prev } },
    },
  });
  assert.equal(presenceOf(left(null), "c"), null);
  assert.equal(presenceOf(left({ status: "dnd", activity: "work", expiresAt: later }), "c").status, "dnd");
}

console.log("presence: schedule blocks, overrides and lines follow the Engine");
