// 사연 라디오 (Mari Kit radio feature).
//   #/radio             DJ · 사연 · ▶
//   #/radio/air/<id>    one episode, read like the RP view; follows a show still being written
//   #/radio/shelf       지난 방송: bookmarks, several at once
//   #/radio/settings    연결 · 시간대 · 라디오 네임 · 사연을 가져올 방 · 진행 지침과 저장해 둔 지침

import { connectionSelect } from "../lib/connpick.js";
import { h, icon, I, setChildren, dots } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data, characterIndex, chatTitle, firstLetter } from "../lib/data.js";
import { pageHead, topBar, toast, errorBox, sheet, popMenu, hbox, avatar } from "../lib/ui.js";

const chip = (label, on, onClick) =>
  h(
    "button",
    { type: "button", class: on ? "chip on" : "chip", "aria-pressed": on ? "true" : "false", onClick },
    label,
  );
const sw = (on) => h("span", { class: on ? "sw on" : "sw" }, h("span"));
const marked = new Set(); // episodes already marked seen in this page

/** A station per DJ, so each host keeps their own frequency. */
function freq(name = "") {
  let n = 0;
  for (const ch of name) n = (n * 31 + ch.charCodeAt(0)) % 200;
  return (88.1 + n / 10).toFixed(1);
}
function onAirLabel(zone) {
  try {
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: zone }));
    const hr = d.getHours();
    const part = hr < 5 ? "새벽" : hr < 12 ? "아침" : hr < 17 ? "오후" : hr < 21 ? "저녁" : "밤";
    return `${part} ${hr % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}
const showName = (dj) => `${dj}의 심야 라디오`;

export function radioScreen({ mount, args, go, back }) {
  const view = args[0] || "home";
  let alive = true;
  let state = null; // { settings, episodes }
  let index = new Map();
  const head = h("div");
  const body = h("div", { class: "scroll" });
  mount.append(head, body);
  const zoneOf = (s) => (s?.zone === "device" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "Asia/Seoul");

  async function load() {
    try {
      const [radio, chars] = await Promise.all([api.get("/mari-kit/radio"), data.characters()]);
      state = radio;
      index = characterIndex(chars);
      if (alive) draw();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  }
  async function saveSettings(patch) {
    try {
      state.settings = await api.patch("/mari-kit/radio/settings", patch);
      draw();
    } catch (error) {
      toast(error.message);
    }
  }

  // ── 방송 ─────────────────────────────
  let letter = "";
  function homeView() {
    const s = state.settings;
    const djId = s.djId && index.has(s.djId) ? s.djId : [...index.keys()][0];
    const dj = index.get(djId);
    // 둘이 진행: the second host, when one is chosen.
    const co = s.coDjId && s.coDjId !== djId ? index.get(s.coDjId) : null;
    setChildren(
      head,
      pageHead("라디오", {
        label: dj ? `${freq(dj.name)} MHz · ${onAirLabel(zoneOf(s))}` : " ",
        back: () => back("home"),
        actions: [
          h(
            "button",
            { type: "button", class: "ib", "aria-label": "지난 방송", onClick: () => go("radio/shelf") },
            icon(I.list),
          ),
          h(
            "button",
            { type: "button", class: "ib", "aria-label": "라디오 설정", onClick: () => go("radio/settings") },
            dots(),
          ),
        ],
      }),
    );
    if (!dj) return [h("div", { class: "empty" }, "DJ로 고를 캐릭터가 없어요")];
    const ta = h(
      "textarea",
      {
        class: "bare",
        rows: 5,
        placeholder: "보낼 사연. 비워 두면 DJ가 게시판에서 골라 읽어요",
        style: { fontFamily: "var(--font-read)", fontSize: "18px", lineHeight: "1.7", textAlign: "center" },
        onInput: (e) => (letter = e.target.value),
      },
      letter,
    );
    return [
      h(
        "div",
        {
          style: {
            minHeight: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "56px 32px 40px",
            boxSizing: "border-box",
          },
        },
        h(
          "div",
          { style: { display: "flex", gap: co ? "28px" : "0", alignItems: "flex-start", justifyContent: "center" } },
          host(dj, co ? 72 : 88, "DJ 바꾸기", () => pickDj(djId)),
          co ? host(co, 72, "함께 진행할 사람 바꾸기", () => pickDj(co.id, { co: true, djId })) : null,
        ),
        h(
          "button",
          {
            type: "button",
            class: "pill",
            style: { marginTop: "16px" },
            onClick: () => pickDj(co?.id || "", { co: true, djId }),
          },
          co ? "둘이 진행 중 · 바꾸기" : "+ 함께 진행할 사람",
        ),
        h("label", { class: "sr", for: "radio-letter" }, "사연"),
        Object.assign(ta, { id: "radio-letter", style: `${ta.style.cssText};margin-top:48px` }),
        h("div", { style: { flex: "1", minHeight: "40px" } }),
        h(
          "button",
          { type: "button", class: "go", "aria-label": "방송 듣기", onClick: (e) => start(e, djId, co?.id || "") },
          icon("M8 5v14l11-7z", 18, 0),
        ),
      ),
    ];
  }
  function host(c, size, label, onClick) {
    return h(
      "button",
      { type: "button", class: "plain", style: { alignItems: "center", gap: "12px" }, "aria-label": label, onClick },
      avatar(c.avatar, firstLetter(c.name), size),
      h("span", { style: { fontFamily: "var(--font-read)", fontSize: "17px", fontWeight: "600" } }, c.name),
    );
  }
  // pickDj(current) picks the DJ; with { co: true, djId } it picks the second host (or 혼자 진행).
  function pickDj(cur, { co = false, djId = "" } = {}) {
    const s = sheet(
      h(
        "div",
        {
          style: {
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "20px",
            padding: "16px 20px 32px",
          },
        },
        co
          ? h(
              "button",
              {
                type: "button",
                class: "plain",
                style: { alignItems: "center", width: "64px", gap: "8px", color: cur ? "var(--ink-3)" : "var(--ink)" },
                "aria-pressed": cur ? "false" : "true",
                onClick: () => (s.close(), saveSettings({ coDjId: "" })),
              },
              h("span", { class: "ph", style: { width: "52px", height: "52px", borderRadius: "50%" } }, "—"),
              h("span", { style: { fontSize: "12px" } }, "혼자 진행"),
            )
          : null,
        [...index.values()]
          .filter((c) => !co || c.id !== djId)
          .map((c) =>
            h(
              "button",
              {
                type: "button",
                class: "plain",
                style: {
                  alignItems: "center",
                  width: "64px",
                  gap: "8px",
                  color: c.id === cur ? "var(--ink)" : "var(--ink-3)",
                },
                "aria-pressed": c.id === cur ? "true" : "false",
                onClick: () => (s.close(), saveSettings(co ? { coDjId: c.id } : { djId: c.id })),
              },
              avatar(c.avatar, firstLetter(c.name), 52),
              h(
                "span",
                {
                  style: {
                    fontSize: "12px",
                    maxWidth: "64px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  },
                },
                c.name,
              ),
            ),
          ),
      ),
      { label: co ? "함께 진행" : "DJ" },
    );
  }
  async function start(e, djId, coDjId) {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const res = await api.post("/mari-kit/radio/broadcast", { djId, coDjId, letter: letter.trim() });
      letter = "";
      go(`radio/air/${encodeURIComponent(res.id)}`);
    } catch (error) {
      toast(error.message);
      btn.disabled = false;
    }
  }

  // ── 듣기 ─────────────────────────────
  let poll = null;
  async function airView(id) {
    let ep;
    try {
      ep = await api.get(`/mari-kit/radio/episode/${encodeURIComponent(id)}`);
    } catch (error) {
      return setChildren(body, errorBox(error));
    }
    if (!alive) return;
    setChildren(
      head,
      topBar({
        back: () => back("radio"),
        title: ep.title ? `${ep.no}회 · ${ep.title}` : `${ep.no}회`,
        sub: `${showName(ep.coDjName ? `${ep.djName} × ${ep.coDjName}` : ep.djName)} · ${freq(ep.djName)} MHz`,
        actions: [
          h(
            "button",
            {
              type: "button",
              class: "txtbtn",
              style: { padding: "0 10px" },
              onClick: async () => {
                if (!confirm(`${ep.no}회 방송을 지울까요?`)) return;
                try {
                  await api.post("/mari-kit/radio/episodes", { ids: [ep.id], action: "delete" });
                  toast("방송을 지웠어요");
                  back("radio/shelf");
                } catch (er) {
                  toast(er.message);
                }
              },
            },
            "지우기",
          ),
          h(
            "button",
            {
              type: "button",
              class: "ib",
              "aria-label": "북마크",
              "aria-pressed": ep.starred ? "true" : "false",
              style: { color: ep.starred ? "var(--ink)" : "var(--ink-3)" },
              onClick: async () => {
                await api
                  .post("/mari-kit/radio/episodes", { ids: [ep.id], action: ep.starred ? "unstar" : "star" })
                  .catch((er) => toast(er.message));
                airView(id);
              },
            },
            h(
              "svg",
              {
                width: 18,
                height: 18,
                viewBox: "0 0 24 24",
                fill: ep.starred ? "currentColor" : "none",
                stroke: "currentColor",
                "stroke-width": 1.5,
                "aria-hidden": "true",
              },
              h("path", { d: I.star }),
            ),
          ),
        ],
      }),
    );
    const read = h("div", {
      class: "read",
      style: { padding: "24px 24px 40px", display: "flex", flexDirection: "column", gap: "22px" },
    });
    if (ep.status === "done") {
      setChildren(
        read,
        ep.segments.map((seg, i) =>
          seg.type === "letter"
            ? h(
                "div",
                { class: "hbox", style: { margin: "6px 0 0", color: "var(--ink-2)" } },
                h("span", { class: "htag" }, `${seg.from || ep.sender || "익명"} 님의 사연`),
                seg.text,
              )
            : ep.coDjName
              ? // Two hosts: the speaker's name when the voice changes.
                h(
                  "div",
                  { style: { display: "flex", flexDirection: "column", gap: "6px" } },
                  ep.segments[i - 1]?.host !== seg.host || ep.segments[i - 1]?.type === "letter"
                    ? h("span", { class: "rp-who", style: { margin: "0" } }, seg.host === 2 ? ep.coDjName : ep.djName)
                    : null,
                  h("p", { style: { margin: "0", whiteSpace: "pre-wrap" } }, seg.text),
                )
              : h("p", { style: { margin: "0", whiteSpace: "pre-wrap" } }, seg.text),
        ),
      );
      if (!marked.has(ep.id)) {
        marked.add(ep.id);
        api.post(`/mari-kit/radio/episode/${encodeURIComponent(ep.id)}/seen`).catch(() => marked.delete(ep.id));
      }
    } else if (ep.status === "failed") {
      setChildren(read, h("div", { class: "err" }, `방송을 만들지 못했어요: ${ep.error || ""}`));
    } else {
      setChildren(
        read,
        h("p", { class: "label" }, "방송 만드는 중 · 화면을 닫아도 이어서 만들고, 끝나면 홈에 떠요"),
        ep.letter
          ? h(
              "div",
              { class: "hbox", style: { margin: "6px 0 0", color: "var(--ink-2)" } },
              h("span", { class: "htag" }, `${ep.sender} 님의 사연`),
              ep.letter,
            )
          : null,
      );
      clearTimeout(poll);
      // In the background the broadcast keeps going on the server; look again once the page is back.
      const again = () =>
        alive && (document.visibilityState === "visible" ? airView(id) : (poll = setTimeout(again, 3000)));
      poll = setTimeout(again, 3000);
    }
    setChildren(body, read);
  }

  // ── 지난 방송 ─────────────────────────
  let selecting = false;
  let starOnly = false;
  const picked = new Set();
  function shelfView() {
    const eps = state.episodes.filter((e) => !starOnly || e.starred);
    setChildren(
      head,
      pageHead("지난 방송", {
        label: selecting ? `${picked.size}개 고름` : starOnly ? "북마크만" : `${state.episodes.length}회`,
        back: () => back("radio"),
        actions: [
          selecting
            ? null
            : h(
                "button",
                {
                  type: "button",
                  class: "ib",
                  "aria-label": "북마크만",
                  "aria-pressed": starOnly ? "true" : "false",
                  style: { color: starOnly ? "var(--ink)" : "var(--ink-3)" },
                  onClick: () => ((starOnly = !starOnly), draw()),
                },
                h(
                  "svg",
                  {
                    width: 18,
                    height: 18,
                    viewBox: "0 0 24 24",
                    fill: starOnly ? "currentColor" : "none",
                    stroke: "currentColor",
                    "stroke-width": 1.5,
                    "aria-hidden": "true",
                  },
                  h("path", { d: I.star }),
                ),
              ),
          h(
            "button",
            {
              type: "button",
              class: "txtbtn",
              style: { padding: "0 12px" },
              onClick: () => ((selecting = !selecting), picked.clear(), draw()),
            },
            selecting ? "완료" : "고르기",
          ),
        ],
      }),
    );
    const bulk = async (action) => {
      if (!picked.size) return toast("고른 방송이 없어요");
      try {
        const res = await api.post("/mari-kit/radio/episodes", { ids: [...picked], action });
        state.episodes = res.episodes;
        picked.clear();
        selecting = false;
        draw();
      } catch (error) {
        toast(error.message);
      }
    };
    return [
      eps.length
        ? h(
            "div",
            { style: { borderTop: "1px solid var(--line)", paddingBottom: selecting ? "96px" : "0" } },
            eps.map((e) =>
              h(
                "div",
                {
                  class: "ep",
                  style: { gridTemplateColumns: selecting ? "22px minmax(0,1fr) 44px" : "minmax(0,1fr) 44px" },
                },
                selecting
                  ? h(
                      "button",
                      {
                        type: "button",
                        class: "cbx",
                        "aria-label": "고르기",
                        "aria-pressed": picked.has(e.id) ? "true" : "false",
                        onClick: () => (picked.has(e.id) ? picked.delete(e.id) : picked.add(e.id), draw()),
                      },
                      icon("M5 12l5 5 9-10", 12, 3),
                    )
                  : null,
                h(
                  "button",
                  { type: "button", class: "plain", onClick: () => go(`radio/air/${encodeURIComponent(e.id)}`) },
                  h(
                    "span",
                    { style: { fontSize: "15px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
                    `${e.no}회 · ${e.status === "done" ? e.title : e.status === "making" ? "만드는 중…" : "만들지 못했어요"}`,
                  ),
                  h(
                    "span",
                    { style: { fontSize: "12px", color: "var(--ink-3)" } },
                    `${e.djName}${e.coDjName ? ` × ${e.coDjName}` : ""} · ${new Date(e.createdAt).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })}`,
                  ),
                ),
                h(
                  "button",
                  {
                    type: "button",
                    class: "ib",
                    "aria-label": "북마크",
                    "aria-pressed": e.starred ? "true" : "false",
                    style: { color: e.starred ? "var(--ink)" : "var(--ink-3)" },
                    onClick: () => ((picked.clear(), picked.add(e.id)), bulk(e.starred ? "unstar" : "star")),
                  },
                  h(
                    "svg",
                    {
                      width: 18,
                      height: 18,
                      viewBox: "0 0 24 24",
                      fill: e.starred ? "currentColor" : "none",
                      stroke: "currentColor",
                      "stroke-width": 1.5,
                      "aria-hidden": "true",
                    },
                    h("path", { d: I.star }),
                  ),
                ),
              ),
            ),
          )
        : h("div", { class: "empty" }, starOnly ? "북마크한 방송이 없어요" : "아직 방송이 없어요"),
      selecting
        ? h(
            "div",
            { class: "bulkbar" },
            h("button", { type: "button", onClick: () => (eps.forEach((e) => picked.add(e.id)), draw()) }, "전체"),
            h("button", { type: "button", onClick: () => bulk("star") }, "북마크"),
            h("button", { type: "button", onClick: () => bulk("unstar") }, "북마크 빼기"),
            h("button", { type: "button", onClick: () => bulk("delete") }, "지우기"),
          )
        : null,
    ];
  }

  // ── 설정 ─────────────────────────────
  function settingsView() {
    const s = state.settings;
    setChildren(head, pageHead("라디오 설정", { label: "모든 방송 공통", back: () => back("radio") }));
    const conn = connectionSelect({
      value: s.connectionId,
      onPick: (v) => saveSettings({ connectionId: v }),
      attrs: { class: "sel", style: { width: "160px" } },
    });
    const name = h("input", {
      class: "bare",
      type: "text",
      maxlength: 40,
      value: s.radioName,
      placeholder: "비우면 익명 번호 (010-****-27)",
      onChange: (e) => saveSettings({ radioName: e.target.value }),
    });
    let guide = s.guide;
    const guideBox = h(
      "textarea",
      { class: "bare", rows: 5, onInput: (e) => (guide = e.target.value), onChange: () => saveSettings({ guide }) },
      s.guide,
    );
    const rooms = h("div", { class: "gcard" }, h("div", { class: "empty" }, "불러오는 중…"));
    Promise.all([data.chats(), data.characters()]).then(([chats, chars]) => {
      const idx = characterIndex(chars);
      const list = chats.filter((c) => c.characterIds?.length).slice(0, 30);
      setChildren(
        rooms,
        list.map((c) => {
          const on = s.rooms.includes(c.id);
          return h(
            "button",
            {
              type: "button",
              class: "grow",
              role: "checkbox",
              "aria-checked": on ? "true" : "false",
              style: { gridTemplateColumns: "20px minmax(0,1fr)" },
              onClick: () => saveSettings({ rooms: on ? s.rooms.filter((x) => x !== c.id) : [...s.rooms, c.id] }),
            },
            h("span", { class: on ? "cbx on" : "cbx" }, icon("M5 12l5 5 9-10", 12, 3)),
            h("span", null, chatTitle(c, idx), h("small", null, c.mode === "conversation" ? "Convo" : "RP")),
          );
        }),
      );
    });
    return [
      h(
        "div",
        { style: { padding: "0 20px 32px" } },
        h("div", { class: "gsec" }, h("span", null, "방송")),
        h(
          "div",
          { class: "gcard" },
          h("label", { class: "grow" }, h("span", null, "쓸 연결", h("small", null, "추론 모델은 오래 걸려요")), conn),
          h(
            "div",
            { class: "grow", style: { gridTemplateColumns: "minmax(0,1fr)", padding: "12px 16px" } },
            h("span", null, "시간대"),
            h(
              "div",
              { class: "chips" },
              chip("서울", s.zone !== "device", () => saveSettings({ zone: "seoul" })),
              chip("이 기기 시간", s.zone === "device", () =>
                saveSettings({ zone: "device", deviceZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
              ),
            ),
          ),
          h(
            "button",
            {
              type: "button",
              class: "grow",
              role: "switch",
              "aria-checked": s.notify ? "true" : "false",
              onClick: () => saveSettings({ notify: !s.notify }),
            },
            h("span", null, "끝나면 홈에 알리기", h("small", null, "화면을 닫아도 이어서 만들어요")),
            sw(s.notify),
          ),
        ),
        hbox("라디오 네임", name),
        h("div", { class: "gsec" }, h("span", null, "진행 지침")),
        hbox("DJ는 보낸 사람을 몰라요", guideBox),
        h(
          "div",
          { class: "chips", style: { paddingTop: "12px" } },
          s.presets.map((p) =>
            h(
              "button",
              {
                type: "button",
                class: p.guide === s.guide ? "chip on" : "chip",
                onClick: () => saveSettings({ guide: p.guide }),
                onContextmenu: (e) => {
                  e.preventDefault();
                  popMenu([
                    {
                      label: `"${p.name}" 지우기`,
                      onClick: () =>
                        api
                          .delete(`/mari-kit/radio/presets/${encodeURIComponent(p.id)}`)
                          .then((r) => ((state.settings = r), draw())),
                    },
                  ]);
                },
              },
              p.name,
            ),
          ),
          h(
            "button",
            {
              type: "button",
              class: "chip",
              onClick: () => {
                const n = h("input", {
                  class: "uline",
                  type: "text",
                  maxlength: 60,
                  placeholder: "예: 테루노리 · 반말",
                });
                const sh = sheet(
                  h(
                    "div",
                    { style: { display: "flex", flexDirection: "column", gap: "20px", padding: "8px 20px 28px" } },
                    h(
                      "label",
                      { style: { display: "flex", flexDirection: "column", gap: "8px" } },
                      h("span", { class: "label" }, "지금 지침에 붙일 이름"),
                      n,
                    ),
                    h(
                      "button",
                      {
                        type: "button",
                        class: "pill main",
                        onClick: async () => {
                          if (!n.value.trim()) return toast("이름을 적어 주세요");
                          try {
                            state.settings = await api.post("/mari-kit/radio/presets", { name: n.value.trim(), guide });
                            sh.close();
                            draw();
                          } catch (error) {
                            toast(error.message);
                          }
                        },
                      },
                      "저장",
                    ),
                  ),
                  { label: "지침 저장" },
                );
              },
            },
            "+ 지금 지침 저장",
          ),
        ),
        s.presets.length
          ? h("p", { class: "label", style: { paddingTop: "8px" } }, "저장한 지침을 길게 누르면 지울 수 있어요")
          : null,
        // The room list can be long, so it comes last.
        h(
          "div",
          { class: "gsec" },
          h("span", null, "사연을 가져올 방"),
          h("span", null, s.rooms.length ? `${s.rooms.length}곳` : "비우면 캐릭터 카드만"),
        ),
        rooms,
      ),
    ];
  }

  function draw() {
    if (!alive || !state) return;
    if (view === "air") return airView(args[1]);
    setChildren(body, ...(view === "shelf" ? shelfView() : view === "settings" ? settingsView() : homeView()));
  }

  setChildren(body, h("div", { class: "empty" }, "불러오는 중…"));
  load();
  return {
    dispose: () => {
      alive = false;
      clearTimeout(poll);
    },
  };
}
