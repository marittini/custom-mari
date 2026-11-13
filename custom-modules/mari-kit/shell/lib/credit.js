// 남은 크레딧: what is left on every account, in one receipt.
//   Google Cloud / Vertex accounts: Mari Kit (/mari-kit/credit) — the console figure minus what Google counted since.
//   Engine connections with a balance (OpenRouter, NanoGPT, DeepSeek, LinkAPI, …): the Engine's own balance route,
//   with the keys the Engine holds (kept 5 minutes there).

import { h, icon } from "./h.js";
import { api } from "./api.js";
import { foldGroup } from "./groups.js";

let memo = null; // { at, value } — moving away from 홈 and back within a minute reads nothing again

/** { view, accounts: [{ id, name, left, unit, total, note }], google: [...] } */
export async function loadCredit({ refresh = false } = {}) {
  if (!refresh && memo && Date.now() - memo.at < 60_000) return memo.value;
  const [view, list] = await Promise.all([
    api.get(`/mari-kit/credit${refresh ? "?refresh=1" : ""}`),
    api.get("/connection-accounts").catch(() => []),
  ]);
  const shown = (Array.isArray(list) ? list : []).filter(
    (a) => a.balanceSource && a.enabled !== false && !view.hidden.includes(a.id),
  );
  const accounts = await Promise.all(
    shown.map(async (a) => {
      const res = await api
        .get(`/connection-accounts/${encodeURIComponent(a.id)}/balance${refresh ? "?refresh=true" : ""}`)
        .catch((error) => ({ error }));
      const b = res?.balance;
      // LinkAPI: with only an sk- key the Engine reads that key's own allowance (none for an unlimited key);
      // the account balance needs the dashboard access token (profile:read) and user id on the Engine connection.
      const linkKeyOnly = a.balanceSource === "linkapi" && b?.scope === "key";
      return {
        id: a.id,
        name: a.name,
        source: a.balanceSource,
        scope: b?.scope || null,
        left: b && Number.isFinite(b.left) ? b.left : null,
        unit: b?.unit || "USD",
        total:
          !b || !Number.isFinite(b.left)
            ? null
            : Number.isFinite(b.granted)
              ? b.granted
              : Number.isFinite(b.used) && b.scope === "key"
                ? b.left + b.used
                : null,
        note: res?.error
          ? "읽지 못했어요"
          : !b
            ? "잔액 읽기 꺼짐"
            : b.left === null
              ? linkKeyOnly
                ? "키 한도 없음 · 계정 잔액은 토큰 필요"
                : "한도 없음"
              : "",
        // Why the account balance is not shown (the Engine's notice), for 설정.
        notice:
          res?.notice === "linkapi_missing_profile_read"
            ? "대시보드 토큰에 profile:read 권한이 없어요"
            : res?.notice === "linkapi_token_rejected"
              ? "대시보드 토큰이 거절됐어요"
              : linkKeyOnly
                ? "키의 남은 한도예요. 계정 전체 잔액은 대시보드 토큰과 사용자 ID를 넣으면 보여요"
                : "",
      };
    }),
  );
  const value = { view, accounts, google: view.google, list: Array.isArray(list) ? list : [] };
  memo = { at: Date.now(), value };
  return value;
}

export const forgetCredit = () => (memo = null);

/** USD for an amount in a currency the Engine reports (USD, CNY; tokens are not money). */
function toUsd(amount, unit, rates) {
  if (unit === "USD") return amount;
  if (unit === "CNY") return amount / (rates.CNY || 7.1);
  if (unit === "KRW") return amount / (rates.KRW || 1400);
  return null;
}

export function money(usd, view) {
  if (usd === null || usd === undefined) return "—";
  if (view.display === "USD") return `$${usd < 100 ? usd.toFixed(2) : Math.round(usd).toLocaleString("en-US")}`;
  return `₩${Math.round(usd * view.rates.KRW).toLocaleString("ko-KR")}`;
}

function native(amount, unit) {
  if (unit === "USD") return `$${amount < 100 ? amount.toFixed(2) : Math.round(amount).toLocaleString("en-US")}`;
  if (unit === "CNY") return `¥${amount.toFixed(2)}`;
  if (unit === "TOKENS") return `${Math.round(amount / 1000).toLocaleString("ko-KR")}k 토큰`;
  return `${Math.round(amount).toLocaleString("ko-KR")} ${unit}`;
}

const dday = (iso) => {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((Date.parse(`${iso}T00:00:00`) - today.getTime()) / 86_400_000);
};

const leader = (left, right, extra = {}) =>
  h("div", { class: "rcl", ...extra }, h("span", null, left), h("i"), h("span", null, right));
// "적음": what is left is under the threshold set in 설정 (USD).
const named = (name, usd, view) =>
  view.low !== null && usd !== null && usd < view.low ? [name, " ", h("span", { class: "rclow" }, "적음")] : name;
