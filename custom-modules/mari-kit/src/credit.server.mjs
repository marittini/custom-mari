// 남은 크레딧 (home card): Google Cloud / Vertex accounts the shell cannot read through the Engine.
// Google does not report a remaining credit, so the user types the console's figure once; from then on the card
// subtracts what Google itself counted since (Cloud Monitoring token counts × a price table), for every account —
// any number of service-account JSON keys. Keys stay in this package's storage and never go back to the page.
// Engine connections with a balance (OpenRouter, NanoGPT, DeepSeek, LinkAPI, …) are read by the page through the
// Engine's own balance route, with the keys the Engine already holds.

import { createSign } from "node:crypto";

const PKG = "mari-kit";
const DOC_ID = "mari-kit:credit";
const CHECK_MS = 30 * 60_000; // Google is asked at most this often per account (↻ asks now)
const FOLD_MS = 7 * 86_400_000; // usage older than this is kept as a sum (Monitoring keeps about six weeks)
const FX_MS = 86_400_000;
const SCOPE = "https://www.googleapis.com/auth/monitoring.read";
const METRIC = "aiplatform.googleapis.com/publisher/online_serving/token_count";

/**
 * Official prices, USD per 1M tokens [input, output], as the 말랑 receipt widget keeps them (2026-10). The first
 * match wins; a model with no match is counted at FALLBACK and named on the card so the figure is not trusted
 * blindly.
 */
export const PRICES = [
  [/opus.?5.?5|opus-5-5/i, [4, 20]],
  [/opus.?5\b|opus-5(?!\.)/i, [5, 25]],
  [/opus/i, [5, 25]],
  [/sonnet.?5/i, [2, 10]],
  [/sonnet/i, [3, 15]],
  [/haiku.?5/i, [0.1, 0.5]],
  [/haiku/i, [1, 5]],
  [
    /gemini.?3\.[678].?flash(?!.?lite)/i,
    () => (Date.now() < Date.parse("2027-01-01T00:00:00-08:00") ? [0.75, 3.75] : [1.5, 7.5]),
  ],
  [/gemini.?3\.5.?flash.?lite/i, [0.3, 2.5]],
  [/gemini.?3\.1.?flash.?lite/i, [0.25, 1.5]],
  [/gemini.?3\.\d.?pro/i, [2, 12]],
  [/gemini.?2\.5.?pro/i, [1.25, 10]],
  [/gemini.?2\.5.?flash.?lite/i, [0.1, 0.4]],
  [/gemini.?2\.5.?flash/i, [0.3, 2.5]],
  [/gemma/i, [0.15, 0.6]],
  [/glm/i, [1.4, 4.4]],
  [/deepseek/i, [0.3, 1.2]],
  [/kimi|moonshot/i, [3, 15]],
];
const FALLBACK = [2, 12];

export function priceOf(model) {
  const hit = PRICES.find(([re]) => re.test(String(model || "")));
  if (!hit) return null;
  return typeof hit[1] === "function" ? hit[1]() : hit[1];
}

/** USD for { model: [inTokens, outTokens] }; `unknown` lists models priced at the fallback. */
export function costOf(tokens) {
  let usd = 0;
  const unknown = [];
  for (const [model, [inp, out]] of Object.entries(tokens || {})) {
    const price = priceOf(model);
    if (!price) unknown.push(model);
    const [pin, pout] = price || FALLBACK;
    usd += (inp * pin + out * pout) / 1e6;
  }
  return { usd, unknown };
}

