// 기억 › 최근 제외: organized messages older than the newest N are hidden from the AI with the Engine's own hide,
// shown again when they no longer qualify, and still counted (hiding must not change any count). 묶음 from 1.
import assert from "node:assert/strict";
import {
  CHUNK_RANGE,
  hiddenTarget,
  nextChunk,
  normalizeMemory,
  readableMessages,
  syncHidden,
} from "../mari-kit/src/memory.server.mjs";

const records = Array.from({ length: 10 }, (_, i) => ({
  id: `m${i}`,
  role: i % 2 ? "assistant" : "user",
  content: `line ${i}`,
  extra: {},
}));
const nameOf = (m) => (m.role === "user" ? "Me" : "Rin");

// 묶음 1 is allowed; the limits come from one place.
assert.deepEqual(CHUNK_RANGE, [1, 60]);
assert.equal(normalizeMemory({ chunkMessages: 1 }).chunkMessages, 1);
assert.equal(normalizeMemory({ chunkMessages: 0 }).chunkMessages, 1);
assert.equal(normalizeMemory({ chunkMessages: 99 }).chunkMessages, 60);
const one = normalizeMemory({ chunkMessages: 1, settings: { keepRecent: 4 } });
assert.deepEqual(
  nextChunk(one, readableMessages(records, nameOf)).chunk.map((m) => m.id),
  ["m0"],
);

// Organized m0–m7, keep 4: m0–m5 are older than the newest four, so they are hidden; m6, m7 stay.
const memory = normalizeMemory({
  settings: { keepRecent: 4 },
  chunks: [{ id: "c1", messageIds: ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7"] }],
});
const messages = readableMessages(records, nameOf);
assert.deepEqual(hiddenTarget(memory, messages), ["m0", "m1", "m2", "m3", "m4", "m5"]);

// The Engine call: hides, shows, and leaves out what the user set by hand (m1 here).
const calls = [];
const runtime = {
  persistence: {
    async setMessagesHiddenFromAI(chatId, ids, hidden) {
      calls.push([hidden, [...ids]]);
      return ids.filter((id) => id !== "m1");
    },
  },
};
memory.hidden = await syncHidden(runtime, "chat", memory, messages);
assert.deepEqual(calls, [[true, ["m0", "m1", "m2", "m3", "m4", "m5"]]]);
assert.deepEqual(memory.hidden.sort(), ["m0", "m2", "m3", "m4", "m5"]);

// Hidden by memory still counts: the same ten messages, nothing waiting twice, no chunk looks changed.
const hiddenRecords = records.map((r) => (memory.hidden.includes(r.id) ? { ...r, extra: { hiddenFromAI: true } } : r));
assert.equal(readableMessages(hiddenRecords, nameOf, new Set(memory.hidden)).length, 10);
// A message the user hid by hand still drops out, as before.
assert.equal(readableMessages(hiddenRecords, nameOf).length, 5);

// 최근 제외 raised to 8: only m0, m1 qualify; memory shows again what it hid and no longer needs to.
calls.length = 0;
const raised = { ...memory, settings: { ...memory.settings, keepRecent: 8 } };
const after = await syncHidden(runtime, "chat", raised, messages);
// (m1, which the user set by hand, is offered again; the Engine leaves it alone again.)
assert.deepEqual(calls, [
  [false, ["m2", "m3", "m4", "m5"]],
  [true, ["m1"]],
]);
assert.deepEqual(after, ["m0"]);

// Undo or clear (no chunks): everything memory hid comes back; nothing else is touched.
calls.length = 0;
assert.deepEqual(await syncHidden(runtime, "chat", normalizeMemory({}), messages, ["m0"]), []);
assert.deepEqual(calls, [[false, ["m0"]]]);

// An older Engine without the call: nothing is hidden, nothing breaks.
assert.deepEqual(await syncHidden({ persistence: {} }, "chat", memory, messages, []), []);

console.log("memory: 최근 제외 hides organized older messages, counts stay, 묶음 from 1");
