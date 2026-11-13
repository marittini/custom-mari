import assert from "node:assert/strict";
import { syncAppearance } from "../../custom-modules/mari-kit/shell/lib/prefs.js";

const originalFetch = globalThis.fetch;
const writes = [];
let finishFirst;
let failNext = false;
let loseNextResponse = false;
let serverTheme = null;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/mari-kit/shell/appearance");
  assert.equal(options.method, "PUT");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.headers["x-marinara-csrf"], "1");
  const { theme } = JSON.parse(options.body);
  writes.push(theme);
  if (writes.length === 1)
    await new Promise((resolve) => {
      finishFirst = resolve;
    });
  if (failNext) {
    failNext = false;
    return Response.json({ error: "temporarily unavailable" }, { status: 503 });
  }
  serverTheme = theme;
  if (loseNextResponse) {
    loseNextResponse = false;
    throw new Error("response lost after the server committed the theme");
  }
  return Response.json({ theme });
};

try {
  const first = syncAppearance("light");
  await Promise.resolve();
  assert.deepEqual(writes, ["light"]);
  syncAppearance("dark");
  const latest = syncAppearance("light");
  assert.deepEqual(writes, ["light"], "new choices wait for the in-flight write");
  finishFirst();
  await Promise.all([first, latest]);
  assert.deepEqual(writes, ["light"], "a superseded queued choice never overwrites the latest choice");

  await syncAppearance("dark");
  await syncAppearance("dark");
  await syncAppearance("system");
  assert.deepEqual(writes, ["light", "dark"], "unchanged or unresolved choices do not make requests");

  failNext = true;
  await syncAppearance("light");
  await syncAppearance("light");
  assert.deepEqual(writes, ["light", "dark", "light", "light"], "a failed write can retry the same choice");

  loseNextResponse = true;
  await syncAppearance("dark");
  assert.equal(serverTheme, "dark", "the server may commit before the response is lost");
  await syncAppearance("light");
  assert.equal(serverTheme, "light", "returning to the prior choice must resave after an ambiguous failure");
  assert.deepEqual(writes.slice(-2), ["dark", "light"]);
  console.log("Mari appearance sync: serialized writes, coalescing, no-op and retry passed");
} finally {
  globalThis.fetch = originalFetch;
}
