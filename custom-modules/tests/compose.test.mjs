// Convo composer helpers (shell/lib/compose.js): @mentions like the Engine's ConversationInput.
import assert from "node:assert/strict";
import { insertMention, mentionAt, mentionChoices, mentionedNames } from "../mari-kit/shell/lib/compose.js";

assert.deepEqual(mentionAt("hi @Re", 6), { start: 3, query: "Re" });
assert.deepEqual(mentionAt("@", 1), { start: 0, query: "" });
assert.equal(mentionAt("mail@host", 9), null); // not after a letter
assert.equal(mentionAt("@Ren hi\nok", 10), null); // a new line ends it

assert.deepEqual(mentionChoices(["Aoi", "Ren", "Rin"], "r"), ["Ren", "Rin"]);
assert.deepEqual(mentionChoices(["하루", "서진"], "하"), ["하루"]);

const ins = insertMention("hi @Re there", 6, 3, "Ren");
assert.equal(ins.text, "hi @Ren  there");
assert.equal(ins.caret, 8);

assert.deepEqual(mentionedNames("@ren 일어나! @하루, 너도", ["Ren", "하루", "Aoi"]), ["Ren", "하루"]);
assert.deepEqual(mentionedNames("@Renata hi", ["Ren"]), []); // a longer word is not a mention
assert.deepEqual(mentionedNames("no mention", ["Ren"]), []);

console.log("compose: @mention detection, choices and names follow the Engine");