/** A service-account key file, checked; null when it is not one. */
export function parseServiceAccount(text) {
  let sa = text;
  if (typeof text === "string") {
    try {
      sa = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!sa || typeof sa !== "object" || sa.type !== "service_account") return null;
  const { client_email, private_key, project_id } = sa;
  if (![client_email, private_key, project_id].every((v) => typeof v === "string" && v.trim())) return null;
  if (!/BEGIN (RSA )?PRIVATE KEY/.test(private_key)) return null;
  return {
    type: "service_account", // kept, so a stored key reads back as one
    client_email,
    private_key,
    project_id,
    token_uri:
      typeof sa.token_uri === "string" && sa.token_uri.startsWith("https://")
        ? sa.token_uri
        : "https://oauth2.googleapis.com/token",
  };
}

const num = (v, min = 0) => (Number.isFinite(Number(v)) && Number(v) >= min ? Number(v) : null);
const str = (v, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");

export function normalizeCredit(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    display: d.display === "USD" ? "USD" : "KRW",
    fx: num(d.fx, 1),
    hidden: Array.isArray(d.hidden) ? d.hidden.filter((x) => typeof x === "string").slice(0, 200) : [],
    google: (Array.isArray(d.google) ? d.google : []).slice(0, 20).map((g) => ({
      id: str(g.id, 40),
      name: str(g.name) || "구글 계정",
      sa: parseServiceAccount(g.sa),
      balance: num(g.balance),
      total: num(g.total),
      at: str(g.at, 40),
      lagHours: num(g.lagHours) ?? 24,
      expires: day(g.expires),
      used: g.used && typeof g.used === "object" ? g.used : null, // { usd, unknown, checkedAt, from }
      folded: g.folded && typeof g.folded === "object" ? g.folded : null, // { until, usd, unknown }
      error: str(g.error, 200),
    })),
    fxCache: d.fxCache && typeof d.fxCache === "object" ? d.fxCache : null,
  };
}

/** What the page may see of an account: never the key. */
export function publicGoogle(g) {
  const usedUsd = (g.used?.usd || 0) + (g.folded?.usd || 0);
  return {
    id: g.id,
    name: g.name,
    project: g.sa?.project_id || "",
    email: g.sa?.client_email || "",
    hasKey: !!g.sa,
    balance: g.balance,
    total: g.total,
    lagHours: g.lagHours,
    since: g.at,
    expires: g.expires,
    // Counted usage only once Google answered; until then the left amount is the typed figure.
    used: g.balance === null || !g.used?.checkedAt ? null : usedUsd,
    left: g.balance === null ? null : Math.max(0, g.balance - usedUsd),
    unknown: [...new Set([...(g.used?.unknown || []), ...(g.folded?.unknown || [])])].slice(0, 8),
    checkedAt: g.used?.checkedAt || "",
    error: g.error,
  };
}

// ── Google ──────────────────────────────────────
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const tokens = new Map(); // client_email -> { token, exp }

async function accessToken(sa, fetchFn) {
  const hit = tokens.get(sa.client_email);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri, iat: now, exp: now + 3600 }),
  );
  const sign = createSign("RSA-SHA256");
  sign.update(`${head}.${claim}`);
  const jwt = `${head}.${claim}.${b64u(sign.sign(sa.private_key))}`;
  const res = await fetchFn(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token)
    throw new Error(`키를 받아 주지 않았어요 (${res.status} ${json.error || ""})`.trim());
  tokens.set(sa.client_email, { token: json.access_token, exp: Date.now() + (Number(json.expires_in) || 3600) * 1000 });
  return json.access_token;
}

