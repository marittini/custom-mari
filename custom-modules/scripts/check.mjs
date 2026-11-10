#!/usr/bin/env node
// Quick proof for custom modules, also worth running after every Engine update:
//   1. builds the package and validates its manifest and agents.json against this Engine's own schemas;
//   2. runs the server module's pure helpers on fixed cases.
// Needs the shared package built once (pnpm build:shared).
//
//   node custom-modules/scripts/check.mjs [package-id]

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPackage } from "./build.mjs";

const id = process.argv[2] ?? "mari-kit";
const sharedEntry = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "packages",
  "shared",
  "dist",
  "index.js",
);
const shared = await import(pathToFileURL(sharedEntry).href).catch(() => {
  throw new Error("Build the shared package first: pnpm build:shared");
});

const { outDir, manifest } = await buildPackage(id);
const parsed = shared.capabilityPackageManifestSchema.safeParse(manifest);
assert.ok(parsed.success, `manifest rejected by this Engine: ${parsed.error?.message}`);
const supported = shared.supportedCapabilityApi;
assert.ok(
  manifest.capabilityApi.major === supported.major && manifest.capabilityApi.minor <= supported.minor,
  `manifest needs capability API ${manifest.capabilityApi.major}.${manifest.capabilityApi.minor}, Engine has ${supported.major}.${supported.minor}`,
);
const agents = JSON.parse(await readFile(join(outDir, "agents.json"), "utf8"));
const agentsParsed = shared.packagedAgentDefinitionsSchema.safeParse(agents);
assert.ok(agentsParsed.success, `agents.json rejected: ${agentsParsed.error?.message}`);

