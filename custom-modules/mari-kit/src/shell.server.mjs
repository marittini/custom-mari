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
import { mkdir, readdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="color-scheme" content="light dark">
<title>Marinara</title>
<link rel="manifest" href="/api/mari-kit/manifest">
<link rel="apple-touch-icon" href="/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
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

// ── avatar previews ──────────────────────────
// The Engine serves character avatars only at full size (often a 1–3 MB card PNG); its own WebP thumbnailer
// covers backgrounds and the gallery, not avatars. The shell shows avatars at 32–76 px, so this route reads the
// avatar file from the Engine's data folder and answers a small WebP made with the Engine's `sharp`.
// Without sharp (some Termux builds) it redirects to the original, which is what the shell loaded before.
export const AVATAR_WIDTHS = [96, 240];
const AVATAR_CACHE_BYTES = 16 * 1024 * 1024;
const avatarCache = new Map();
let avatarBytes = 0;
let sharpP = null;

export function avatarFile(raw) {
  const name = String(raw ?? "");
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name) && !name.includes("..") ? name : null;
}

function loadSharp() {
  sharpP ??= import("sharp").then((m) => m.default ?? m).catch(() => null);
  return sharpP;
}

// The Engine hands packages its data folder as an absolute DATA_DIR; avatars live in its avatars/ folder.
async function avatarPath(file) {
  const root = process.env.DATA_DIR;
  if (!root) return null;
  const dir = await realpath(join(root, "avatars")).catch(() => null);
  if (!dir) return null;
  const path = await realpath(join(dir, file)).catch(() => null);
  return path && path.startsWith(dir + sep) ? path : null;
}

/**
 * The Engine's avatar crop, as the shell passes it (`c`): "R,x,y,w,h" — the current format, a rectangle normalized to
 * the source — or "L,zoom,offsetX,offsetY" — the legacy format the Engine draws as `scale(zoom) translate(x%, y%)` on
 * an object-cover square. Returns the source pixel rectangle to cut, or null for none.
 */
export function cropRegion(code, width, height) {
  const parts = String(code || "").split(",");
  const n = parts.slice(1).map(Number);
  if (!width || !height || n.some((v) => !Number.isFinite(v))) return null;
  let left, top, size;
  if (parts[0] === "R" && n.length === 4) {
    if (n[2] <= 0 || n[3] <= 0) return null;
    left = n[0] * width;
    top = n[1] * height;
    const w = n[2] * width;
    const h = n[3] * height;
    size = Math.min(w, h);
    left += (w - size) / 2;
    top += (h - size) / 2;
  } else if (parts[0] === "L" && n.length === 3) {
    const [zoom, ox, oy] = n;
    if (zoom <= 1) return null;
    const side = Math.min(width, height);
    size = side / zoom;
    left = (width - side) / 2 + (0.5 - ox / 100) * side - size / 2;
    top = (height - side) / 2 + (0.5 - oy / 100) * side - size / 2;
  } else return null;
  size = Math.max(1, Math.min(size, width, height));
  left = Math.min(Math.max(0, left), width - size);
  top = Math.min(Math.max(0, top), height - size);
  return { left: Math.round(left), top: Math.round(top), width: Math.round(size), height: Math.round(size) };
}

async function avatarPreview(file, width, crop = "") {
  const path = await avatarPath(file);
  if (!path) return { status: 404 };
  const info = await stat(path);
  const key = `${width}/${file}/${info.mtimeMs}/${crop}`;
  const hit = avatarCache.get(key);
  if (hit) return hit;
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    let image = sharp(path, { animated: false }).rotate();
    if (crop) {
      const meta = await sharp(path, { animated: false }).metadata();
      const swap = (meta.orientation || 1) >= 5;
      const region = cropRegion(crop, swap ? meta.height : meta.width, swap ? meta.width : meta.height);
      // The rotated image is cut in a second pass, so the rectangle is in the orientation the Engine shows.
      if (region) image = sharp(await image.toBuffer()).extract(region);
    }
    const data = await image.resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    const entry = { data };
    avatarCache.set(key, entry);
    avatarBytes += data.length;
    for (const [k, old] of avatarCache) {
      if (avatarBytes <= AVATAR_CACHE_BYTES || k === key) break;
      avatarCache.delete(k);
      avatarBytes -= old.data.length;
    }
    return entry;
  } catch {
    return null;
  }
}