const bar = (part, whole) =>
  h("div", { class: "rcbar" }, h("b", { style: { width: `${Math.max(0, Math.min(100, (part / whole) * 100))}%` } }));

/** 오늘·이번 달 쓴 것: only Google reports spending (the other sites report what is left). */
function spentLine(google, view) {
  const counted = google.filter((g) => g.hasKey && g.spend);
  if (!counted.length) return null;
  const today = counted.reduce((a, g) => a + g.spend.today, 0);
  const month = counted.reduce((a, g) => a + g.spend.month, 0);
  return h("div", { class: "rcsub" }, `오늘 ${money(today, view)} · 이번 달 ${money(month, view)} 씀 (구글)`);
}

/**
 * The home receipt: 연결 · 크레딧. Accounts grouped like the Engine groups them (Google Cloud first, then the
 * Engine's connection folders), each with what is left and, under it, the models chats use on it with their
 * speed. `use` = { conns, chats, folders, status } (status: model → { label, latency, level }; it may come later).
 */
export function creditCard({ view, accounts, google, list = [] }, { go, onRefresh, busy = false, use = {} }) {
  const { conns = [], chats = [], folders = [], status = null } = use;
  // Models in use: a chat's connection, newest first (the default connection counts too).
  const lastUse = new Map();
  for (const c of chats) {
    if (!c.connectionId) continue;
    const t = String(c.lastMessageAt || c.updatedAt || "");
    if (!lastUse.has(c.connectionId) || t > lastUse.get(c.connectionId)) lastUse.set(c.connectionId, t);
  }
  const used = conns
    .filter((c) => lastUse.has(c.id) || c.isDefault === true || c.isDefault === "true")
    .sort((a, b) => String(lastUse.get(b.id) || "").localeCompare(String(lastUse.get(a.id) || "")));
  const modelsOf = (accountIds) => used.filter((c) => accountIds.includes(c.accountId)).slice(0, 2);
  const modelLine = (c) => {
    const st = status && status.get ? status.get(c.model) : null;
    const speed = st ? " · " + st.label + " " + st.latency + "초" : "";
    return h("div", { class: "rcm" }, (c.model || c.name) + speed);
  };

  let totalUsd = 0;
  const groups = []; // { label, rows, count }
  // Google Cloud: Mari Kit's accounts; the Engine's Vertex account of the same project shows its models here.
  const vertexOf = (project) =>
    list.filter(
      (a) =>
        a.provider === "google_vertex" && project && String(a.baseUrl || "").includes("/projects/" + project + "/"),
    );
  const taken = new Set();
  const gRows = [];
  for (const g of google) {
    if (!g.hasKey) continue;
    const linked = vertexOf(g.project).map((a) => a.id);
    linked.forEach((id) => taken.add(id));
    const right =
      g.left === null
        ? "남은 금액을 적어 주세요"
        : g.total
          ? "$" + g.left.toFixed(0) + " / $" + g.total
          : "$" + g.left.toFixed(2);
    gRows.push(leader(named(g.name, g.left, view), right));
    if (g.left !== null) totalUsd += g.left;
    if (g.left !== null && g.total) gRows.push(bar(g.left, g.total));
    // The reason is in 설정; here only that the figure is not up to date.
    if (g.error) gRows.push(h("div", { class: "rcnote" }, "사용량을 못 읽었어요 · 설정에서 보기"));
    gRows.push(...modelsOf(linked).map(modelLine));
  }
  if (gRows.length) groups.push({ label: "구글 클라우드", rows: gRows, count: google.filter((g) => g.hasKey).length });

  // DeepSeek keys Mari Kit reads itself (설정 › 크레딧).
  const dRows = [];
  for (const k of view.deepseek || []) {
    if (Number.isFinite(k.left)) {
      const usd = toUsd(k.left, k.unit, view.rates);
      if (usd !== null) totalUsd += usd;
      dRows.push(leader(named(k.name, usd, view), native(k.left, k.unit)));
      if (k.available === false) dRows.push(h("div", { class: "rcnote" }, "잔액이 모자라 지금은 못 써요"));
    } else dRows.push(leader(k.name, k.error ? "읽지 못했어요" : "—"));
  }
  if (dRows.length) groups.push({ label: "딥시크", rows: dRows, count: (view.deepseek || []).length });

  // ElevenLabs: characters left this period (the key in 음성 설정); not money, so not in the total.
  const e = view.eleven;
  if (e && (Number.isFinite(e.left) || e.error)) {
    const eRows = [];
    if (Number.isFinite(e.left)) {
      eRows.push(
        leader(
          "글자" + (e.tier ? " · " + e.tier : ""),
          Math.round(e.left).toLocaleString("ko-KR") + " / " + Math.round(e.total).toLocaleString("ko-KR"),
        ),
      );
      if (e.total) eRows.push(bar(e.left, e.total));
      if (e.resetAt) {
        const d = dday(e.resetAt.slice(0, 10));
        if (d !== null && d >= 0)
          eRows.push(h("div", { class: "rcm" }, d === 0 ? "오늘 다시 채워져요" : d + "일 뒤 다시 채워져요"));
      }
    } else eRows.push(leader("글자", "읽지 못했어요"));
    groups.push({ label: "일레븐랩스", rows: eRows, count: 1 });
  }

  // Engine accounts: with a balance (not hidden in 설정) or with a model in use.
  const byFolder = new Map(); // folderId or "" -> { rows, count }
  const balanceOf = new Map(accounts.map((a) => [a.id, a]));
  const ordered = [...list].sort((x, y) => Number(balanceOf.has(y.id)) - Number(balanceOf.has(x.id)));
  for (const a of ordered) {
    if (taken.has(a.id) || a.enabled === false) continue;
    const b = balanceOf.get(a.id);
    const models = modelsOf([a.id]);
    if (!b && !models.length) continue;
    const rows = [];
    if (b && b.left !== null) {
      const usd = toUsd(b.left, b.unit, view.rates);
      if (usd !== null) totalUsd += usd;
      rows.push(
        leader(
          named(a.name, usd, view),
          b.total ? native(b.left, b.unit) + " / " + native(b.total, b.unit) : native(b.left, b.unit),
        ),
      );
      if (b.total) rows.push(bar(b.left, b.total));
    } else rows.push(leader(a.name, b ? b.note || "—" : ""));
    rows.push(...models.map(modelLine));
    // An account sits in the folder of the connection a chat used last (else of any of its connections).
    const folder =
      (models[0] && models[0].folderId) || (conns.find((c) => c.accountId === a.id && c.folderId) || {}).folderId || "";
    if (!byFolder.has(folder)) byFolder.set(folder, { rows: [], count: 0, more: 0 });
    const f = byFolder.get(folder);
    // 홈 stays short: five accounts per group (balances first), the rest one tap away.
    if (f.count - f.more < 5) f.rows.push(...rows);
    else f.more += 1;
    f.count += 1;
  }
  for (const f of byFolder.values())
    if (f.more)
      f.rows.push(
        h(
          "button",
          { type: "button", class: "rcbtn rcmore", onClick: () => go("settings/connections") },
          "그 밖에 " + f.more + "개 ›",
        ),
      );
  for (const f of folders) if (byFolder.has(f.id)) groups.push({ label: f.name, ...byFolder.get(f.id) });
  for (const [id, f] of byFolder) if (id && !folders.some((x) => x.id === id)) groups.push({ label: "폴더", ...f });
  if (byFolder.has("")) groups.push({ label: groups.length ? "폴더 없음" : "", ...byFolder.get("") });

  const soonest = google
    .filter((g) => g.hasKey && g.expires)
    .map((g) => ({ g, d: dday(g.expires) }))
    .filter((x) => x.d !== null && x.d >= 0)
    .sort((a, b) => a.d - b.d)[0];
  const empty = !groups.length;
  const body = groups.map((g) =>
    g.label
      ? foldGroup(h, "credit", g.label, g.count, h("div", { class: "rcg" }, g.rows))
      : h("div", { class: "rcg" }, g.rows),
  );
  return h(
    "div",
    { class: "rc", role: "group", "aria-label": "연결 · 크레딧" },
    h("div", { class: "rchd" }, "연결 · 크레딧"),
    empty
      ? h("div", { class: "rcsub", style: { padding: "8px 0" } }, "아직 보여 줄 계정이 없어요")
      : spentLine(google, view),
    h("div", { class: "rccut" }),
    body,
    body.length ? h("div", { class: "rccut" }) : null,
    soonest ? leader(soonest.g.name + " 만료", soonest.d === 0 ? "오늘" : "D-" + soonest.d) : null,
    h(
      "div",
      { class: "rcl rcact" },
      h("button", { type: "button", class: "rcbtn", onClick: () => go("credit") }, empty ? "계정 추가 ›" : "크레딧 ›"),
      h("i"),
      h(
        "button",
        { type: "button", class: "rcbtn", onClick: () => go("settings/connections") },
        "연결 " + conns.length + "개 ›",
      ),
      h(
        "button",
        {
          type: "button",
          class: "rcbtn",
          "aria-label": "다시 확인",
          disabled: busy,
          onClick: onRefresh,
          style: { marginLeft: "14px" },
        },
        busy ? "확인 중…" : icon(["M20 12a8 8 0 1 1-2.3-5.7", "M20 4v5h-5"], 14, 1.8),
      ),
    ),
  );
}
