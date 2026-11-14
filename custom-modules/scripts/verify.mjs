#!/usr/bin/env node
// Mari Kit checks (custom-modules/WORKFLOW.md, section 7). By default only what the change can affect.
//
//   node custom-modules/scripts/verify.mjs            checks for the files changed since origin/main (commits, staged,
//                                                     unstaged, new): formatting and parsing of those files, the
//                                                     package build if Mari Kit changed, and, on a throwaway Engine
//                                                     with a fake model, only the Engine checks, tests, shell flows
//                                                     and 360px screens those files reach (scripts/e2e/scope.mjs)
//   node custom-modules/scripts/verify.mjs --quick    the same, without the Engine (formatting, parsing, package)
//   node custom-modules/scripts/verify.mjs --all      everything (before a release-sized merge; CI runs this)
//
//   options: --base <ref> (compare with another ref) · --shots <dir> (keep a screenshot per toured screen) ·
//            --url <engine> (use a running Engine whose data can be thrown away) · --verbose (full output)
//
// Output is short on purpose: one line per check, the transfer of each toured screen, and the tail of a failure.

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { planChecks } from "./e2e/scope.mjs";
import { FLOW_SCREENS } from "./e2e/screens.mjs";
import { undefinedNames } from "./e2e/undefined-names.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const kit = resolve(root, "custom-modules");
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const quick = args.includes("--quick");
const all = args.includes("--all");
const verbose = args.includes("--verbose");
const results = [];
const bin = (name) => join(root, "node_modules", ".bin", name);
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);

function run(cmd, cmdArgs, { cwd = root, env = {} } = {}) {
  return new Promise((done) => {
    const child = spawn(cmd, cmdArgs, { cwd, env: { ...process.env, ...env }, stdio: verbose ? "inherit" : "pipe" });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("close", (code) => done({ ok: code === 0, out }));
  });
}
const tail = (out, n = 12) => out.trim().split("\n").slice(-n).join("\n");
async function step(name, fn) {
  const t = Date.now();
  let res = { ok: false, detail: "" };
  try {
    res = await fn();
  } catch (error) {
    res = { ok: false, detail: error.message };
  }
  results.push({ name, ok: res.ok });
  console.log(`${res.ok ? "PASS" : "FAIL"}  ${name}  (${((Date.now() - t) / 1000).toFixed(0)}s)`);
  if (res.detail) console.log(res.detail.replace(/^/gm, "      "));
  return res.ok;
}

// ── What changed, and what it needs ──
async function shellAndTests() {
  const files = {};
  const walk = async (dir) => {
    if (!existsSync(dir)) return;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(m?js)$/.test(e.name)) files[relative(root, p)] = await readFile(p, "utf8");
    }
  };
  await walk(join(kit, "mari-kit", "shell"));
  await walk(join(kit, "tests"));
  return files;
}
const files = await shellAndTests();
let plan;
if (all) {
  plan = {
    format: ["custom-modules", "CLAUDE.md", "AGENTS.override.md"],
    parse: "all",
    package: true,
    api: true,
    sections: true,
    tests: "all",
    flows: Object.keys(FLOW_SCREENS),
    screens: "all",
    why: {},
  };
  console.log("Everything (--all)");
} else {
  const base = opt("--base") || "origin/main";
  const changed = [
    ...new Set([
      ...git("diff", "--name-only", `${base}...HEAD`),
      ...git("diff", "--name-only", "HEAD"),
      ...git("ls-files", "--others", "--exclude-standard"),
    ]),
  ].filter((p) => existsSync(join(root, p)));
  plan = planChecks(changed, files);
  if (quick) Object.assign(plan, { api: false, sections: false, tests: [], flows: [], screens: [] });
  console.log(`${changed.length} changed file(s) since ${base}`);
  const parts = [
    plan.format.length && `format ${plan.format.length}`,
    plan.parse.length && `parse ${plan.parse.length}`,
    plan.package && "package",
    plan.api && "engine routes",
    plan.sections && "chat-settings sections",
    plan.tests.length && `tests ${plan.tests.join(",")}`,
    plan.flows.length && `flows ${plan.flows.join(",")}`,
    plan.screens.length && `screens ${plan.screens.join(",")}`,
  ].filter(Boolean);
  console.log(`Checks: ${parts.join(" · ") || "nothing to check"}`);
  if (verbose) for (const [k, v] of Object.entries(plan.why)) console.log(`  ${k}: ${v}`);
}

// ── Static ──
if (plan.format.length)
  await step("Formatting", async () => {
    const r = await run(bin("prettier"), ["--check", "--ignore-unknown", ...plan.format]);
    return { ok: r.ok, detail: r.ok ? "" : `${tail(r.out)}\n(fix: npx prettier --write <file>)` };
  });

if (plan.parse === "all" || plan.parse.length)
  await step("Files parse, no undefined names", async () => {
    const esbuild = createRequire(join(root, "package.json"))("esbuild");
    let list = plan.parse;
    if (list === "all") {
      list = [];
      const walk = async (dir) => {
        for (const e of await readdir(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) await walk(p);
          else if (/\.(m?js)$/.test(e.name)) list.push(relative(root, p));
        }
      };
      await walk(join(kit, "mari-kit"));
    }
    const bad = [];
    for (const f of list) {
      try {
        await esbuild.transform(await readFile(join(root, f), "utf8"), { loader: "js", format: "esm", sourcefile: f });
      } catch (error) {
        bad.push(`${f}: ${error.errors?.[0]?.text || error.message}`);
      }
    }
    // A name used but never imported or defined parses fine and breaks only when that code runs.
    if (!bad.length) bad.push(...(await undefinedNames(list)));
    return { ok: bad.length === 0, detail: bad.join("\n") };
  });

