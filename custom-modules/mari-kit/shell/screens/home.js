import { h, icon, I, setChildren } from "../lib/h.js";
import { data } from "../lib/data.js";
import { pageHead, errorBox, hbox } from "../lib/ui.js";
import { groupsOf } from "../lib/groups.js";
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
      const [chats, conns, radio, folders] = await Promise.all([
        data.chats("soft"),
        data.connections(),
        api.get("/mari-kit/radio").catch(() => null),
        groupsOf("connections"),
      ]);
      if (!alive) return;
      const parts = [];
      const hint = installHint();
      if (hint) parts.push(hint);

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
      // 연결 · 크레딧: every account in one receipt, grouped like the Engine groups them, with the models chats
      // use and their speed (reads after the rest is drawn).
      const creditHead = h("div", { class: "gsec" }, h("span", null, "연결 · 크레딧"), h("span", null, ""));
      const creditBox = h("div", null, h("div", { class: "empty", style: { padding: "16px 0" } }, "확인하는 중…"));
      parts.push(creditHead, creditBox);
      let status = null;
      const paint = (busy = false) =>
        setChildren(
          creditBox,
          creditCard(last, {
            go,
            busy,
            onRefresh: () => drawCredit(true),
            use: { conns, chats, folders, status },
          }),
        );
      const drawCredit = async (refresh = false) => {
        if (refresh && last) paint(true);
        try {
          last = await loadCredit({ refresh });
          if (!alive) return;
          const at = [...last.google.map((g) => g.checkedAt)].filter(Boolean).sort().pop();
          creditHead.lastChild.textContent = `${clockOf(at ? new Date(at) : new Date())} 확인`;
          paint();
          // Model speed (Radiosonde) for the models shown; the card is drawn again when it answers.
          const shown = [...creditBox.querySelectorAll(".rcm")].map((el) => el.textContent.split(" · ")[0]);
          if (!status && shown.length)
            modelStatus(shown).then((s) => {
              if (!alive || !s) return;
              status = s;
              paint();
            });
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
