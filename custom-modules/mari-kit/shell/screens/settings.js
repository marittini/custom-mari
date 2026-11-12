import { h, icon, I, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { prefs, setPrefs, isDark, TOOL_DEFS, toolPlace, parseFamilies } from "../lib/prefs.js";
import { pageHead, toast, openEngine } from "../lib/ui.js";
import { data, byLastActivity } from "../lib/data.js";
import { connectionsPage, connectionPage, presetsPage, presetPage, voicePage } from "./manage.js";

const startsInShell = () => {
  try {
    return localStorage.getItem("mari-kit:start") !== "engine";
  } catch {
    return true;
  }
};
const sw = (on) => h("span", { class: on ? "sw on" : "sw" }, h("span"));

export function settingsScreen({ mount, args, go }) {
  const page = args[0] || "";
  const titles = {
    "": "설정",
    font: "글꼴",
    brand: "앱 이름 · 아이콘",
    tools: "메시지 도구",
    connections: "연결",
    connection: "연결",
    presets: "프리셋",
    preset: "프리셋",
    voice: "엔진 TTS 연결",
  };
  const parent =
    { connection: "settings/connections", preset: "settings/presets", voice: "voice/settings" }[page] || "settings";
  const head = pageHead(titles[page] || "설정", page ? { label: "설정", back: () => go(parent) } : {});
  const body = h("div", { class: "scroll", style: { padding: "8px 0 28px" } });
  mount.append(head, body);
  const manage = {
    connections: () => connectionsPage(body, go),
    connection: () => connectionPage(body, go, args[1]),
    presets: () => presetsPage(body, go),
    preset: () => presetPage(body, go, args[1]),
    voice: () => voicePage(body),
  };
  const draw = () => {
    if (manage[page]) return manage[page]();
    setChildren(
      body,
      ...(page === "font" ? fontPage() : page === "brand" ? brandPage() : page === "tools" ? toolsPage() : listPage()),
    );
  };

  function row(path, label, value, onClick, extra = {}) {
    return h(
      "button",
      { type: "button", class: "r", onClick, ...extra },
      h("span", { class: "ic" }, icon(path)),
      h("span", null, label),
      value,
    );
  }

  function listPage() {
    const p = prefs();
    const shown = TOOL_DEFS.filter((t) => toolPlace(t) === "show").length;
    const more = TOOL_DEFS.filter((t) => toolPlace(t) === "more").length;
    return [
      h(
        "div",
        { class: "list" },
        row(I.contrast, "다크 모드", sw(isDark()), () => setPrefs({ theme: isDark() ? "light" : "dark" }), {
          role: "switch",
          "aria-checked": isDark() ? "true" : "false",
        }),
        row(I.font, "글꼴", h("span", { class: "val" }, `${p.font || "기본"} ›`), () => go("settings/font")),
        row(I.reader, "읽기", h("span", { class: "val" }, "›"), () => go("reader")),
        row(I.list, "메시지 도구", h("span", { class: "val" }, `표시 ${shown} · 더보기 ${more} ›`), () =>
          go("settings/tools"),
        ),
        row(I.square, "앱 이름 · 아이콘", h("span", { class: "val" }, `${p.appName || "기본"} ›`), () =>
          go("settings/brand"),
        ),
      ),
      h("div", { class: "gap" }),
      h(
        "div",
        { class: "list" },
        row(I.link, "연결", h("span", { class: "val" }, "›"), () => go("settings/connections")),
        row(I.list, "프리셋", h("span", { class: "val" }, "›"), () => go("settings/presets")),
        row(I.voice, "음성 · 읽는 법", h("span", { class: "val" }, "›"), () => go("voice")),
      ),
      h("div", { class: "gap" }),
      h(
        "div",
        { class: "list" },
        row(I.calendar, "내 일정", h("span", { class: "val" }, "Convo ›"), openSchedule),
        row(I.radio, "라디오", h("span", { class: "val" }, "›"), () => go("radio")),
      ),
      h("div", { class: "gap" }),
      h(
        "div",
        { class: "list" },
        row(I.square, "엔진 화면", h("span", { class: "val" }, "전체 기능 ›"), () => openEngine()),
        row(
          I.square,
          "엔진 주소로 열면 Mari 화면",
          sw(startsInShell()),
          () => {
            try {
              if (startsInShell()) localStorage.setItem("mari-kit:start", "engine");
              else localStorage.removeItem("mari-kit:start");
            } catch {}
            draw();
          },
          { role: "switch", "aria-checked": startsInShell() ? "true" : "false" },
        ),
      ),
    ];
  }

  // 내 일정 belongs to a persona: open the one the newest Convo uses.
  async function openSchedule() {
    const latest = (await data.chats().catch(() => []))
      .filter((c) => c.mode === "conversation")
      .sort(byLastActivity)[0];
    const me = latest
      ? await api.get(`/mari-kit/schedule/chat/${encodeURIComponent(latest.id)}`).catch(() => null)
      : null;
    go(`schedule/${encodeURIComponent(me?.key || "default")}/now${latest ? `/${encodeURIComponent(latest.id)}` : ""}`);
  }

  function fontPage() {
    const p = prefs();
    const families = Array.isArray(p.families) ? p.families : [];
    const select = h(
      "select",
      { class: "inp", onChange: (e) => setPrefs({ font: e.target.value }) },
      [["", "기본"], ...families.map((f) => [f, f])].map(([value, label]) =>
        h("option", { value, selected: (p.font || "") === value }, label),
      ),
    );
    let draft = "";
    const area = h("textarea", {
      class: "inp",
      rows: 5,
      placeholder: "@import url(…); 또는 @font-face { … }",
      style: { resize: "vertical", fontSize: "13px" },
      onInput: (e) => (draft = e.target.value),
    });
    const register = async () => {
      const css = draft.trim();
      const found = parseFamilies(css);
      if (!css || !found.length) return toast("글꼴 이름을 찾지 못했어요");
      if (String(p.fontCss || "").includes(css)) {
        setPrefs({ families: [...new Set([...families, ...found])], font: found[0] });
        return draw();
      }
      const next = [p.fontCss, css].filter(Boolean).join("\n");
      try {
        await api.put("/mari-kit/fonts", { css: next });
      } catch (error) {
        return toast(`저장하지 못했어요: ${error.message}`);
      }
      setPrefs({ fontCss: next, families: [...new Set([...families, ...found])], font: found[0] });
      toast(`${found.join(", ")} 등록`);
      draw();
    };
    const remove = async (family) => {
      const css = String(p.fontCss || "")
        .split(/(?=@import|@font-face)/)
        .filter((part) => !parseFamilies(part).includes(family))
        .join("")
        .trim();
      try {
        await api.put("/mari-kit/fonts", { css });
      } catch (error) {
        return toast(`저장하지 못했어요: ${error.message}`);
      }
      setPrefs({ fontCss: css, families: families.filter((f) => f !== family), font: p.font === family ? "" : p.font });
      draw();
    };
    return [
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "24px", paddingTop: "8px" } },
        h("label", { class: "fld" }, "사용할 글꼴", select),
        families.length
          ? h(
              "div",
              { class: "list" },
              families.map((f) =>
                h(
                  "div",
                  { class: "r two static" },
                  h("span", { style: { fontFamily: `"${f}", system-ui, sans-serif` } }, f),
                  h(
                    "button",
                    { type: "button", class: "ib", "aria-label": `${f} 삭제`, onClick: () => remove(f) },
                    icon(I.close, 16),
                  ),
                ),
              ),
            )
          : null,
        h("label", { class: "fld" }, "웹폰트 CSS", area),
        h(
          "div",
          { style: { padding: "0 20px" } },
          h("button", { type: "button", class: "pill", onClick: register }, "등록"),
        ),
      ),
    ];
  }

  function brandPage() {
    const p = prefs();
    let name = p.appName || "";
    const file = h("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/webp",
      class: "sr",
      onChange: (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (f.size > 512 * 1024) return toast("512KB 이하 이미지만 쓸 수 있어요");
        const reader = new FileReader();
        reader.onload = () => {
          setPrefs({ icon: String(reader.result) });
          draw();
        };
        reader.readAsDataURL(f);
      },
    });
    return [
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "24px", paddingTop: "8px" } },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "16px", padding: "0 20px" } },
          h(
            "span",
            {
              class: "ph",
              style: {
                width: "64px",
                height: "64px",
                borderRadius: "16px",
                ...(p.icon ? { backgroundImage: `url("${p.icon}")` } : {}),
              },
            },
            p.icon ? "" : icon(I.square, 22),
          ),
          h("label", { class: "pill", style: { display: "inline-flex", alignItems: "center" } }, "아이콘 선택", file),
          p.icon
            ? h(
                "button",
                {
                  type: "button",
                  class: "ib",
                  "aria-label": "기본 아이콘으로",
                  onClick: () => {
                    setPrefs({ icon: "" });
                    draw();
                  },
                },
                icon(I.close, 18),
              )
            : null,
        ),
        h(
          "label",
          { class: "fld" },
          "앱 이름",
          h("input", {
            class: "inp",
            type: "text",
            value: name,
            placeholder: "Marinara",
            onInput: (e) => (name = e.target.value),
          }),
        ),
        h(
          "div",
          { style: { padding: "0 20px" } },
          h(
            "button",
            {
              type: "button",
              class: "pill",
              onClick: () => {
                setPrefs({ appName: name.trim() });
                toast("저장했어요");
              },
            },
            "저장",
          ),
        ),
      ),
    ];
  }

  function toolsPage() {
    return [
      h(
        "div",
        { class: "list" },
        TOOL_DEFS.map((t) =>
          h(
            "div",
            { class: "r static" },
            h("span", { class: "ic" }, icon(t.icon, 18)),
            h("span", null, t.convoOnly ? `${t.label} (Convo)` : t.label),
            h(
              "span",
              { class: "seg3" },
              [
                ["show", "표시"],
                ["more", "더보기"],
                ["hidden", "숨김"],
              ].map(([k, label]) =>
                h(
                  "button",
                  {
                    type: "button",
                    "aria-pressed": toolPlace(t) === k ? "true" : "false",
                    onClick: () => {
                      setPrefs({ tools: { ...prefs().tools, [t.id]: k } });
                      draw();
                    },
                  },
                  label,
                ),
              ),
            ),
          ),
        ),
      ),
    ];
  }

  draw();
  return { onPrefs: draw };
}
