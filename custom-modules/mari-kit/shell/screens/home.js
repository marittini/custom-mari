import { h, icon, I, setChildren } from "../lib/h.js";
import {
  previewLine,
  data,
  byLastActivity,
  characterIndex,
  chatTitle,
  firstLetter,
  messageText,
  shortTime,
  chatMeta,
  coverOf,
} from "../lib/data.js";
import { pageHead, avatar, avatarStack, errorBox, lazyBg, hbox, timeAndUnread } from "../lib/ui.js";
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
      const [chats, chars, conns, radio] = await Promise.all([
        data.chats(true),
        data.characters(),
        data.connections(),
        api.get("/mari-kit/radio").catch(() => null),
      ]);
      const index = characterIndex(chars);
      const sorted = [...chats].sort(byLastActivity);
      const rp = sorted.find((c) => c.mode === "roleplay");
      const convos = sorted.filter((c) => c.mode === "conversation").slice(0, 3);
      const [rpLast, ...convoLast] = await Promise.all([
        rp ? data.messages(rp.id, 4).catch(() => []) : [],
        ...convos.map((c) => data.messages(c.id, 4).catch(() => [])),
      ]);
      if (!alive) return;
      const parts = [];
      const hint = installHint();
      if (hint) parts.push(hint);

      if (rp) {
        const lastAssistant = [...rpLast].reverse().find((m) => m.role === "assistant");
        const cover = index.get(rp.characterIds?.[0]);
        const title = chatTitle(rp, index);
        parts.push(
          h(
            "a",
            {
              class: "gcard",
              href: `#/rp/${encodeURIComponent(rp.id)}`,
              style: {
                display: "grid",
                gridTemplateColumns: "56px minmax(0,1fr) 40px",
                alignItems: "center",
                gap: "16px",
                padding: "16px",
              },
            },
            lazyBg(
              h(
                "span",
                { class: "ph", style: { width: "56px", height: "76px", fontSize: "18px" } },
                coverOf(rp) || cover?.avatar ? "" : firstLetter(title),
              ),
              coverOf(rp) || cover?.avatar,
            ),
            h(
              "span",
              { style: { display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" } },
              h(
                "span",
                { class: "hint", style: { fontSize: "11px" } },
                `이어 읽기 · ${shortTime(rp.lastMessageAt || rp.updatedAt)}`,
              ),
              h("span", { style: { fontSize: "16px", fontWeight: "600" } }, title),
              lastAssistant
                ? h(
                    "span",
                    {
                      class: "read",
                      style: {
                        fontSize: "13px",
                        lineHeight: "1.6",
                        color: "var(--ink-2)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      },
                    },
                    lastLine(messageText(lastAssistant)),
                  )
                : null,
            ),
            h(
              "span",
              {
                "aria-label": "이어서",
                style: {
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  background: "var(--me)",
                  color: "var(--me-fg)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                },
              },
              icon(I.play, 14, 2),
            ),
          ),
        );
      }

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

      if (convos.length) {
        parts.push(
          h("div", { class: "gsec" }, h("span", null, "최근 대화")),
          h(
            "div",
            { class: "gcard" },
            convos.map((c, i) => {
              const cast = (c.characterIds || []).map((id) => index.get(id)).filter(Boolean);
              const title = chatTitle(c, index);
              return h(
                "a",
                {
                  class: "grow",
                  href: `#/convo/${encodeURIComponent(c.id)}`,
                  style: { gridTemplateColumns: "32px minmax(0,1fr) auto" },
                },
                coverOf(c)
                  ? avatar(coverOf(c), firstLetter(title), 32)
                  : cast.length > 1
                    ? avatarStack(cast, 32)
                    : avatar(cast[0]?.avatar, firstLetter(title), 32),
                h(
                  "span",
                  { style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" } },
                  h("span", { style: { fontSize: "14px", fontWeight: "500" } }, title),
                  h(
                    "span",
                    { class: "hint", style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
                    previewLine(convoLast[i]),
                  ),
                ),
                timeAndUnread(c, shortTime(c.lastMessageAt || c.updatedAt)),
              );
            }),
          ),
        );
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
          rp ? 1 : 0,
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
      if (!parts.length) parts.push(h("div", { class: "empty" }, "아직 채팅이 없어요."));
      setChildren(scroll, ...parts);
    } catch (error) {
      if (alive) setChildren(scroll, errorBox(error));
    }
  })();

  return { dispose: () => (alive = false) };
}

function lastLine(text) {
  const quotes = String(text).match(/[“"「『][^”"」』]{2,}[”"」』]/g);
  const pick = quotes?.length ? quotes[quotes.length - 1] : String(text).trim().split(/\n+/).pop();
  return pick || "";
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