/** Tokens Google counted for this project between two times: { model: [in, out] }. */
export async function googleTokens(sa, fromMs, toMs, fetchFn = fetch) {
  const token = await accessToken(sa, fetchFn);
  const sec = Math.max(60, Math.ceil((toMs - fromMs) / 1000));
  const out = {};
  let pageToken = "";
  for (let page = 0; page < 10; page += 1) {
    const q = new URLSearchParams();
    q.set("filter", `metric.type="${METRIC}"`);
    q.set("interval.startTime", new Date(fromMs).toISOString());
    q.set("interval.endTime", new Date(toMs).toISOString());
    q.set("aggregation.alignmentPeriod", `${sec}s`);
    q.set("aggregation.perSeriesAligner", "ALIGN_SUM");
    q.set("aggregation.crossSeriesReducer", "REDUCE_SUM");
    q.append("aggregation.groupByFields", "resource.label.model_user_id");
    q.append("aggregation.groupByFields", "metric.label.type");
    if (pageToken) q.set("pageToken", pageToken);
    const res = await fetchFn(
      `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(sa.project_id)}/timeSeries?${q}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = res.status === 403 ? "권한이 없어요 (모니터링 뷰어 권한을 주세요)" : json.error?.message || "";
      throw new Error(`사용량을 읽지 못했어요: ${res.status} ${why}`.trim());
    }
    for (const s of json.timeSeries || []) {
      const model = s.resource?.labels?.model_user_id || "알 수 없는 모델";
      const isIn = /^in/i.test(String(s.metric?.labels?.type || ""));
      const v = (s.points || []).reduce((a, p) => a + Number(p.value?.int64Value ?? p.value?.doubleValue ?? 0), 0);
      out[model] = out[model] || [0, 0];
      out[model][isIn ? 0 : 1] += v;
    }
    pageToken = json.nextPageToken || "";
    if (!pageToken) break;
  }
  return out;
}

/** Brings one account's usage up to date (at most every CHECK_MS unless forced). Returns the changed account. */
export async function refreshGoogle(g, { force = false, now = Date.now(), fetchFn = fetch } = {}) {
  if (!g.sa || g.balance === null || !g.at) return g;
  const fresh = g.used?.checkedAt && now - Date.parse(g.used.checkedAt) < CHECK_MS;
  if (fresh && !force) return g;
  const start = Date.parse(g.at);
  let folded = g.folded && Date.parse(g.folded.until) >= start ? g.folded : null;
  const from = folded ? Date.parse(folded.until) : start;
  try {
    // Usage older than a week is summed once and kept, so the window never outgrows Monitoring's retention.
    if (now - from > FOLD_MS) {
      const until = now - 86_400_000;
      const part = costOf(await googleTokens(g.sa, from, until, fetchFn));
      folded = {
        until: new Date(until).toISOString(),
        usd: (folded?.usd || 0) + part.usd,
        unknown: [...new Set([...(folded?.unknown || []), ...part.unknown])],
      };
    }
    const liveFrom = folded ? Date.parse(folded.until) : start;
    const live = costOf(await googleTokens(g.sa, liveFrom, now, fetchFn));
    return { ...g, folded, used: { ...live, checkedAt: new Date(now).toISOString() }, error: "" };
  } catch (error) {
    return { ...g, error: String(error.message || error).slice(0, 200) };
  }
}

// ── exchange rates ──────────────────────────────
/** KRW and CNY per USD, read once a day (a typed ₩ rate wins for KRW). */
async function rates(credit, fetchFn = fetch) {
  const cached = credit.fxCache?.KRW && Date.now() - Date.parse(credit.fxCache.at) < FX_MS ? credit.fxCache : null;
  let cache = cached;
  if (!cache) {
    for (const url of [
      "https://open.er-api.com/v6/latest/USD",
      "https://api.frankfurter.app/latest?from=USD&to=KRW,CNY",
    ]) {
      try {
        const json = await (await fetchFn(url)).json();
        const KRW = Number(json?.rates?.KRW);
        const CNY = Number(json?.rates?.CNY);
        if (KRW > 100) {
          cache = { KRW, CNY: CNY > 1 ? CNY : 7.1, at: new Date().toISOString() };
          break;
        }
      } catch {}
    }
  }
  const base = cache || credit.fxCache || { KRW: 1400, CNY: 7.1 };
  return { KRW: credit.fx || base.KRW, CNY: base.CNY || 7.1, cache: cache || credit.fxCache };
}

export const creditFeature = {
  id: "credit",
  routes(app, { runtime, httpError }) {
    const docs = () => runtime.persistence.documents;
    const read = async () => normalizeCredit((await docs().getById(PKG, DOC_ID))?.data);
    async function save(mutate) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const doc = await docs().getById(PKG, DOC_ID);
        const next = await mutate(normalizeCredit(doc?.data));
        const now = new Date().toISOString();
        if (!doc) {
          try {
            await docs().create({
              id: DOC_ID,
              packageId: PKG,
              kind: "credit",
              name: "남은 크레딧",
              description: "",
              data: next,
              createdAt: now,
              updatedAt: now,
            });
            return next;
          } catch {
            continue;
          }
        }
        const ok = await docs().update({
          id: DOC_ID,
          packageId: PKG,
          expectedRevision: doc.revision,
          name: doc.name,
          description: doc.description,
          data: next,
          updatedAt: now,
        });
        if (ok) return next;
      }
      throw httpError(409, "저장하는 사이에 바뀌었어요. 다시 해 주세요.");
    }
    const view = async (credit) => {
      const { KRW, CNY } = await rates(credit);
      return {
        display: credit.display,
        fx: credit.fx,
        rates: { KRW, CNY },
        hidden: credit.hidden,
        google: credit.google.map(publicGoogle),
      };
    };

    // The card: Google accounts brought up to date (each at most every 30 minutes; ?refresh=1 asks now).
    app.get("/credit", async (request) => {
      const force = request.query?.refresh === "1";
      let credit = await read();
      const counting = credit.google.some((g) => g.sa && g.balance !== null);
      const fx = await rates(credit);
      if (counting || fx.cache !== credit.fxCache) {
        const updated = await Promise.all(credit.google.map((g) => refreshGoogle(g, { force })));
        const changed = updated.some((g, i) => g !== credit.google[i]) || fx.cache !== credit.fxCache;
        if (changed)
          credit = await save((c) => ({
            ...c,
            fxCache: fx.cache,
            google: c.google.map((g) => {
              const u = updated.find((x) => x.id === g.id);
              // Keep what the user changed meanwhile; take only the usage that was read.
              return u && u.at === g.at ? { ...g, used: u.used, folded: u.folded, error: u.error } : g;
            }),
          }));
      }
      return view(credit);
    });

    app.patch("/credit", async (request) => {
      const b = request.body && typeof request.body === "object" ? request.body : {};
      return view(
        await save((c) => ({
          ...c,
          ...(b.display !== undefined ? { display: b.display === "USD" ? "USD" : "KRW" } : {}),
          ...(b.fx !== undefined ? { fx: num(b.fx, 1) } : {}),
          ...(Array.isArray(b.hidden) ? { hidden: b.hidden.filter((x) => typeof x === "string").slice(0, 200) } : {}),
        })),
      );
    });

    // Adds or changes a Google account. `key` is the JSON key file's text (only on add or replace).
    const googleInput = (b, prev) => {
      const out = { ...prev };
      if (b.key !== undefined) {
        const sa = parseServiceAccount(b.key);
        if (!sa) throw httpError(400, "서비스 계정 JSON 키 파일이 아니에요.");
        out.sa = sa;
        out.used = null;
        out.folded = null;
      }
      if (b.name !== undefined) out.name = str(b.name) || "구글 계정";
      if (b.total !== undefined) out.total = num(b.total);
      if (b.expires !== undefined) out.expires = day(b.expires);
      if (b.lagHours !== undefined) out.lagHours = num(b.lagHours) ?? 24;
      // A newly typed console figure starts the count again: the console lags, so it counts from lag hours ago.
      if (b.balance !== undefined) {
        out.balance = num(b.balance);
        out.at = new Date(Date.now() - (out.lagHours ?? 24) * 3_600_000).toISOString();
        out.used = null;
        out.folded = null;
      }
      out.error = "";
      return out;
    };
    app.post("/credit/google", async (request) => {
      const b = request.body && typeof request.body === "object" ? request.body : {};
      if (b.key === undefined) throw httpError(400, "JSON 키 파일을 골라 주세요.");
      const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const added = googleInput(b, {
        id,
        name: "구글 계정",
        balance: null,
        total: 300,
        lagHours: 24,
        at: "",
        expires: "",
      });
      if (!b.name && added.sa) added.name = added.sa.project_id;
      const credit = await save((c) => ({ ...c, google: [...c.google, added].slice(0, 20) }));
      return view(credit);
    });
    app.patch("/credit/google/:id", async (request) => {
      const b = request.body && typeof request.body === "object" ? request.body : {};
      const credit = await save((c) => {
        const g = c.google.find((x) => x.id === request.params.id);
        if (!g) throw httpError(404, "계정을 찾지 못했어요.");
        return { ...c, google: c.google.map((x) => (x.id === g.id ? googleInput(b, x) : x)) };
      });
      return view(credit);
    });
    app.delete("/credit/google/:id", async (request) =>
      view(await save((c) => ({ ...c, google: c.google.filter((x) => x.id !== request.params.id) }))),
    );
  },
};
