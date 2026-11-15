// Picks the checks a change needs, so verify.mjs runs only what the changed files can affect (custom-modules/WORKFLOW.md,
// section 7). Pure: give it the changed paths (relative to the repository root) and the shell's files; it returns
// the plan and why each part is in it.
//
// Screens (the 360px tour) follow imports, and for shell.css the classes of the changed rules. Flows follow what each
// flow actually ran last time (ctx.coverage, e2e/coverage.mjs): a flow runs only when it executed a changed function,
// created an element a changed CSS rule styles, or called a changed server feature's routes. A flow with no
// coverage yet falls back to the screens it opens (FLOW_SCREENS).

import { FLOW_SCREENS } from "./screens.mjs";
import { cssSelectors, mentionsAll, ranLines } from "./coverage.mjs";

const SHELL = "custom-modules/mari-kit/shell/";
const SRC = "custom-modules/mari-kit/src/";
const CORE = new Set([`${SHELL}app.js`, `${SRC}server.mjs`, `${SRC}shell.server.mjs`]);
const CSS = `${SHELL}shell.css`;
const E2E = "custom-modules/scripts/shell-e2e.mjs";
const HARNESS = /^custom-modules\/scripts\/e2e\/(screens|fake-llm|playwright)\.mjs$/;

/** Line ranges of each flow in shell-e2e.mjs ("  async name({" … next flow), for a change to one flow's own code. */
export function flowBlocks(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^const flows = \{/.test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length && !/^\};/.test(lines[i]); i += 1) {
    const m = /^ {2}(?:async )?(?:"([\w-]+)"|([\w-]+))\(/.exec(lines[i]);
    if (m) {
      if (out.length) out[out.length - 1].end = i;
      out.push({ name: m[1] || m[2], start: i + 1, end: i + 1 });
    } else if (out.length) out[out.length - 1].end = i + 1;
  }
  // Comment lines just above a flow belong to it.
  for (let k = 0; k < out.length; k += 1) {
    const floor = k ? out[k - 1].start + 1 : start + 2;
    while (out[k].start > floor && /^\s*\/\//.test(lines[out[k].start - 2])) {
      out[k].start -= 1;
      if (k) out[k - 1].end = out[k].start - 1;
    }
  }
  return out;
}

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
 * (custom-modules/tests/*.test.mjs). ctx (optional, from verify.mjs): { coverage: { flow: { tree, files, routes } },
 * diff(tree, path) → { old, new } changed lines since that tree (null: unchanged), show(tree, path) → text | null,
 * base: the tree the change is measured from, text(path) → current text }.
 * Returns { format, parse, package, api, sections, tests, regressions, flows, screens, why }. flows / screens: arrays of names.
 */
export function planChecks(changed, files, ctx = {}) {
  const why = {};
  const note = (key, reason) => (why[key] ||= reason);
  const plan = {
    format: changed.filter(
      (p) =>
        (p.startsWith("custom-modules/") || ["CLAUDE.md", "AGENTS.override.md"].includes(p)) &&
        /\.(m?js|json|md|ya?ml|css|html)$/.test(p),
    ),
    parse: changed.filter((p) => p.startsWith("custom-modules/mari-kit/") && /\.m?js$/.test(p)),
    package: false,
    api: false,
    sections: false,
    tests: new Set(),
    regressions: new Set(),
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
  const cov = ctx.coverage || {};
  const covered = (f) => Boolean(cov[f]?.tree && ctx.diff);
  const allFlows = (reason) => Object.keys(FLOW_SCREENS).forEach((f) => (plan.flows.add(f), note(`flow ${f}`, reason)));
  const pickFlows = (test, reason) => {
    for (const f of Object.keys(FLOW_SCREENS))
      if (covered(f) && !plan.flows.has(f)) {
        let hit = false;
        try {
          hit = test(f);
        } catch {
          hit = true;
        }
        if (hit) (plan.flows.add(f), note(`flow ${f}`, reason));
      }
  };

  for (const p of changed) {
    if (p.startsWith("custom-modules/mari-kit/")) {
      plan.package = true;
      note("package", p);
    }
    if (CORE.has(p)) {
      allScreens();
      note("screens", `${p} (every screen)`);
      if (!p.endsWith("app.js")) allFlows(p);
    }
    if (p === CSS) {
      const lines = ctx.diff?.(ctx.base, p);
      const before = lines ? ctx.show(ctx.base, p) : null;
      const sels = !lines
        ? "all"
        : (() => {
            const a = before === null ? "all" : cssSelectors(before, lines.cssOld);
            const b = cssSelectors(ctx.text(p), lines.new);
            return a === "all" || b === "all" ? "all" : [...a, ...b];
          })();
      if (sels === "all") {
        allScreens();
        allFlows(`${p} (a rule with no class)`);
        note("screens", `${p} (a rule with no class)`);
      } else {
        for (const [s, seen] of closure)
          if (sels.some((cls) => [...seen].some((f) => mentionsAll(files[f], cls)))) plan.screens.add(screenName(s));
        note("screens", `${p} (.${[...new Set(sels.flatMap((c) => [...c]))].join(" .")})`);
        // A flow is in when it ran code that names the rule's rarest class.
        const count = (c) => Object.values(files).reduce((n, t) => n + (mentionsAll(t, new Set([c])) ? 1 : 0), 0);
        const rare = sels.map((cls) => [...cls].sort((x, y) => count(x) - count(y))[0]);
        pickFlows((f) => {
          for (const path of Object.keys(cov[f].files)) {
            const text = ctx.show(cov[f].tree, path);
            if (!text) continue;
            const hits = [];
            text.split("\n").forEach((l, i) => rare.some((c) => mentionsAll(l, new Set([c]))) && hits.push(i + 1));
            if (hits.length && ranLines(cov[f].files, path, hits)) return true;
          }
          return false;
        }, p);
      }
    } else if (p.startsWith(SHELL) && p.endsWith(".js")) {
      plan.api = true;
      note("api", p);
      for (const [s, seen] of closure) if (seen.has(p)) plan.screens.add(screenName(s));
      note("screens", p);
      pickFlows((f) => {
        const d = ctx.diff(cov[f].tree, p);
        return Boolean(d) && ranLines(cov[f].files, p, d.old);
      }, p);
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
      pickFlows((f) => cov[f].routes.includes(route), p);
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
      allFlows(`${p} (test harness)`);
      note("screens", `${p} (test harness)`);
    }
    if (p === E2E) {
      // A change inside one flow runs that flow; a change to the shared setup (seed data, helpers) runs everything.
      const d = ctx.diff?.(ctx.base, p);
      const blocks = d ? flowBlocks(ctx.text(p)) : [];
      const own = (d?.new || []).map((l) => blocks.find((b) => b.start <= l && l <= b.end)?.name ?? null);
      if (!d || own.includes(null)) {
        allScreens();
        allFlows(`${p} (setup)`);
        note("screens", `${p} (setup)`);
      } else for (const f of new Set(own)) (plan.flows.add(f), note(`flow ${f}`, p));
    }
    if (p.startsWith("custom-modules/tests/") && p.endsWith(".test.mjs") && files[p] !== undefined) {
      plan.tests.add(p.slice("custom-modules/tests/".length));
      note("tests", p);
    }
  }
  // Old Mari Kit regressions (scripts/regressions/mari-kit-*.mjs) that load a changed shell file, directly or through
  // its imports: they run outside a browser, so a change that assumes one breaks them.
  const changedSet = new Set(changed);
  for (const r of Object.keys(files).filter((p) =>
    /^scripts\/regressions\/mari-kit-[\w-]+\.regression\.mjs$/.test(p),
  )) {
    const seen = new Set();
    const walk = (p) => {
      if (seen.has(p) || files[p] === undefined) return;
      seen.add(p);
      for (const q of importsOf(p, files[p])) walk(q);
    };
    walk(r);
    const hit = [...seen].find((p) => changedSet.has(p));
    if (hit) {
      plan.regressions.add(r.slice("scripts/regressions/".length));
      note("regressions", hit);
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
  // Flows with no coverage yet: the screens they open.
  for (const [flow, screens] of Object.entries(FLOW_SCREENS))
    if (!covered(flow) && screens.some((s) => plan.screens.has(s))) plan.flows.add(flow);

  return {
    ...plan,
    tests: [...plan.tests].sort(),
    regressions: [...plan.regressions].sort(),
    flows: [...plan.flows],
    screens: [...plan.screens].sort(),
    why,
  };
}
