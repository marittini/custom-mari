# Mari Kit workflow

The one process every AI (Claude, Codex, any other) and every session follows in this repository. `CLAUDE.md` holds
the owner's expectations (how to work, design, data, talking with the owner); this file holds the process. Both
apply. When they disagree, the owner's latest words win, then `CLAUDE.md`, then this file.

## 1. Boundaries

- **The Engine is upstream's.** Everything outside `custom-modules/` is Pasta-Devs/Marinara-Engine, unmodified. The
  owner's Engine updates straight from upstream, so a change in `packages/` never reaches the owner's phone: it only
  makes this repository's test Engine differ from the real one.
- **Never edit Engine files.** Work through the capability package API inside `custom-modules/mari-kit/`. A PR that
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
| 4. Verify  | `verify.mjs` (full). Then use it like a user at 360px: whole flows, back, reload, group chats, several personas. Add a flow to `shell-e2e.mjs` or a test to `custom-modules/tests/` for what you built.                                                    | Everything passes, screenshots looked at, transfer recorded.       |
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

## 6. Release and catalog

- `manifest.template.json`'s version goes up with every Mari Kit change (patch for fixes, minor for features).
- Merging into `main` runs `mari-catalog.yml`. If it is stuck in GitHub's queue, publish it yourself:
  `node custom-modules/scripts/catalog.mjs --out <worktree of mari-catalog>` and push that branch.
- Raw GitHub files are cached for about 5 minutes: the new version can take that long to show in Mari's update
  screen.

## 7. Checks

| Command                                                | What it checks                                                                                                                                                                                                            | When                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `node custom-modules/scripts/verify.mjs --quick`       | formatting, package build and schema, shell files parse                                                                                                                                                                   | after each edit       |
| `node custom-modules/scripts/verify.mjs`               | the above, then a throwaway Engine with a fake model: Engine routes the shell calls, chat-settings sections, `custom-modules/tests`, shell flows, every main screen at 360px (overflow, page errors, transfer per screen) | before a PR           |
| `node custom-modules/scripts/verify.mjs --shots <dir>` | the same, and keeps a 360px screenshot of each screen                                                                                                                                                                     | when a screen changed |
| `Mari verify` (CI, `mari-verify.yml`)                  | the full run on every PR that touches `custom-modules/`                                                                                                                                                                   | automatic             |
| `Upstream Check` (CI, daily)                           | Mari Kit on the newest upstream Engine; a failure shows as a failed run (and an issue, if Issues are turned on)                                                                                                           | automatic             |

The fake model (`scripts/e2e/fake-llm.mjs`) answers every request with fixed text. A flow that needs a particular
reply (a reaction, a selfie command, a schedule) adds a scenario there instead of calling a real model.

What these cannot check, and the report must say so: the owner's phone and Termux, real models and their output,
real provider accounts (ElevenLabs, credits), Android WebView quirks.

## 8. Delegating

The main session keeps design decisions, integration and the final verification. Hand self-contained parts to
subagents on a lower model tier with a precise brief and the exact output wanted: reading and summarising Engine
code, inventories, mechanical edits, focused checks, screenshots. Two agents never edit the same file at once.
