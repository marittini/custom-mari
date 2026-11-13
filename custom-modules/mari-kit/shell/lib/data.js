// Engine data the screens share, fetched once per load and refreshed on demand.

import { api, characterCard, parseJson, chatWriteCount } from "./api.js";

let chatsP = null;
let chatsAt = 0;
let chatsWrites = 0;
let charsP = null;
const cards = new Map();
let connsP = null;
let personasP = null;
let uiP = null;

export const data = {
  /**
   * Every chat with its metadata (the Engine has no slimmer list). true re-reads now (after the shell changed a
   * chat); "soft" re-reads only when the copy is older than 20 seconds or the shell has written to a chat since, so
   * moving between 홈, 대화 and 서재 does not download it each time; nothing reuses the copy.
   */
  chats: (fresh) => {
    const stale =
      !chatsP ||
      fresh === true ||
      (fresh === "soft" && (Date.now() - chatsAt > 20_000 || chatsWrites !== chatWriteCount()));
    if (stale) {
      chatsAt = Date.now();
      chatsWrites = chatWriteCount();
      chatsP = api.get("/chats");
      chatsP.catch(() => (chatsP = null));
    }
    return chatsP;
  },
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
  /**
   * The Engine's UI settings (quick replies live here), the newer of the two copies the Engine keeps: the server's
   * (with __updatedAt) and this browser's, like the Engine's own sync decides. A reply added in the Engine on this
   * phone shows even when its server copy has not caught up.
   */
  engineUi: () =>
    uiP ||
    (uiP = api
      .get("/app-settings/ui")
      .then((res) => {
        const value = typeof res?.value === "string" ? JSON.parse(res.value) : res?.value;
        const server = value && typeof value === "object" ? value : null;
        const local = localUi();
        const localAt = Number(localStorageGet("marinara-engine-ui-updated-at")) || 0;
        const serverAt = Number(server?.__updatedAt) || 0;
        if (!server) return local;
        return Object.keys(local).length && localAt > serverAt ? { ...server, ...local } : server;
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
    /** Reads older pages until message `id` is on screen (a search hit); false when it is not in the chat. */
    async until(id) {
      for (let i = 0; i < 200 && !list.some((m) => m.id === id); i += 1) if (!(await this.older())) break;
      return list.some((m) => m.id === id);
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

function localStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localUi() {
  try {
    const raw = JSON.parse(localStorage.getItem("marinara-engine-ui") || "{}");
    return raw.state || raw || {};
  } catch {
    return {};
  }
}

// Connections that write text: image, video, audio and decision connections are for other jobs.
const NOT_TEXT = ["image_generation", "video_generation", "audio_generation", "audio", "decision"];
export const textConnections = (list) => (list || []).filter((c) => !NOT_TEXT.includes(c.provider));

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

/** "3,421자" · "12.3만 자": the length of a chat, in characters. */
export function charLabel(n) {
  return n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}만 자` : `${n.toLocaleString("ko-KR")}자`;
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
  const meta = chatMeta(chat);
  const url = meta.mariKitCover;
  if (typeof url !== "string" || !url.startsWith("/api/mari-kit/shell/cover/")) return null;
  // 표지 위치: the point to keep in view, carried on the URL (#p=x,y in percent) so every list shows it.
  const at = coverPos(meta);
  return at ? `${url}#p=${at.x},${at.y}` : url;
}

/** The chosen focus of a chat's cover ({ x, y } in percent), or null for the middle. */
export function coverPos(meta) {
  const p = meta?.mariKitCoverPos;
  const ok = (v) => Number.isFinite(v) && v >= 0 && v <= 100;
  return p && ok(p.x) && ok(p.y) && !(p.x === 50 && p.y === 50) ? { x: Math.round(p.x), y: Math.round(p.y) } : null;
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