if (plan.package)
  await step("Package build + Engine schema (check.mjs)", async () => {
    if (!existsSync(join(root, "packages", "shared", "dist"))) await run("pnpm", ["build:shared"]);
    const r = await run("node", [join(kit, "scripts", "check.mjs")]);
    return { ok: r.ok, detail: r.ok ? "" : tail(r.out) };
  });

// ── Engine ──
const allTests = existsSync(join(kit, "tests"))
  ? (await readdir(join(kit, "tests"))).filter((f) => f.endsWith(".test.mjs")).sort()
  : [];
const tests = plan.tests === "all" ? allTests : plan.tests;
const needsEngine =
  plan.api ||
  plan.sections ||
  plan.flows.length ||
  plan.screens.length ||
  tests.some((t) => t.endsWith(".engine.test.mjs"));
let engine = null;
let dataDir = null;
let base = opt("--url");
if (needsEngine && !base) {
  const ready = await step("Throwaway Engine", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mari-verify-"));
    const inst = await run("node", [join(kit, "scripts", "install.mjs"), "--data-dir", dataDir]);
    if (!inst.ok) return { ok: false, detail: tail(inst.out) };
    const port = await new Promise((r) => {
      const s = createServer().listen(0, "127.0.0.1", () => {
        const p = s.address().port;
        s.close(() => r(p));
      });
    });
    const server = join(root, "packages", "server");
    const dist = join(server, "dist", "index.js");
    // CI builds the server first; locally a dist folder can be older than the source, so run the source.
    const built = Boolean(process.env.CI) && existsSync(dist);
    const [cmd, cmdArgs] = built ? ["node", [dist]] : [join(server, "node_modules", ".bin", "tsx"), ["src/index.ts"]];
    engine = spawn(cmd, cmdArgs, {
      cwd: server,
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        PORT: String(port),
        HOST: "127.0.0.1",
        NODE_ENV: "production",
        // The checks send far more than a person does (600 a minute is the Engine's limit per address).
        MARINARA_E2E_DISABLE_RATE_LIMIT: "true",
      },
      stdio: "ignore",
    });
    base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 120; i += 1) {
      const ok = await fetch(`${base}/api/mari-kit/app`).then(
        (r) => r.ok,
        () => false,
      );
      if (ok) return { ok: true };
      await new Promise((r) => setTimeout(r, 1000));
    }
    return { ok: false, detail: "the Engine did not start in 120s" };
  });
  if (!ready) base = null;
}
const withEngine = (fn) => async () => (base ? fn() : { ok: false, detail: "no Engine" });

if (plan.api)
  await step(
    "Engine routes the shell calls",
    withEngine(async () => {
      const r = await run("node", [join(kit, "scripts", "check-engine-api.mjs"), base]);
      return { ok: r.ok, detail: r.ok ? "" : tail(r.out) };
    }),
  );
if (plan.sections)
  await step(
    "Engine chat-settings sections",
    withEngine(async () => {
      const r = await run("node", [join(kit, "scripts", "check-engine-sections.mjs"), base]);
      return { ok: r.ok, detail: r.ok ? "" : tail(r.out) };
    }),
  );
for (const t of tests)
  await step(`Test ${t}`, async () => {
    const r = await run("node", [join(kit, "tests", t)], { env: base ? { ENGINE_URL: base } : {} });
    return { ok: r.ok, detail: r.ok ? "" : tail(r.out, 10) };
  });
if (all)
  // Older Mari Kit tests that still live in the Engine's regression folder (WORK.md M-7 moves them).
  await step("Mari Kit regressions in scripts/regressions (legacy place)", async () => {
    const r = await run("node", ["scripts/run-regressions.mjs", "--filter", "mari-kit"]);
    return { ok: r.ok, detail: r.ok ? "" : tail(r.out) };
  });

const screens =
  plan.screens === "all"
    ? Object.keys(files)
        .filter((p) => p.startsWith("custom-modules/mari-kit/shell/screens/"))
        .map((p) => p.slice(p.lastIndexOf("/") + 1, -3))
    : plan.screens;
if (plan.flows.length || screens.length)
  await step(
    `Shell ${plan.flows.length} flow(s) + ${screens.length} screen module(s) at 360px`,
    withEngine(async () => {
      // --all runs shell-e2e as the daily check does (every flow, first-visit transfer, every screen).
      const extra = all ? [] : ["--only", plan.flows.join(",") || "-", "--screens", screens.join(",") || "-"];
      if (opt("--shots")) extra.push("--shots", resolve(opt("--shots")));
      const r = await run("node", [join(kit, "scripts", "shell-e2e.mjs"), base, ...extra]);
      const keep = r.out
        .split("\n")
        .filter((l) => /^(FAIL|First visit|Screens at|  (ok|FAIL) |  screenshots|     screen:)/.test(l));
      return { ok: r.ok, detail: (r.ok ? keep.filter((l) => !l.startsWith("FAIL")) : keep).join("\n") };
    }),
  );

if (engine) engine.kill();
if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});

const failed = results.filter((r) => !r.ok).length;
console.log(
  `\n${failed ? `${failed} check(s) failed` : `All ${results.length} check(s) passed`}. Not covered: the owner's phone and Termux, real models, real accounts, Android WebView.`,
);
process.exit(failed ? 1 : 0);
