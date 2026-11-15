# Mari Kit work list

The shared to-do list for every AI working here (GitHub Issues are turned off in this repository). Rules are in
`WORKFLOW.md`, section 4. Each item has an id (`M-<n>`, never reused), a status and, while someone works on it, who
(`claude <session or branch>`, `codex <branch>`, …). Move an item to **Done** with its PR link when it is merged.

Status: `plan` waiting for the owner · `ready` agreed, nobody on it · `doing` someone on it (say who) · `blocked`
needs the owner, a real account or a phone.

## Doing

_(none)_

## Ready

## Plan (waiting for the owner)

_(none)_

## Blocked

_(none)_

## Done

- M-13 잘못 누르기 방지 · M-14 메뉴 정리 · M-15 통화 자막과 기록 — Mari Kit 0.24.0 (PR #54) and 0.26.0 (PR #55):
  ask / 멈추기 / 되돌리기 on AI and overwrite buttons, chat settings in groups with every-room switches in 설정, the
  call caption (the line being said large by default, 지난 대사까지 as a choice, unspaced Japanese wraps), ☺ while
  calling, call cards with the full record. The 360px tour now fails on text running off the screen.
- M-11 Convo 3단계 — Mari Kit 0.23.0 (PR #53): ☺ media panel (emoji, kaomoji, stickers), custom emojis and
  :name:, emoji selection, games through the Engine.
- M-6 Convo 2단계 — Mari Kit 0.20.0 (PR #51) and 0.22.0 (PR #52): pictures, @mentions, my status, coloured
  dots, schedule block editing, reaction removal, weather, scene invitations.
- M-4 Convo 이모지 반응·답장, M-8 화면 못 불러올 때 다시 시도, M-9 내 일정 페르소나 고르기, M-10 생성 중인 요청 화면
  — Mari Kit 0.19.0 (PR #49).
- M-3 Convo 캐릭터 일정 보기 (머리줄 상태, 상태 시트, 주간 일정, 목록 상태 점) — Mari Kit 0.18.0 (PR #48).
- M-7 Engine 원본 수정 4곳: 주인 결정으로 그대로 둠. 어떤 기능 때문에 어떤 파일을 고쳤는지는 `ENGINE-EDITS.md`,
  업스트림 이슈 초안은 `UPSTREAM.md`.
- M-1 Convo 바쁨·오프라인·입력 중 알림, M-2 셀카·영상·사진, M-5 시각·날짜 구분선 — Mari Kit 0.17.0 (PR #47).
- Workflow: `WORKFLOW.md`, `AGENTS.override.md`, Engine guard, `verify.mjs` with the 360px screen tour, this list.
- M-12 번역 단어장 찾기, 입출력별 지침 직접 편집·미리보기, 독립된 원본 복원 — Mari Kit 0.18.1 (PR #50).
