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

- Lighter screens and full sheet checks — Mari Kit 0.29.0 (PR #58): Convo 1:1 opens with 89.9KB (was 122.3KB;
  the emoji list and call code load only when needed), 설정 43.8KB (was 51.2KB); `verify.mjs --crawl` presses every
  safe button on every toured screen (179 on 26, no layout faults); the hang-up guide checked against the real
  Calls package (reaches calls only, [end_call] comes back as a command turn).
- Owner round of 13 + memory — Mari Kit 0.27.0 (PR #56) and 0.28.0 (PR #57): memory work per room, 묶음 from 1,
  최근 제외 hides organized messages, one organize flow; squeezed text, invisible ▶, reactions over translations
  fixed; 새 답 and 지금 답하게 removed; voice 다시 만들기; 선톡 marks without reload; weather draws at once; the
  composer's ＋ menu, any-emoji reactions, Korean call lines with 통화 종료, characters hang up by themselves
  (call-only lorebook guide), highlighter in the speaker's 대사 색. Checks: verify starts from the last pass, picks
  flows by coverage, runs the old regressions a change reaches; layout faults fail every flow; screen rules in
  WORKFLOW.md section 8.
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
