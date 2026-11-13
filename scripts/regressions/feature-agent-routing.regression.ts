import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.MARINARA_LITE = "true";

const { packagedAgentDefinitionsSchema, replaceBuiltInAgentDefinitions } =
  await import("../../packages/shared/dist/index.js");
const { resolveAgentPipelineAgents } =
  await import("../../packages/server/src/services/generation/agent-resolution.js");
const { resolveRetryAgents } = await import("../../packages/server/src/routes/generate/retry-agents-route.js");
const { OpenAIProvider } = await import("../../packages/server/src/services/llm/providers/openai.provider.js");
const { collectCapabilityPromptContext, registerCapabilityPromptContext } =
  await import("../../packages/server/src/services/capability-packages/capability-prompt-context.service.js");

const [mariKit] = packagedAgentDefinitionsSchema.parse(
  JSON.parse(readFileSync(new URL("../../custom-modules/mari-kit/agents.json", import.meta.url), "utf8")),
);
assert.ok(mariKit);
assert.equal(mariKit.execution, "feature");
assert.equal(mariKit.runtimeDisabled, true, "catalog updates also skip the LLM pipeline on existing Engines");
assert.equal(mariKit.defaultPromptTemplate, "");

const definitions = [
  mariKit,
  { ...mariKit, id: "host-fixture", execution: "host" as const, runtimeDisabled: false },
  {
    ...mariKit,
    id: "pipeline-fixture",
    execution: "pipeline" as const,
    runtimeDisabled: false,
    defaultPromptTemplate: "Return a note.",
  },
];
replaceBuiltInAgentDefinitions(definitions);

const connection = {
  id: "fixture-connection",
  name: "Fixture",
  provider: "custom",
  baseUrl: "http://127.0.0.1:65535/v1",
  apiKey: "",
  model: "fixture-model",
  maxContext: 32_768,
  defaultParameters: "{}",
  maxParallelJobs: 1,
};
const connections = {
  getDefaultForAgents: async () => null,
  getFallbackForAgents: async () => null,
  getWithKey: async (id: string) => (id === connection.id ? connection : null),
};
const config = (type: string, promptTemplate = "Return a note.") => ({
  id: `${type}-config`,
  type,
  name: type,
  phase: "post_processing",
  connectionId: null,
  promptTemplate,
  settings: "{}",
});
const activeAgentIds = [...definitions.map((agent) => agent.id), "custom-fixture"];
const chatMeta = { enableAgents: true, activeAgentIds };

// Both saved Agent rows and selected agents without a saved row must skip feature entries.
for (const source of ["stored", "fallback"]) {
  const configuredAgents = [
    config("custom-fixture"),
    ...(source === "stored" ? definitions.map((agent) => config(agent.id, agent.defaultPromptTemplate)) : []),
  ];
  const initial = await resolveAgentPipelineAgents({
    connections,
    configuredAgents,
    chatId: "rp-voice-fixture",
    chatEnableAgents: true,
    hasPerChatAgentList: true,
    perChatAgentSet: new Set(activeAgentIds),
    agentPromptTemplateSelections: {},
    chatProvider: new OpenAIProvider(connection.baseUrl, ""),
    chatConnectionId: connection.id,
    chatModel: connection.model,
    chatCustomParameters: {},
    chatSuppressModelParameters: false,
    chatMaxOutputTokens: null,
    chatMaxParallelJobs: 1,
    chatEnableCaching: false,
    chatAnthropicExtendedCacheTtl: false,
    chatCachingAtDepth: 5,
    chatMetadata: chatMeta,
    resolveBaseUrl: (conn) => conn.baseUrl ?? "",
  });
  assert.deepEqual(
    initial.resolvedAgents.map((agent) => agent.type).sort(),
    ["custom-fixture", "pipeline-fixture"],
    `RP generation (${source}) excludes feature/host entries and keeps LLM agents`,
  );
  const retry = await resolveRetryAgents({
    agentTypes: activeAgentIds,
    chat: { id: "rp-voice-fixture", mode: "roleplay", connectionId: connection.id, metadata: JSON.stringify(chatMeta) },
    conns: connections as unknown as Parameters<typeof resolveRetryAgents>[0]["conns"],
    agentsStore: { list: async () => configuredAgents } as Parameters<typeof resolveRetryAgents>[0]["agentsStore"],
    allowExternalAgentImports: true,
  });
  assert.deepEqual(
    retry.resolvedAgents.map((agent) => agent.resolved.type).sort(),
    ["custom-fixture", "pipeline-fixture"],
    `Retry Failed Agents (${source}) also excludes feature/host entries`,
  );
}

// Skipping the generic LLM pipeline must leave Mari Kit's own pre-generation voice hook active.
const serverEntry = new URL("../../custom-modules/mari-kit/src/server.mjs", import.meta.url).href;
const { activate } = await import(serverEntry);
let ttsEnabled = true;
let rpEnabled = true;
let roomEnabled = true;
const release = await activate({
  api: {
    runtime: {
      persistence: {
        documents: {
          getById: async (_packageId: string, id: string) => ({
            data:
              id === "mari-kit:settings"
                ? { features: { tts: ttsEnabled } }
                : { rp: rpEnabled, rooms: roomEnabled ? {} : { "rp-voice-fixture": false } },
          }),
        },
        getChat: async () => ({ characterIds: ["c1"], personaId: "p1" }),
      },
      resources: {
        listCharacters: async () => [{ id: "c1", data: { name: "Aya" } }],
        listPersonas: async () => [{ id: "p1", data: { name: "Mari" } }],
      },
      languageModels: {
        generate: () => assert.fail("Voice guidance must not make an extra model call"),
      },
      logger: { error: (error: Error) => assert.fail(error.message) },
    },
    registerPrivilegedRoutes: async () => () => {},
    registerPromptContext: (contributor: Parameters<typeof registerCapabilityPromptContext>[1]) =>
      registerCapabilityPromptContext("mari-kit", contributor),
  },
});
try {
  const request = { chatId: "rp-voice-fixture", mode: "roleplay", chatMeta };
  for (const meta of [chatMeta, { enableAgents: false }]) {
    const { blocks } = await collectCapabilityPromptContext({ ...request, chatMeta: meta });
    assert.equal(blocks.length, 1);
    assert.match(blocks[0]!, /<voice_markup>/);
    assert.match(blocks[0]!, /"kind":"character","id":"c1"/);
    assert.match(blocks[0]!, /"kind":"persona","id":"p1"/);
  }
  ttsEnabled = false;
  assert.deepEqual((await collectCapabilityPromptContext(request)).blocks, [], "global TTS off is respected");
  ttsEnabled = true;
  rpEnabled = false;
  assert.deepEqual((await collectCapabilityPromptContext(request)).blocks, [], "RP voice off is respected");
  rpEnabled = true;
  roomEnabled = false;
  assert.deepEqual((await collectCapabilityPromptContext(request)).blocks, [], "room voice off is respected");
} finally {
  release();
  replaceBuiltInAgentDefinitions([]);
}

console.log("feature-agent-routing: RP and retry routing, voice guidance and off switches passed");