if (id === "mari-kit") {
  const server = await import(pathToFileURL(join(outDir, "server.mjs")).href);
  assert.deepEqual(server.normalizeSettings(null).features, {
    tts: false,
    translation: false,
    weather: false,
    memory: false,
  });
  assert.deepEqual(
    server.normalizeSettings({ features: { tts: true, memory: "yes", bogus: true } }).features,
    { tts: true, translation: false, weather: false, memory: false },
    "unknown keys and non-boolean values are dropped",
  );
  assert.equal(server.chatUsesMariKit({ enableAgents: true, activeAgentIds: ["mari-kit"] }), true);
  assert.equal(server.chatUsesMariKit({ enableAgents: false, activeAgentIds: ["mari-kit"] }), false);
  assert.equal(server.chatUsesMariKit({ enableAgents: true, activeAgentIds: ["other"] }), false);
  assert.equal(server.chatUsesMariKit(null), false);

  // ── TTS ──
  const tts = await import(pathToFileURL(join(outDir, "tts.server.mjs")).href);
  const client = await import(pathToFileURL(join(outDir, "client.js")).href);

  assert.deepEqual(
    tts.characterParticipant({
      id: "c1",
      data: JSON.stringify({ name: "쿠가 테루노리", extensions: { phoneticName: "kuga terunori" } }),
    }),
    { kind: "character", id: "c1", name: "쿠가 테루노리", phoneticName: "kuga terunori" },
  );
  assert.deepEqual(tts.personaParticipant({ id: "p1", data: { name: "Mari", phoneticName: "" } }), {
    kind: "persona",
    id: "p1",
    name: "Mari",
    phoneticName: "",
  });
  assert.equal(tts.buildTtsGuidance([]), null);
  const guidance = tts.buildTtsGuidance([{ kind: "character", id: "c1", name: "Aya", phoneticName: "" }]);
  assert.match(guidance, /<audio_character id="ID">/);
  assert.match(guidance, /"id":"c1"/);
  assert.doesNotMatch(guidance, /phoneticName/, "phonetic names are not sent to the model");

  // Pronunciation: the reported case — a given name alone must use its own part of the phonetic name.
  const kuga = client.buildPronunciations([{ name: "쿠가 테루노리", phoneticName: "kuga terunori" }]);
  assert.equal(client.applyPronunciations("테루노리가 웃었다.", kuga), "terunori가 웃었다.");
  assert.equal(client.applyPronunciations("쿠가 테루노리.", kuga), "kuga terunori.");
  assert.equal(client.applyPronunciations("쿠가 씨.", kuga), "kuga 씨.");
  // Word counts differ → only the whole name is replaced.
  const uneven = client.buildPronunciations([
    { name: "IV", phoneticName: "フォー" },
    { name: "A B", phoneticName: "x" },
  ]);
  assert.deepEqual(
    uneven.map((entry) => entry.from),
    ["IV", "A B"].sort((a, b) => b.length - a.length),
  );
  assert.equal(client.applyPronunciations("IV and IVY", uneven), "フォー and IVY", "Latin names keep word edges");

  // Voiced lines pair with the screen's spans by order, cue split off as tone.
  const content =
    'He leaned back. <audio_character id="c1">"[low, amused] You came **back**, huh?"</audio_character> He smiled.\n' +
    '<audio_persona id="p1">"Sit."</audio_persona> <audio_character id="c1">"[soft laugh] Fine."';
  const lines = client.parseVoiceLines(content);
  assert.deepEqual(lines, [
    { kind: "character", id: "c1", cue: "low, amused", text: "You came back, huh?" },
    { kind: "persona", id: "p1", cue: "", text: "Sit." },
    { kind: "character", id: "c1", cue: "soft laugh", text: "Fine." },
  ]);

  // Display rules: accepted by the Engine's regex safety check, and they leave one span per parsed line.
  let shown = content;
  for (const rule of client.DISPLAY_RULES) {
    assert.ok(shared.isPatternSafe(rule.findRegex), `display rule rejected as unsafe: ${rule.name}`);
    shown = shown.replace(new RegExp(rule.findRegex, rule.flags), rule.replaceString);
  }
  assert.equal(shown.match(/<span class="mk-line/g)?.length, lines.length);
  assert.doesNotMatch(shown, /audio_|\[low|\[soft/, "markup and line-start cues are hidden");

  // ── Weather ──
  const wx = await import(pathToFileURL(join(outDir, "weather.server.mjs")).href);
  const now = new Date();
  now.setUTCMinutes(Math.floor(now.getUTCMinutes() / 15) * 15, 0, 0);
  const fakeForecast = (temperature) => ({
    timezone: "UTC",
    utc_offset_seconds: 0,
    current_units: {
      time: "iso8601",
      interval: "seconds",
      temperature_2m: "°C",
      apparent_temperature: "°C",
      relative_humidity_2m: "%",
      wind_speed_10m: "m/s",
      precipitation: "mm",
      weather_code: "wmo code",
      is_day: "",
    },
    current: {
      time: now.toISOString().slice(0, 16),
      interval: 900,
      temperature_2m: temperature,
      apparent_temperature: temperature - 2,
      relative_humidity_2m: 60,
      wind_speed_10m: 3,
      precipitation: 0,
      weather_code: 61,
      is_day: 1,
    },
  });
  let fetched = 0;
  const fakeFetch = async (url) => {
    fetched += 1;
    return { ok: true, json: async () => fakeForecast(url.includes("latitude=35") ? 12 : 5) };
  };
  const seoul = wx.normalizeLocation({ name: "서울", label: "서울 · 대한민국", latitude: 37.57, longitude: 126.98 });
  const busan = wx.normalizeLocation({ name: "부산", label: "부산 · 대한민국", latitude: 35.18, longitude: 129.08 });
  assert.equal(wx.normalizeLocation({ name: "x", latitude: 91, longitude: 0 }), null);
  const user = await wx.getWeather(seoul, fakeFetch);
  await wx.getWeather(seoul, fakeFetch);
  assert.equal(fetched, 1, "a place is fetched once per 15 minutes");
  const character = await wx.getWeather(busan, fakeFetch);
  const context = wx.buildWeatherContext({ user, character, userName: "Mari", characterName: "Aya" });
  assert.match(context, /Mari's weather: slight rain, 5°C, feels like 3°C/);
  assert.match(context, /Aya's weather: slight rain, 12°C/);
  assert.doesNotMatch(context, /서울|부산|37\.57|126|Seoul|UTC/, "place names, coordinates and time zones stay out");
  assert.match(wx.buildWeatherContext({ user }), /Current weather: slight rain, 5°C/);
  assert.equal(wx.buildWeatherContext({ user: null }), null);
  const state = wx.normalizeWeatherState({
    userLocation: seoul,
    rooms: { c1: { enabled: "yes", characterLocation: { latitude: "x" } } },
  });
  assert.deepEqual(state.rooms.c1, { enabled: false, characterLocation: null });

  // ── Translation ──
  const tr = await import(pathToFileURL(join(outDir, "translation.server.mjs")).href);
  assert.deepEqual(client.parseGlossaryText("Aya = 아야\n  \nbad line\nKyoto = 교토 # 지명 # 일본"), [
    { source: "Aya", target: "아야", notes: "" },
    { source: "Kyoto", target: "교토", notes: "지명 # 일본" },
  ]);
  assert.equal(client.formatGlossaryText(client.parseGlossaryText("A = B # n")), "A = B # n");
  assert.deepEqual(
    client.mergeGlossaryText("Aya = 아야", [
      { source: "Aya", target: "X" },
      { source: "Ren", target: "렌" },
    ]),
    {
      text: "Aya = 아야\nRen = 렌",
      added: 1,
    },
  );
  const room = tr.normalizeRoom({
    incomingPresetId: "builtin-english-korean-v2",
    outgoingPresetId: "nope",
    glossary: [
      { source: "Aya", target: "아야" },
      { source: "Aya", target: "dup" },
      { source: "", target: "x" },
    ],
    speech: "[Aya] - 반말",
    world: "Kyoto, 1999",
  });
  assert.equal(room.outgoingPresetId, tr.INHERIT_PRESET_ID, "unknown preset falls back to keeping the chat's prompt");
  assert.equal(room.glossary.length, 1, "duplicate and empty glossary rows are dropped");
  const composed = tr.composeRoom(room, { incoming: "own incoming", outgoing: "Own outgoing prompt {{vocab}}" });
  assert.match(composed.incoming.text, /- Aya → 아야/);
  assert.match(composed.incoming.text, /\[Aya\] - 반말/);
  assert.doesNotMatch(composed.incoming.text, /\{\{(voice|vocab)\}\}/, "macros are filled");
  assert.match(composed.outgoing.text, /^Own outgoing prompt/, "the inherit preset keeps the chat's own prompt");
  assert.match(composed.outgoing.text, /- 아야 → Aya/, "drafts get the glossary reversed");
  assert.doesNotMatch(composed.outgoing.text, /반말/, "voice notes are for responses only");
  // Fitting to the Engine's limit: world first, then glossary from the bottom, then voice notes shortened.
  const many = Array.from({ length: 300 }, (_, i) => ({ source: `Term${i}`, target: `용어${i}` }));
  const fitted = tr.composePrompt({
    presetId: "builtin-roleplay",
    glossary: many,
    world: "w".repeat(3000),
    speech: "s",
  });
  assert.ok(fitted.length <= tr.FIT_LIMIT && tr.FIT_LIMIT < tr.PROMPT_LIMIT);
  assert.equal(fitted.droppedWorld, true);
  assert.ok(fitted.droppedGlossary > 0 && fitted.droppedGlossary < 300);
  assert.match(fitted.text, /Term0 → 용어0/, "the top of the glossary is kept");
  const longVoice = tr.composePrompt({ presetId: "builtin-roleplay", speech: "v".repeat(9000) });
  assert.ok(longVoice.shortenedVoice && longVoice.length <= tr.FIT_LIMIT);
  for (const preset of (await import(pathToFileURL(join(outDir, "translation-presets.mjs")).href))
    .BUILTIN_TRANSLATION_PRESETS) {
    assert.ok(tr.composePrompt({ presetId: preset.id }).length <= tr.FIT_LIMIT, `${preset.id} fits`);
  }
  // Model replies of the automatic notes.
  assert.deepEqual(
    tr.parseScan("glossary", '```json\n{"glossary":[{"original":"Aya","translation":"아야"}]}\n```').glossary,
    [{ source: "Aya", target: "아야", notes: "" }],
  );
  assert.equal(
    tr.parseScan(
      "speech",
      JSON.stringify({ characters: [{ character: "Aya", age: "17", speech: "- 반말", samples: ["응."] }] }),
    ).text,
    '[Aya]\n- 나이: 17\n- 반말\n- 대사 예시: "응."',
  );
  assert.equal(tr.parseScan("world", "```\n교토\n```").text, "교토");
  assert.equal(tr.languageName("ko"), "Korean");

  assert.equal(
    client.pickVoice(
      { voiceMode: "per-character", voice: "def", voiceAssignments: [{ characterId: "c1", voice: "v1" }] },
      "c1",
    ),
    "v1",
  );
  assert.equal(client.pickVoice({ voiceMode: "per-character", voice: "def", voiceAssignments: [] }, "c2"), "def");
  assert.equal(
    client.pickVoice(
      { voiceMode: "single", voice: "def", voiceAssignments: [{ characterId: "c1", voice: "v1" }] },
      "c1",
    ),
    "def",
  );
}

console.log(
  `OK ${manifest.id} ${manifest.version}: manifest, agents and helpers pass on capability API ${supported.major}.${supported.minor}`,
);
