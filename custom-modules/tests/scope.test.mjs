// verify.mjs picks only the checks a change reaches (scripts/e2e/scope.mjs). Pure, no Engine.
import assert from "node:assert/strict";
import { importsOf, planChecks } from "../scripts/e2e/scope.mjs";

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

console.log("verify scope: picks only the checks a change reaches");
