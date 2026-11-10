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
}

console.log(
  `OK ${manifest.id} ${manifest.version}: manifest, agents and helpers pass on capability API ${supported.major}.${supported.minor}`,
);
