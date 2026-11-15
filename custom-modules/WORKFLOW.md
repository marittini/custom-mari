# Mari Kit workflow

The one process every AI (Claude, Codex, any other) and every session follows in this repository. `CLAUDE.md` holds
the owner's expectations (how to work, design, data, talking with the owner); this file holds the process. Both
apply. When they disagree, the owner's latest words win, then `CLAUDE.md`, then this file.

## 1. Boundaries

- **The Engine is upstream's.** Everything outside `custom-modules/` is Pasta-Devs/Marinara-Engine, unmodified. The
  owner's Engine updates straight from upstream, so a change in `packages/` never reaches the owner's phone: it only
  makes this repository's test Engine differ from the real one.
- **Never edit Engine files.** Four earlier edits are kept on purpose; `ENGINE-EDITS.md` lists them.
  Otherwise work through the capability package API inside `custom-modules/mari-kit/`. A PR that
  changes a path outside the fork's own files (list below) fails the `Mari Engine guard` check.
- **An Engine bug** is handled in two parts: work around it inside Mari Kit (shell or package), and write up the
  upstream issue text for the owner to file, in its `WORK.md` item (what breaks, smallest reproduction, the fix you
  would propose). Say in the report which part is a workaround.
- The fork's own files, the only ones a PR may change:
  - `custom-modules/**`
  - `CLAUDE.md`, `AGENTS.override.md`
  - `.github/workflows/mari-*.yml`, `.github/workflows/upstream-check.yml`
- Tests for Mari Kit go in `custom-modules/tests/` (run by `verify.mjs` and by the daily upstream check). Do not add
  files under `scripts/regressions/`: the daily check, which puts Mari Kit on the newest upstream Engine, never sees
  them.

## 2. Stages

Every request goes through these stages in order. A bug fix skips stage 2 unless it changes what a screen shows or how
it is used.

| Stage      | What happens                                                                                                                                                                                                                                               | Done when                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Intake  | Restate the request in one line. Read `WORK.md` and open PRs so two AIs do not do the same work. Ask the owner briefly if the request is genuinely ambiguous.                                                                                              | The work has one `WORK.md` item and nobody else is on it.          |
| 2. Plan    | For anything the owner sees: an artifact with principles, structure map, screen mockups, tap paths and the transfer it will cost. List everything the Engine already does for this feature (inventory), and say which parts are reused, redrawn or linked. | The owner agreed. Agreed steps become `WORK.md` items (section 4). |
| 3. Build   | Branch, smallest change that does the step, Engine calls added to `mari-kit/shell/engine-api.json`, `manifest.template.json` version bumped.                                                                                                               | `verify.mjs --quick` passes.                                       |
| 4. Verify  | `verify.mjs` (scoped; `--all` for release-sized changes). Then use it like a user at 360px: whole flows, back, reload, group chats, several personas. Add a flow to `shell-e2e.mjs` or a test to `custom-modules/tests/` for what you built.               | Everything passes, screenshots looked at, transfer recorded.       |
| 5. Release | PR (section 5), squash merge into `main`, catalog published (section 6).                                                                                                                                                                                   | The catalog shows the new version.                                 |
| 6. Report  | To the owner, in Korean, short: what changed, what the owner does (copy-pasteable), what was not verified. Move the item to Done with the PR link.                                                                                                         | The item is in Done.                                               |

## 3. Branches and merging

- Work on the session's branch (or `mari/<short-topic>`), never directly on `main`.
- One PR per agreed step. Squash merge. Never force-push, never rewrite history.
- After a merge, restart the branch from the new `main`: `git checkout -B <branch> origin/main`, then
  `git merge -s ours --no-edit origin/<branch>` so the push is a fast-forward, then push.

## 4. Work list

GitHub Issues are turned off in this repository, so the shared to-do list is `custom-modules/WORK.md`.

- Every piece of work is an item there with an id (`M-<n>`, never reused) and a status: `plan` (waiting for the
  owner), `ready` (agreed, nobody on it), `doing` (say who: `claude <branch>`, `codex <branch>`), `blocked` (needs
  the owner, a real account or a phone).
- Before starting, move the item to **Doing** with your name, commit and push that change first, so another AI
  sees it. Do not take an item someone else is doing.
- A finished item moves to **Done** with its PR link in the same PR that does the work.
- Found something on the way (a bug, a gap)? Add an item instead of fixing it silently inside unrelated work.
- Every PR and comment an AI writes ends with the attribution line its host requires.

## 5. Pull requests

Title: `Mari Kit <version>: <what changed in plain words>`. Body sections:

1. **Why** — the owner's problem, in one or two lines, with the `WORK.md` item id.
2. **What changed** — bullets a user would recognise.
3. **Verified** — the commands run and their result, transfer per changed screen, screenshots looked at.
4. **Not verified** — the owner's phone/Termux, real models, real accounts, anything skipped and why.

Leave checkboxes unchecked. Do not claim pending CI as passed.

The Engine's own PR workflows also run here. Their **Branch policy check** always fails ("Contributions must target
staging"): it is upstream's rule for upstream's repository and does not apply. A shard job that shows `cancelled`
after a new push is not a failure. The checks that matter are **Mari Engine guard** and **Mari verify**.

## 6. Release and catalog

- `manifest.template.json`'s version goes up with every Mari Kit change (patch for fixes, minor for features).
- Merging into `main` runs `mari-catalog.yml`. If it is stuck in GitHub's queue, publish it yourself:
  `node custom-modules/scripts/catalog.mjs --out <worktree of mari-catalog>` and push that branch.
- Raw GitHub files are cached for about 5 minutes: the new version can take that long to show in Mari's update
  screen.

## 7. Checks

