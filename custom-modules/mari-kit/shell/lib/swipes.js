// "‹ 2 / 3 ›" under a reply: the other replies to the same turn (the Engine's swipes). Moving between them never
// starts a generation; a new reply is 다시 생성 in the message tools. Buttons are full 44px touch targets.

import { h, icon, I } from "./h.js";
import { api } from "./api.js";
import { toast } from "./ui.js";

export function swipeNav({ chatId, message: m, reload, busy = false }) {
  const i = m.activeSwipeIndex ?? 0;
  const n = m.swipeCount || 1;
  const set = async (to) => {
    try {
      await api.put(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(m.id)}/active-swipe`, {
        index: to,
      });
      await reload();
    } catch (error) {
      toast(error.message);
    }
  };
  const last = i >= n - 1;
  const btn = (label, path, disabled, fn) =>
    h(
      "button",
      {
        type: "button",
        class: "sw-nav",
        "aria-label": label,
        disabled,
        onClick: (e) => {
          e.stopPropagation();
          fn();
        },
      },
      icon(path, 14, 1.8),
    );
  return h(
    "div",
    { class: "sw-row" },
    btn("이전 답", I.back, i <= 0 || busy, () => set(i - 1)),
    h("span", { class: "sw-count" }, `${i + 1} / ${n}`),
    btn("다음 답", "M9 5l7 7-7 7", last || busy, () => set(i + 1)),
  );
}
