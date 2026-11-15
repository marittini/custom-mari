// "‹ 2 / 3 ›" under a reply: the other replies to the same turn (the Engine's swipes). A new reply is its own
// labelled button ("＋ 새 답"), never the same arrow as "다음 답", so moving between answers never starts a
// generation by mistake (the old answers stay either way). Buttons are full 44px touch targets.

import { h, icon, I } from "./h.js";
import { api } from "./api.js";
import { toast } from "./ui.js";

export function swipeNav({ chatId, message: m, reload, regenerate, busy = false }) {
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
    last && regenerate
      ? h(
          "button",
          {
            type: "button",
            class: "sw-new",
            "aria-label": "새 답 만들기",
            disabled: busy,
            onClick: (e) => {
              e.stopPropagation();
              regenerate();
            },
          },
          "＋ 새 답",
        )
      : null,
  );
}
