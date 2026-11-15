// verify.mjs picks only the checks a change reaches (scripts/e2e/scope.mjs). Pure, no Engine.
import assert from "node:assert/strict";
import { flowBlocks, importsOf, planChecks } from "../scripts/e2e/scope.mjs";
import { cssSelectors, hunkLines, ranLines, shellPath } from "../scripts/e2e/coverage.mjs";

const S = "custom-modules/mari-kit/shell/";
const files = {
  [`${S}app.js`]: 'import { h } from "./lib/h.js"; const x = () => import("./screens/convo.js");',
  [`${S}lib/h.js`]: "export const h = 1;",
  [`${S}lib/reactions.js`]: 'import { h } from "./h.js";',
  [`${S}lib/schedule-view.js`]: 'api.get("/mari-kit/schedule/chat/1")',
  [`${S}screens/convo.js`]: 'import "../lib/reactions.js"; import "../lib/h.js";',
  [`${S}screens/rp.js`]: 'import "../lib/h.js";',
  [`${S}screens/schedule.js`]: 'import "../lib/schedule-view.js";',
  [`${S}screens/chat-settings.js`]: 'import "../lib/h.js";',
  "custom-modules/tests/reactions.test.mjs": 'import "../mari-kit/shell/lib/reactions.js";',
};

assert.deepEqual(importsOf(`${S}screens/convo.js`, files[`${S}screens/convo.js`]), [
  `${S}lib/reactions.js`,
  `${S}lib/h.js`,
]);

// A lib used by one screen: that screen, its flows, its test; no chat-settings sections.
let p = planChecks([`${S}lib/reactions.js`], files);
assert.deepEqual(p.screens, ["convo"]);
assert.ok(p.flows.includes("convo-send") && !p.flows.includes("rp-send"));
assert.deepEqual(p.tests, ["reactions.test.mjs"]);
assert.equal(p.api, true);
assert.equal(p.sections, false);
assert.equal(p.package, true);

// A shared lib reaches every screen that imports it.
p = planChecks([`${S}lib/h.js`], files);
assert.deepEqual(p.screens, ["chat-settings", "convo", "rp"]);
assert.ok(p.flows.includes("rp-send") && p.flows.includes("chat-settings"));

// The app shell itself: every screen.
assert.equal(planChecks([`${S}app.js`], files).screens.length, 4);

// chat-settings.js: also the Engine sections check.
assert.equal(planChecks([`${S}screens/chat-settings.js`], files).sections, true);

// A server feature reaches the screens that call its routes.
assert.deepEqual(planChecks(["custom-modules/mari-kit/src/schedule.server.mjs"], files).screens, ["schedule"]);

// Docs only: formatting, nothing else.
p = planChecks(["custom-modules/WORK.md"], files);
assert.deepEqual(p.format, ["custom-modules/WORK.md"]);
assert.equal(p.package || p.api || p.sections || p.flows.length || p.screens.length || p.tests.length, 0);

// The test harness: every flow and screen.
p = planChecks(["custom-modules/scripts/shell-e2e.mjs"], files);
assert.equal(p.screens.length, 4);
assert.ok(p.flows.length >= 9);

// An old regression that loads a changed file through its imports runs too (it runs outside a browser).
p = planChecks([`${S}lib/h.js`], {
  ...files,
  "scripts/regressions/mari-kit-x.regression.mjs": 'import "../../custom-modules/mari-kit/shell/lib/reactions.js";',
});
assert.deepEqual(p.regressions, ["mari-kit-x.regression.mjs"]);

// ── Flows by coverage (what each flow ran last time) ──
assert.equal(shellPath("http://x/api/mari-kit/app/v/0123456789ab/lib/h.js?x"), `${S}lib/h.js`);
assert.deepEqual(hunkLines("@@ -3,2 +3,0 @@\n@@ -10,0 +9,2 @@"), {
  old: [3, 4, 10, 11],
  new: [3, 4, 9, 10],
  cssOld: [3, 4],
});
const fnFiles = { f: { fns: ["2-20", "5-8", "10-12"], ran: ["2-20", "5-8"] } };
assert.equal(ranLines(fnFiles, "f", [6]), true); // inside a function that ran
assert.equal(ranLines(fnFiles, "f", [11]), false); // inside one that never ran
assert.equal(ranLines(fnFiles, "f", [30]), true); // top-level code of a loaded file
assert.equal(ranLines(fnFiles, "g", [1]), false); // a file the flow never loaded
const css = ".a,\n.b span {\n  color: red;\n}\n:root {\n  --x: 1;\n}\n.c .d {\n  gap: 0;\n}";
assert.deepEqual(
  cssSelectors(css, [3]).map((c) => [...c]),
  [["a"], ["b"]],
);
assert.equal(cssSelectors(css, [6]), "all");
assert.deepEqual(
  cssSelectors(css, [9]).map((c) => [...c]),
  [["c", "d"]],
);
const e2e =
  'const flows = {\n  // one\n  async one({ page }) {\n    a();\n  },\n  async "two-x"({ page }) {\n    b();\n  },\n};';
assert.deepEqual(
  flowBlocks(e2e).map((b) => [b.name, b.start, b.end]),
  [
    ["one", 2, 5],
    ["two-x", 6, 8],
  ],
);
// A covered flow runs only when it ran the changed lines; an uncovered one falls back to its screens.
const coverage = {
  "convo-send": { tree: "T", files: { [`${S}lib/reactions.js`]: { fns: ["1-9"], ran: [] } }, routes: [] },
  "convo-react": { tree: "T", files: { [`${S}lib/reactions.js`]: { fns: ["1-9"], ran: ["1-9"] } }, routes: [] },
};
const ctx = { coverage, diff: () => ({ old: [4], new: [4], cssOld: [4] }), show: () => "", base: "T", text: () => "" };
p = planChecks([`${S}lib/reactions.js`], files, ctx);
assert.ok(p.flows.includes("convo-react") && !p.flows.includes("convo-send"));
assert.ok(p.flows.includes("back")); // no coverage yet: by its screens

// A new FLOW_SCREENS entry runs that flow only (no tour); any other change to screens.mjs runs everything.
const H = "custom-modules/scripts/e2e/screens.mjs";
const before = 'x\nexport const FLOW_SCREENS = {\n  home: ["home"],\n  back: ["convos"],\n};\n';
const after =
  'x\nexport const FLOW_SCREENS = {\n  home: ["home"],\n  back: ["convos"],\n  "convo-send": ["convo"],\n};\n';
const hctx = (d, now) => ({ coverage: {}, diff: () => d, show: () => before, base: "T", text: () => now });
p = planChecks([H], files, hctx({ old: [4, 5], new: [5], cssOld: [] }, after));
assert.deepEqual(p.flows, ["convo-send"]);
assert.deepEqual(p.screens, []);
p = planChecks([H], files, hctx({ old: [1], new: [1], cssOld: [1] }, after.replace("x", "y")));
assert.ok(p.flows.includes("home") && p.screens.length);

console.log("verify scope: picks only the checks a change reaches");
