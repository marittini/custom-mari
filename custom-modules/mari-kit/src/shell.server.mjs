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
import { readdir, readFile } from "node:fs/promises";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const SHELL_ROOT = new URL("./shell/", import.meta.url);
const TYPES = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", svg: "image/svg+xml" };

/** A path inside shell/ the browser may ask for: plain segments, a known type, no traversal. */
export function shellFile(raw) {
  const path = String(raw ?? "");
  if (!/^[a-z0-9][a-z0-9/_-]*\.(?:js|css|svg)$/i.test(path)) return null;
  if (path.split("/").some((part) => !part || part.startsWith("."))) return null;
  return path;
}

/**
 * The page loads everything under /app/v/<version>/, where the version hashes every shell file. Those URLs
 * never change content, so the phone keeps them for a year and asks nothing on the next visit; a new package
 * build gives a new version and the page fetches only then.
 */
export function shellPage(version) {
  const base = `/api/mari-kit/app/v/${version}`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Marinara</title>
<link rel="stylesheet" href="${base}/shell.css">
<script type="module" src="${base}/app.js"></script>
</head>
<body>
<div id="app" class="mk"></div>
<noscript>이 화면은 자바스크립트가 필요해요.</noscript>
</body>
</html>
`;
}

/** Brotli when the browser takes it, else gzip, else plain. */
export function pickEncoding(header) {
  const offered = new Set();
  for (const part of String(header ?? "").split(",")) {
    const [name = "", ...params] = part.trim().toLowerCase().split(";");
    if (params.some((p) => /^\s*q=0(?:\.0*)?\s*$/.test(p))) continue;
    offered.add(name.trim());
  }
  return offered.has("br") ? "br" : offered.has("gzip") ? "gzip" : null;
}

const cache = new Map();

async function readShellFile(path) {
  const hit = cache.get(path);
  if (hit) return hit;
  const data = await readFile(new URL(path, SHELL_ROOT));
  // Compressed once per file and kept: the shell is a few hundred KB of text that shrinks to about a quarter.
  const entry = {
    data,
    br: brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
    gzip: gzipSync(data, { level: 9 }),
    etag: `"${createHash("sha256").update(data).digest("hex").slice(0, 32)}"`,
  };
  cache.set(path, entry);
  return entry;
}

async function listShell(dir = SHELL_ROOT, prefix = "") {
  const out = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isDirectory()) out.push(...(await listShell(new URL(`${item.name}/`, dir), `${prefix}${item.name}/`)));
    else if (shellFile(prefix + item.name)) out.push(prefix + item.name);
  }
  return out.sort();
}

let versionP = null;
function shellVersion() {
  if (!versionP) {
    versionP = (async () => {
      const hash = createHash("sha256");
      for (const path of await listShell()) hash.update(path).update((await readShellFile(path)).etag);
      return hash.digest("hex").slice(0, 12);
    })().catch((error) => {
      versionP = null;
      throw error;
    });
  }
  return versionP;
}

const BUILT_IN = new Set(["__professor_mari__"]);

/** What a character list needs — never the card body, which with a lorebook can be hundreds of KB a character. */
export function slimCharacter(record) {
  let data = record?.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = {};
    }
  }
  const card = data && typeof data === "object" ? data : {};
  const ext = card.extensions && typeof card.extensions === "object" ? card.extensions : {};
  return {
    id: record.id,
    name: typeof card.name === "string" ? card.name.trim() : "",
    phoneticName: typeof ext.phoneticName === "string" ? ext.phoneticName : "",
  };
}

export async function shellRoutes(app, { runtime } = {}) {
  app.get("/shell/characters", async () =>
    (await runtime.resources.listCharacters()).filter((c) => !BUILT_IN.has(c.id)).map(slimCharacter),
  );
  app.get("/app", async (_request, reply) => {
    reply.header("Cache-Control", "no-cache");
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(shellPage(await shellVersion()));
  });
  app.get("/app/*", async (request, reply) => {
    const raw = String(request.params["*"] ?? "");
    const versioned = /^v\/([0-9a-f]{12})\/(.*)$/.exec(raw);
    const path = shellFile(versioned ? versioned[2] : raw);
    if (!path) return reply.status(404).send({ error: "Not found" });
    let file;
    try {
      file = await readShellFile(path);
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
    // An old page asking with an earlier version gets today's file, but must not keep it forever.
    const current = versioned && versioned[1] === (await shellVersion());
    reply.header("Cache-Control", current ? "public, max-age=31536000, immutable" : "no-cache");
    reply.header("ETag", file.etag);
    reply.header("Vary", "Accept-Encoding");
    if (request.headers["if-none-match"] === file.etag) return reply.status(304).send();
    reply.header("Content-Type", TYPES[path.split(".").pop().toLowerCase()]);
    const encoding = pickEncoding(request.headers["accept-encoding"]);
    if (encoding) reply.header("Content-Encoding", encoding);
    return reply.send(encoding ? file[encoding] : file.data);
  });
}
