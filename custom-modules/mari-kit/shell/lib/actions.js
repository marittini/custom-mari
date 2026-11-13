// Message tools shared by the RP and Convo screens.

import { h } from "./h.js";
import { api } from "./api.js";
import { data, chatMeta, messageText } from "./data.js";
import { toast, sheet, openEngine } from "./ui.js";
import { translate, savedTranslation } from "./translate.js";

export const GUIDE = (text) =>
  `[Guided generation instruction — do not include a reply from {{user}}. Instead, write the next generated message steering it toward the following: ${text.trim()}]`;

/** Quick replies from the Engine's own synced settings: guide reply (when on) and the custom ones. */
/**
 * The Engine's quick-reply menu as the user set it up (설정 › 채팅 › 빠른 답장), in its order: post only, guide,
 * impersonate (Roleplay only), then the user's own replies. Each built-in one follows its switch; the whole menu
 * follows "빠른 답장 메뉴 보이기". Nothing is added that the Engine's menu does not have.
 */
export function quickReplies(ui, guideIcon, mode = "roleplay") {
  if (ui.showQuickRepliesMenu === false) return [];
  const list = [];
  if (ui.showQuickReplyPostOnly !== false)
    list.push({ id: "post", label: "답 없이 보내기", icon: ["M4 12l16-8-6 16-2-6z"] });
  if (ui.showQuickReplyGuide !== false) list.push({ id: "guide", label: "방향 지시", icon: guideIcon });
  if (mode === "roleplay" && ui.showQuickReplyImpersonate !== false)
    list.push({
      id: "impersonate",
      label: "대신 써 줘",
      icon: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21c1-4 4-6 8-6s7 2 8 6"],
    });
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

/**
 * The fixed quick-reply entries; returns false for the others. ctx: { chatId, input, grow, slash }.
 * 대신 써 줘 and 답 없이 보내기 use what is typed (impersonate also works with nothing typed).
 */
export function composerTool(q, { chatId, input, grow, slash }) {
  const text = input.value.trim();
  const take = () => ((input.value = ""), grow());
  if (q.id === "impersonate") (take(), slash(text ? `/impersonate ${text}` : "/impersonate"));
  else if (q.id === "post") {
    if (!text) toast("보낼 메시지를 먼저 적어 주세요");
    else (take(), slash(`/send ${text}`));
  } else return false;
  return true;
}

/** A slash command's note; one the shell cannot run opens the Engine's chat on a tap. */
export function slashNote(note, chatId) {
  if (!note) return;
  if (typeof note === "object" && note.engine) toast(note.text, () => openEngine(chatId, { composer: true }));
  else toast(note);
}

/** The Engine's "hide from AI" flag on a message (all characters, or some of them). */
export function hiddenFromAI(m) {
  let extra = m?.extra;
  try {
    if (typeof extra === "string") extra = JSON.parse(extra);
  } catch {}
  return (
    extra?.hiddenFromAI === true ||
    (Array.isArray(extra?.hiddenFromAICharacterIds) && extra.hiddenFromAICharacterIds.length > 0)
  );
}

/** A tool's label for this message (hide turns into show back). */
export const toolLabel = (t, m) => (t.id === "hide" && hiddenFromAI(m) ? "AI에게 다시 보이기" : t.label);

/** Last in every message menu: what the shell does not draw (reactions, replies, marks, prompt, thinking, …). */
export const ENGINE_TOOL = {
  id: "engine",
  label: "엔진에서 이 메시지 열기",
  icon: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
};

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
    } else if (id === "hide") {
      // Like the Engine: hide from every character, or show again (clears a per-character hide too).
      await api.patch(`${base}/extra`, { hiddenFromAI: !hiddenFromAI(message), hiddenFromAICharacterIds: [] });
      await reload();
    } else if (id === "engine") {
      openEngine(chatId, { message: message.id });
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
