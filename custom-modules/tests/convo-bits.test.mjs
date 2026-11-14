// Convo pieces that follow the Engine (shell/lib/convo-bits.js): days and times, presence notices, attachments.
import assert from "node:assert/strict";
import {
  attachmentsOf,
  closeInTime,
  dayLabel,
  presenceText,
  timeLabel,
  waitPhrase,
} from "../mari-kit/shell/lib/convo-bits.js";

const now = new Date(2026, 10, 14, 15, 0);
assert.equal(dayLabel(new Date(2026, 10, 14, 9, 0).toISOString(), now), "오늘");
assert.equal(dayLabel(new Date(2026, 10, 13, 23, 0).toISOString(), now), "어제");
assert.equal(dayLabel(new Date(2026, 10, 12, 8, 0).toISOString(), now), "11월 12일 목요일");
assert.equal(dayLabel(new Date(2025, 0, 2, 8, 0).toISOString(), now), "2025년 1월 2일 목요일");
assert.equal(timeLabel(new Date(2026, 10, 14, 16, 5).toISOString()), "오후 4:05");
assert.equal(timeLabel(new Date(2026, 10, 14, 0, 30).toISOString()), "오전 12:30");

// The Engine's groups: same day and within 5 minutes.
const t = (h, m) => new Date(2026, 10, 14, h, m).toISOString();
assert.equal(closeInTime(t(10, 0), t(10, 5)), true);
assert.equal(closeInTime(t(10, 0), t(10, 6)), false);
assert.equal(closeInTime(new Date(2026, 10, 13, 23, 58).toISOString(), t(0, 1)), false);

// Notices with the right particle for the name's last letter.
assert.equal(presenceText({ kind: "typing", names: ["하루"] }), "하루가 입력 중…");
assert.equal(presenceText({ kind: "typing", names: ["서진"] }), "서진이 입력 중…");
assert.equal(
  presenceText({ kind: "delayed", names: ["서진"], status: "dnd", delayMs: 150000 }),
  "서진은 지금 바빠요 · 틈나면 답해요 (약 3분 뒤)",
);
assert.equal(
  presenceText({ kind: "delayed", names: ["Aoi"], status: "idle", delayMs: 10000 }),
  "Aoi는 자리를 비웠어요 · 곧 답해요 (1분 안에)",
);
assert.match(presenceText({ kind: "offline", names: ["하루"] }), /^하루는 지금 오프라인이라/);
assert.match(presenceText({ kind: "offline", names: ["하루"], reason: "scene_busy" }), /장면/);
assert.equal(presenceText({ kind: "typing", names: ["A", "B", "C"] }), "A 외 2명이 입력 중…");
assert.equal(waitPhrase(61000), "약 2분 뒤");

// Attachments: gallery selfies get the Engine's phone preview; uploads become data URLs; scripts never load.
const atts = attachmentsOf({
  extra: JSON.stringify({
    attachments: [
      { type: "image", url: "/api/gallery/file/c1/selfie_a_1.png", prompt: "in the rain" },
      { type: "video", url: "/api/gallery/scene-videos/file/c1/v.mp4" },
      { type: "image/png", data: "AAAA", name: "mine.png" },
      { type: "image", url: "javascript:alert(1)", name: "bad" },
      { type: "application/pdf", data: "AAAA", name: "doc.pdf" },
    ],
  }),
});
assert.deepEqual(
  atts.map((a) => [a.kind, a.thumb]),
  [
    ["image", "/api/gallery/file/c1/selfie_a_1.png?w=1024"],
    ["video", "/api/gallery/scene-videos/file/c1/v.mp4"],
    ["image", "data:image/png;base64,AAAA"],
    ["file", ""],
    ["file", ""],
  ],
);
assert.equal(atts[0].prompt, "in the rain");
assert.deepEqual(attachmentsOf({ extra: "not json" }), []);

console.log("convo bits: days, times, presence notices and attachments follow the Engine");
