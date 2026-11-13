import assert from "node:assert/strict";
import { parseMessage, resolveTranslationSpeechLines } from "../../custom-modules/mari-kit/shell/lib/render.js";

const source = [
  '"We left off at clause two."',
  '"Begin from the fourth clause."',
  '<audio_persona id="mari">"[flatly] The long passage continues here."</audio_persona>',
  '"Wait, did you skip a line?"',
  '"You skipped the fourth clause."',
  '<audio_persona id="mari">"[calm] Add the salt later."</audio_persona>',
].join("\n\n");

const parsedSource = parseMessage(source, "teacher-1");
assert.equal(parsedSource.lines.length, 6, "mixed tagged and quoted source keeps all dialogue visible");
assert.deepEqual(
  parsedSource.lines.map((line) => line.speakerId),
  ["teacher-1", "teacher-1", "mari", "teacher-1", "teacher-1", "mari"],
);
assert.deepEqual(
  parsedSource.lines.map((line) => line.hasSpeakerTag),
  [false, false, true, false, false, true],
);
assert.deepEqual(
  parsedSource.lines.map((line) => line.cue),
  ["", "", "flatly", "", "", "calm"],
);

// Translation may change paragraphing, quote count, or include the source beside each translation.
// Only explicit source wrappers establish a TTS mapping; their translated wrapper sequence stays exact.
const shiftedTranslation = [
  "“English note: beginning, 시작 설명”",
  '"We stopped at clause two."',
  '"Start from clause four."',
  '<audio_persona id="mari">"[flatly] The translated passage continues."</audio_persona>',
  '"Wait, did you miss a line?"',
  "“Source: You skipped a clause. / Translation: 제4조를 건너뛰었어.”",
  '"You missed the fourth clause."',
  '<audio_persona id="mari">"[calm] Add the salt later."</audio_persona>',
].join("\n\n");
const parsedShifted = parseMessage(shiftedTranslation, "teacher-1");
const shiftedMap = resolveTranslationSpeechLines(parsedSource, parsedShifted);
assert.equal(parsedShifted.lines.length, 8, "translation can add quoted bilingual material");
assert.equal(
  shiftedMap[3]?.spoken,
  parsedSource.lines[2].spoken,
  "the first translated tagged line maps by marker sequence",
);
assert.equal(
  shiftedMap[7]?.spoken,
  parsedSource.lines[5].spoken,
  "the last translated tagged line keeps its source speaker",
);
assert.equal(shiftedMap[3]?.speakerId, "mari");
assert.equal(shiftedMap[7]?.cue, "calm");
assert.equal(Object.hasOwn(shiftedMap, 0), false, "unwrapped quotes have no playback mapping");

const partialTranslation = shiftedTranslation.replace(
  '<audio_persona id="mari">"[calm] Add the salt later."</audio_persona>',
  '"[calm] Add the salt later."',
);
assert.deepEqual(
  resolveTranslationSpeechLines(parsedSource, parseMessage(partialTranslation, "teacher-1")),
  [],
  "a missing translated speaker wrapper disables the ambiguous mapping",
);
const untaggedTranslation = shiftedTranslation
  .replace(
    '<audio_persona id="mari">"[flatly] The translated passage continues."</audio_persona>',
    '"[flatly] The translated passage continues."',
  )
  .replace('<audio_persona id="mari">"[calm] Add the salt later."</audio_persona>', '"[calm] Add the salt later."');
assert.deepEqual(
  resolveTranslationSpeechLines(parsedSource, parseMessage(untaggedTranslation, "teacher-1")),
  [],
  "unwrapped translation quotes do not get playback mappings",
);

const untaggedSource = parseMessage('"One quote."\n\n"Another quote."', "teacher-1");
assert.deepEqual(
  resolveTranslationSpeechLines(untaggedSource, parseMessage('"한 문장."\n\n"다른 문장."', "teacher-1")),
  [],
  "an untagged source has no TTS mappings",
);

const wrongId = shiftedTranslation.replace('<audio_persona id="mari">"[calm]', '<audio_persona id="teacher-1">"[calm]');
assert.deepEqual(
  resolveTranslationSpeechLines(parsedSource, parseMessage(wrongId, "teacher-1")),
  [],
  "an explicit speaker ID conflict disables the mapping",
);
const wrongKind = shiftedTranslation.replace('<audio_persona id="mari">"[calm]', '<audio_character id="mari">"[calm]');
assert.deepEqual(
  resolveTranslationSpeechLines(parsedSource, parseMessage(wrongKind, "teacher-1")),
  [],
  "an explicit speaker kind conflict disables the mapping",
);
const wrongCue = shiftedTranslation.replace("[calm]", "[angry]");
assert.deepEqual(
  resolveTranslationSpeechLines(parsedSource, parseMessage(wrongCue, "teacher-1")),
  [],
  "a delivery cue conflict disables the mapping",
);
