// The rule for buttons that cost an AI call or overwrite something (the owner's "no dark patterns"): ask first,
// saying what changes; show the work with 멈추기 (the request is cut, so the Engine drops it, and anything already
// written is put back); afterwards offer 되돌리기 for 10 seconds. One place, so every such button behaves alike.

import { api } from "./api.js";
import { ask, toast, undoToast } from "./ui.js";
import { startJob } from "./activity.js";

/**
 * confirm: the question (null = no question, for actions the user just chose on a screen made for them).
 * run(signal, stopped): does the work; snapshot(): what to put back (called before run), restore(snap).
 * done: the notice afterwards (text, or a function called when the work is done). chat: the room the work belongs to (default: the one in the address).
 * Resolves true when the work finished and was kept.
 */
export async function work({
  confirm = null,
  ok = "계속",
  danger = false,
  label,
  run,
  snapshot = null,
  restore = null,
  done,
  chat,
}) {
  if (confirm && !(await ask(confirm, { ok, danger }))) return false;
  let snap = null;
  try {
    snap = snapshot ? await snapshot() : null;
  } catch (error) {
    toast(`시작하지 못했어요: ${error.message}`);
    return false;
  }
  const controller = new AbortController();
  let stopped = false;
  const end = startJob(
    label,
    {
      label: "멈추기",
      fn: () => {
        stopped = true;
        controller.abort();
        end();
      },
    },
    chat === undefined ? undefined : { chat },
  );
  try {
    await run(controller.signal, () => stopped);
    if (stopped) throw new DOMException("stopped", "AbortError");
    const said = typeof done === "function" ? done() : done;
    if (restore && snap) undoToast(said, () => restore(snap));
    else if (said) toast(said);
    return true;
  } catch (error) {
    if (stopped || error?.name === "AbortError") {
      // Whatever the Engine wrote before the stop goes back (said only when there is something to put back).
      if (restore && snap) {
        const back = await restore(snap).then(
          () => true,
          () => false,
        );
        toast(back ? "멈췄어요 · 바뀐 것은 원래대로 돌려놨어요" : "멈췄어요 · 되돌리지 못한 부분이 있어요");
      } else toast("멈췄어요");
    } else toast(`하지 못했어요: ${error.message}`);
    return false;
  } finally {
    if (!stopped) end();
  }
}

const cardOf = async (id) => {
  const row = await api.get(`/characters/${encodeURIComponent(id)}`);
  const data = typeof row?.data === "string" ? JSON.parse(row.data) : row?.data || {};
  return data.extensions || {};
};
const metaOf = (chat) => {
  try {
    return typeof chat?.metadata === "string" ? JSON.parse(chat.metadata) : chat?.metadata || {};
  } catch {
    return {};
  }
};

/** What a character-schedule generation overwrites: each card's schedule and status, and the chat's copy. */
export async function scheduleSnapshot(chatId, ids) {
  const [chat, cards] = await Promise.all([
    chatId ? api.get(`/chats/${encodeURIComponent(chatId)}`) : null,
    Promise.all(ids.map(cardOf)),
  ]);
  const meta = metaOf(chat);
  return {
    chatId,
    cards: Object.fromEntries(
      ids.map((id, i) => [
        id,
        {
          conversationSchedule: cards[i].conversationSchedule ?? null,
          conversationStatus: cards[i].conversationStatus ?? null,
        },
      ]),
    ),
    meta: chat
      ? {
          characterSchedules: meta.characterSchedules ?? {},
          conversationSchedulesEnabled: meta.conversationSchedulesEnabled ?? null,
          scheduleWeekStart: meta.scheduleWeekStart ?? null,
        }
      : null,
  };
}

export async function scheduleRestore(snap) {
  const patch = (id, extensions) =>
    api.patch(`/characters/${encodeURIComponent(id)}`, { data: { extensions }, skipVersionSnapshot: true });
  for (const [id, ext] of Object.entries(snap.cards)) {
    // The card PATCH merges nested objects, so clear the new schedule first; the old one then comes back exactly.
    await patch(id, { conversationSchedule: null });
    await patch(id, ext);
  }
  if (snap.chatId && snap.meta) await api.patch(`/chats/${encodeURIComponent(snap.chatId)}/metadata`, snap.meta);
}

/**
 * Regenerate (or make) the week for these characters with the Engine's AI, by the rule above.
 * names: for the question; fresh: true when nobody has a schedule yet (nothing to lose, so no question).
 */
export function regenerateSchedules({ chatId, ids, names, timeZone, fresh = false }) {
  const who = names.length > 2 ? `${names.slice(0, 2).join(", ")} 외 ${names.length - 2}명` : names.join(", ");
  return work({
    confirm: fresh
      ? null
      : `${who}의 이번 주 일정을 AI로 다시 만들까요?\n지금 일정은 새것으로 바뀌어요. 손으로 고친 칸도 바뀌어요. AI 요청 ${ids.length}번.\n끝난 뒤 10초 안에는 되돌릴 수 있어요.`,
    ok: "다시 만들기",
    label: `${who} 일정 만드는 중…`,
    snapshot: () => scheduleSnapshot(chatId, ids),
    restore: scheduleRestore,
    run: async (signal) => {
      const res = await api.post(
        "/conversation/schedule/generate",
        { chatId, characterIds: ids, forceRefresh: true, ...(timeZone ? { timeZone } : {}) },
        signal,
      );
      const failed = Object.values(res?.results || {}).find((r) => String(r?.status || "").startsWith("error"));
      if (failed) throw new Error(String(failed.status).slice(6).trim() || "일정을 만들지 못했어요");
    },
    done: fresh ? "일정을 만들었어요" : "일정을 새로 만들었어요",
  });
}
