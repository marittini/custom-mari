// Engine data the screens share, fetched once per load and refreshed on demand.

import { api, characterCard, parseJson } from "./api.js";

let chatsP = null;
let charsP = null;
let connsP = null;
let personasP = null;
let uiP = null;

export const data = {
  chats: (fresh) => (fresh || !chatsP ? (chatsP = api.get("/chats")) : chatsP),
  characters: (fresh) => (fresh || !charsP ? (charsP = api.get("/characters")) : charsP),
  connections: () => connsP || (connsP = api.get("/connections").catch(() => [])),
  personas: () => personasP || (personasP = api.get("/characters/personas/list").catch(() => [])),
  /** The Engine's own synced UI settings (quick replies live here). */
  engineUi: () =>
    uiP ||
    (uiP = api
      .get("/app-settings/ui")
      .then((res) => (res && typeof res.value === "object" && res.value) || localUi())
      .catch(() => localUi())),
  messages: (chatId, limit) =>
    api.get(`/chats/${encodeURIComponent(chatId)}/messages${limit ? `?limit=${limit}` : ""}`),
  chat: (chatId) => api.get(`/chats/${encodeURIComponent(chatId)}`),
};

function localUi() {
  try {
    const raw = JSON.parse(localStorage.getItem("marinara-engine-ui") || "{}");
    return raw.state || raw || {};
  } catch {
    return {};
  }
}

export function chatMeta(chat) {
  return parseJson(chat?.metadata, {}) || {};
}

export function byLastActivity(a, b) {
  return String(b.lastMessageAt || b.updatedAt || "").localeCompare(String(a.lastMessageAt || a.updatedAt || ""));
}

export function characterIndex(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const card = characterCard(row);
    map.set(row.id, { id: row.id, name: card.name || "이름 없음", card, avatar: row.avatarPath || null, row });
  }
  return map;
}

export function messageText(message) {
  const extra = parseJson(message?.extra, {}) || {};
  return typeof extra.displayText === "string" && extra.displayText
    ? extra.displayText
    : String(message?.content ?? "");
}

export function firstLetter(name) {
  const s = String(name || "").trim();
  return s ? Array.from(s)[0] : "·";
}

const pad = (n) => String(n).padStart(2, "0");

/** 14:20 today, 어제, else MM.DD. */
export function shortTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 86400000;
  if (diff === 0) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diff === 1) return "어제";
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

export function todayLabel() {
  const d = new Date();
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${"일월화수목금토"[d.getDay()]}요일`;
}

export function chatTitle(chat, chars) {
  if (chat?.name && chat.name.trim()) return chat.name.trim();
  const names = (chat?.characterIds || []).map((id) => chars.get(id)?.name).filter(Boolean);
  return names.join(", ") || "제목 없는 채팅";
}
