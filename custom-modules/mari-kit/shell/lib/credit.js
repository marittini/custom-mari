// 남은 크레딧: what is left on every account, in one receipt.
//   Google Cloud / Vertex accounts: Mari Kit (/mari-kit/credit) — the console figure minus what Google counted since.
//   Engine connections with a balance (OpenRouter, NanoGPT, DeepSeek, LinkAPI, …): the Engine's own balance route,
//   with the keys the Engine holds (kept 5 minutes there).

import { h, icon, I } from "./h.js";
import { api } from "./api.js";

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
  const value = { view, accounts, google: view.google };
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

/** The home receipt. `onRefresh` re-reads now; `go` opens the settings. */
export function creditCard({ view, accounts, google }, { go, onRefresh, busy = false }) {
  const rows = [];
  let totalUsd = 0;
  for (const g of google) {
    if (!g.hasKey) continue;
    const right =
      g.left === null
        ? "남은 금액을 적어 주세요"
        : g.total
          ? `$${g.left.toFixed(0)} / $${g.total}`
          : `$${g.left.toFixed(2)}`;
    rows.push(leader(named(g.name, g.left, view), right));
    if (g.left !== null) totalUsd += g.left;
    if (g.left !== null && g.total) rows.push(bar(g.left, g.total));
    // The reason is in 설정; here only that the figure is not up to date.
    if (g.error) rows.push(h("div", { class: "rcnote" }, "사용량을 못 읽었어요 · 설정에서 보기"));
  }
  for (const a of accounts) {
    if (a.left === null) {
      rows.push(leader(a.name, a.note || "—"));
      continue;
    }
    const usd = toUsd(a.left, a.unit, view.rates);
    if (usd !== null) totalUsd += usd;
    rows.push(
      leader(
        named(a.name, usd, view),
        a.total ? `${native(a.left, a.unit)} / ${native(a.total, a.unit)}` : native(a.left, a.unit),
      ),
    );
    if (a.total) rows.push(bar(a.left, a.total));
  }
  const soonest = google
    .filter((g) => g.hasKey && g.expires)
    .map((g) => ({ g, d: dday(g.expires) }))
    .filter((x) => x.d !== null && x.d >= 0)
    .sort((a, b) => a.d - b.d)[0];
  const empty = !rows.length;
  const other =
    view.display === "USD"
      ? `₩${Math.round(totalUsd * view.rates.KRW).toLocaleString("ko-KR")}`
      : `$${totalUsd.toFixed(2)}`;
  return h(
    "div",
    { class: "rc", role: "group", "aria-label": "남은 크레딧" },
    h("div", { class: "rchd" }, "크레딧 영수증"),
    empty
      ? h("div", { class: "rcsub", style: { padding: "8px 0" } }, "아직 보여 줄 계정이 없어요")
      : [
          h("div", { class: "rcbig" }, money(totalUsd, view)),
          h("div", { class: "rcsub" }, `전부 합쳐서 · 약 ${other}`),
          spentLine(google, view),
        ],
    h("div", { class: "rccut" }),
    rows,
    rows.length ? h("div", { class: "rccut" }) : null,
    soonest ? leader(`${soonest.g.name} 만료`, soonest.d === 0 ? "오늘" : `D-${soonest.d}`) : null,
    h(
      "div",
      { class: "rcl rcact" },
      h("button", { type: "button", class: "rcbtn", onClick: () => go("credit") }, empty ? "계정 추가 ›" : "설정 ›"),
      h("i"),
      h(
        "button",
        { type: "button", class: "rcbtn", "aria-label": "다시 확인", disabled: busy, onClick: onRefresh },
        busy ? "확인 중…" : icon(["M20 12a8 8 0 1 1-2.3-5.7", "M20 4v5h-5"], 14, 1.8),
      ),
    ),
  );
}
