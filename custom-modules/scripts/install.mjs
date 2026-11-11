#!/usr/bin/env node
// Installs a built custom module into a Marinara data folder, the way the Engine's own installer leaves it:
//   <DATA_DIR>/capability-packages/versions/<id>/<version>/   the verified files
//   <DATA_DIR>/capability-packages/installed.json             the registry record
// The Engine re-verifies every file's SHA-256 when it reads it and activates the package at the next start.
// Stop Marinara before running this, then start it again.
//
//   node custom-modules/scripts/install.mjs [--data-dir <path>] [package-id]
//   DATA_DIR defaults to $DATA_DIR, else packages/server/data (the Engine's own default).

import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPackage } from "./build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

function parseArgs(argv) {
  const args = {
    dataDir: process.env.DATA_DIR?.trim() || join(repoRoot, "packages", "server", "data"),
    id: "mari-kit",
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--data-dir") args.dataDir = argv[++i];
    else args.id = argv[i];
  }
  args.dataDir = resolve(args.dataDir);
  return args;
}

async function readRegistry(file) {
  try {
    const raw = JSON.parse(await readFile(file, "utf8"));
    if (raw?.schemaVersion !== 1 || !Array.isArray(raw.packages)) throw new Error("unexpected installed.json shape");
    return raw;
  } catch (error) {
    if (error?.code === "ENOENT") return { schemaVersion: 1, packages: [] };
    throw error;
  }
}

export async function installPackage({ dataDir, id }) {
  const { outDir, manifest } = await buildPackage(id);
  const root = join(dataDir, "capability-packages");
  const target = join(root, "versions", id, manifest.version);
  const staging = `${target}.install-${process.pid}`;

  await rm(staging, { recursive: true, force: true });
  await mkdir(dirname(staging), { recursive: true });
  // Copied with sub-folders: the shell keeps its own folder layout.
  await cp(outDir, staging, { recursive: true });
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);

  const registryFile = join(root, "installed.json");
  const registry = await readRegistry(registryFile);
  const existing = registry.packages.find((entry) => entry?.id === id);
  const record = {
    id,
    version: manifest.version,
    manifest,
    installedAt: new Date().toISOString(),
    status: "restart-required",
    error: null,
    readiness: "pending",
    readinessError: null,
    legacy: false,
    ...(existing && existing.version !== manifest.version
      ? { previousVersion: existing.version, previousManifest: existing.manifest }
      : {}),
  };
  const packages = [...registry.packages.filter((entry) => entry?.id !== id), record];
  const temporary = `${registryFile}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify({ schemaVersion: 1, packages }, null, 2), { mode: 0o600 });
  await rename(temporary, registryFile);
  return { target, manifest };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const { target, manifest } = await installPackage(args);
  console.log(`Installed ${manifest.id} ${manifest.version} → ${target}`);
  console.log("Restart Marinara to activate it.");
}
