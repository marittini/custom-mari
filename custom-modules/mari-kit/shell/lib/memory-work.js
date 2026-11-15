// 기억 정리, the one flow behind every button that starts it (RP's memory button, 기억 서재 › 정리): ask first (it
// costs AI calls), show it in this room's activity strip with 멈추기, organize chunk after chunk until nothing is
// waiting, then say how many model calls it took. 기억 서재 keeps "방금 정리한 묶음을 취소" for undoing.

import { api } from "./api.js";
import { work } from "./work.js";

export const MAX_ROUNDS = 20;

/** waiting: messages not organized yet (status.waitingMessages). onStatus(status) after each chunk. */
export async function organizeMemory(chatId, { waiting = 0, onStatus = null } = {}) {
  const enc = encodeURIComponent(chatId);
  let calls = 0;
  return work({
    chat: chatId,
    confirm: `기억에 아직 안 들어간 메시지 ${waiting}개를 정리할까요?\nAI가 요약을 만들어 기억 서재에 넣어요. AI 요청 여러 번(최대 ${MAX_ROUNDS}번).\n정리한 뒤에는 기억 서재에서 되돌릴 수 있어요.`,
    ok: "정리하기",
    label: "기억 정리 중…",
    run: async (signal, stopped) => {
      for (let i = 0; i < MAX_ROUNDS && !stopped(); i += 1) {
        const res = await api.post(`/mari-kit/memory/${enc}/organize`, { force: true }, signal);
        calls += res?.calls || 0;
        onStatus?.(res?.status);
        if (!res?.organized || !res?.status?.waitingMessages) break;
      }
    },
    done: () => (calls ? `기억을 정리했어요 (모델 호출 ${calls}번)` : "정리할 메시지가 없어요"),
  });
}
