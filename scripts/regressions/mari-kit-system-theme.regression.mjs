import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { shellPage, shellRoutes } from "../../custom-modules/mari-kit/src/shell.server.mjs";

const requireServer = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const Fastify = requireServer("fastify");
const app = Fastify();
await shellRoutes(app);
try {
  const read = async (query) => {
    const response = await app.inject({ method: "GET", url: `/manifest${query}` });
    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.headers["content-type"], /application\/manifest\+json/);
    return response.json();
  };
  const light = await read("?theme=light&name=Mari%20Phone");
  const dark = await read("?theme=dark&name=Mari%20Phone");
  const fallback = await read("?theme=invalid");
  assert.equal(dark.theme_color, "#000000");
  assert.equal(dark.background_color, "#000000");
  assert.equal(light.theme_color, "#ffffff");
  assert.equal(light.background_color, "#ffffff");
  assert.equal(fallback.theme_color, light.theme_color);
  for (const key of ["name", "short_name", "id", "start_url", "scope", "display", "icons"])
    assert.deepEqual(dark[key], light[key], `theme changes preserve installed-app ${key}`);
  assert.equal(dark.name, "Mari Phone");
  assert.match(shellPage("fixture"), /<meta name="theme-color"/);
  console.log("Mari system theme: manifest colors and installed-app identity passed");
} finally {
  await app.close();
}
