// Engine data the screens share, fetched once per load and refreshed on demand.

import { api, characterCard, parseJson } from "./api.js";

let chatsP = null;
let charsP = null;
const cards = new Map();
let connsP = null;
let personasP = null;
let uiP = null;

export const data = {
  chats: (fresh) => (fresh || !chatsP ? (chatsP = api.get("/chats")) : chatsP),
  /** Names, avatars and readings of every character: Mari Kit's slim list plus the Engine's avatar summaries. */
  characters: (fresh) => {
    if (fresh || !charsP) {
      cards.clear();
      charsP = api.get("/mari-kit/shell/characters").then(async (rows) => {
        const list = Array.isArray(rows) ? rows : [];
        const sums = list.length
          ? await api.post("/characters/summaries", { ids: list.map((c) => c.id) }).catch(() => [])
          : [];
        // The avatar URL carries the Engine's crop (?crop=…), so every thumbnail shows the cropped picture.
        const avatars = new Map(
          (Array.isArray(sums) ? sums : []).map((s) => [s.id, withCrop(s.avatarUrl || null, s.avatarCrop)]),
        );
        return list.map((c) => ({ ...c, avatarPath: avatars.get(c.id) || null }));
      });
      charsP.catch(() => (charsP = null));
    }
    return charsP;
  },
  /** One character's full card, read when a screen needs its text (profile, greetings, a card edit). */
  character: (id) => {
    if (!cards.has(id)) {
      const p = api.get(`/characters/${encodeURIComponent(id)}`);
      p.catch(() => cards.delete(id));
      cards.set(id, p);
    }
    return cards.get(id);
  },
  connections: () => connsP || (connsP = api.get("/connections").catch(() => [])),
  /** Personas with the Engine's avatar crop on their avatar URL (like characters). */
  personas: () =>
    personasP ||
    (personasP = api
      .get("/characters/personas/list")
      .then((list) =>
        (Array.isArray(list) ? list : []).map((p) => ({
          ...p,
          avatarPath: withCrop(p.avatarPath || null, p.avatarCrop),
        })),
      )
      .catch(() => [])),
  /** The Engine's own synced UI settings (quick replies live here). */
  engineUi: () =>
    uiP ||
    (uiP = api
      .get("/app-settings/ui")
      .then((res) => {
        // The Engine stores its synced UI settings as one JSON string.
        const value = typeof res?.value === "string" ? JSON.parse(res.value) : res?.value;
        return value && typeof value === "object" ? value : localUi();
      })
      .catch(() => localUi())),
  messages: (chatId, limit) =>
    api.get(`/chats/${encodeURIComponent(chatId)}/messages${limit ? `?limit=${limit}` : ""}`),
  chat: (chatId) => api.get(`/chats/${encodeURIComponent(chatId)}`),
  /**
   * One line per chat for lists ({ line, assistant }), from Mari Kit's preview route: it never sends the prompt the
   * Engine keeps on recent replies. Kept per chat until the chat's last activity changes.
   */
  previews: async (chats) => {
    const want = chats.filter((c) => previewMemo.get(c.id)?.key !== activityKey(c));
    if (want.length) {
      const got = await api.get(`/mari-kit/shell/previews?ids=${want.map((c) => encodeURIComponent(c.id)).join(",")}`);
      for (const c of want)
        previewMemo.set(c.id, { key: activityKey(c), value: got?.[c.id] || { line: "", assistant: "" } });
    }
    return new Map(chats.map((c) => [c.id, previewMemo.get(c.id)?.value || { line: "", assistant: "" }]));
  },
};
const previewMemo = new Map();
const activityKey = (c) => String(c.lastMessageAt || c.updatedAt || "");

/**
 * The latest messages of a chat, read a page at a time: a long story is thousands of messages, and a phone
 * should not download all of them to show the last screen. `reload()` re-reads as many as are on screen, so
 * edits, deletions and new replies show without dropping the older pages the reader opened.
 */
