#!/usr/bin/env node
// Mari's agent catalog: the official Marinara-Agents catalog, unchanged, plus Mari Kit. An Engine started with
// MARINARA_AGENT_CATALOG_URL pointing at the published catalog.json lists, installs and updates every official
// agent as before (their artifacts still come from Pasta-Devs) and Mari Kit the same way.
//
//   node custom-modules/scripts/catalog.mjs --out <dir> --base-url <url the dir is served at>
//
// Writes <dir>/catalog/v<major>/{catalog,notes,store}.json and <dir>/artifacts/mari-kit-<version>.zip; an
// artifact already in <dir> is kept. Needs the shared package built (pnpm build:shared).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildPackage } from "./build.mjs";

const OFFICIAL = "https://raw.githubusercontent.com/Pasta-Devs/Marinara-Agents/main/catalog";
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const AdmZip = createRequire(join(repoRoot, "packages", "server", "package.json"))("adm-zip");

/** The same bytes for the same files, so an unchanged package keeps its hash and is not offered as an update. */
async function zipPackage(outDir, manifest) {
  const zip = new AdmZip();
  const time = new Date(2000, 0, 1);
  for (const path of ["manifest.json", ...manifest.files.map((f) => f.path)]) {
    zip.addFile(path, await readFile(join(outDir, path)));
    zip.getEntry(path).header.time = time;
  }
  return zip.toBuffer();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export async function buildCatalog({ out, baseUrl, id = "mari-kit" }) {
  const base = baseUrl.replace(/\/$/, "");
  const shared = await import(pathToFileURL(join(repoRoot, "packages", "shared", "dist", "index.js")).href);
  const engineVersion = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")).version;
  const lane = `v${Number(engineVersion.split(".")[0])}`;

  const official = await fetchJson(`${OFFICIAL}/${lane}/catalog.json`);
  assert.ok(Array.isArray(official?.packages), "official catalog has no packages");

  const built = await buildPackage(id);
  let manifest = built.manifest;
  let archive = await zipPackage(built.outDir, manifest);
  const name = `${manifest.id}-${manifest.version}.zip`;
  await mkdir(join(out, "artifacts"), { recursive: true });
  const artifactPath = join(out, "artifacts", name);
  const existing = await readFile(artifactPath).catch(() => null);
  if (existing) {
    // A published version never changes under its URL. The same files (only the build stamp differs) keep the
    // published archive; other files must come with a new version.
    const published = JSON.parse(new AdmZip(existing).readAsText("manifest.json"));
    if (JSON.stringify(published.files) !== JSON.stringify(manifest.files))
      throw new Error(`${name} is already published with other files; bump the version in manifest.template.json`);
    manifest = published;
    archive = existing;
  } else {
    await writeFile(artifactPath, archive);
  }

  const entry = {
    manifest,
    category: "misc",
    artifact: {
      url: `${base}/artifacts/${name}`,
      sha256: createHash("sha256").update(archive).digest("hex"),
      bytes: archive.length,
    },
    documentationUrl: "https://github.com/marittini/custom-mari/tree/main/custom-modules",
  };
  const parsed = shared.capabilityCatalogPackageSchema.safeParse(entry);
  assert.ok(parsed.success, `Mari Kit catalog entry rejected: ${parsed.error?.message}`);

  const packages = [...official.packages.filter((p) => p?.manifest?.id !== manifest.id), entry];
  const dir = join(out, "catalog", lane);
  const previous = JSON.parse(await readFile(join(dir, "catalog.json"), "utf8").catch(() => "null"));
  // Unchanged packages keep the old date, so a day with nothing new leaves the published files as they are.
  const same = previous && JSON.stringify(previous.packages) === JSON.stringify(packages);
  const catalog = { schemaVersion: 1, generatedAt: same ? previous.generatedAt : new Date().toISOString(), packages };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  // Release notes and store cards sit beside catalog.json; the official ones carry over as they are.
  for (const sidecar of ["notes.json", "store.json"]) {
    const body = await fetchJson(`${OFFICIAL}/${lane}/${sidecar}`);
    if (body) await writeFile(join(dir, sidecar), `${JSON.stringify(body, null, 2)}\n`);
  }
  return { catalogUrl: `${base}/catalog/${lane}/catalog.json`, entry, count: catalog.packages.length };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: "string" }, "base-url": { type: "string" } } });
  assert.ok(values.out && values["base-url"], "usage: catalog.mjs --out <dir> --base-url <url>");
  const { catalogUrl, entry, count } = await buildCatalog({ out: resolve(values.out), baseUrl: values["base-url"] });
  console.log(`Catalog with ${count} packages (Mari Kit ${entry.manifest.version}) → ${catalogUrl}`);
}
