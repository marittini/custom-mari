import { h, icon, I, setChildren } from "../lib/h.js";
import { data } from "../lib/data.js";
import { pageHead, errorBox, hbox } from "../lib/ui.js";
import { loadCredit, creditCard } from "../lib/credit.js";

const clockOf = (d) =>
  `${d.getHours() < 12 ? "오전" : "오후"} ${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
import { modelStatus } from "../lib/status.js";
import { api } from "../lib/api.js";

export function homeScreen({ mount, go }) {
  let alive = true;
  const scroll = h(
    "div",
    { class: "scroll", style: { padding: "8px 20px 32px" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  mount.append(pageHead("홈"), scroll);

  (async () => {
    try {
      const [chats, conns, radio] = await Promise.all([
        data.chats("soft"),
        data.connections(),
        api.get("/mari-kit/radio").catch(() => null),
      ]);
      if (!alive) return;
      const parts = [];
      const hint = installHint();
      if (hint) parts.push(hint);

      // 내 연결: only connections a chat actually uses (or the default), not every saved endpoint.
      // The three most recently used; the rest stay one tap away so 최근 대화 is not pushed off the screen.
      const lastUse = new Map();
      for (const c of chats) {
        if (!c.connectionId) continue;
        const t = String(c.lastMessageAt || c.updatedAt || "");
        if (!lastUse.has(c.connectionId) || t > lastUse.get(c.connectionId)) lastUse.set(c.connectionId, t);
      }
      const allMine = conns
        .filter((c) => lastUse.has(c.id) || c.isDefault === "true" || c.isDefault === true)
        .sort((a, b) => String(lastUse.get(b.id) || "").localeCompare(String(lastUse.get(a.id) || "")));
      const mine = allMine.slice(0, 3);
      if (mine.length) {
        const statusLine = h("span", null, "");
        const rows = mine.map((c) => {
          const state = h("span", {
            style: {
              display: "flex",
              alignItems: "center",
              fontSize: "13px",
              color: "var(--ink-2)",
              fontVariantNumeric: "tabular-nums",
            },
          });
          return {
            c,
            state,
            row: h(
              "div",
              { class: "grow" },
              h(
                "span",
                { style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" } },
                h(
                  "span",
                  { style: { fontSize: "14px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
                  c.model || c.name,
                ),
                h("span", { class: "hint", style: { fontSize: "11px" } }, c.name),
              ),
              state,
            ),
          };
        });
        parts.push(
          h("div", { class: "gsec" }, h("span", null, "내 연결"), statusLine),
          h(
            "div",
            { class: "gcard" },
            rows.map((r) => r.row),
            allMine.length > mine.length
              ? h(
                  "a",
                  {
                    class: "grow",
                    href: "#/settings/connections",
                    style: { color: "var(--ink-3)", textDecoration: "none", fontSize: "13px" },
                  },
                  h("span", null, `연결 ${allMine.length}개 모두 보기`),
                  h("span", null, "›"),
                )
              : null,
          ),
        );
        modelStatus(mine.map((c) => c.model).filter(Boolean)).then((status) => {
          if (!alive || !status) return;
          let off = 0;
          for (const { c, state } of rows) {
            const s = status.get(c.model);
            if (!s) continue;
            if (s.level !== "ok") off += 1;
            setChildren(
              state,
              h("span", { class: "dot", style: { background: `var(--${s.level})` } }),
              `${s.label} · ${s.latency}초`,
            );
          }
          const known = rows.filter(({ c }) => status.has(c.model)).length;
          if (known) statusLine.textContent = off ? `${known}곳 중 ${off}곳 느림` : `${known}곳 모두 정상`;
        });
      }

      // 라디오: the newest episode, marked when it finished while the reader was away.
      if (radio) {
        const ep = radio.episodes?.[0];
        const fresh = ep && ep.status === "done" && ep.seen === false;
        const line = !ep
          ? "DJ에게 사연 보내기"
          : ep.status === "making"
            ? `${ep.no}회 · 방송 만드는 중…`
            : ep.status === "failed"
              ? `${ep.no}회 · 만들지 못했어요`
              : `${ep.no}회 · ${ep.title}`;
        parts.splice(
          hint ? 1 : 0,
          0,
          h(
            "a",
            {
              class: "gcard grow",
              href: ep && ep.status === "done" ? `#/radio/air/${encodeURIComponent(ep.id)}` : "#/radio",
              style: { marginTop: "12px", color: "var(--ink)", textDecoration: "none" },
            },
            h(
              "span",
              { style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" } },
              h("span", { class: "label" }, fresh ? "라디오 · 새 방송" : "라디오"),
              h("span", { style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, line),
            ),
            h("span", { style: { display: "flex", color: "var(--ink-3)" } }, icon(I.radio, 18)),
          ),
        );
      }
      // 남은 크레딧: every account's balance in one receipt (reads after the rest is drawn).
      const creditHead = h("div", { class: "gsec" }, h("span", null, "남은 크레딧"), h("span", null, ""));
      const creditBox = h("div", null, h("div", { class: "empty", style: { padding: "16px 0" } }, "확인하는 중…"));
      parts.push(creditHead, creditBox);
      const drawCredit = async (refresh = false) => {
        if (refresh) setChildren(creditBox, creditCard(last, { go, busy: true, onRefresh: () => {} }));
        try {
          last = await loadCredit({ refresh });
          if (!alive) return;
          const at = [...last.google.map((g) => g.checkedAt)].filter(Boolean).sort().pop();
          creditHead.lastChild.textContent = `${clockOf(at ? new Date(at) : new Date())} 확인`;
          setChildren(creditBox, creditCard(last, { go, onRefresh: () => drawCredit(true) }));
        } catch (error) {
          if (alive) setChildren(creditBox, errorBox(error));
        }
      };
      let last = null;
      setChildren(scroll, ...parts);
      drawCredit();
    } catch (error) {
      if (alive) setChildren(scroll, errorBox(error));
    }
  })();

  return { dispose: () => (alive = false) };
}

/** Once, for a visit that came through the Engine's address: the home-screen icon opens Mari directly. */
function installHint() {
  try {
    if (
      sessionStorage.getItem("mari-kit:via-engine") !== "1" ||
      localStorage.getItem("mari-kit:install-hint") === "seen"
    )
      return null;
  } catch {
    return null;
  }
  const close = () => {
    try {
      localStorage.setItem("mari-kit:install-hint", "seen");
    } catch {}
    box.remove();
  };
  const prompt = window.__mariInstall;
  const box = hbox(
    "더 가볍게 열기",
    h(
      "p",
      { style: { margin: "0", fontSize: "13px", lineHeight: "1.6", color: "var(--ink-2)" } },
      "엔진 주소로 열면 엔진 앱을 먼저 받아요(처음 약 17MB). 홈 화면에 Mari를 추가해 그 아이콘으로 열면 0.1MB 안팎이에요.",
    ),
    h(
      "div",
      { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "10px" } },
      h("button", { type: "button", class: "pill", onClick: close }, "닫기"),
      prompt
        ? h(
            "button",
            {
              type: "button",
              class: "pill main",
              onClick: async () => {
                await prompt.prompt().catch(() => {});
                close();
              },
            },
            "홈 화면에 추가",
          )
        : h("span", { class: "hint", style: { alignSelf: "center" } }, "브라우저 메뉴 → 홈 화면에 추가"),
    ),
  );
  return box;
}
