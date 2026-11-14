// Convo reactions and replies in the Engine's data (shell/lib/reactions.js).
import assert from "node:assert/strict";
import {
  reactionsOf,
  replyFor,
  replyOf,
  toggleReaction,
  reactorNames,
  removeReactor,
} from "../mari-kit/shell/lib/reactions.js";

const m = {
  extra: JSON.stringify({
    reactions: [
      { emoji: "😂", by: ["c1"] },
      { emoji: "❤️", by: [] }, // empty entries are dropped
      { emoji: "👍", by: ["user"], segment: 1, segmentSpeaker: "Aoi" },
    ],
  }),
};
const list = reactionsOf(m);
assert.equal(list.length, 2);

// The user joins the character's 😂, then takes it back; the character's stays.
let next = toggleReaction(list, "😂");
assert.deepEqual(next.find((r) => r.emoji === "😂").by, ["c1", "user"]);
next = toggleReaction(next, "😂");
assert.deepEqual(next.find((r) => r.emoji === "😂").by, ["c1"]);
// A new emoji, then taken back: the entry disappears.
next = toggleReaction(next, "🔥");
assert.ok(next.some((r) => r.emoji === "🔥"));
assert.ok(!toggleReaction(next, "🔥").some((r) => r.emoji === "🔥"));
// A segment reaction is a different entry from the whole-message one, and is kept as it was.
next = toggleReaction(list, "👍");
assert.equal(next.filter((r) => r.emoji === "👍").length, 2);
// Custom emoji keep their picture.
assert.equal(
  toggleReaction([], ":wave:", "/api/custom-emojis/file/w.png")[0].imageUrl,
  "/api/custom-emojis/file/w.png",
);
// The input array is not changed.
assert.deepEqual(list[0].by, ["c1"]);

assert.equal(
  reactorNames({ by: ["c1", "user"] }, (id) => (id === "c1" ? "하루" : "")),
  "하루, 나",
);

// Removing one reactor (a character's too); the emoji goes when nobody is left, segment reactions stay.
const mixed = [
  { emoji: "❤️", by: ["c1", "user"] },
  { emoji: "😂", by: ["c2"] },
  { emoji: "😂", by: ["c2"], segment: 1 },
];
assert.deepEqual(removeReactor(mixed, "❤️", "c1"), [
  { emoji: "❤️", by: ["user"] },
  { emoji: "😂", by: ["c2"] },
  { emoji: "😂", by: ["c2"], segment: 1 },
]);
assert.deepEqual(removeReactor(mixed, "😂", "c2"), [
  { emoji: "❤️", by: ["c1", "user"] },
  { emoji: "😂", by: ["c2"], segment: 1 },
]);
assert.deepEqual(mixed[0].by, ["c1", "user"]);

// Replies: the Engine's limits and checks.
assert.deepEqual(replyFor({ id: "m1" }, "하루", "  안녕  "), { messageId: "m1", name: "하루", content: "안녕" });
assert.equal(replyFor({ id: "__live" }, "하루", "x"), null);
assert.equal(replyFor({ id: "m1" }, "하루", "   "), null);
assert.equal(replyFor({ id: "m1" }, "하루", "a".repeat(20000)).content.length, 16000);
assert.equal(replyOf({ extra: { replyTo: { messageId: "m1", name: "하루", content: "x" } } }).name, "하루");
assert.equal(replyOf({ extra: { replyTo: { messageId: "m1" } } }), null);

console.log("reactions: toggles, segments, custom emoji and replies follow the Engine");
