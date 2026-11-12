// 내 일정 — the persona's own week for Convo (Mari Kit schedule feature).
//   #/schedule/<key>/now/<chatId?>   지금 + 오늘
//   #/schedule/<key>/week/<chatId?>  요일별 편집
//   #/schedule/<key>/make/<chatId?>  AI로 만들기 · 실제 생활
// <key> is the persona id ("default" when the chat has none); <chatId> lets "캐릭터 일정과 맞춰서" read the room.

import { h, icon, I, setChildren, dots } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data } from "../lib/data.js";
import { pageHead, toast, errorBox, sheet, popMenu, hbox } from "../lib/ui.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_KO = ["월", "화", "수", "목", "금", "토", "일"];
const LABEL = { online: "온라인", idle: "자리 비움", dnd: "방해 금지", offline: "오프라인" };
const toMin = (t) => (t === "24:00" ? 1440 : Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
const ampm = (t) => {
  if (toMin(t) === 1440) return "자정";
  const m = toMin(t);
  const h24 = Math.floor(m / 60);
  return `${h24 < 12 ? "오전" : "오후"} ${h24 % 12 || 12}:${String(m % 60).padStart(2, "0")}`;
};
const dot = (status) => h("span", { class: `sdot ${status}` });
const chip = (label, on, onClick, extra) =>
  h(
    "button",
    { type: "button", class: on ? "chip on" : "chip", "aria-pressed": on ? "true" : "false", onClick },
    extra,
    label,
  );

export function scheduleScreen({ mount, args, go, back }) {
  const key = args[0] || "default";
  const view = args[1] || "now";
  const chatId = args[2] || "";
  const base = `/mari-kit/schedule/${encodeURIComponent(key)}`;
  const link = (v) => `schedule/${encodeURIComponent(key)}/${v}${chatId ? `/${encodeURIComponent(chatId)}` : ""}`;
  let alive = true;
  let state = null; // { profile, now, today }
  let day = null;
  const body = h("div", { class: "scroll", style: { padding: "0 20px 32px" } });

  const header = () => {
    const up = () => back(view === "now" ? "settings" : link(view === "make" ? "week" : "now"));
    if (view === "week")
      return pageHead("주간 일정", {
        label: "이번 주",
        back: up,
        actions: h(
          "button",
          { type: "button", class: "ib", "aria-label": "AI로 만들기", onClick: () => go(link("make")) },
          icon(I.spark),
        ),
      });
    if (view === "make") return pageHead("일정 만들기", { label: "AI가 짜는 일주일", back: up });
    return pageHead("내 일정", {
      label: state ? `오늘 · ${DAY_KO[DAYS.indexOf(state.today)]}요일` : " ",
      back: up,
      actions: h("button", { type: "button", class: "ib", "aria-label": "일정 메뉴", onClick: openMenu }, dots()),
    });
  };
  mount.append(h("div", { class: "phead-host" }), body);
  const drawHead = () => mount.querySelector(".phead-host").replaceChildren(header());

  async function load() {
    try {
      state = await api.get(base);
      if (!alive) return;
      day ??= state.today;
      draw();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  }
  async function call(method, path, payload, done) {
    try {
      state = await api[method](base + path, payload);
      if (done) toast(done);
      draw();
    } catch (error) {
      toast(error.message);
    }
  }

  function openMenu() {
    const p = state?.profile;
    if (!p) return;
    popMenu([
      { label: "주간 일정 편집", sub: "›", onClick: () => go(link("week")) },
      { label: "AI로 만들기 · 실제 생활", sub: "›", onClick: () => go(link("make")) },
      "-",
      {
        label: "Convo에 알려주기",
        sub: p.config.enabled ? "켜짐" : "꺼짐",
        onClick: async () => {
          if (!p.config.enabled)
            await api.patch("/mari-kit/settings", { features: { schedule: true } }).catch(() => {});
          call(
            "patch",
            "/config",
            { enabled: !p.config.enabled },
            p.config.enabled ? "Convo에 알리지 않아요" : "Convo에 알려요",
          );
        },
      },
      { label: "내보내기", onClick: exportIt },
      { label: "가져오기", onClick: importIt },
    ]);
  }
  async function exportIt() {
    try {
      const out = await api.get(`${base}/export`);
      const a = h("a", {
        href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" })),
        download: `schedule-${key}.json`,
      });
      document.body.append(a);
      a.click();
      a.remove();
    } catch (error) {
      toast(error.message);
    }
  }
  function importIt() {
    const file = h("input", {
      type: "file",
      accept: "application/json",
      onChange: async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try {
          if (f.size > 1024 * 1024) throw new Error("1MB 이하 파일만 돼요");
          await call("post", "/import", JSON.parse(await f.text()), "가져왔어요");
        } catch (error) {
          toast(error.message);
        }
      },
    });
    file.click();
  }

  // ── 지금 ─────────────────────────────
  // Each persona keeps its own week; "기본" is for chats without a persona.
  let personas = null;
  data
    .personas()
    .then((list) => {
      personas = list;
      if (alive && state && view === "now") draw();
    })
    .catch(() => {});
  function personaRow() {
    if (!personas?.length) return null;
    const to = (k) => go(`schedule/${encodeURIComponent(k)}/now${chatId ? `/${encodeURIComponent(chatId)}` : ""}`);
    return h(
      "div",
      { class: "chips", role: "group", "aria-label": "페르소나", style: { margin: "4px 0 16px" } },
      [["default", "기본"], ...personas.map((p) => [p.id, p.name || "이름 없음"])].map(([k, label]) =>
        chip(label, key === k, () => key !== k && to(k)),
      ),
    );
  }

  function nowView() {
    const p = state.profile;
    const n = state.now;
    // A block split only by a real-life status change reads as one line here.
    const blocks = (p.days[state.today] || []).reduce((out, b) => {
      const last = out[out.length - 1];
      if (last && last.activity === b.activity && last.time.split("-")[1] === b.time.split("-")[0])
        out[out.length - 1] = { ...last, time: `${last.time.split("-")[0]}-${b.time.split("-")[1]}` };
      else out.push(b);
      return out;
    }, []);
    const nowMin = (() => {
      const d = new Date(new Date().toLocaleString("en-US", { timeZone: p.config.zone }));
      return d.getHours() * 60 + d.getMinutes();
    })();
    const until =
      n?.source === "override"
        ? n.expiresAt
          ? `${new Date(n.expiresAt).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit", timeZone: p.config.zone })}까지`
          : "직접 돌릴 때까지"
        : n?.until
          ? `${ampm(n.until)}까지`
          : "";
    return [
      personaRow(),
      n
        ? h(
            "button",
            { type: "button", class: "now", onClick: overrideSheet },
            h(
              "span",
              { class: "label", style: { display: "inline-flex", alignItems: "center", gap: "6px" } },
              dot(n.status),
              LABEL[n.status] + (n.source === "override" ? " · 잠깐 바꿈" : ""),
            ),
            h("b", null, n.activity),
            h("span", { style: { fontSize: "13px", color: "var(--ink-3)" } }, until),
          )
        : h(
            "button",
            { type: "button", class: "now", onClick: () => go(link("make")) },
            h("span", { class: "label" }, "아직 일정이 없어요"),
            h("b", null, "일주일 만들기 ›"),
          ),
      p.config.enabled
        ? null
        : h("p", { class: "hint", style: { margin: "16px 0 0" } }, "Convo에 알리지 않는 중이에요 · ⋯에서 켜요"),
      nextLine(n, nowMin),
      h(
        "div",
        { style: { paddingTop: "12px" } },
        blocks.map((b) => {
          const [a, z] = b.time.split("-").map(toMin);
          const on = z > a ? nowMin >= a && nowMin < z : nowMin >= a || nowMin < z;
          return h(
            "div",
            { class: on ? "tline on" : z <= nowMin && z > a ? "tline past" : "tline" },
            h("span", null, b.time.split("-")[0]),
            h(
              "span",
              { style: { display: "inline-flex", alignItems: "center", gap: "8px", minWidth: "0" } },
              dot(b.status),
              b.activity,
            ),
          );
        }),
      ),
      tomorrowLine(p),
      summaryBox(p),
    ];
  }

  /** 다음 일정, with how long until it starts. */
  function nextLine(n, nowMin) {
    if (!n?.next) return null;
    const start = n.next.time.split("-")[0];
    const left = (toMin(start) - nowMin + 1440) % 1440;
    const span = left >= 60 ? `${Math.floor(left / 60)}시간${left % 60 ? ` ${left % 60}분` : ""}` : `${left}분`;
    return h(
      "div",
      { class: "nextl" },
      h(
        "span",
        { style: { display: "inline-flex", alignItems: "center", gap: "8px" } },
        dot(n.next.status),
        `다음 · ${n.next.activity}`,
      ),
      h("span", { class: "hint" }, `${ampm(start)} · ${span} 뒤`),
    );
  }

  /** 내일 첫 일정. */
  function tomorrowLine(p) {
    const i = DAYS.indexOf(state.today);
    const day = DAYS[(i + 1) % 7];
    const first = (p.days[day] || []).find((b) => b.activity !== "수면") || (p.days[day] || [])[0];
    if (!first) return null;
    return h(
      "button",
      { type: "button", class: "foldl", onClick: () => go(link("week")) },
      h("span", { class: "hint" }, `내일 · ${DAY_KO[(i + 1) % 7]}요일`),
      h("span", null, `${ampm(first.time.split("-")[0])} ${first.activity} ›`),
    );
  }

  /** 일상 요약: a short paragraph about the week, made on request (one model call). */
  function summaryBox(p) {
    if (!DAYS.some((d) => p.days[d]?.length)) return null;
    const make = async (btn) => {
      btn.disabled = true;
      btn.textContent = "만드는 중…";
      try {
        state = await api.post(`${base}/summary`);
        draw();
      } catch (error) {
        toast(error.message);
        btn.disabled = false;
        btn.textContent = p.summary ? "다시 만들기" : "요약 만들기";
      }
    };
    const btn = h(
      "button",
      { type: "button", class: "txtbtn", onClick: (e) => make(e.currentTarget) },
      p.summary ? "다시 만들기" : "요약 만들기",
    );
    return h(
      "div",
      { class: "foldl", style: { cursor: "default" } },
      h(
        "span",
        { class: "hint", style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
        "일상 요약",
        btn,
      ),
      h(
        "span",
        { style: { lineHeight: "1.6", color: p.summary ? "var(--ink-2)" : "var(--ink-3)" } },
        p.summary?.text || "이 주간 일정이 어떤 하루하루인지 한 단락으로 정리해 둬요.",
      ),
    );
  }

  function overrideSheet() {
    const cur = state.profile.override;
    let status = cur?.status || "dnd";
    let until = "60";
    const act = h("input", {
      class: "uline",
      type: "text",
      value: cur?.activity || state.now?.activity || "",
      maxlength: 120,
      style: { fontFamily: "var(--font-read)", fontSize: "18px" },
    });
    const st = h("div", { class: "chips" });
    const un = h("div", { class: "chips" });
    const drawChips = () => {
      setChildren(
        st,
        Object.keys(LABEL).map((k) => chip(LABEL[k], status === k, () => ((status = k), drawChips()), dot(k))),
      );
      setChildren(
        un,
        [
          ["30", "30분"],
          ["60", "1시간"],
          ["180", "3시간"],
          ["", "직접 돌릴 때까지"],
        ].map(([v, l]) => chip(l, until === v, () => ((until = v), drawChips()))),
      );
    };
    drawChips();
    const s = sheet(
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "24px", padding: "8px 20px 28px" } },
        h(
          "label",
          { style: { display: "flex", flexDirection: "column", gap: "8px" } },
          h("span", { class: "label" }, "지금 하는 일"),
          act,
        ),
        st,
        un,
        h(
          "div",
          { style: { display: "flex", gap: "8px" } },
          state.profile.override
            ? h(
                "button",
                {
                  type: "button",
                  class: "pill",
                  style: { flex: "1" },
                  onClick: () => (s.close(), call("delete", "/override", undefined, "일정대로 돌아갔어요")),
                },
                "일정대로",
              )
            : null,
          h(
            "button",
            {
              type: "button",
              class: "pill main",
              style: { flex: "1" },
              onClick: () => {
                if (!act.value.trim()) return toast("하는 일을 적어 주세요");
                s.close();
                call(
                  "put",
                  "/override",
                  { status, activity: act.value.trim(), minutes: until ? Number(until) : null },
                  "바꿨어요",
                );
              },
            },
            "바꾸기",
          ),
        ),
      ),
      { label: "지금 바꾸기" },
    );
  }

  // ── 주간 ─────────────────────────────
  /** Rows to show: neighbouring blocks with the same activity (split only by a real-life status) read as one. */
  function groups(blocks) {
    const out = [];
    blocks.forEach((b, i) => {
      const last = out[out.length - 1];
      if (last && last.block.activity === b.activity && last.block.time.split("-")[1] === b.time.split("-")[0]) {
        last.block = { ...last.block, time: `${last.block.time.split("-")[0]}-${b.time.split("-")[1]}` };
        last.idx.push(i);
      } else out.push({ block: b, idx: [i] });
    });
    return out;
  }

  function weekView() {
    const blocks = state.profile.days[day] || [];
    const rows = groups(blocks);
    return [
      h(
        "div",
        { class: "days7", role: "tablist", "aria-label": "요일" },
        DAYS.map((d, i) =>
          h(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": d === day ? "true" : "false",
              onClick: () => ((day = d), draw()),
            },
            DAY_KO[i],
          ),
        ),
      ),
      blocks.length
        ? h(
            "div",
            { class: "gcard" },
            rows.map(({ block: b }, i) =>
              h(
                "button",
                { type: "button", class: "blk", onClick: () => blockSheet(i) },
                h("span", { class: "tm" }, b.time.replace("-", "–")),
                h("span", null, b.activity),
                dot(b.status),
              ),
            ),
          )
        : h("div", { class: "empty" }, "이 요일은 비어 있어요"),
      h(
        "div",
        { style: { display: "flex", justifyContent: "space-between", flexWrap: "wrap", paddingTop: "8px" } },
        h("button", { type: "button", class: "txtbtn", onClick: () => blockSheet(-1) }, "+ 시간 추가"),
        h(
          "span",
          { style: { display: "flex", gap: "12px" } },
          h(
            "button",
            { type: "button", class: "txtbtn", onClick: () => saveDay(blocks, true, "빈 시간과 겹침을 고쳤어요") },
            "빈 시간 · 겹침 고치기",
          ),
          h("button", { type: "button", class: "txtbtn", onClick: () => regenerateDay() }, "이 요일 다시 만들기"),
        ),
      ),
    ];
  }
  function saveDay(blocks, repair, done) {
    return call("put", `/day/${day}`, { blocks, repair }, done);
  }
  async function regenerateDay() {
    toast(`${DAY_KO[DAYS.indexOf(day)]}요일 만드는 중…`);
    await call("post", "/generate", { day, action: "rewrite", chatId }, "다시 만들었어요");
  }
  function blockSheet(index) {
    const all = [...(state.profile.days[day] || [])];
    const group = groups(all)[index];
    // The blocks this row stands for are replaced together.
    const blocks = all.filter((_, i) => !group?.idx.includes(i)).concat(group ? [group.block] : []);
    index = group ? blocks.length - 1 : -1;
    const cur = blocks[index] || { time: "12:00-13:00", activity: "", status: "online" };
    const [a, z] = cur.time.split("-");
    let status = cur.status;
    const start = h("input", { class: "uline", type: "time", value: a });
    const end = h("input", { class: "uline", type: "time", value: z === "24:00" ? "23:59" : z });
    const act = h("input", { class: "uline", type: "text", value: cur.activity, maxlength: 500 });
    const st = h("div", { class: "chips" });
    const drawChips = () =>
      setChildren(
        st,
        Object.keys(LABEL).map((k) => chip(LABEL[k], status === k, () => ((status = k), drawChips()), dot(k))),
      );
    drawChips();
    const s = sheet(
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "24px", padding: "8px 20px 28px" } },
        h(
          "div",
          { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" } },
          h(
            "label",
            { style: { display: "flex", flexDirection: "column", gap: "6px" } },
            h("span", { class: "label" }, "시작"),
            start,
          ),
          h(
            "label",
            { style: { display: "flex", flexDirection: "column", gap: "6px" } },
            h("span", { class: "label" }, "끝"),
            end,
          ),
        ),
        h(
          "label",
          { style: { display: "flex", flexDirection: "column", gap: "6px" } },
          h("span", { class: "label" }, "하는 일"),
          act,
        ),
        st,
        h(
          "div",
          { style: { display: "flex", gap: "8px" } },
          index >= 0
            ? h(
                "button",
                {
                  type: "button",
                  class: "pill",
                  onClick: () => (
                    s.close(),
                    saveDay(
                      blocks.filter((_, i) => i !== index),
                      true,
                      "지웠어요",
                    )
                  ),
                },
                "지우기",
              )
            : null,
          h(
            "button",
            {
              type: "button",
              class: "pill main",
              style: { flex: "1" },
              onClick: () => {
                if (!act.value.trim()) return toast("하는 일을 적어 주세요");
                const endV = end.value === "23:59" ? "24:00" : end.value;
                const next = { time: `${start.value}-${endV}`, activity: act.value.trim(), status };
                // An edited block wins over the ones it now overlaps; the server trims and fills the rest.
                const others = blocks.filter((_, i) => i !== index);
                s.close();
                saveDay([next, ...others], true, "저장했어요");
              },
            },
            "저장",
          ),
        ),
      ),
      { label: "시간 편집" },
    );
  }

  // ── 만들기 ───────────────────────────
  let make = null;
  function makeView() {
    const p = state.profile;
    make ??= {
      action: "rewrite",
      mode: p.config.mode,
      span: "week",
      day: state.today,
      instructions: p.config.instructions,
      lifestyle: p.config.lifestyle,
      connectionId: p.config.connectionId,
      zone: p.config.zone,
    };
    const q = (label, opts, keyName) => [
      h("div", { class: "askq" }, label),
      h(
        "div",
        { class: "chips" },
        opts.map(([v, l]) => chip(l, make[keyName] === v, () => ((make[keyName] = v), draw()))),
      ),
    ];
    const ta = (keyName, rows) =>
      h("textarea", { class: "bare", rows, onInput: (e) => (make[keyName] = e.target.value) }, make[keyName]);
    const conn = h(
      "select",
      { class: "sel", style: { width: "170px" }, onChange: (e) => (make.connectionId = e.target.value) },
      h("option", { value: "" }, "기본 연결"),
    );
    data.connections().then((list) => {
      for (const c of list) conn.append(h("option", { value: c.id, selected: c.id === make.connectionId }, c.name));
    });
    const zone = h("input", {
      class: "inp",
      style: { width: "170px" },
      value: make.zone,
      onInput: (e) => (make.zone = e.target.value.trim()),
    });
    return [
      h("div", { class: "gsec" }, h("span", null, "어떻게")),
      h(
        "div",
        { class: "gcard" },
        q(
          "기존 일정을",
          [
            ["rewrite", "새로 짜기"],
            ["adjust", "조금만 손보기"],
          ],
          "action",
        ),
        q(
          "캐릭터 일정과",
          [
            ["independent", "따로"],
            ["linked", "맞춰서 짜기"],
          ],
          "mode",
        ),
        q(
          "한 번에",
          [
            ["week", "일주일 전체"],
            ["day", "요일 하나"],
          ],
          "span",
        ),
        make.span === "day"
          ? h(
              "div",
              { class: "chips", style: { padding: "0 16px 16px" } },
              DAYS.map((d, i) => chip(DAY_KO[i], make.day === d, () => ((make.day = d), draw()))),
            )
          : null,
      ),
      hbox("만들 때 지침", ta("instructions", 3)),
      hbox("실제 생활 · 이 시간엔 답이 늦어요", ta("lifestyle", 3)),
      h("div", { class: "gsec" }, h("span", null, "연결")),
      h(
        "div",
        { class: "gcard" },
        h("label", { class: "grow" }, h("span", null, "만들 때 쓸 연결"), conn),
        h("label", { class: "grow" }, h("span", null, "시간대"), zone),
      ),
      h(
        "button",
        { type: "button", class: "pill main wide", onClick: runMake },
        make.span === "day" ? `${DAY_KO[DAYS.indexOf(make.day)]}요일 만들기` : "일주일 만들기",
      ),
      make.mode === "linked" && !chatId
        ? h("p", { class: "hint", style: { marginTop: "12px" } }, "맞춰 짜려면 Convo 방에서 들어와 주세요")
        : null,
    ];
  }
  async function runMake(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "만드는 중…";
    try {
      await api.patch(`${base}/config`, {
        instructions: make.instructions,
        lifestyle: make.lifestyle,
        connectionId: make.connectionId,
        zone: make.zone,
        mode: make.mode,
      });
      state = await api.post(`${base}/generate`, {
        action: make.action,
        day: make.span === "day" ? make.day : null,
        chatId,
      });
      toast("만들었어요");
      day = make.span === "day" ? make.day : state.today;
      go(link("week"));
    } catch (error) {
      toast(error.message);
      btn.disabled = false;
      draw();
    }
  }

  function draw() {
    if (!alive || !state) return;
    drawHead();
    setChildren(body, ...(view === "week" ? weekView() : view === "make" ? makeView() : nowView()));
  }

  drawHead();
  setChildren(body, h("div", { class: "empty" }, "불러오는 중…"));
  load();
  return { dispose: () => (alive = false) };
}
