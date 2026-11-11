// ──────────────────────────────────────────────
// Mari Kit — web fonts for the shell
//
// The Engine's Content-Security-Policy only lets a page load fonts and styles from its own origin, so a pasted
// web-font CSS (@import url(…) or @font-face) is kept here and served back same-origin: imported CSS is inlined
// and every font url() points at this package's proxy, which fetches the font once and keeps it in memory.
// ──────────────────────────────────────────────

const DOC_ID = "mari-kit:fonts";
const MAX_CSS = 64 * 1024;
const MAX_FONT = 12 * 1024 * 1024;
const FONT_TYPES = /^(?:font\/|application\/(?:font|x-font|vnd\.ms-fontobject|octet-stream))/i;
const fontCache = new Map();
let fontBytes = 0;
const MAX_FONT_CACHE = 48 * 1024 * 1024;
// Built stylesheets by browser User-Agent (each browser family gets its own format); a few at most in practice.
const cssCache = new Map();

function httpsUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Points every url(...) of a stylesheet at the proxy; drops anything that is not https. */
export function rewriteFontUrls(css, base) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_m, _q, raw) => {
    const url = httpsUrl(raw.trim(), base);
    return url ? `url("/api/mari-kit/fonts/file?u=${encodeURIComponent(url.href)}")` : "url(about:invalid)";
  });
}

// Font services pick the format by the asking browser: a phone's browser gets small woff2 slices split by
// unicode-range (it downloads only the slices a page uses), while a request with no browser behind it gets one
// whole TTF — 8 MB for a Korean font. The shell's own browser is the one asking, so its User-Agent is passed on.
async function fetchText(url, userAgent) {
  const headers = { Accept: "text/css,*/*;q=0.1" };
  if (userAgent) headers["User-Agent"] = userAgent;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  if (text.length > MAX_CSS * 4) throw new Error("stylesheet too large");
  return text;
}

/** Inlines @import url(...) (one level) and rewrites font URLs. */
export async function buildFontCss(source, fetcher = fetchText, userAgent = "") {
  const imports = [];
  const rest = source.replace(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;?/g, (_m, _q, raw) => {
    const url = httpsUrl(raw);
    if (url) imports.push(url);
    return "";
  });
  const parts = [];
  for (const url of imports) {
    try {
      parts.push(rewriteFontUrls(await fetcher(url.href, userAgent), url.href));
    } catch {
      // A failing import only loses that font.
    }
  }
  parts.push(rewriteFontUrls(rest, "https://invalid.local/"));
  return parts.join("\n");
}

export function fontRoutes(app, { runtime, httpError }) {
  const docs = () => runtime.persistence.documents;
  async function read() {
    return (await docs().getById("mari-kit", DOC_ID)) ?? null;
  }
  app.put("/fonts", async (request) => {
    const css = typeof request.body?.css === "string" ? request.body.css : null;
    if (css === null || css.length > MAX_CSS) throw httpError(400, "css must be text up to 64 KB");
    const existing = await read();
    const now = new Date().toISOString();
    if (existing) {
      const updated = await docs().update({
        id: DOC_ID,
        packageId: "mari-kit",
        expectedRevision: existing.revision,
        name: existing.name,
        description: existing.description,
        data: { css },
        updatedAt: now,
      });
      if (!updated) throw httpError(409, "Fonts changed while saving. Try again.");
    } else
      await docs().create({
        id: DOC_ID,
        packageId: "mari-kit",
        kind: "fonts",
        name: "Shell web fonts",
        description: "",
        data: { css },
        createdAt: now,
        updatedAt: now,
      });
    cssCache.clear();
    return { ok: true };
  });
  app.get("/fonts/css", async (request, reply) => {
    const userAgent = String(request.headers["user-agent"] || "").slice(0, 400);
    let css = cssCache.get(userAgent);
    if (css === undefined) {
      const doc = await read();
      css = await buildFontCss(String(doc?.data?.css || ""), fetchText, userAgent);
      if (cssCache.size >= 8) cssCache.delete(cssCache.keys().next().value);
      cssCache.set(userAgent, css);
    }
    reply.header("Content-Type", "text/css; charset=utf-8");
    // The page asks with ?v=<hash of the saved CSS>, so a given URL never changes for a given browser.
    reply.header("Cache-Control", request.query?.v ? "private, max-age=31536000, immutable" : "no-cache");
    reply.header("Vary", "User-Agent");
    return reply.send(css);
  });
  app.get("/fonts/file", async (request, reply) => {
    const url = httpsUrl(String(request.query?.u || ""));
    if (!url) throw httpError(400, "https font URL required");
    let hit = fontCache.get(url.href);
    if (!hit) {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const type = res.headers.get("content-type") || "application/octet-stream";
      if (!res.ok || !FONT_TYPES.test(type)) throw httpError(502, "not a font");
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > MAX_FONT) throw httpError(413, "font too large");
      hit = { data, type };
      fontCache.set(url.href, hit);
      fontBytes += data.length;
      // Oldest first out, so a phone that tried many fonts does not hold them all in the server's memory.
      for (const [key, old] of fontCache) {
        if (fontBytes <= MAX_FONT_CACHE || key === url.href) break;
        fontCache.delete(key);
        fontBytes -= old.data.length;
      }
    }
    reply.header("Content-Type", hit.type);
    // Font host URLs carry their version; the browser keeps the file and never asks again.
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.send(hit.data);
  });
}
