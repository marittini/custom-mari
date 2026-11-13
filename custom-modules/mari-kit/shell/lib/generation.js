// Server generations outlive a page. Recover their state instead of treating a new viewer as a new run.
import { api } from "./api.js";

export const generationStatus = (chatId) => api.get(`/generate/status/${encodeURIComponent(chatId)}`);
export const stopGeneration = (chatId) => api.post("/generate/abort", { chatId });

export function watchGeneration(chatId, { isAttached = () => false, onState, onSettled, onError } = {}) {
  let disposed = false;
  let pending = false;
  let checking = null;
  let timer = null;
  const check = () => {
    clearTimeout(timer);
    if (disposed || document.hidden || isAttached()) return Promise.resolve();
    if (checking) return checking;
    checking = (async () => {
      try {
        const state = await generationStatus(chatId);
        if (disposed || isAttached()) return;
        const wasPending = pending;
        pending = state?.active === true || state?.translating === true;
        onState?.(state);
        if (wasPending && !pending) await onSettled?.();
      } catch (error) {
        if (!disposed) onError?.(error);
      } finally {
        checking = null;
        if (!disposed && !document.hidden && pending) timer = setTimeout(check, 1500);
      }
    })();
    return checking;
  };
  const visible = () => {
    clearTimeout(timer);
    if (!document.hidden) check();
  };
  document.addEventListener("visibilitychange", visible);
  queueMicrotask(check);
  return {
    check,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    },
  };
}
