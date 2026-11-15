// Convo mini-games: the Engine's turn-game packages (UNO, chess, …), installed separately. Their boards are drawn by
// the package inside the Engine, so Mari lists the installed ones (/games, the ☺ panel's 게임 tab), sends a pick to
// the Engine at this chat with the game's command already typed (one tap on send opens its setup), and shows a strip
// when the chat has a game board. Nothing is asked of the server when no game is installed.

import { api } from "./api.js";

let installedP = null;

/** Installed, active turn games: [{ id, name, command, aliases, playerLabel }] (read once per visit). */
export function turnGames() {
  installedP ||= api
    .get("/capability-packages/installed")
    .then((rows) => gamesOf(rows))
    .catch(() => ((installedP = null), []));
  return installedP;
}

/** The Engine's selectConversationTurnGamePackages plus its conversationGame contribution. Pure. */
export function gamesOf(rows) {
  const list = Array.isArray(rows) ? rows : Array.isArray(rows?.items) ? rows.items : [];
  return list
    .filter(
      (p) => p?.status === "active" && p.manifest?.kind?.includes?.("turn-game") && p.manifest?.entrypoints?.client,
    )
    .map((p) => {
      const g = p.manifest.contributions?.conversationGame || {};
      const command = typeof g.command === "string" && g.command.startsWith("/") ? g.command : null;
      return {
        id: p.id,
        name: p.manifest.name || p.id,
        command,
        aliases: (Array.isArray(g.aliases) ? g.aliases : []).filter((a) => typeof a === "string"),
        playerLabel: typeof g.playerLabel === "string" ? g.playerLabel : "",
      };
    })
    .filter((g) => g.command);
}

/** The game a typed "/uno" (or an alias) names, or null. */
export function gameForCommand(text, games) {
  const word = String(text || "")
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();
  if (!word.startsWith("/")) return null;
  return (
    games.find(
      (g) =>
        g.command.toLowerCase() === word || g.aliases.some((a) => `/${a.replace(/^\//, "")}`.toLowerCase() === word),
    ) || null
  );
}

/** True when the chat has a game board (GET /turn-games/:chatId/state answers; 404 means none). */
export async function hasGameBoard(chatId) {
  try {
    const res = await api.get(`/turn-games/${encodeURIComponent(chatId)}/state`);
    return !!res?.view;
  } catch {
    return false;
  }
}
