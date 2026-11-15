// Editing a character's week (shell/lib/schedule-edit.js): time boxes, the ＋ block, problems, overlaps, copying a
// day and the saved shape.
import assert from "node:assert/strict";
import {
  changed,
  copyDay,
  draftDays,
  joinTime,
  newBlock,
  overlaps,
  problems,
  scheduleWith,
  sortBlocks,
  splitTime,
} from "../mari-kit/shell/lib/schedule-edit.js";

const schedule = {
  weekStart: "2026-11-09",
  routineSummary: "평일엔 알바",
  days: {
    Monday: [
      { time: "23:00-07:00", activity: "잠", status: "offline" },
      { time: "9:00-18:00", activity: "카페 알바", status: "dnd" },
    ],
  },
};

// Every day is there, statuses cleaned, and the copy does not touch the card.
const days = draftDays(schedule);
assert.equal(days.Sunday.length, 0);
assert.equal(days.Monday.length, 2);
days.Monday[0].activity = "꿀잠";
assert.equal(schedule.days.Monday[0].activity, "잠");
assert.equal(draftDays({ days: { Monday: [{ time: "1:00-2:00", status: "weird" }] } }).Monday[0].status, "online");

// Time boxes read "H:MM" and midnight ends; 24:00 becomes 00:00.
assert.deepEqual(splitTime("9:00-18:00"), { from: "09:00", to: "18:00" });
assert.deepEqual(splitTime("22:00-24:00"), { from: "22:00", to: "00:00" });
assert.deepEqual(splitTime("nonsense"), { from: "", to: "" });
assert.equal(joinTime("07:00", "08:30"), "07:00-08:30");

// ＋ takes the day's first free time (half-hour steps, up to an hour); a full day falls back to the Engine's 9 to 10.
assert.equal(newBlock([]).time, "00:00-01:00");
assert.equal(newBlock(schedule.days.Monday).time, "07:00-08:00");
assert.equal(newBlock([{ time: "00:00-12:00" }, { time: "12:30-00:00" }]).time, "12:00-12:30");
assert.equal(newBlock([{ time: "00:00-12:00" }, { time: "12:00-00:00" }]).time, "09:00-10:00");

// Unreadable or zero-length times stop a save; overlaps are only a warning.
assert.deepEqual(problems({ Monday: [{ time: "10:00-10:00" }, { time: "x" }] }), [
  { day: "Monday", index: 0, why: "시작과 끝이 같아요" },
  { day: "Monday", index: 1, why: "시간을 읽을 수 없어요" },
]);
assert.deepEqual(problems(draftDays(schedule)), []);
assert.deepEqual(overlaps([{ time: "09:00-12:00" }, { time: "11:00-13:00" }, { time: "13:00-14:00" }]), [[0, 1]]);

// Copying a day replaces the targets with copies, never the source.
const copied = copyDay(draftDays(schedule), "Monday", ["Tuesday", "Monday", "Sunday"]);
assert.equal(copied.Tuesday.length, 2);
copied.Tuesday[0].activity = "x";
assert.notEqual(copied.Monday[0].activity, "x");
assert.equal(copied.Sunday.length, 2);

// The saved schedule keeps the other fields, sorts blocks and trims activities.
const saved = scheduleWith(schedule, {
  ...draftDays(schedule),
  Friday: [{ time: "20:00-21:00", activity: "  산책  하기 ", status: "idle" }],
});
assert.equal(saved.routineSummary, "평일엔 알바");
assert.equal(saved.weekStart, "2026-11-09");
assert.equal(saved.days.Monday[0].activity, "카페 알바");
assert.equal(saved.days.Friday[0].activity, "산책 하기");
assert.equal(sortBlocks([{ time: "x" }, { time: "01:00-02:00" }])[0].time, "01:00-02:00");

// Changed or not.
assert.equal(changed(schedule, draftDays(schedule)), false);
assert.equal(changed(schedule, copied), true);

console.log("schedule-edit ok");
