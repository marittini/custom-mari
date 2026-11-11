// Model status from Radiosonde (rs.igx.kr), asked by the browser for the models of my own connections only.
// Connection model names vary ("anthropic/claude-opus-4-6", "claude-opus-4.6"), so a few spellings are tried.
// When the service cannot be reached, or does not track a model, its status simply stays hidden.

const LEVEL = { OPERATIONAL: "ok", DEGRADED: "warn", IMPACTED: "warn", CRITICAL: "bad", DOWN: "bad", OUTAGE: "bad" };
const LABEL = { ok: "정상", warn: "느림", bad: "장애" };

export function candidates(model) {
  const base = String(model || "")
    .trim()
    .toLowerCase()
    .split("/")
    .pop()
    .replace(/:.*$/, "");
  if (!base) return [];
  const dotted = base.replace(/-(\d+)-(\d+)(?=$|-)/g, "-$1.$2");
  const undated = dotted.replace(/-\d{8}$/, "");
  return [...new Set([base, dotted, undated])];
}

// The bulk endpoint rejects the whole request when any name is unknown, so only names from its own list are asked.
let known = null;
async function knownModels() {
  if (!known) {
    known = fetch("https://rs.igx.kr/api/v2/models", { credentials: "omit" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => new Set(Array.isArray(body?.data) ? body.data.map(String) : []))
      .catch(() => {
        known = null;
        return new Set();
      });
  }
  return known;
}

// Returning to Home within two minutes reuses the last answer instead of asking again.
const FRESH_MS = 2 * 60 * 1000;
let last = null;

export async function modelStatus(models) {
  const key = [...new Set(models)].sort().join("\n");
  if (last && last.key === key && Date.now() - last.at < FRESH_MS) return last.value;
  const value = await lookup(models);
  if (value) last = { key, at: Date.now(), value };
  return value;
}

async function lookup(models) {
  const list = await knownModels();
  const wanted = new Map();
  for (const m of models) {
    const id = candidates(m).find((c) => list.has(c));
    if (id) wanted.set(id, m);
  }
  if (!wanted.size) return null;
  try {
    const res = await fetch(
      `https://rs.igx.kr/api/v2/simple/bulk?models=${encodeURIComponent([...wanted.keys()].join(","))}`,
      { credentials: "omit" },
    );
    if (!res.ok) return null;
    const body = await res.json();
    const out = new Map();
    for (const [id, item] of Object.entries(body?.data || {})) {
      const model = wanted.get(id);
      if (!model || out.has(model) || !item) continue;
      const level = LEVEL[String(item.status || "").toUpperCase()] || "ok";
      const latency = Number(item.latency);
      out.set(model, {
        level,
        label: LABEL[level],
        latency: Number.isFinite(latency) ? (latency / 1000).toFixed(2) : "–",
        score: Math.round(Number(item.score) || 0),
      });
    }
    return out;
  } catch {
    return null;
  }
}
