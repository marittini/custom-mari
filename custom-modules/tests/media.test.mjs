// The Convo media panel's pure parts (shell/lib/media.js, games.js, emoji-selection.js), checked against the
// Engine's rules: recents, ":name" completion, ":name:" rendering, installed games and the emoji selection prefs.
import assert from "node:assert/strict";
import {
  RECENT_KEY,
  completionText,
  emojiParts,
  insertAt,
  readRecents,
  rememberRecent,
  shortcodeAt,
  shortcodeChoices,
} from "../mari-kit/shell/lib/media.js";
import { gameForCommand, gamesOf } from "../mari-kit/shell/lib/games.js";
import { selectionOf } from "../mari-kit/shell/lib/emoji-selection.js";

// Recents: the Engine's key and shape; newest first, no repeats, at most 8, junk dropped.
const mem = new Map();
const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
assert.deepEqual(readRecents(storage), { emoji: [], kaomoji: [], gif: [], sticker: [] });
for (const e of ["😀", "😂", "❤️", "😀"]) rememberRecent("emoji", { value: e }, storage);
assert.deepEqual(
  readRecents(storage).emoji.map((r) => r.value),
  ["😀", "❤️", "😂"],
);
for (let i = 0; i < 12; i++) rememberRecent("kaomoji", { value: `k${i}` }, storage);
assert.equal(readRecents(storage).kaomoji.length, 8);
assert.equal(readRecents(storage).kaomoji[0].value, "k11");
mem.set(
  RECENT_KEY,
  JSON.stringify({ emoji: [{ value: "" }, { nope: 1 }, { value: "🙂", label: "x", previewUrl: "/api/a" }] }),
);
assert.deepEqual(readRecents(storage).emoji, [{ value: "🙂", label: "x", previewUrl: "/api/a" }]);
mem.set(RECENT_KEY, "not json");
assert.deepEqual(readRecents(storage).sticker, []);

// ":query" at a word start before the caret (the Engine's regex), not inside a word or a time.
assert.deepEqual(shortcodeAt("hi :smi", 7), { start: 3, query: "smi" });
assert.deepEqual(shortcodeAt(":Heart", 6), { start: 0, query: "heart" });
assert.equal(shortcodeAt("12:30", 5), null);
assert.equal(shortcodeAt("hi : smi", 8), null);

// Completions: custom names containing the query (prefix first), then standard ones not shadowed; at most 10.
const custom = [
  { name: "big_smile", url: "/api/c/1" },
  { name: "smile", url: "/api/c/2" },
];
const standard = (q) => [
  { name: "smile", emoji: "😄" },
  { name: "smirk", emoji: "😏" },
];
const choices = shortcodeChoices("smi", custom, standard);
assert.deepEqual(
  choices.map((c) => `${c.kind}:${c.name}`),
  ["custom:smile", "custom:big_smile", "standard:smirk"],
);
assert.equal(completionText(choices[0]), ":smile: ");
assert.equal(completionText(choices[2]), "😏 ");
assert.deepEqual(insertAt("hi :smi there", 3, 7, "😏 "), { text: "hi 😏  there", caret: 6 });

// ":name:" in a message: known custom → picture (big when alone), standard → emoji, unknown → text.
const map = new Map([["wave", "/api/c/wave"]]);
const resolve = (n) => (n === "heart" ? "❤️" : null);
assert.deepEqual(emojiParts("hi :wave: and :heart: :nope:", map, resolve), {
  parts: [
    { text: "hi " },
    { url: "/api/c/wave", alt: ":wave:" },
    { text: " and " },
    { emoji: "❤️" },
    { text: " :nope:" },
  ],
  jumbo: false,
});
assert.equal(emojiParts(" :wave: :wave: ", map).jumbo, true);
assert.deepEqual(emojiParts("plain", map), { parts: [{ text: "plain" }], jumbo: false });

// Games: active turn-game packages with a client and a /command; matching by command or alias.
const games = gamesOf([
  {
    id: "uno",
    status: "active",
    manifest: {
      name: "UNO",
      kind: ["turn-game"],
      entrypoints: { client: "c.js" },
      contributions: { conversationGame: { command: "/uno", aliases: ["/u"] } },
    },
  },
  { id: "off", status: "disabled", manifest: { kind: ["turn-game"], entrypoints: { client: "c.js" } } },
  { id: "agent", status: "active", manifest: { kind: ["agent"], entrypoints: { client: "c.js" } } },
]);
assert.deepEqual(
  games.map((g) => g.id),
  ["uno"],
);
assert.equal(gameForCommand("/UNO please", games)?.id, "uno");
assert.equal(gameForCommand("/u", games)?.id, "uno");
assert.equal(gameForCommand("/chess", games), null);
assert.deepEqual(gamesOf({ items: [] }), []);

// The Engine's emoji selection defaults and limits.
assert.deepEqual(selectionOf({}), { mode: "semantic", maxCount: 20, toolConnectionId: null });
assert.deepEqual(selectionOf({ customEmojiSelection: { mode: "tool-call", maxCount: 500, toolConnectionId: "c" } }), {
  mode: "tool-call",
  maxCount: 100,
  toolConnectionId: "c",
});
assert.equal(selectionOf({ customEmojiSelection: { mode: "weird", maxCount: 0 } }).maxCount, 1);

console.log("media: recents, completions, emoji tokens, games and selection follow the Engine");
