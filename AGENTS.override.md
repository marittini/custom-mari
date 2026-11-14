# AGENTS.override.md

This repository is marittini's Mari Kit workspace, not the Marinara Engine project. This file replaces `AGENTS.md`
for agents that read it (Codex and others).

Read these before any work and follow them:

1. `custom-modules/WORKFLOW.md` — the process: boundaries, stages, branches, issues, PRs, release, checks.
2. `CLAUDE.md` — the owner's standing expectations (they apply to every AI, not only Claude).
3. `custom-modules/README.md` — how Mari Kit is built, installed and published.

The most important rule: **do not edit Engine files** (anything outside `custom-modules/` and the few fork files
listed in `WORKFLOW.md`). The owner's Engine updates straight from upstream, so such edits never reach the owner and
only make this repository's test Engine differ from the real one. A PR that does it fails the `Mari Engine guard`
check.

From `AGENTS.md`, only these sections still apply: **Ponytail Implementation Discipline**, **Logging**, and the
code-quality parts of **Frontend Changes**. Its workflow rules (target `staging`, assign `SpicyMarinara`,
Marinara-Agents routing, CodeRabbit, the model table, version sync of Engine files) do not apply here.
