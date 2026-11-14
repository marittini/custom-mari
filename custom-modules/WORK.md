# Mari Kit work list

The shared to-do list for every AI working here (GitHub Issues are turned off in this repository). Rules are in
`WORKFLOW.md`, section 4. Each item has an id (`M-<n>`, never reused), a status and, while someone works on it, who
(`claude <session or branch>`, `codex <branch>`, …). Move an item to **Done** with its PR link when it is merged.

Status: `plan` waiting for the owner · `ready` agreed, nobody on it · `doing` someone on it (say who) · `blocked`
needs the owner, a real account or a phone.

## Doing

_(none)_

## Ready

### M-1 Convo: 바쁨·오프라인·입력 중 알림 — bug

The Engine streams `delayed`, `offline` (also `scene_busy`) and `typing` events; Mari's `streamGenerate`
(`shell/lib/actions.js`) reads only `token`, `message_saved` and `error`. A busy character shows "…" for 1–5 minutes,
an offline one shows nothing, and a group does not say who is typing.

- Show "○○는 지금 바빠요 · 틈나면 답해요 (약 N분)" with the Engine's 지금 답하게 (Reply now).
- Show why there is no reply for offline / in a scene.
- "○○가 입력 중…" with face and name, in order for groups.
- Engine: `packages/server/src/routes/generate/conversation-presence-runtime.ts`.
- Proof: fake-model scenario and a character on a dnd/offline schedule; a `shell-e2e` flow.

### M-2 Convo: 캐릭터 셀카·영상이 안 보임 — bug

`[selfie]` / `[video]` results are stored in the message's `extra.attachments` (per swipe;
`services/generation/conversation-selfie-command-runtime.ts`). Mari Convo does not draw attachments.

- Image/video under the bubble, small in the list, large on tap; follow the shown swipe; `loading=lazy`.
- Proof: a seeded message with an attachment at 360px; a `shell-e2e` flow.

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

### M-5 Convo: 시각·날짜 구분선, '읽음' 정리 — step

- Day separators (오늘/어제/날짜) and a small time on the last bubble of a run (the Engine groups the same speaker
  within 5 minutes).
- '읽음' is not Engine data (always shown under my last message): remove it or show the sent time.

### M-7 Engine 원본을 고친 PR 4개 정리 — engine

PRs #35, #38, #41, #42 changed Engine files (`agent-resolution.ts`, `retry-agents-route.ts`, `generate.routes.ts`,
`translation.service.ts`, `chats.routes.ts`). The owner's Engine updates from upstream, so these never reach the
phone; Mari Kit features that rely on them do not work there.

- For each change: what it fixes, whether Mari Kit can do it itself (workaround), and the upstream issue text for the
  owner to file.
- Then put the Engine files back to upstream's text (PR with the `mari:engine-restore` label; labels can be added to PRs even with Issues off) and make sure the
  verify run still passes.
- Move the Mari Kit tests in `scripts/regressions/mari-kit-*` that do not need Engine source into
  `custom-modules/tests/`; the rest go with the upstream issue.

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

- Workflow: `WORKFLOW.md`, `AGENTS.override.md`, Engine guard, `verify.mjs` with the 360px screen tour, this list.
