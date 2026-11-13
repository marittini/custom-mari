import { h, icon, I, setChildren } from "../lib/h.js";
import { prefs, setPrefs } from "../lib/prefs.js";
import { topBar } from "../lib/ui.js";
import { inline } from "../lib/render.js";

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

export function readerScreen({ mount, back }) {
  const body = h("div", { class: "scroll rpf", style: { paddingBottom: "24px" } });
  mount.append(topBar({ back: () => back("settings"), title: "읽기 설정" }), body);
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
          inline(
            "“네가 젖으면 내가 곤란해.” 우산이 마리 쪽으로 기울었다. 그의 왼쪽 어깨에 빗방울이 하나둘 내려앉았다.",
          ),
        ),
      ),
      h(
        "div",
        { class: "list" },
        [
          ["font", "글꼴 · 앱 전체", "기본"],
          ["fontRp", "글꼴 · 롤플레이", "앱과 같게"],
          ["fontConvo", "글꼴 · 대화", "앱과 같게"],
        ].map(([key, label, none]) =>
          h(
            "label",
            { class: "r two static" },
            h("span", null, label),
            h(
              "select",
              { class: "sel", style: { width: "160px" }, onChange: (e) => setPrefs({ [key]: e.target.value }) },
              [["", none], ...families.map((f) => [f, f])].map(([value, text]) =>
                h("option", { value, selected: (p[key] || "") === value }, text),
              ),
            ),
          ),
        ),
        h(
          "button",
          {
            type: "button",
            class: "r two",
            role: "switch",
            "aria-checked": p.highlight === true ? "true" : "false",
            onClick: () => setPrefs({ highlight: p.highlight !== true }),
          },
          h("span", null, "대사 형광펜"),
          h("span", { class: p.highlight === true ? "sw on" : "sw" }, h("span")),
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
