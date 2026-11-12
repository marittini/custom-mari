# CLAUDE.md

This repository is the owner's (marittini) Mari Kit workspace. The Engine source here is upstream
Pasta-Devs/Marinara-Engine, unmodified; the owner's work lives in `custom-modules/` (Mari Kit: one capability
package plus the Mari shell UI at `/api/mari-kit/app`). `AGENTS.md` is upstream's guide: its code-quality and
logging rules apply, its workflow rules (target `staging`, assign SpicyMarinara, Marinara-Agents routing) do not.

Read `custom-modules/README.md` for how Mari Kit is built, installed, published (the `mari-catalog` branch) and
checked against upstream.

## Working with the owner

Lessons from earlier sessions. They are the owner's standing expectations.

### How to work

- Fix the kind of problem, not only the instance that was pointed out. When one bug or gap is reported, search the
  whole shell for the same cause and fix those too (one CSS rule hid nothing anywhere; every feature assumed one
  character and one persona).
- Use it like a real user before reporting: run whole flows at phone size, tap through, look for dead ends, loops
  and missing information. Do not stop at "the screen renders".
- Read intent, not wording. "깔끔하게" means organized and partly tucked away, never deleted. Wanting the shell and
  wanting upstream updates are both requirements at once.
- Ask briefly when a request is genuinely ambiguous, before building something large; never re-ask what is
  settled.
- Before changing UI, show the flow first (principles, structure map, screen mockups, tap paths) as an artifact,
  then build what was agreed.

### Features

- Never drop an Engine feature. What the shell does not draw itself opens the Engine at that exact place (chat
  settings section, character/preset/lorebook/connection editor) with the ‹ Mari로 pill back — never the Engine's
  start page.
- Follow what the Engine already defines instead of inventing: its groups (connection folders, preset/lorebook
  folders, character and persona groups), avatar crops, per-chat settings (translation switches, preset choices,
  lorebook rules, author's notes), field names and defaults (`presetChoices`, `excludedLorebookIds`, …).
- When porting an extension or redrawing an Engine screen, list everything the original showed and did, and check
  each item off (the schedule port lost next block, tomorrow and the daily summary).
- Assume many: several characters per chat, several personas, group chats and group calls.

### Design

- Monotone only (no cream or ink tints, no browser accent colors such as the default focus ring); fonts only
  through the shell's tokens.
- Do not cram one screen, and do not strip it either: frequent things one tap away, occasional things one level in,
  long information folded.
- Slim visuals with roomy spacing; touch areas about 44px even when the control looks smaller.
- Keep the accepted visual language: page head with a small label and a 24px title; `gcard`/`grow` rows; `hbox`
  with its label on the border; character profile English tags stay.
- Back always returns where the user came from. A fresh open starts on 홈; a reload or a return from the Engine
  keeps the screen.
- Screens that imitate a real action must feel like it (the call screen looks and behaves like a phone call; typing
  first; no accidental hang-up while typing).
- Settings live where they are used (this chat → chat settings; the whole app → 설정), with search for the rest.

### Data and performance (required)

- Measure transfer per screen and report the numbers with each step.
- Never load the whole Engine app as part of the shell (16MB on a first visit; the in-shell sheet idea cost 9.6MB
  plus a second Engine in memory). Heavy Engine screens open only on request, and the UI says what it costs.
- Each screen fetches only what it shows; polling only while visible and only when it can change something; large
  records (a preset's full record) only when opened.
- Images small: WebP made in the browser before upload, small thumbnails in lists, immutable caching for files that
  never change.

### Engine updates and structure

- Do not modify Engine source. Everything goes through the capability package API inside `custom-modules/`.
- The owner never merges by hand: the Engine updates from upstream directly; Mari Kit updates from the catalog. If
  the catalog workflow is stuck in GitHub's queue, publish the catalog yourself (`scripts/catalog.mjs` into the
  `mari-catalog` branch) and mention the 5-minute caches.
- Keep drift visible: `check-engine-api.mjs` (routes the shell calls), `check-engine-sections.mjs` (chat settings
  sections) and `check.mjs` run in the daily upstream check, which opens an issue on failure. Add new Engine calls
  to `mari-kit/shell/engine-api.json`.
- Bump `manifest.template.json`'s version whenever Mari Kit files change.

### Verifying and reporting

- Say plainly what was verified and how, and what was not (the owner's phone/Termux, real models, real accounts).
- Tell test-tool artifacts from real bugs, but check that a test is not hiding a real bug.
- Keep the owner's steps minimal and copy-pasteable; explain with plain words or an analogy, not jargon.

### Talking with the owner

- Korean, short and plain. If an explanation is called hard, shorten it again with an analogy.
- No excuses: acknowledge a mistake in one line and fix it.
- Report in this order: what changed, what the owner needs to do, what was not verified.
