// Model status from Radiosonde (rs.igx.kr), asked by the browser for the models of my own connections only.
// Connection model names vary ("anthropic/claude-opus-4-6", "claude-opus-4.6"), so a few spellings are tried.
// When the service cannot be reached the status simply stays hidden.

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

export async function modelStatus(models) {
  const wanted = new Map();
  for (const m of models) for (const id of candidates(m)) wanted.set(id, m);
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