const TAIL = 8;
export function messageWindow(chatId, page = 40) {
  let list = [];
  let more = false;
  const base = `/chats/${encodeURIComponent(chatId)}/messages`;
  return {
    get list() {
      return list;
    },
    get more() {
      return more;
    },
    set list(next) {
      list = next;
    },
    /**
     * Re-reads what is on screen. `tail` (after a reply) reads only the last few messages and merges them: the
     * Engine keeps its whole prompt on the latest replies, so re-reading 40 messages each turn costs far more.
     */
    async reload(tail = false) {
      if (tail && list.length) {
        const rows = await api.get(`${base}?limit=${TAIL}`);
        const got = Array.isArray(rows) ? rows : [];
        const at = got.length ? list.findIndex((m) => m.id === got[0].id) : -1;
        if (at >= 0) return (list = [...list.slice(0, at), ...got]);
        if (got.length < TAIL) return (list = got);
        // More changed than the tail holds: read the whole window below.
      }
      // A reply adds messages at the end; ask a few past what is on screen so the oldest one stays.
      const firstId = list[0]?.id;
      const limit = Math.max(page, list.length + 4);
      const rows = await api.get(`${base}?limit=${limit}`);
      list = Array.isArray(rows) ? rows : [];
      more = list.length >= limit;
      // More arrived than that (another device wrote meanwhile): read back until the reader's first message.
      for (let i = 0; firstId && more && i < 20 && !list.some((m) => m.id === firstId); i += 1) await this.older();
      return list;
    },
    /** Adds the page before the first message on screen; returns how many came. */
    async older() {
      const first = list[0];
      if (!first || !more) return 0;
      const cursor = `${first.createdAt}|${encodeURIComponent(first.id)}`;
      const rows = await api.get(`${base}?limit=${page}&before=${encodeURIComponent(cursor)}`);
      const got = Array.isArray(rows) ? rows : [];
      more = got.length >= page;
      list = [...got, ...list];
      return got.length;
    },
  };
}

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
    // Slim rows (the shell's list) carry no card; full Engine rows still work.
    const card = row.data ? characterCard(row) : null;
    const name = row.name || card?.name || "";
    map.set(row.id, { id: row.id, name: name || "이름 없음", card, avatar: row.avatarPath || null, row });
  }
  return map;
}

export function messageText(message) {
  const extra = parseJson(message?.extra, {}) || {};
  return typeof extra.displayText === "string" && extra.displayText
    ? extra.displayText
    : String(message?.content ?? "");
}

/** One line for a conversation list: the newest real message; a call shows as 음성 통화, other system text never. */
export function previewLine(rows) {
  for (const m of [...(rows || [])].reverse()) {
    if (m.role !== "system") return stripTags(messageText(m));
    const extra = parseJson(m.extra, {}) || {};
    if (extra.conversationCallEvent?.callId) return "음성 통화";
  }
  return "";
}
const stripTags = (t) => String(t).replace(/\[[a-z][a-z ,.'-]{0,40}\]\s?/g, "");

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

/**
 * An Engine avatar URL with its crop as `?crop=` for Mari Kit's thumbnailer: "R,x,y,w,h" for the current
 * source-rectangle crop, "L,zoom,x,y" for the legacy zoom/offset one, nothing when there is no crop.
 */
export function cropCode(raw) {
  let c = raw;
  if (typeof c === "string") {
    try {
      c = JSON.parse(c);
    } catch {
      return "";
    }
  }
  if (!c || typeof c !== "object") return "";
  const n = (v) => Math.round(Number(v) * 10000) / 10000;
  if (["srcX", "srcY", "srcWidth", "srcHeight"].every((k) => Number.isFinite(Number(c[k]))) && c.srcWidth > 0)
    return `R,${n(c.srcX)},${n(c.srcY)},${n(c.srcWidth)},${n(c.srcHeight)}`;
  if (Number.isFinite(Number(c.zoom)) && Number(c.zoom) > 1 && !c.fullImage)
    return `L,${n(c.zoom)},${n(c.offsetX || 0)},${n(c.offsetY || 0)}`;
  return "";
}

export function withCrop(url, crop) {
  const code = url ? cropCode(crop) : "";
  return code ? `${url}?crop=${code}` : url;
}

/** The chat's own cover picture (chosen in 채팅 설정 › 표지), when it has one. */
export function coverOf(chat) {
  const url = chatMeta(chat).mariKitCover;
  return typeof url === "string" && url.startsWith("/api/mari-kit/shell/cover/") ? url : null;
}

/**
 * Branches of one chat (the Engine's groupId) as one entry, like the Engine's chat list: the most recent branch
 * stands for the group and carries `branches` (all of them, newest first).
 */
export function byBranchGroup(chats) {
  const groups = new Map();
  for (const c of [...chats].sort(byLastActivity)) {
    const key = c.groupId || c.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return [...groups.values()].map((list) => ({ ...list[0], branches: list }));
}
