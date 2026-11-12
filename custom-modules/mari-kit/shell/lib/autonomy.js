// Conversation autonomy for the Mari shell. Mirrors packages/client/src/hooks/use-autonomous-messaging.ts
// and use-background-autonomous.ts of Marinara Engine 2.5.2: the Engine drives this from its web client,
// not its server, so the shell has to reproduce it. Data-saving rule: no request is ever made while
// document.visibilityState !== "visible"; a hidden tick only reschedules.

import { api } from "./api.js";

const visible = () => document.visibilityState === "visible";
const quiet = (p) => Promise.resolve(p).catch(() => null);
const clearInProgress = (chatId, startedAt) =>
  typeof startedAt === "number"
    ? quiet(api.post("/conversation/autonomous/clear-in-progress", { chatId, startedAt }))
    : null;

// The open Convo chat: poll, optional busy delay, then optional character-to-character exchanges.
export function activeAutonomy({ chatId, meta, userStatus, isBusy, generate }) {
  let stopped = false;
  let running = false; // an own autonomous generation is in flight
  let pollTimer = null;
  let delayTimer = null;
  let pending = null; // generationStartedAt waiting out a busy delay

  const schedule = (ms = 30_000) => {
    clearTimeout(pollTimer);
    if (!stopped) pollTimer = setTimeout(tick, ms);
  };

  // Returns true when a follow-up exchange took over scheduling.
  async function trigger(characterId, intentKey, skipPresenceDelay) {
    running = true;
    let produced = false;
    try {
      produced = !!(await generate({
        forCharacterId: characterId,
        autonomous: true,
        autonomousIntentKey: intentKey,
        skipPresenceDelay,
      }));
    } catch {
      produced = false;
    }
    // The server records success itself; only a miss needs reporting.
    if (!produced) await quiet(api.post("/conversation/activity/assistant", { chatId }));
    running = false;
    if (stopped || !produced || meta()?.characterExchanges !== true) return false;
    try {
      const ex = await api.post("/conversation/autonomous/exchange", { chatId, lastSpeakerCharId: characterId });
      const next = ex?.characterIds?.[0];
      if (!ex?.shouldTrigger || !next) return false;
      pending = typeof ex.generationStartedAt === "number" ? ex.generationStartedAt : null;
      delayTimer = setTimeout(
        async () => {
          delayTimer = null;
          pending = null;
          if (stopped || userStatus() === "dnd" || isBusy()) {
            await clearInProgress(chatId, ex.generationStartedAt);
            return schedule();
          }
          if (!(await trigger(next, undefined, false))) schedule();
        },
        2000 + Math.random() * 3000,
      );
      return true;
    } catch {
      return false;
    }
  }

  async function tick() {
    if (stopped || !visible() || meta()?.autonomousMessages !== true || isBusy() || running) return schedule();
    try {
      if (userStatus() === "dnd") {
        await api.post("/conversation/activity/presence", { chatId, userStatus: "dnd" });
        return schedule();
      }
      const check = await api.post("/conversation/autonomous/check", { chatId, userStatus: userStatus() });
      const characterId = check?.characterIds?.[0];
      if (!check?.shouldTrigger || !characterId) return schedule();
      const { delayMs } = (await api.post("/conversation/busy-delay", { chatId, characterId })) || {};
      if (delayMs > 0) {
        pending = check.generationStartedAt;
        delayTimer = setTimeout(async () => {
          delayTimer = null;
          const startedAt = pending;
          pending = null;
          if (stopped || userStatus() === "dnd" || isBusy()) {
            await clearInProgress(chatId, startedAt);
            return schedule();
          }
          if (!(await trigger(characterId, check.autonomousIntentKey, true))) schedule();
        }, delayMs);
        return;
      }
      if (!(await trigger(characterId, check.autonomousIntentKey, false))) schedule();
    } catch {
      schedule(); // best effort: a failed request must not end the poll
    }
  }

  schedule(10_000);

  return {
    stop() {
      stopped = true;
      clearTimeout(pollTimer);
      clearTimeout(delayTimer);
      delayTimer = null;
      if (pending !== null) clearInProgress(chatId, pending);
      pending = null;
    },
    // Call after the user sends a message.
    userSent() {
      return Promise.allSettled([
        api.post("/conversation/activity/user", { chatId, preserveGenerationInProgress: isBusy() }),
        api.post("/conversation/activity/presence", { chatId, userStatus: userStatus() }),
      ]);
    },
  };
}

