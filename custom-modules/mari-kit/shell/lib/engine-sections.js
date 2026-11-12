// Every section of the Engine's Chat Settings, as the shell groups them. Data only, so check-engine-sections.mjs can
// compare it with the sections a running Engine shows (and report new or renamed ones after an Engine update).
//   [label, section ids without the mode prefix (the first is what the Engine opens), modes, shell view or null]
// A shell view of "" means the 자주 list; null means the row opens the Engine at that section.

const BOTH = ["conversation", "roleplay"];
export const ENGINE_SECTIONS = {
  채팅: [
    ["채팅 이름", ["chat-name"], BOTH, "name"],
    ["연결 · 프리셋 · 페르소나", ["connection", "prompt-preset", "conversation-prompt", "persona"], BOTH, ""],
    ["등장 캐릭터", ["characters"], BOTH, "cast"],
    ["번역", ["translation"], BOTH, "translation"],
    ["단체 대화", ["group-chat"], BOTH, null],
    ["로어북", ["lorebooks"], BOTH, "lorebooks"],
    ["채팅 변수", ["chat-variables"], BOTH, null],
    ["자율 메시지", ["autonomous-messaging"], ["conversation"], null],
    ["연결된 채팅", ["connected-chats"], BOTH, null],
    ["함수 호출", ["function-calling"], BOTH, null],
    ["고급 파라미터", ["advanced-parameters"], BOTH, null],
    ["사칭 (Impersonate)", ["impersonate"], ["roleplay"], null],
  ],
  컨텍스트: [
    ["작가 노트", ["author-notes"], ["roleplay"], "author"],
    ["채팅 요약", ["chat-summary"], ["roleplay"], null],
    ["활성 컨텍스트", ["active-context"], BOTH, null],
  ],
  기억: [
    ["기억 회상", ["memory-recall"], BOTH, null],
    ["자동 요약", ["automatic-summarization"], ["conversation"], null],
  ],
  기타: [
    ["Mari Kit · 음성 · 번역 · 기억", [], BOTH, "kit"],
    ["화면", [], BOTH, "view"],
    ["에이전트", ["agents"], BOTH, null],
    ["메시지 검색", ["message-search"], BOTH, null],
    ["채팅 분기", ["chat-branches"], BOTH, null],
    ["갤러리", ["gallery"], BOTH, null],
    ["에이전트 활동", ["agent-activity"], ["roleplay"], null],
    ["배경", ["background"], ["roleplay"], null],
  ],
};
