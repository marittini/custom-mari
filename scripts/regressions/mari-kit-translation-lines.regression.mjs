import assert from "node:assert/strict";
import { parseMessage, resolveTranslationSpeechLines } from "../../custom-modules/mari-kit/shell/lib/render.js";

// Mixed speaker markup from RP: the teacher's quoted dialogue uses the fallback speaker,
// while two persona lines carry explicit speaker IDs and delivery cues.
const source = [
  '"We left off at clause two."',
  '"Begin from the fourth clause."',
  '<audio_persona id="mari">"[flatly] The long passage continues here."</audio_persona>',
  '"Wait, did you skip a line?"',
  '"You skipped the fourth clause."',
  '<audio_persona id="mari">"[calm] Add the salt later."</audio_persona>',
].join("\n\n");

// A provider may preserve one wrapper and lose another in an older/partial translation.
const partialTranslation = [
  '"We stopped at clause two."',
  '"Start from the fourth clause."',
  '<audio_persona id="mari">"[flatly] The translated passage continues."</audio_persona>',
  '"Wait, did you miss a line?"',
  '"You missed the fourth clause."',
  '"[calm] Add the salt later."',
].join("\n\n");

const untaggedTranslation = [
  '"We stopped at clause two."',
  '"Start from the fourth clause."',
  '"[flatly] The translated passage continues."',
  '"Wait, did you miss a line?"',
  '"You missed the fourth clause."',
  '"[calm] Add the salt later."',
].join("\n\n");

const fullyTaggedTranslation = [
  '"We stopped at clause two."',
  '"Start from the fourth clause."',
  '<audio_persona id="mari">"[flatly] The translated passage continues."</audio_persona>',
  '"Wait, did you miss a line?"',
  '"You missed the fourth clause."',
  '<audio_persona id="mari">"[calm] Add the salt later."</audio_persona>',
].join("\n\n");

const expectedIds = ["teacher-1", "teacher-1", "mari", "teacher-1", "teacher-1", "mari"];
const parsedSource = parseMessage(source, "teacher-1");
const parsedTranslation = parseMessage(partialTranslation, "teacher-1");

assert.equal(parsedSource.lines.length, 6, "mixed tagged and quoted source exposes all six speech lines");
assert.deepEqual(
  parsedSource.lines.map((line) => line.speakerId),
  expectedIds,
);
assert.deepEqual(
  parsedSource.lines.map((line) => line.cue),
  ["", "", "flatly", "", "", "calm"],
);
assert.equal(parsedTranslation.lines.length, 6, "a partially tagged translation still exposes all speech lines");

for (const translatedText of [partialTranslation, untaggedTranslation, fullyTaggedTranslation]) {
  const translated = parseMessage(translatedText, "teacher-1");
  const speechLines = resolveTranslationSpeechLines(parsedSource, translated);
  assert.equal(speechLines.length, 6, "unambiguous translated lines map to all original speech lines");
  assert.equal(speechLines[1].spoken, "Begin from the fourth clause.", "teacher dialogue keeps its source line");
  assert.equal(speechLines[5].speakerId, "mari", "the final persona dialogue keeps its speaker");
  assert.equal(speechLines[5].cue, "calm", "the final persona dialogue keeps its delivery cue");
}

assert.deepEqual(
  resolveTranslationSpeechLines(parsedSource, parseMessage('"Only one translated line."', "teacher-1")),
  [],
  "a line-count mismatch must not guess a speaker",
);
const wrongSpeakerTranslation = fullyTaggedTranslation.replace('id="mari">"[calm]', 'id="teacher-1">"[calm]');
assert.deepEqual(
  resolveTranslationSpeechLines(parsedSource, parseMessage(wrongSpeakerTranslation, "teacher-1")),
  [],
  "an explicit translated speaker conflict must not play the wrong voice",
);
const wrongCueTranslation = fullyTaggedTranslation.replace("[calm]", "[angry]");
assert.deepEqual(
  resolveTranslationSpeechLines(parsedSource, parseMessage(wrongCueTranslation, "teacher-1")),
  [],
  "a translated delivery cue conflict must not play a mismatched line",
);
