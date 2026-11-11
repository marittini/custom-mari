import { h, icon, I, setChildren } from "../lib/h.js";
import {
  data,
  byLastActivity,
  characterIndex,
  chatTitle,
  firstLetter,
  messageText,
  shortTime,
  chatMeta,
} from "../lib/data.js";
import { pageHead, avatar, errorBox, lazyBg } from "../lib/ui.js";
import { modelStatus } from "../lib/status.js";

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
      const [chats, chars, conns] = await Promise.all([data.chats(true), data.characters(), data.connections()]);
      const index = characterIndex(chars);
      const sorted = [...chats].sort(byLastActivity);
      const rp = sorted.find((c) => c.mode === "roleplay");
      const convos = sorted.filter((c) => c.mode === "conversation").slice(0, 3);
      const [rpLast, ...convoLast] = await Promise.all([
        rp ? data.messages(rp.id, 4).catch(() => []) : [],
        ...convos.map((c) => data.messages(c.id, 1).catch(() => [])),
      ]);
      if (!alive) return;
      const parts = [];

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
                cover?.avatar ? "" : firstLetter(title),
              ),
              cover?.avatar,
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
      const used = new Set(chats.map((c) => c.connectionId).filter(Boolean));
      const mine = conns.filter((c) => used.has(c.id) || c.isDefault === "true" || c.isDefault === true);
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
              const who = index.get(c.characterIds?.[0]);
              const last = convoLast[i]?.[convoLast[i].length - 1];
              const title = chatTitle(c, index);
              return h(
                "a",
                {
                  class: "grow",
                  href: `#/convo/${encodeURIComponent(c.id)}`,
                  style: { gridTemplateColumns: "32px minmax(0,1fr) auto" },
                },
                avatar(who?.avatar, firstLetter(title), 32),
                h(
                  "span",
                  { style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" } },
                  h("span", { style: { fontSize: "14px", fontWeight: "500" } }, title),
                  h(
                    "span",
                    { class: "hint", style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
                    last ? messageText(last) : "",
                  ),
                ),
                h("span", { class: "hint", style: { fontSize: "11px" } }, shortTime(c.lastMessageAt || c.updatedAt)),
              );
            }),
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
