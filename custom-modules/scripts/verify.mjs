#!/usr/bin/env node
// One command for every Mari Kit check (custom-modules/WORKFLOW.md, section 7).
//
//   node custom-modules/scripts/verify.mjs --quick     formatting, package build + schema, shell files parse
//   node custom-modules/scripts/verify.mjs             the above, then a throwaway Engine with a fake model:
//                                                      Engine routes, chat-settings sections, custom-modules/tests,
//                                                      shell flows and the 360px screen tour
//   options: --shots <dir> (keep a screenshot per screen) · --url <engine> (use a running Engine whose data can be
//            thrown away, instead of starting one) · --only <flow,flow> (passed to shell-e2e)
//
// The Engine it starts uses an empty data folder in the system temp folder and is stopped at the end.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const kit = resolve(root, "custom-modules");
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const quick = args.includes("--quick");
const results = [];

function run(cmd, cmdArgs, { cwd = root, env = {}, quiet = false } = {}) {
  return new Promise((done) => {
    const child = spawn(cmd, cmdArgs, { cwd, env: { ...process.env, ...env }, stdio: quiet ? "pipe" : "inherit" });
    let out = "";
    if (quiet) {
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
    }
    child.on("close", (code) => done({ ok: code === 0, out }));
  });
}
async function step(name, fn) {
  console.log(`\n── ${name}`);
  const t = Date.now();
  let ok = false;
  try {
    ok = await fn();
  } catch (error) {
    console.log(error.message);
  }
  results.push({ name, ok, s: (Date.now() - t) / 1000 });
  return ok;
}
const bin = (name) => join(root, "node_modules", ".bin", name);

// ── Quick ──
await step("Formatting (prettier)", async () => {
  const r = await run(bin("prettier"), ["--check", "custom-modules", "CLAUDE.md", "AGENTS.override.md"], {
    quiet: true,
  });
  if (!r.ok) console.log(r.out.trim().split("\n").slice(-15).join("\n") + "\n(fix: npx prettier --write <files>)");
  else console.log("ok");
  return r.ok;
});

await step("Shell and package files parse", async () => {
  const esbuild = createRequire(join(root, "package.json"))("esbuild");
  const files = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(m?js)$/.test(e.name)) files.push(p);
    }
  };
  await walk(join(kit, "mari-kit"));
  const bad = [];
  for (const f of files) {
    try {
      await esbuild.transform(await readFile(f, "utf8"), { loader: "js", format: "esm", sourcefile: f });
    } catch (error) {
      bad.push(`${relative(root, f)}: ${error.errors?.[0]?.text || error.message}`);
    }
  }
  console.log(bad.length ? bad.join("\n") : `ok (${files.length} files)`);
  return bad.length === 0;
});

await step("Package build + Engine schema (check.mjs)", async () => {
  if (!existsSync(join(root, "packages", "shared", "dist"))) await run("pnpm", ["build:shared"], { quiet: true });
  return (await run("node", [join(kit, "scripts", "check.mjs")])).ok;
});

// ── Full ──
let engine = null;
let dataDir = null;
if (!quick) {
  let base = opt("--url");
  if (!base) {
    const ready = await step("Throwaway Engine (empty data, Mari Kit installed)", async () => {
      dataDir = await mkdtemp(join(tmpdir(), "mari-verify-"));
      const inst = await run("node", [join(kit, "scripts", "install.mjs"), "--data-dir", dataDir], { quiet: true });
      if (!inst.ok) return (console.log(inst.out), false);
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
        if (ok) return (console.log(`up at ${base} (${built ? "built server" : "source"})`), true);
        await new Promise((r) => setTimeout(r, 1000));
      }
      console.log("the Engine did not start in 120s");
      return false;
    });
    if (!ready) base = null;
  }
  if (base) {
    await step(
      "Engine routes the shell calls (check-engine-api.mjs)",
      async () => (await run("node", [join(kit, "scripts", "check-engine-api.mjs"), base])).ok,
    );
    await step(
      "Engine chat-settings sections (check-engine-sections.mjs)",
      async () => (await run("node", [join(kit, "scripts", "check-engine-sections.mjs"), base])).ok,
    );
    await step("Mari Kit tests (custom-modules/tests)", async () => {
      const dir = join(kit, "tests");
      const tests = existsSync(dir) ? (await readdir(dir)).filter((f) => /\.test\.mjs$/.test(f)).sort() : [];
      let ok = true;
      for (const t of tests) {
        const r = await run("node", [join(dir, t)], { env: { ENGINE_URL: base }, quiet: true });
        console.log(
          `${r.ok ? "PASS" : "FAIL"} ${t}${r.ok ? "" : `\n${r.out.trim().split("\n").slice(-10).join("\n")}`}`,
        );
        ok &&= r.ok;
      }
      // Older Mari Kit tests that still live in the Engine's regression folder (to be moved; see WORKFLOW.md §1).
      const legacy = await run("node", ["scripts/run-regressions.mjs", "--filter", "mari-kit"], { quiet: true });
      console.log(`${legacy.ok ? "PASS" : "FAIL"} scripts/regressions/mari-kit-* (legacy location)`);
      if (!legacy.ok) console.log(legacy.out.trim().split("\n").slice(-12).join("\n"));
      return ok && legacy.ok;
    });
    await step("Shell flows + 360px screen tour (shell-e2e.mjs)", async () => {
      const extra = [];
      if (opt("--shots")) extra.push("--shots", resolve(opt("--shots")));
      if (opt("--only")) extra.push("--only", opt("--only"));
      return (await run("node", [join(kit, "scripts", "shell-e2e.mjs"), base, ...extra])).ok;
    });
  }
}

if (engine) engine.kill();
if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});

console.log("\n── Summary");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.s.toFixed(0)}s)`);
console.log(
  "\nNot covered by these checks: the owner's phone and Termux, real models, real provider accounts, Android WebView.",
);
process.exit(results.every((r) => r.ok) ? 0 : 1);
