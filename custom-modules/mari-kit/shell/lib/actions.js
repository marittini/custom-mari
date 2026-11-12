// Message tools shared by the RP and Convo screens.

import { h } from "./h.js";
import { api } from "./api.js";
import { data, chatMeta, messageText } from "./data.js";
import { toast, sheet } from "./ui.js";
import { translate, savedTranslation } from "./translate.js";

export const GUIDE = (text) =>
  `[Guided generation instruction — do not include a reply from {{user}}. Instead, write the next generated message steering it toward the following: ${text.trim()}]`;

/** Quick replies from the Engine's own synced settings: guide reply (when on) and the custom ones. */
export function quickReplies(ui, guideIcon) {
  const list = [];
  if (ui.showQuickReplyGuide !== false) list.push({ id: "guide", label: "방향 지시", icon: guideIcon });
  for (const entry of Array.isArray(ui.customQuickReplies) ? ui.customQuickReplies : []) {
    const content = String(entry?.content || "").trim();
    if (!content) continue;
    list.push({
      id: `custom-${entry.id}`,
      label: String(entry.label || "").trim() || content.slice(0, 24),
      emoji: String(entry.icon || "").trim() || "✨",
      content,
    });
  }
  return list;
}

export async function runTool(id, { chatId, chat, message, reload, generate, go, speak }) {
  const text = messageText(message);
  const base = `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(message.id)}`;
  try {
    if (id === "copy") {
      await navigator.clipboard.writeText(text);
      toast("복사했어요");
    } else if (id === "regen") {
      generate({ regenerateMessageId: message.id });
    } else if (id === "voice") {
      await speak?.(message);
    } else if (id === "translate") {
      // Like the Engine: translate, or hide a translation that is already showing.
      if (savedTranslation(message)) {
        await api.patch(`${base}/extra`, { translationHidden: true });
      } else {
        const translation = await translate(text, "output", chatMeta(chat), chatId);
        await api.patch(`${base}/extra`, { translation, translationSource: message.content, translationHidden: false });
      }
      await reload();
    } else if (id === "edit") {
      editMessage(message, base, reload);
    } else if (id === "branch") {
      const created = await api.post(`/chats/${encodeURIComponent(chatId)}/branch`, { upToMessageId: message.id });
      data.chats(true);
      if (created?.id) go(`${chat.mode === "conversation" ? "convo" : "rp"}/${encodeURIComponent(created.id)}`);
    } else if (id === "del") {
      if (!confirm("이 메시지를 지울까요?")) return;
      await api.delete(base);
      await reload();
    }
  } catch (error) {
    toast(error.message);
  }
}

function editMessage(message, base, reload) {
  const area = h("textarea", {
    class: "inp",
    rows: 10,
    style: { resize: "vertical", fontSize: "15px", lineHeight: "1.6" },
  });
  area.value = String(message.content ?? "");
  const s = sheet(
    h(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "12px", padding: "8px 20px 24px", overflowY: "auto" } },
      h("b", { style: { fontSize: "15px" } }, "메시지 편집"),
      area,
      h(
        "div",
        { style: { display: "flex", justifyContent: "flex-end", gap: "8px" } },
        h("button", { type: "button", class: "pill", onClick: () => s.close() }, "취소"),
        h(
          "button",
          {
            type: "button",
            class: "pill main",
            onClick: async () => {
              try {
                await api.patch(base, { content: area.value });
                s.close();
                await reload();
              } catch (error) {
                toast(error.message);
              }
            },
          },
          "저장",
        ),
      ),
    ),
    { label: "메시지 편집" },
  );
}

/** Runs one /generate stream; onToken gets the text so far, onSaved each saved message. */
export async function streamGenerate({ chatId, body, signal, onToken, onSaved }) {
  let text = "";
  for await (const event of api.stream(
    "/generate",
    {
      chatId,
      connectionId: null,
      streaming: true,
      userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      ...body,
    },
    signal,
  )) {
    if (event.type === "token" && typeof event.data === "string") {
      text += event.data;
      onToken?.(text);
    } else if (event.type === "message_saved") {
      onSaved?.(event.data);
      if (event.data?.role === "assistant") text = "";
    } else if (event.type === "error" && !body?.autonomous) {
      // A character's own (autonomous) message failing is not the user's error to see.
      toast(typeof event.data === "string" ? event.data : event.data?.message || "생성하지 못했어요");
    }
  }
}
