// Small pieces of the Convo screen that follow the Engine's conversation view: day separators and times (5-minute
// groups), the presence notices of a busy, away or offline character, and message attachments (selfies, videos,
// uploaded pictures). Pure, so custom-modules/tests can check them.

const pad = (n) => String(n).padStart(2, "0");
const at = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** The local calendar day of a time, as a key ("2026-11-14"), or "" when it cannot be read. */
export function dayKey(iso) {
  const d = at(iso);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "";
}

/** The separator text for a day: 오늘, 어제, else "11월 12일 목요일" (with the year when it is another year). */
export function dayLabel(iso, now = new Date()) {
  const d = at(iso);
  if (!d) return "";
  const diff = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  if (diff === 0) return "오늘";
  if (diff === 1) return "어제";
  const year = d.getFullYear() === now.getFullYear() ? "" : `${d.getFullYear()}년 `;
  return `${year}${d.getMonth() + 1}월 ${d.getDate()}일 ${"일월화수목금토"[d.getDay()]}요일`;
}

/** "오후 4:12". */
export function timeLabel(iso) {
  const d = at(iso);
  if (!d) return "";
  const h = d.getHours();
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${pad(d.getMinutes())}`;
}

/** The Engine groups one speaker's messages within 5 minutes of each other on the same day. */
export const GROUP_GAP_MS = 5 * 60 * 1000;
export function closeInTime(a, b) {
  const x = at(a);
  const y = at(b);
  if (!x || !y) return true;
  return dayKey(a) === dayKey(b) && Math.abs(y - x) <= GROUP_GAP_MS;
}

// ── Korean particles by the last letter of a name (받침) ──
function hasFinal(name) {
  const c = String(name || "")
    .trim()
    .slice(-1)
    .charCodeAt(0);
  // Not Hangul (an English name, a number): read as 는/가, as most speakers would.
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
}
const topic = (name) => `${name}${hasFinal(name) ? "은" : "는"}`;
const subject = (name) => `${name}${hasFinal(name) ? "이" : "가"}`;

/** Names as one phrase: "하루", "하루, 서진", "하루 외 2명". */
export function namesPhrase(names) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return "캐릭터";
  if (list.length <= 2) return list.join(", ");
  return `${list[0]} 외 ${list.length - 1}명`;
}

/** About how long a busy character takes: "1분 안에", "약 3분". */
export function waitPhrase(ms) {
  const min = Math.ceil((Number(ms) || 0) / 60000);
  return min <= 1 ? "1분 안에" : `약 ${min}분 뒤`;
}

/**
 * The text of a presence notice. info: { kind: "typing" | "delayed" | "offline", names, status, delayMs, reason }.
 */
export function presenceText(info) {
  const who = namesPhrase(info?.names);
  const many = (info?.names || []).length > 2;
  if (info?.kind === "typing") return `${many ? `${who}이` : subject(who)} 입력 중…`;
  if (info?.kind === "delayed") {
    const when = waitPhrase(info.delayMs);
    return info.status === "dnd"
      ? `${many ? `${who}은` : topic(who)} 지금 바빠요 · 틈나면 답해요 (${when})`
      : `${many ? `${who}은` : topic(who)} 자리를 비웠어요 · 곧 답해요 (${when})`;
  }
  if (info?.kind === "offline")
    return info.reason === "scene_busy"
      ? `${many ? `${who}은` : topic(who)} 지금 장면(롤플) 중이라 여기서는 답하지 않아요`
      : `${many ? `${who}은` : topic(who)} 지금 오프라인이라 답하지 않아요 · 돌아오면 답할 수 있어요`;
  return "";
}

/**
 * A message's attachments as the screen draws them (the Engine's MessageAttachment: selfies and videos from
 * characters, pictures the user sent). Each: { kind: "image" | "video" | "file", src, thumb, name, prompt }.
 * Gallery pictures get the Engine's phone-size preview (?w=1024, the only preview width it makes).
 */
export function attachmentsOf(message) {
  let extra = message?.extra;
  if (typeof extra === "string") {
    try {
      extra = JSON.parse(extra);
    } catch {
      extra = null;
    }
  }
  const list = Array.isArray(extra?.attachments) ? extra.attachments : [];
  const out = [];
  for (const a of list) {
    if (!a || typeof a !== "object") continue;
    const type = String(a.type || "");
    const name = String(a.name || a.filename || "");
    const prompt = typeof a.prompt === "string" ? a.prompt : "";
    let src = typeof a.url === "string" && a.url ? a.url : "";
    if (!src && typeof a.data === "string" && a.data)
      src = a.data.startsWith("data:") ? a.data : `data:${type || "application/octet-stream"};base64,${a.data}`;
    // Only local paths, data URLs or https; never script URLs.
    if (src && !/^(\/api\/|data:(image|video)\/|https:\/\/)/i.test(src)) src = "";
    if ((type === "video" || type.startsWith("video/")) && src)
      out.push({ kind: "video", src, thumb: src, name, prompt });
    else if ((type === "image" || type.startsWith("image/")) && src) {
      const thumb = /^\/api\/gallery\/file\/[^/?#]+\/[^/?#]+$/.test(src) ? `${src}?w=1024` : src;
      out.push({ kind: "image", src, thumb, name, prompt });
    } else if (name) out.push({ kind: "file", src, thumb: "", name, prompt });
  }
  return out;
}
