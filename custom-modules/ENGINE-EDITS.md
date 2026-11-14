# 엔진 원본 수정 기록

규칙상 엔진 원본(`custom-modules/` 바깥)은 고치지 않아요(`WORKFLOW.md` 1절). 아래 4곳은 예외로, 다른 AI가 Mari Kit
0.16.x 작업 중에 고친 것을 **주인이 그대로 두기로 정한** 것이에요(2026-11-14). 나중에 엔진을 손보거나 업스트림을
받을 때 이 표를 보고 판단해요.

주의할 점

- 주인의 실제 엔진은 업스트림(Pasta-Devs/Marinara-Engine)에서 바로 업데이트돼요. 이 저장소의 엔진 수정은 휴대폰
  엔진에는 들어가지 않아요. 이 저장소의 테스트 엔진에서만 효과가 있어요. 휴대폰에서 같은 문제가 보이면 이 표의
  "없을 때" 칸이 원인일 수 있어요.
- `Mari Engine guard`는 이 파일들을 다시 고치는 PR을 막아요. 꼭 고쳐야 하면 주인에게 먼저 묻고, 되돌리는 PR이면
  `mari:engine-restore` 라벨을 붙여요.
- 업스트림에 낼 이슈 초안은 `UPSTREAM.md`에 있어요(주인이 원할 때 제출).

| PR · 커밋         | 고친 엔진 파일                                                                                                             | 어떤 기능 때문에                                                | 무엇을 바꿨나                                                                  | 없을 때(업스트림 그대로)                                                                         | 함께 넣은 테스트                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| #35 · `f6013ae3a` | `packages/server/src/services/generation/agent-resolution.ts`, `packages/server/src/routes/generate/retry-agents-route.ts` | Mari Kit 에이전트(`agents.json`의 `execution: "feature"`)       | 기능형 에이전트를 LLM 에이전트 파이프라인과 "실패한 에이전트 다시 시도"에서 뺌 | 채팅에 Mari Kit 에이전트를 켜면 빈 에이전트 호출이 한 번 더 생기거나 다시 시도 목록에 뜰 수 있음 | `scripts/regressions/feature-agent-routing.regression.ts`       |
| #38 · `0fa9d7624` | `packages/server/src/services/translation.service.ts`                                                                      | RP 음성(TTS): `<audio_character>` 태그와 `[감정]` 지시          | 번역 전에 태그·지시를 자리표시로 바꿨다가 되돌림, 깨지면 422로 실패            | 번역(직접·자동)이 태그나 감정 지시를 바꾸거나 지워서 화자별 음성이 어긋날 수 있음                | `scripts/regressions/translation-voice-markup.regression.ts`    |
| #41 · `e5fa0ce4a` | `packages/server/src/routes/generate.routes.ts`                                                                            | 생성 복구(`shell/lib/generation.js`, 생성 요청 관리 화면)       | 생성 준비 중 실패하면 "생성 중" 기록을 지움(자기 것만)                         | 실패 뒤에도 그 채팅이 계속 "생성 중"으로 보이고 새 생성이 막힐 수 있음. 멈추기로 풀어야 함       | `scripts/regressions/generation-registry-cleanup.regression.ts` |
| #42 · `51b3cbd01` | `packages/server/src/routes/chats.routes.ts`                                                                               | 데이터 절약: Mari가 메시지를 `?includePromptCache=false`로 읽음 | 그 옵션이면 메시지 목록에서 `extra.cachedPrompt`(긴 프롬프트 기록)를 뺌        | 옵션이 무시되어 메시지 목록이 무거워짐(긴 채팅일수록). 기능은 그대로                             | `scripts/regressions/shell-message-prompt-cache.regression.ts`  |

같은 PR들이 `scripts/regressions/`에 넣은 Mari Kit 테스트(`mari-kit-*`)는 `verify.mjs --all`이 그대로 돌려요.
