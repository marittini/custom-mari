# Mari Kit work list

The shared to-do list for every AI working here (GitHub Issues are turned off in this repository). Rules are in
`WORKFLOW.md`, section 4. Each item has an id (`M-<n>`, never reused), a status and, while someone works on it, who
(`claude <session or branch>`, `codex <branch>`, …). Move an item to **Done** with its PR link when it is merged.

Status: `plan` waiting for the owner · `ready` agreed, nobody on it · `doing` someone on it (say who) · `blocked`
needs the owner, a real account or a phone.

## Doing

_(none)_

## Ready

### M-4 Convo: 이모지 반응, 답장 — step (plan §4, stage 1)

- Show reactions (`extra.reactions`, incl. the character's `[react]`) small on the bubble corner; per segment for
  grouped messages.
- Tap a bubble: 6 reactions + ＋ above the current toolbar; save with `PATCH /chats/:id/messages/:id/extra` in the
  Engine's format (a lone reaction can make the character answer: `recordUserReaction`).
- 답장 tool (`TOOL_DEFS`): quote above the composer, sent as `extra.replyTo`, quote shown on the sent bubble.

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

- M-3 Convo 캐릭터 일정 보기 (머리줄 상태, 상태 시트, 주간 일정, 목록 상태 점) — Mari Kit 0.18.0 (PR #48).
- M-7 Engine 원본 수정 4곳: 주인 결정으로 그대로 둠. 어떤 기능 때문에 어떤 파일을 고쳤는지는 `ENGINE-EDITS.md`,
  업스트림 이슈 초안은 `UPSTREAM.md`.
- M-1 Convo 바쁨·오프라인·입력 중 알림, M-2 셀카·영상·사진, M-5 시각·날짜 구분선 — Mari Kit 0.17.0 (PR #47).
- Workflow: `WORKFLOW.md`, `AGENTS.override.md`, Engine guard, `verify.mjs` with the 360px screen tour, this list.
- M-12 번역 단어장 찾기, 입출력별 지침 직접 편집·미리보기, 독립된 원본 복원 — Mari Kit 0.18.1 (PR #50).
