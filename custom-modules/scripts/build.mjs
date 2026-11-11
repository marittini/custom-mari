#!/usr/bin/env node
// Builds custom-modules/<id> into custom-modules/dist/<id>/<version>/ with a manifest whose
// files[] carries each file's SHA-256 and size, as the Engine verifies them on every read.
//
//   node custom-modules/scripts/build.mjs [package-id]   (default: mari-kit)

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const modulesRoot = resolve(here, "..");
const repoRoot = resolve(modulesRoot, "..");
const packageId = process.argv[2] ?? "mari-kit";

function engineCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Files of the shell folder (relative paths), or none when the package has no shell. */
async function listShell(dir, prefix = "") {
  let entries;
  try {
    entries = await readdir(join(dir, prefix), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const out = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listShell(dir, rel)));
    else if (/\.(?:js|css|html|svg)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

export async function buildPackage(id = packageId) {
  const root = join(modulesRoot, id);
  const template = JSON.parse(await readFile(join(root, "manifest.template.json"), "utf8"));
  const engineVersion = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")).version;
  const outDir = join(modulesRoot, "dist", id, template.version);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // Copied flat: agents.json from the package root, every file in src/ (entry points and the server modules
  // they import). The browser loads only the client entry, so it must stay a single file.
  const srcFiles = (await readdir(join(root, "src"))).filter((file) => /\.(?:mjs|js)$/.test(file)).sort();
  // The standalone shell (served by the package's own routes) keeps its folder layout under shell/.
  const shellFiles = await listShell(join(root, "shell"));
  const sources = [
    ...(template.entrypoints.agents ? [{ file: "agents.json", from: join(root, "agents.json") }] : []),
    ...srcFiles.map((file) => ({ file, from: join(root, "src", file) })),
    ...shellFiles.map((rel) => ({ file: `shell/${rel}`, from: join(root, "shell", rel) })),
  ];
  const files = [];
  for (const { file, from } of sources) {
    const to = join(outDir, file);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    const bytes = await readFile(to);
    files.push({ path: file, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: (await stat(to)).size });
  }

  const manifest = {
    ...template,
    builtAgainst: { engineVersion, engineCommit: engineCommit() },
    files,
  };
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { outDir, manifest };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const { outDir, manifest } = await buildPackage();
  console.log(`Built ${manifest.id} ${manifest.version} → ${outDir}`);
  for (const file of manifest.files) console.log(`  ${file.path}  ${file.bytes} B  ${file.sha256.slice(0, 12)}…`);
}
