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
