// The Engine's everyday slash commands, run from the shell's composer and from custom quick replies.
// Commands tied to Engine-only screens (games, scene, illustrate, selfie, …) answer with a short note.

import { api } from "./api.js";

const NARRATOR = (d) =>
  `[Narrator instruction — do not include a reply from {{user}}. Instead, write the next part of the narrative steering it toward the following: ${d.trim()}]`;

function rollDice(notation) {
  const m = /^(\d{0,3})d(\d{1,4})(?:kh(\d{1,3}))?([+-]\d{1,5})?$/i.exec(notation.replace(/\s+/g, ""));
  if (!m) return null;
  const count = Math.min(Number(m[1] || 1), 100);
  const sides = Number(m[2]);
  if (!count || sides < 2) return null;
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const keep = m[3] ? Math.min(Number(m[3]), count) : count;
  const kept = [...rolls].sort((a, b) => b - a).slice(0, keep);
  const mod = Number(m[4] || 0);
  return { rolls, kept, mod, total: kept.reduce((a, b) => a + b, 0) + mod };
}

/**
 * Runs `/name args`. ctx: { chatId, chat, messages, characters: [{id,name}], generate(body), reload() }.
 * Returns a note to show, or "" when handled quietly.
 */
export async function runSlash(text, ctx) {
  const m = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  const args = m[2].trim();
  const post = (body) => api.post(`/chats/${encodeURIComponent(ctx.chatId)}/messages`, body).then(() => ctx.reload());
  const last = [...ctx.messages].reverse().find((x) => x.role !== "system");
  switch (name) {
    case "guided":
    case "narrator":
    case "narrate":
    case "nar":
      if (!args) return "사용법: /guided <방향>";
      await ctx.generate({ generationGuide: NARRATOR(args), generationGuideSource: "narrator" });
      return "";
    case "continue":
    case "cont":
      if (last?.role === "assistant") await ctx.generate({ continueMessageId: last.id });
      else await ctx.generate({});
      return "";
    case "impersonate":
    case "imp":
      await ctx.generate({ impersonate: true, ...(args ? { userMessage: args } : {}) });
      return "";
    case "send":
      if (!args) return "사용법: /send <메시지>";
      await post({ role: "user", content: args.replace(/^"([\s\S]*)"$/, "$1"), characterId: null });
      return "";
    case "sys":
    case "system":
      if (!args) return "사용법: /sys <메시지>";
      await post({ role: "system", content: args });
      return "";
    case "as":
    case "respond": {
      const target = ctx.characters.find((c) => args.toLowerCase().startsWith(c.name.toLowerCase()));
      if (!target) return `캐릭터를 찾지 못했어요: ${args}`;
      const rest = args
        .slice(target.name.length)
        .trim()
        .replace(/^"([\s\S]*)"$/, "$1");
      if (rest) await post({ role: "assistant", characterId: target.id, content: rest });
      else await ctx.generate({ userMessage: `[Respond as ${target.name}]` });
      return "";
    }
    case "roll":
    case "r":
    case "dice": {
      const notation = args || "1d20";
      const r = rollDice(notation);
      if (!r) return `주사위 표기를 읽지 못했어요: ${notation}`;
      const detail = r.rolls.length > 1 ? ` [${r.rolls.join(", ")}]` : "";
      const mod = r.mod ? (r.mod > 0 ? `+${r.mod}` : `${r.mod}`) : "";
      await post({
        role: "narrator",
        content: `🎲 **${notation}** → **${r.total}**${detail}${mod}`,
        extra: { diceRollResult: { notation, rolls: r.rolls, modifier: r.mod, total: r.total } },
      });
      return "";
    }
    case "help":
      return "쓸 수 있는 명령: /guided /continue /impersonate /send /sys /as /roll";
    default:
      return `/${name}은 엔진 화면에서 써 주세요`;
  }
}
