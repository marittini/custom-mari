# Mari Kit work list

The shared to-do list for every AI working here (GitHub Issues are turned off in this repository). Rules are in
`WORKFLOW.md`, section 4. Each item has an id (`M-<n>`, never reused), a status and, while someone works on it, who
(`claude <session or branch>`, `codex <branch>`, …). Move an item to **Done** with its PR link when it is merged.

Status: `plan` waiting for the owner · `ready` agreed, nobody on it · `doing` someone on it (say who) · `blocked`
needs the owner, a real account or a phone.

## Doing

### M-6 Convo 2단계 — claude ccr-b4485093-p6ybfu

Agreed with mockups: https://claude.ai/artifact/NxUBMQxF6BBgG8xbpByJXh. Three releases:

- 0.20.0 (doing): send pictures (WebP made in the browser), @mentions (`mentionedCharacterNames`), my own status
  and activity (synced to the Engine's `userStatusManual` / `userActivity`), status dots in colour (the owner asked;
  the one exception to monotone).
- 0.21.0: edit schedule blocks in Mari (add, delete, copy a day), remove a character's reaction (long-press).
- 0.22.0: scene invitations (`extra.sceneRequest`, the Engine's scene plan/create flow, banner, replies-here switch),
  weather (Mari Kit's weather routes).

## Ready

## Plan (waiting for the owner)

### M-11 Convo 3단계 — plan §4, stage 3

Emoji/kaomoji tab and GIFs, mini-games when their packages are installed (link to the Engine first), voice input.

## Blocked

_(none)_

## Done

- M-4 Convo 이모지 반응·답장, M-8 화면 못 불러올 때 다시 시도, M-9 내 일정 페르소나 고르기, M-10 생성 중인 요청 화면
  — Mari Kit 0.19.0 (PR #49).
- M-3 Convo 캐릭터 일정 보기 (머리줄 상태, 상태 시트, 주간 일정, 목록 상태 점) — Mari Kit 0.18.0 (PR #48).
- M-7 Engine 원본 수정 4곳: 주인 결정으로 그대로 둠. 어떤 기능 때문에 어떤 파일을 고쳤는지는 `ENGINE-EDITS.md`,
  업스트림 이슈 초안은 `UPSTREAM.md`.
- M-1 Convo 바쁨·오프라인·입력 중 알림, M-2 셀카·영상·사진, M-5 시각·날짜 구분선 — Mari Kit 0.17.0 (PR #47).
- Workflow: `WORKFLOW.md`, `AGENTS.override.md`, Engine guard, `verify.mjs` with the 360px screen tour, this list.
- M-12 번역 단어장 찾기, 입출력별 지침 직접 편집·미리보기, 독립된 원본 복원 — Mari Kit 0.18.1 (PR #50).
