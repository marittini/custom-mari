import { h, icon, I, setChildren } from "../lib/h.js";
import { prefs, setPrefs } from "../lib/prefs.js";
import { topBar } from "../lib/ui.js";

const STEPS = [
  { key: "size", label: "크기", min: 12, max: 32, step: 1, fmt: (v) => `${v}px` },
  { key: "leading", label: "줄 간격", min: 1, max: 3, step: 0.1, fmt: (v) => v.toFixed(1) },
  { key: "tracking", label: "자간", min: -1, max: 5, step: 0.1, fmt: (v) => `${v.toFixed(1)}px` },
  {
    key: "stroke",
    label: "글자 테두리",
    min: 0,
    max: 2,
    step: 0.1,
    fmt: (v) => (v === 0 ? "끔" : `${v.toFixed(1)}px`),
  },
];
const round = (v) => Math.round(v * 100) / 100;

export function readerScreen({ mount }) {
  const body = h("div", { class: "scroll", style: { paddingBottom: "24px" } });
  mount.append(topBar({ back: () => history.back(), title: "읽기 설정" }), body);
  const draw = () => {
    const p = prefs();
    const families = Array.isArray(p.families) ? p.families : [];
    setChildren(
      body,
      h(
        "div",
        {
          style: {
            margin: "20px",
            padding: "22px",
            border: "1px solid var(--line)",
            borderRadius: "12px",
            background: "var(--surface)",
          },
        },
        h(
          "p",
          { class: "read", style: { margin: "0", textAlign: p.align } },
          "“네가 젖으면 내가 곤란해.” 우산이 마리 쪽으로 기울었다. 그의 왼쪽 어깨에 빗방울이 하나둘 내려앉았다.",
        ),
      ),
      h(
        "div",
        { class: "list" },
        h(
          "label",
          { class: "r two static" },
          h("span", null, "글꼴"),
          h(
            "select",
            { class: "sel", style: { width: "160px" }, onChange: (e) => setPrefs({ font: e.target.value }) },
            [["", "기본"], ...families.map((f) => [f, f])].map(([value, label]) =>
              h("option", { value, selected: (p.font || "") === value }, label),
            ),
          ),
        ),
        STEPS.map((s) => {
          const v = Number(p[s.key]);
          return h(
            "div",
            { class: "r two static" },
            h("span", null, s.label),
            h(
              "span",
              { style: { width: "160px", display: "flex", alignItems: "center", justifyContent: "space-between" } },
              h(
                "button",
                {
                  type: "button",
                  class: "chip stp",
                  "aria-label": `${s.label} 줄이기`,
                  onClick: () => setPrefs({ [s.key]: Math.max(s.min, round(v - s.step)) }),
                },
                "−",
              ),
              h("span", { style: { fontSize: "13px", fontVariantNumeric: "tabular-nums" } }, s.fmt(v)),
              h(
                "button",
                {
                  type: "button",
                  class: "chip stp",
                  "aria-label": `${s.label} 늘리기`,
                  onClick: () => setPrefs({ [s.key]: Math.min(s.max, round(v + s.step)) }),
                },
                "+",
              ),
            ),
          );
        }),
        h(
          "div",
          { class: "r two static" },
          h("span", null, "정렬"),
          h(
            "span",
            { class: "seg" },
            [
              ["start", "왼쪽"],
              ["justify", "양쪽"],
            ].map(([k, label]) =>
              h(
                "button",
                {
                  type: "button",
                  "aria-pressed": p.align === k ? "true" : "false",
                  onClick: () => setPrefs({ align: k }),
                },
                label,
              ),
            ),
          ),
        ),
      ),
    );
  };
  draw();
  return { onPrefs: draw };
}
