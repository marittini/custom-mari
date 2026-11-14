// Scenes as the Engine starts them (shell/lib/scene.js): remembered choices, the planning prompt, what a chat says
// about scenes, and the /scene/create body.
import assert from "node:assert/strict";
import { createBody, planningPrompt, sceneOf, scenePrefs } from "../mari-kit/shell/lib/scene.js";

// The Engine's defaults and normalising.
assert.deepEqual(scenePrefs(null), {
  pov: "third_person",
  tense: "present",
  extraInstructions: "",
  promptPresetId: null,
});
assert.deepEqual(
  scenePrefs({ pov: "first_person", tense: "past", extraInstructions: "  짧게 ", promptPresetId: " p1 " }),
  {
    pov: "first_person",
    tense: "past",
    extraInstructions: "짧게",
    promptPresetId: "p1",
  },
);
assert.equal(scenePrefs({ pov: "fourth", extraInstructions: "x".repeat(3000) }).pov, "third_person");
assert.equal(scenePrefs({ extraInstructions: "x".repeat(3000) }).extraInstructions.length, 2000);

// The scenario, then the inviter's plan (the Engine's wording); empty parts drop out.
assert.equal(planningPrompt(" 밤 산책 ", "1. 비\n2. 우산"), "밤 산책\n\nSuggested plot plan:\n1. 비\n2. 우산");
assert.equal(planningPrompt("", null), "");

// What a chat's metadata says.
assert.equal(sceneOf({ activeSceneChatId: "s1" }).activeSceneId, "s1");
assert.equal(sceneOf({}).activeSceneId, null);
assert.deepEqual(sceneOf({ sceneStatus: "active", sceneOriginChatId: "c1", sceneOriginRepliesAllowed: true }), {
  activeSceneId: null,
  isScene: true,
  active: true,
  originId: "c1",
  repliesHere: true,
});
assert.equal(sceneOf({ sceneStatus: "concluded", sceneOriginChatId: "c1" }).active, false);

// The create body: per-scene choices only when given; persona null means "none", absent means the Convo's.
const plan = { name: "Scene: x" };
const base = { chatId: "c1", initiatorCharId: "a", plan, connectionId: undefined };
assert.deepEqual(createBody({ ...base, prefs: { promptPresetId: null } }), {
  originChatId: "c1",
  initiatorCharId: "a",
  plan,
  connectionId: null,
  promptPresetId: null,
});
const full = createBody({
  ...base,
  prefs: { promptPresetId: "p", presetChoices: { mood: "dark" }, participantCharacterIds: ["a"], personaId: null },
});
assert.deepEqual(full.presetChoices, { mood: "dark" });
assert.deepEqual(full.participantCharacterIds, ["a"]);
assert.equal(full.personaId, null);
assert.ok("personaId" in full);

console.log("scene: preferences, planning prompt, chat state and create body follow the Engine");
