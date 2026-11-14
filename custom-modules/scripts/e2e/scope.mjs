// Picks the checks a change needs, so verify.mjs runs only what the changed files can affect (custom-modules/WORKFLOW.md,
// section 7). Pure: give it the changed paths (relative to the repository root) and the shell's files; it returns
// the plan and why each part is in it.

import { FLOW_SCREENS } from "./screens.mjs";

const SHELL = "custom-modules/mari-kit/shell/";
const SRC = "custom-modules/mari-kit/src/";
const CORE = new Set([`${SHELL}app.js`, `${SHELL}shell.css`, `${SRC}server.mjs`]);
const HARNESS = /^custom-modules\/scripts\/(shell-e2e\.mjs|e2e\/(screens|fake-llm)\.mjs)$/;

/** Relative imports of a shell file (static and dynamic), resolved against its folder. */
export function importsOf(path, text) {
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  const out = [];
  for (const m of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g)) {
    const parts = (dir + m[1]).split("/");
    const stack = [];
    for (const p of parts) {
      if (p === "..") stack.pop();
      else if (p !== ".") stack.push(p);
    }
    out.push(stack.join("/"));
  }
  return out;
}

/**
 * changed: changed paths. files: { path: text } for every shell file (custom-modules/mari-kit/shell/**.js) and test
 * (custom-modules/tests/*.test.mjs). Returns { format, parse, package, api, sections, tests, flows, screens, why }.
 * flows / screens are arrays of names (empty: none).
 */
export function planChecks(changed, files) {
  const why = {};
  const note = (key, reason) => (why[key] ||= reason);
  const plan = {
    format: changed.filter((p) => /\.(m?js|json|md|ya?ml|css|html)$/.test(p)),
    parse: changed.filter((p) => p.startsWith("custom-modules/mari-kit/") && /\.m?js$/.test(p)),
    package: false,
    api: false,
    sections: false,
    tests: new Set(),
    flows: new Set(),
    screens: new Set(),
  };
  const screenFiles = Object.keys(files).filter((p) => p.startsWith(`${SHELL}screens/`));
  const screenName = (p) => p.slice(`${SHELL}screens/`.length).replace(/\.js$/, "");
  // Everything a screen loads, through its imports.
  const closure = new Map();
  for (const s of screenFiles) {
    const seen = new Set();
    const walk = (p) => {
      if (seen.has(p) || files[p] === undefined) return;
      seen.add(p);
      for (const q of importsOf(p, files[p])) walk(q);
    };
    walk(s);
    closure.set(s, seen);
  }
  const allScreens = () => screenFiles.forEach((s) => plan.screens.add(screenName(s)));

  for (const p of changed) {
    if (p.startsWith("custom-modules/mari-kit/")) {
      plan.package = true;
      note("package", p);
    }
    if (CORE.has(p)) {
      allScreens();
      note("screens", `${p} (every screen)`);
    } else if (p.startsWith(SHELL) && p.endsWith(".js")) {
      plan.api = true;
      note("api", p);
      for (const [s, seen] of closure) if (seen.has(p)) plan.screens.add(screenName(s));
      note("screens", p);
    } else if (p === `${SHELL}engine-api.json` || p === "custom-modules/scripts/check-engine-api.mjs") {
      plan.api = true;
      note("api", p);
    } else if (p.startsWith(SRC)) {
      // A server feature reaches the screens that call its routes: <id>.server.mjs → /mari-kit/<id>…
      const id = p.slice(SRC.length).replace(/\.server\.mjs$|\.mjs$|\.js$/, "");
      const route = id === "shell" ? "mari-kit/shell" : `mari-kit/${id}`;
      for (const [s, seen] of closure)
        if ([...seen].some((f) => files[f]?.includes(route))) plan.screens.add(screenName(s));
      note("screens", p);
    }
    if (
      p === `${SHELL}screens/chat-settings.js` ||
      p === `${SHELL}lib/engine-sections.js` ||
      p === "custom-modules/scripts/check-engine-sections.mjs"
    ) {
      plan.sections = true;
      note("sections", p);
    }
    if (HARNESS.test(p)) {
      allScreens();
      Object.keys(FLOW_SCREENS).forEach((f) => plan.flows.add(f));
      note("flows", `${p} (test harness)`);
      note("screens", `${p} (test harness)`);
    }
    if (p.startsWith("custom-modules/tests/") && p.endsWith(".test.mjs") && files[p] !== undefined) {
      plan.tests.add(p.slice("custom-modules/tests/".length));
      note("tests", p);
    }
  }
  // Tests that name a changed module.
  const changedBases = changed
    .filter((p) => p.startsWith("custom-modules/") && /\.m?js$/.test(p))
    .map((p) => p.slice(p.lastIndexOf("/") + 1));
  for (const [p, text] of Object.entries(files)) {
    if (!p.startsWith("custom-modules/tests/")) continue;
    const hit = changedBases.find((b) => text.includes(b));
    if (hit) {
      plan.tests.add(p.slice("custom-modules/tests/".length));
      note("tests", `mentions ${hit}`);
    }
  }
  for (const [flow, screens] of Object.entries(FLOW_SCREENS))
    if (screens.some((s) => plan.screens.has(s))) plan.flows.add(flow);

  return {
    ...plan,
    tests: [...plan.tests].sort(),
    flows: [...plan.flows],
    screens: [...plan.screens].sort(),
    why,
  };
}
