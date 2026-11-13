import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCatalog } from "../../custom-modules/scripts/catalog.mjs";

const root = await mkdtemp(join(tmpdir(), "mari-catalog-version-"));
const savedFetch = globalThis.fetch;
const { version } = JSON.parse(
  await readFile(new URL("../../custom-modules/mari-kit/manifest.template.json", import.meta.url), "utf8"),
);
const [major, minor, patch] = version.split(".").map(Number);
const publishedVersion = `${major}.${minor}.${patch + 1}`;
const file = join(root, "catalog", "v2", "catalog.json");
const published = JSON.stringify({ packages: [{ manifest: { id: "mari-kit", version: publishedVersion } }] });
try {
  await mkdir(join(root, "catalog", "v2"), { recursive: true });
  await writeFile(file, published);
  globalThis.fetch = async () => Response.json({ packages: [] });
  await assert.rejects(
    buildCatalog({ out: root, baseUrl: "https://example.invalid/catalog" }),
    /Refusing to replace published mari-kit .* with older/,
  );
  assert.equal(await readFile(file, "utf8"), published, "an older build cannot overwrite the published catalog");
  console.log("Mari catalog rejects version downgrades before publication.");
} finally {
  globalThis.fetch = savedFetch;
  await rm(root, { recursive: true, force: true });
}