function parseMeta(chat) {
  if (chat?.metadata && typeof chat.metadata === "object") return chat.metadata;
  try {
    return JSON.parse(chat?.metadata) || {};
  } catch {
    return {};
  }
}

// Convo chats the user is not looking at; runs app-wide.
export function backgroundAutonomy({ activeChatId, userStatus, generate, onArrived }) {
  let stopped = false;
  let timer = null;
  let noCandidatesRoute = false; // older servers lack /chats/autonomous-candidates
  const inFlight = new Set();
  const timers = new Map(); // chatId -> delay timer
  const pending = new Map(); // chatId -> generationStartedAt waiting out a delay

  const schedule = (ms = 30_000) => {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(tick, ms);
  };

  async function candidates() {
    if (!noCandidatesRoute) {
      try {
        return (await api.get("/chats/autonomous-candidates")) || [];
      } catch (err) {
        if (err?.status !== 404) throw err;
        noCandidatesRoute = true;
      }
    }
    const chats = (await api.get("/chats")) || [];
    return chats.filter((c) => {
      const m = parseMeta(c);
      return (
        c.mode === "conversation" &&
        c.internalAssistant !== "professor-mari" &&
        !m.multiplayer &&
        !m.multiplayerSetup &&
        m.autonomousMessages === true
      );
    });
  }

  async function run(chatId, characterId, check) {
    const startedAt = check.generationStartedAt;
    try {
      if (stopped || userStatus() === "dnd" || activeChatId() === chatId)
        return await clearInProgress(chatId, startedAt);
      const result = await generate(chatId, {
        forCharacterId: characterId,
        autonomous: true,
        autonomousIntentKey: check.autonomousIntentKey,
        skipPresenceDelay: true,
      });
      if (result?.produced) {
        const chat = await api.post(`/chats/${encodeURIComponent(chatId)}/autonomous-unread`, { characterId });
        onArrived(chat);
      } else {
        await clearInProgress(chatId, startedAt);
      }
    } catch {
      // best effort
    } finally {
      inFlight.delete(chatId);
    }
  }

  async function tick() {
    if (stopped || !visible()) return schedule();
    try {
      const open = activeChatId();
      const all = await candidates();
      // No chat lets its characters write first: look again only every 5 minutes (data saving).
      if (!all.length) return schedule(300_000);
      const list = all.filter((c) => c.id !== open && !inFlight.has(c.id));
      if (userStatus() === "dnd") {
        for (const c of list)
          await quiet(api.post("/conversation/activity/presence", { chatId: c.id, userStatus: "dnd" }));
        return schedule();
      }
      for (const { id: chatId } of list) {
        if (stopped) break;
        try {
          const check = await api.post("/conversation/autonomous/check", { chatId, userStatus: userStatus() });
          const characterId = check?.characterIds?.[0];
          if (!check?.shouldTrigger || !characterId) continue;
          inFlight.add(chatId);
          const { delayMs } = (await api.post("/conversation/busy-delay", { chatId, characterId })) || {};
          if (delayMs > 0) {
            pending.set(chatId, check.generationStartedAt);
            timers.set(
              chatId,
              setTimeout(() => {
                timers.delete(chatId);
                pending.delete(chatId);
                run(chatId, characterId, check);
              }, delayMs),
            );
          } else {
            run(chatId, characterId, check); // not awaited: other chats must not wait on it
          }
        } catch {
          inFlight.delete(chatId);
        }
      }
    } catch {
      // best effort
    }
    schedule();
  }

  schedule(20_000);

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const [chatId, startedAt] of pending) clearInProgress(chatId, startedAt);
      pending.clear();
    },
  };
}

export function clearUnread(chatId) {
  return quiet(api.delete(`/chats/${encodeURIComponent(chatId)}/autonomous-unread`));
}