export async function shellRoutes(app, { runtime } = {}) {
  app.get("/shell/avatar", async (request, reply) => {
    const file = avatarFile(request.query?.f);
    if (!file) return reply.status(400).send({ error: "Invalid avatar" });
    const width = AVATAR_WIDTHS.includes(Number(request.query?.w)) ? Number(request.query.w) : AVATAR_WIDTHS[0];
    const crop = /^[RL](?:,-?\d+(?:\.\d+)?){3,4}$/.test(String(request.query?.c || "")) ? request.query.c : "";
    const preview = await avatarPreview(file, width, crop);
    if (preview?.status) return reply.status(preview.status).send({ error: "Not found" });
    if (!preview) return reply.redirect(`/api/avatars/file/${encodeURIComponent(file)}`);
    // Avatar file names are never reused for other pictures (the Engine caches the originals for good too).
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("Content-Type", "image/webp");
    return reply.send(preview.data);
  });
  // The Engine's own settings sections (tab, label, description, search words) for the shell's settings search.
  // From the Engine's shared module, so it follows Engine updates; empty if that module ever moves.
  let engineSettings = null;
  app.get("/shell/engine-settings", async (_request, reply) => {
    if (!engineSettings) {
      try {
        const shared = await import("@marinara-engine/shared");
        engineSettings = {
          tabs: (shared.SETTINGS_TABS || []).map((t) => ({ id: t.id, label: t.label })),
          sections: (shared.SETTINGS_SECTIONS || []).map((s) => ({
            id: s.id,
            tab: s.tab,
            label: s.label,
            description: s.description || "",
            aliases: s.aliases || [],
          })),
        };
      } catch {
        engineSettings = { tabs: [], sections: [] };
      }
    }
    reply.header("Cache-Control", "private, max-age=3600");
    return engineSettings;
  });
  // ── chat covers ──
  // A cover per chat, chosen in the shell: the browser shrinks and crops the picture to a 3:4 WebP before it is sent
  // (so an upload is ~100KB, not a phone photo), Mari Kit re-encodes it with sharp where it can and keeps it under
  // DATA_DIR/mari-kit/covers. The chat's metadata holds its URL (mariKitCover), so chat lists carry it for free.
  const coverDir = () => (process.env.DATA_DIR ? join(process.env.DATA_DIR, "mari-kit", "covers") : null);
  const coverName = (raw) => (/^[A-Za-z0-9_-]{1,64}-[0-9a-f]{12}\.webp$/.test(String(raw || "")) ? String(raw) : null);
  app.post("/shell/cover/:chatId", async (request, reply) => {
    const chatId = String(request.params.chatId || "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(chatId)) return reply.status(400).send({ error: "Invalid chat" });
    const dir = coverDir();
    if (!dir) return reply.status(500).send({ error: "No data folder" });
    let data = Buffer.from(String(request.body?.data || ""), "base64");
    const isWebp =
      data.length > 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
    const sharp = await loadSharp();
    // Browsers that cannot encode WebP send PNG or JPEG; sharp turns those into WebP. Without sharp only WebP is kept.
    const isPicture = isWebp || (sharp && (data[0] === 0x89 || (data[0] === 0xff && data[1] === 0xd8)));
    if (!isPicture || data.length > 3 * 1024 * 1024) return reply.status(400).send({ error: "A picture up to 3MB" });
    if (sharp) {
      try {
        data = await sharp(data)
          .resize({ width: 600, height: 800, fit: "cover", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
      } catch {
        return reply.status(400).send({ error: "That picture could not be read" });
      }
    }
    await mkdir(dir, { recursive: true });
    const name = `${chatId}-${createHash("sha256").update(data).digest("hex").slice(0, 12)}.webp`;
    await writeFile(join(dir, name), data);
    const old = coverName(request.body?.replaces);
    if (old && old !== name && old.startsWith(`${chatId}-`)) await unlink(join(dir, old)).catch(() => {});
    return { url: `/api/mari-kit/shell/cover/${name}`, bytes: data.length };
  });
  app.delete("/shell/cover/:file", async (request) => {
    const name = coverName(request.params.file);
    const dir = coverDir();
    if (name && dir) await unlink(join(dir, name)).catch(() => {});
    return { ok: true };
  });
  app.get("/shell/cover/:file", async (request, reply) => {
    const name = coverName(request.params.file);
    const dir = coverDir();
    if (!name || !dir) return reply.status(404).send({ error: "Not found" });
    let data;
    try {
      data = await readFile(join(dir, name));
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
    // ?w=96|240: a small square-ish version for list thumbnails (kept in the avatar preview cache).
    const width = AVATAR_WIDTHS.includes(Number(request.query?.w)) ? Number(request.query.w) : 0;
    if (width) {
      const key = `cover/${width}/${name}`;
      let hit = avatarCache.get(key);
      const sharp = hit ? null : await loadSharp();
      if (!hit && sharp) {
        try {
          hit = { data: await sharp(data).resize({ width }).webp({ quality: 78 }).toBuffer() };
          avatarCache.set(key, hit);
          avatarBytes += hit.data.length;
        } catch {}
      }
      if (hit) data = hit.data;
    }
    // The name carries the picture's hash, so it never changes under this URL.
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("Content-Type", "image/webp");
    return reply.send(data);
  });
  app.get("/shell/characters", async () =>
    (await runtime.resources.listCharacters()).filter((c) => !BUILT_IN.has(c.id)).map(slimCharacter),
  );
  // Installs the shell as its own home-screen app: it opens Mari directly (about 0.08MB) instead of loading the
  // Engine's app first. Icons are the Engine's own; the name follows the shell's 앱 이름 (sent as ?name=).
  app.get("/manifest", async (request, reply) => {
    const name =
      String(request.query?.name || "")
        .trim()
        .slice(0, 40) || "Marinara";
    reply.header("Cache-Control", "no-cache");
    reply.header("Content-Type", "application/manifest+json; charset=utf-8");
    return reply.send(
      JSON.stringify({
        name,
        short_name: name.slice(0, 12),
        id: "/api/mari-kit/app",
        start_url: "/api/mari-kit/app#/home",
        scope: "/api/mari-kit/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      }),
    );
  });
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
