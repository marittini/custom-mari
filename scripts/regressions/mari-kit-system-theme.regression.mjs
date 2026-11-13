import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { shellPage, shellRoutes } from "../../custom-modules/mari-kit/src/shell.server.mjs";

const requireServer = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const Fastify = requireServer("fastify");

function fakeDocuments() {
  const rows = new Map();
  let writes = 0;
  return {
    rows,
    get writes() {
      return writes;
    },
    async getById(packageId, id) {
      assert.equal(packageId, "mari-kit", "appearance documents stay in the package namespace");
      return rows.get(id) ?? null;
    },
    async create(input) {
      assert.equal(input.packageId, "mari-kit");
      assert.equal(input.id, "mari-kit:shell-appearance");
      assert.equal(input.kind, "shell-appearance");
      if (rows.has(input.id)) throw new Error("document already exists");
      rows.set(input.id, { ...input, revision: 1 });
      writes += 1;
      return rows.get(input.id);
    },
    async update(input) {
      assert.equal(input.packageId, "mari-kit");
      const current = rows.get(input.id);
      if (!current || current.revision !== input.expectedRevision) return null;
      rows.set(input.id, { ...current, ...input, revision: current.revision + 1 });
      writes += 1;
      return rows.get(input.id);
    },
  };
}

const documents = fakeDocuments();
const runtime = { persistence: { documents } };

async function makeApp() {
  const app = Fastify();
  await shellRoutes(app, { runtime });
  return app;
}

async function readManifest(app, query = "") {
  const response = await app.inject({ method: "GET", url: `/manifest${query}` });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.headers["content-type"], /application\/manifest\+json/);
  return response.json();
}

const app = await makeApp();
try {
  const initialLight = await readManifest(app, "?theme=light&name=Mari%20Phone");
  const initialDark = await readManifest(app, "?theme=dark&name=Mari%20Phone");
  const initialFallback = await readManifest(app, "?theme=invalid");
  const initialDefault = await readManifest(app);
  assert.equal(initialDark.theme_color, "#000000");
  assert.equal(initialDark.background_color, "#000000");
  assert.equal(initialLight.theme_color, "#ffffff");
  assert.equal(initialLight.background_color, "#ffffff");
  assert.equal(initialFallback.theme_color, initialLight.theme_color);
  for (const key of ["name", "short_name", "id", "start_url", "scope", "display", "icons"])
    assert.deepEqual(initialDark[key], initialLight[key], `theme changes preserve installed-app ${key}`);
  assert.equal(initialDark.name, "Mari Phone");

  const invalid = await app.inject({ method: "PUT", url: "/shell/appearance", payload: { theme: "system" } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(documents.writes, 0, "invalid values do not touch persistence");

  const darkWrite = await app.inject({ method: "PUT", url: "/shell/appearance", payload: { theme: "dark" } });
  assert.equal(darkWrite.statusCode, 200, darkWrite.body);
  assert.deepEqual(darkWrite.json(), { theme: "dark" });
  const darkDoc = documents.rows.get("mari-kit:shell-appearance");
  assert.equal(darkDoc.revision, 1);
  assert.equal(darkDoc.kind, "shell-appearance");
  assert.equal(darkDoc.packageId, "mari-kit");
  const writesAtDark = documents.writes;

  const noOpDarkWrite = await app.inject({ method: "PUT", url: "/shell/appearance", payload: { theme: "dark" } });
  assert.equal(noOpDarkWrite.statusCode, 200);
  assert.equal(documents.writes, writesAtDark, "saving the current theme is a no-op");
  assert.equal(documents.rows.get("mari-kit:shell-appearance").revision, 1, "no-op preserves revision");

  const darkManifest = await readManifest(app);
  const staleLightQuery = await readManifest(app, "?theme=light&name=Mari%20Phone");
  assert.equal(darkManifest.theme_color, "#000000", "the queryless installed manifest URL follows persisted theme");
  assert.equal(darkManifest.background_color, "#000000");
  assert.equal(staleLightQuery.theme_color, "#000000", "stored theme wins over old query parameters");
  assert.equal(staleLightQuery.background_color, "#000000");
  assert.equal(staleLightQuery.name, "Mari Phone", "name query behavior remains intact");
  for (const key of ["name", "short_name", "id", "start_url", "scope", "display", "icons"])
    assert.deepEqual(darkManifest[key], initialDefault[key], `persisted theme preserves installed-app ${key}`);

  await app.close();
  const restarted = await makeApp();
  try {
    const afterRestart = await readManifest(restarted);
    assert.equal(afterRestart.theme_color, "#000000", "appearance survives route/server re-registration");
    assert.equal(afterRestart.background_color, "#000000");

    const lightWrite = await restarted.inject({ method: "PUT", url: "/shell/appearance", payload: { theme: "light" } });
    assert.equal(lightWrite.statusCode, 200, lightWrite.body);
    const lightDoc = documents.rows.get("mari-kit:shell-appearance");
    assert.equal(lightDoc.revision, 2, "updates use the observed document revision");
    assert.deepEqual(lightDoc.data, { theme: "light" });
    const lightManifest = await readManifest(restarted);
    const staleDarkQuery = await readManifest(restarted, "?theme=dark");
    assert.equal(lightManifest.theme_color, "#ffffff");
    assert.equal(lightManifest.background_color, "#ffffff");
    assert.equal(staleDarkQuery.theme_color, "#ffffff", "stored light theme wins over any stale theme query");
    assert.equal(staleDarkQuery.background_color, "#ffffff");
    assert.equal(documents.writes, writesAtDark + 1);
  } finally {
    await restarted.close();
  }
} finally {
  if (!app.server.listening) await app.close().catch(() => {});
}

const fallbackApp = await Fastify();
await shellRoutes(fallbackApp);
try {
  assert.equal(
    (await readManifest(fallbackApp, "?theme=dark")).theme_color,
    "#000000",
    "without persistence manifest query fallback remains available",
  );
  const unavailable = await fallbackApp.inject({ method: "PUT", url: "/shell/appearance", payload: { theme: "dark" } });
  assert.equal(unavailable.statusCode, 503, "writes fail explicitly when runtime document storage is absent");
} finally {
  await fallbackApp.close();
}

assert.match(shellPage("fixture"), /<meta name="theme-color"/);
console.log("Mari system theme: manifest colors, durable appearance, and installed-app identity passed");
