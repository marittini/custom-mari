# Mari Kit work list

The shared to-do list for every AI working here (GitHub Issues are turned off in this repository). Rules are in
`WORKFLOW.md`, section 4. Each item has an id (`M-<n>`, never reused), a status and, while someone works on it, who
(`claude <session or branch>`, `codex <branch>`, …). Move an item to **Done** with its PR link when it is merged.

Status: `plan` waiting for the owner · `ready` agreed, nobody on it · `doing` someone on it (say who) · `blocked`
needs the owner, a real account or a phone.

## Doing

_(none)_

## Ready

### M-3 Convo: 캐릭터 일정 보기 — step (plan §3)

Plan with mockups: https://claude.ai/artifact/375D4DH6fcBQHXme3Tmnv5

- Header line under the name: status dot, activity, until when (groups: shortened, tap for each). The current
  "나 · …" line moves to the bottom of the status sheet.
- Status sheet: everything the Engine's `ConversationPresenceCard` shows (status, activity, rest of today, last
  contact, schedule vs override, change status with activity and duration, reply now).
- Week view: day tabs, blocks with the current one marked, routine summary, regenerate day/week
  (`POST /conversation/schedule/draft`, `/schedule/generate`). Editing single blocks is M-6; until then link to the
  Engine's schedule editor.
- Status dot on avatars in the convo list; 채팅 설정 › 대화 기능 › 캐릭터 일정 gets 일정 보기 per character.
- Data: `GET /conversation/status/:chatId` on open and after a reply (3–5KB with schedules); the minute-by-minute
  status is computed on screen from the schedule. Add new Engine calls to `engine-api.json`.

### M-4 Convo: 이모지 반응, 답장 — step (plan §4, stage 1)

- Show reactions (`extra.reactions`, incl. the character's `[react]`) small on the bubble corner; per segment for
  grouped messages.
- Tap a bubble: 6 reactions + ＋ above the current toolbar; save with `PATCH /chats/:id/messages/:id/extra` in the
  Engine's format (a lone reaction can make the character answer: `recordUserReaction`).
- 답장 tool (`TOOL_DEFS`): quote above the composer, sent as `extra.replyTo`, quote shown on the sent bubble.

### M-7 Engine 원본을 고친 PR 4개 정리 — engine

PRs #35, #38, #41, #42 changed Engine files. The owner's Engine updates from upstream, so these never reach the
phone. Investigation done (read-only); upstream issue drafts for the owner are in `custom-modules/UPSTREAM.md`.

| PR  | Engine change                                                                           | Mari Kit can do it itself?                                                                                                                             |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #35 | feature agents (`execution: "feature"`) kept out of the LLM agent pipeline and Retry    | No (Engine resolution code). Until upstream: check whether enabling the Mari Kit agent on a chat makes an empty agent call; if so, say so in the shell |
| #38 | translation keeps `<audio_…>` wrappers and `[cues]` (placeholder tokens, 422 if broken) | Partly: Mari's own translate calls can tokenize in `shell/lib/translate.js`; the Engine's automatic translation cannot                                 |
| #41 | a generation that fails during setup no longer stays "generating"                       | Partly: `watchGeneration` can offer 멈추기 for a stuck entry; root cause is Engine                                                                     |
| #42 | `includePromptCache=false` drops `extra.cachedPrompt` from message lists                | Yes, likely: a Mari Kit route that reads messages (`runtime.persistence.listMessages`) and strips it                                                   |

Next: do the Mari Kit side (#42 route, #38 manual translation, #41 stuck notice), then put the Engine files back
(PR labelled `mari:engine-restore`), move the `scripts/regressions/mari-kit-*.mjs` tests that need no Engine source
into `custom-modules/tests/` (all but `mari-kit-tts-generation.regression.ts`), and give the owner `UPSTREAM.md`.

### M-8 화면을 못 불러올 때 다시 시도 — bug

A screen's module fetch can fail (network drop on the phone, or the Engine's 600-requests-a-minute limit: reproduced
by `check-engine-api` followed by the flows). The shell then shows "화면을 불러오지 못했어요: Failed to fetch
dynamically imported module …" with no way out. Retry once, then offer 다시 시도 and say it in plain words.

### M-9 내 일정: 페르소나가 많으면 칩이 화면을 덮음 — bug

`schedule.js` lists every persona as a chip; with many personas the chips fill the screen (seen in the 360px tour).
Use the persona picker with groups (`pickPerson`, `foldGroup`) and show only the current one.

### M-10 생성 요청 관리 화면 모양 맞추기 — bug

`screens/generations.js` (0.16.x) does not use the accepted page head (small label + 24px title) and uses a bare
`<select>` and a grey disabled button. Match the other screens.

## Plan (waiting for the owner)

### M-6 Convo 2단계 — plan §4, stage 2

Edit schedule blocks in Mari, send photos (WebP made in the browser), @mention in groups, my own status
(online/idle/dnd/invisible), scene invitations, weather (server already in Mari Kit, no screen yet).

### M-11 Convo 3단계 — plan §4, stage 3

Emoji/kaomoji tab and GIFs, mini-games when their packages are installed (link to the Engine first), voice input.

## Blocked

_(none)_

## Done

- M-1 Convo 바쁨·오프라인·입력 중 알림, M-2 셀카·영상·사진, M-5 시각·날짜 구분선 — Mari Kit 0.17.0 (PR #47).
- Workflow: `WORKFLOW.md`, `AGENTS.override.md`, Engine guard, `verify.mjs` with the 360px screen tour, this list.
