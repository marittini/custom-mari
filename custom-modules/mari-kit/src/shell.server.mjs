// ──────────────────────────────────────────────
// Mari Kit — standalone shell host
//
// Serves this fork's own screens (the "shell") from the package's routes, so the Engine's own UI stays
// untouched and can be updated freely. Everything the shell does goes through the Engine's normal /api.
//
//   GET /api/mari-kit/app          the page
//   GET /api/mari-kit/app/<file>   its scripts and styles (from the package's shell/ folder)
//
// The Engine's Content-Security-Policy allows same-origin scripts only, so the page carries no inline script.
// ──────────────────────────────────────────────

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const SHELL_ROOT = new URL("./shell/", import.meta.url);
const TYPES = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", svg: "image/svg+xml" };

/** A path inside shell/ the browser may ask for: plain segments, a known type, no traversal. */
export function shellFile(raw) {
  const path = String(raw ?? "");
  if (!/^[a-z0-9][a-z0-9/_-]*\.(?:js|css|svg)$/i.test(path)) return null;
  if (path.split("/").some((part) => !part || part.startsWith("."))) return null;
  return path;
}

export function shellPage() {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Marinara</title>
<link rel="stylesheet" href="/api/mari-kit/app/shell.css">
<script type="module" src="/api/mari-kit/app/app.js"></script>
</head>
<body>
<div id="app" class="mk"></div>
<noscript>이 화면은 자바스크립트가 필요해요.</noscript>
</body>
</html>
`;
}

const cache = new Map();

async function readShellFile(path) {
  const hit = cache.get(path);
  if (hit) return hit;
  const data = await readFile(new URL(path, SHELL_ROOT));
  const entry = { data, etag: `"${createHash("sha256").update(data).digest("hex").slice(0, 32)}"` };
  cache.set(path, entry);
  return entry;
}

export async function shellRoutes(app) {
  app.get("/app", async (_request, reply) => {
    reply.header("Cache-Control", "no-cache");
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(shellPage());
  });
  app.get("/app/*", async (request, reply) => {
    const path = shellFile(request.params["*"]);
    if (!path) return reply.status(404).send({ error: "Not found" });
    let file;
    try {
      file = await readShellFile(path);
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
    reply.header("Cache-Control", "no-cache");
    reply.header("ETag", file.etag);
    if (request.headers["if-none-match"] === file.etag) return reply.status(304).send();
    reply.header("Content-Type", TYPES[path.split(".").pop().toLowerCase()]);
    return reply.send(file.data);
  });
}
