// How this chat's characters are offered custom emojis and stickers when there are more than the maximum (the
// Engine's per-chat customEmojiSelection, CustomEmojiSelectionSettings): by meaning (default), at random, or picked
// by an AI with a chosen connection; and how many at most (1–100, default 20). Saved in the chat's metadata.

import { h, setChildren } from "./h.js";
import { api } from "./api.js";
import { data, chatMeta, textConnections } from "./data.js";
import { sheet, toast } from "./ui.js";
import { groupsOf, splitByGroup, groupedOptions } from "./groups.js";

export const MODES = [
  ["semantic", "뜻에 맞게", "최근 대화와 가장 어울리는 걸 골라 보여 줘요 (로컬 임베더가 없으면 무작위)."],
  ["random", "무작위", "답할 때마다 무작위로 골라요."],
  [
    "tool-call",
    "AI가 고르기",
    "답할 때마다 AI가 어울리는 걸 골라요. 아래 모델을 정해 주세요. 없거나 실패하면 '뜻에 맞게'로 해요.",
  ],
];

/** The Engine's normalizeCustomEmojiSelection. */
export function selectionOf(meta) {
  const raw =
    meta?.customEmojiSelection && typeof meta.customEmojiSelection === "object" ? meta.customEmojiSelection : {};
  const n = Math.floor(Number(raw.maxCount));
  return {
    mode: MODES.some(([m]) => m === raw.mode) ? raw.mode : "semantic",
    maxCount: Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 20,
    toolConnectionId: typeof raw.toolConnectionId === "string" && raw.toolConnectionId ? raw.toolConnectionId : null,
  };
}
export const selectionLabel = (meta) => {
  const s = selectionOf(meta);
  return `${MODES.find(([m]) => m === s.mode)[1]} · 최대 ${s.maxCount}개`;
};

/** The sheet; resolves after it closes (saved or not). chat: the chat; changed(): reload after a save. */
export function emojiSelectionSheet(chat, changed) {
  return new Promise(async (resolve) => {
    let prefs = selectionOf(chatMeta(chat));
    const [conns, folders] = await Promise.all([data.connections(), groupsOf("connections")]);
    const box = h("div", { class: "psheet pad" });
    const s = sheet(box, { label: "캐릭터 이모지 고르는 방식", onClose: resolve });
    const save = async (patch) => {
      prefs = selectionOf({ customEmojiSelection: { ...prefs, ...patch } });
      paint();
      try {
        await api.patch(`/chats/${encodeURIComponent(chat.id)}/metadata`, { customEmojiSelection: prefs });
        await changed?.();
      } catch (error) {
        toast(`저장하지 못했어요: ${error.message}`);
      }
    };
    const count = h("input", {
      class: "inp",
      type: "number",
      inputmode: "numeric",
      min: 1,
      max: 100,
      "aria-label": "한 번에 보여 줄 최대 개수",
      style: { width: "88px", textAlign: "center" },
      onChange: (e) => save({ maxCount: e.target.value }),
    });
    function paint() {
      count.value = prefs.maxCount;
      const mode = MODES.find(([m]) => m === prefs.mode);
      setChildren(
        box,
        h("b", { class: "psheet-title" }, "캐릭터 이모지·스티커 고르는 방식"),
        h(
          "p",
          { class: "hint", style: { margin: "0" } },
          "캐릭터의 내 이모지·스티커가 최대 개수보다 많을 때, 모델에게 어떤 걸 보여 줄지 정해요.",
        ),
        h(
          "div",
          { class: "chips", role: "radiogroup", "aria-label": "고르는 방식" },
          MODES.map(([m, label]) =>
            h(
              "button",
              {
                type: "button",
                class: m === prefs.mode ? "chip on" : "chip",
                role: "radio",
                "aria-checked": m === prefs.mode ? "true" : "false",
                onClick: () => save({ mode: m }),
              },
              label,
            ),
          ),
        ),
        h("p", { class: "hint", style: { margin: "0" } }, mode[2]),
        prefs.mode === "tool-call"
          ? h(
              "label",
              { class: "scn-row" },
              h("span", { class: "label" }, "고르는 모델"),
              h(
                "select",
                {
                  class: "sel",
                  "aria-label": "고르는 모델",
                  onChange: (e) => save({ toolConnectionId: e.target.value || null }),
                },
                groupedOptions(
                  h,
                  prefs.toolConnectionId || "",
                  [["", "정하지 않음 ('뜻에 맞게'로 해요)"]],
                  splitByGroup(textConnections(conns), folders, { folderOf: (c) => c.folderId }),
                  (c) => [c.id, c.name],
                ),
              ),
            )
          : null,
        h(
          "div",
          { class: "r two static", style: { padding: "0" } },
          h("span", null, "한 번에 보여 줄 최대 개수"),
          count,
        ),
        h(
          "button",
          { type: "button", class: "pill main", style: { minHeight: "48px" }, onClick: () => s.close() },
          "닫기",
        ),
      );
    }
    paint();
  });
}