By default `verify.mjs` checks only what the change reaches, so a small change costs little time and output (tokens).
It starts from **the last passing run on this branch** (the first run: from `origin/main`), so work already checked
is not checked again; `--base origin/main` checks the whole branch. It picks (`scripts/e2e/scope.mjs`):

- formatting and parsing of the changed files, and the package build when anything in `mari-kit/` changed;
- the Engine-routes check when shell code or `engine-api.json` changed, the chat-settings-sections check only for
  `chat-settings.js` / `engine-sections.js`;
- the 360px tour for the screens that load a changed file (through imports); for `shell.css`, only the screens whose
  code uses the classes of the changed rules (a rule without a class, like `:root` or `button`, tours all);
- **flows by what they ran**: every passing flow records which shell functions it executed and which Engine routes it
  called (`scripts/e2e/coverage.mjs`, kept in `.git/mari-verify/`). A change runs only the flows that executed a
  changed function, built an element a changed CSS rule styles, or called a changed server feature's routes. A
  change to one flow in `shell-e2e.mjs` runs that flow; a change to its shared setup runs all. A flow with no record
  yet falls back to the screens it opens (`FLOW_SCREENS`);
- the old Mari Kit regressions in `scripts/regressions/mari-kit-*.mjs` that load a changed file through their
  imports (they run outside a browser, so code that assumes `location` or `document` breaks them);
- the tests in `custom-modules/tests/` that changed or name a changed file. A test that needs an Engine is named
  `*.engine.test.mjs`; the Engine starts only when something needs it.

`--plan` prints what would run and why, without running it. Batch edits and verify once per batch: every run of a
flow costs output, so do not run the scoped check after each small edit (`--quick` is for that).

Each check prints one line; a toured screen prints its transfer; a failure prints its tail.

| Command                                          | What it checks                                                                                                  | When                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `node custom-modules/scripts/verify.mjs --quick` | formatting, parsing and undefined names (a missing import), package build — no Engine                           | after each edit                                                   |
| `node custom-modules/scripts/verify.mjs`         | the scoped run above                                                                                            | before a PR                                                       |
| `node custom-modules/scripts/verify.mjs --all`   | everything: every flow and screen, every test, first-visit transfer, the old Mari Kit regressions               | before a release-sized merge (several steps, `app.js`, the build) |
| add `--shots <dir>`                              | keeps a 360px screenshot of each toured screen                                                                  | when a screen changed                                             |
| add `--verbose`                                  | full output and why each check was picked                                                                       | when a check fails or looks wrong                                 |
| `Mari verify` (CI)                               | `--all` on every PR that touches Mari Kit (costs no tokens)                                                     | automatic                                                         |
| `Upstream Check` (CI, daily)                     | Mari Kit on the newest upstream Engine; a failure shows as a failed run (and an issue, if Issues are turned on) | automatic                                                         |

When you add a flow to `shell-e2e.mjs`, add it to `FLOW_SCREENS` too (its fallback before it has a record).

Flows run at 360px (a phone's narrowest common width). Every flow and every toured screen is also checked for
layout faults (`layoutFaults` in `scripts/e2e/screens.mjs`):
text squeezed into a one- or two-letter column, an icon button that draws nothing, a `.r` row with fewer cells than
its grid has columns, and text running off the screen. A fault fails the check; fix it, do not loosen the check.

The fake model (`scripts/e2e/fake-llm.mjs`) answers every request with fixed text. A flow that needs a particular
reply (a reaction, a selfie command, a schedule) adds a scenario there instead of calling a real model.

What these cannot check, and the report must say so: the owner's phone and Termux, real models and their output,
real provider accounts (ElevenLabs, credits), Android WebView quirks.

## 8. Screen rules

The owner's rules for anything drawn in the shell, from the mistakes that reached the owner. Read them before
building UI; the layout ones are checked automatically (section 7).

1. **No buttons, notices or steps nobody asked for.** No "＋ 새 답", "지금 답하게", "곧 대답합니다", "잠시 기다려 주세요".
   When porting an Engine feature, port what the Engine has, no more. Anything extra goes into the mockup first, as
   a question.
2. **No explanation text beside an icon.** An icon button has its name in `aria-label`/`title` only. A settings row
   may have one short `small` line under its label; nothing longer.
3. **Running work shows once, in its own room.** Use `startJob` (`lib/activity.js`; it belongs to the chat it
   started in) or `work()` for anything that costs an AI call. Never a toast that follows the user into other rooms.
   No apology or hurry-up text.
4. **Use the existing pieces.** Rows: `.r` (icon · text · value) or `.r.two` (text · value), never two children in a
   `.r`. Cards: `gcard` / `grow`. Text in a cell may wrap (`min-width: 0`, `overflow-wrap: anywhere`; `keep-all`
   only together with `overflow-wrap: anywhere`); a short label that must stay whole (a time) gets `nowrap` and the
   long neighbour wraps.
5. **Filled icons are filled.** `icon(path, size, 0)` draws a filled shape; never a line 0 wide.
6. **No raw Engine text.** English system lines and ids are shown in Korean, in the shell's monotone style.
7. **One flow, one place.** When two screens do the same thing (organize memory, make a voice clip), they share one
   `lib/` module. Number limits and defaults come from one constant (the server's, sent to the screen).
8. **Say only what happened.** A notice never claims something that did not happen ("되돌렸어요" only after a real
   restore).
9. **Before reporting:** run the whole flow at 360px, back and reload included; look at the screenshots.

## 9. Delegating

The main session keeps design decisions, integration and the final verification. Hand self-contained parts to
subagents on a lower model tier with a precise brief and the exact output wanted: reading and summarising Engine
code, inventories, mechanical edits, focused checks, screenshots. Two agents never edit the same file at once.
