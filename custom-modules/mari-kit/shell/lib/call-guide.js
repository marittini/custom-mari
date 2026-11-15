// 캐릭터가 알아서 전화 끊기: the Calls package lets a character hang up ([end_call]) but never says when; this puts
// "when" in front of every call. A call reads all enabled entries of the active lorebooks (keys are not checked,
// lowest order first), so one global lorebook "Mari Kit · 통화" with one entry whose key never appears in a chat
// reaches calls only, never an ordinary reply. The owner can reword it in the Engine's lorebook screen.
// ponytail: relies on the package ignoring keys in calls (1.1.7); if that changes, the guide stops reaching calls
// and nothing else breaks — the call-hangup flow in shell-e2e.mjs notices.

import { api } from "./api.js";
import { prefs, setPrefs } from "./prefs.js";

export const GUIDE_NAME = "Mari Kit · 통화";
const TAG = "mari-kit-call";
const NEVER_KEY = "mari-kit-call-only";

export const GUIDE_TEXT = [
  "When a call ends (Mari Kit call rule).",
  "Each character decides, like the real person they are, when the call should end. A character may end it",
  "themselves with a separate command turn [end_call] whenever that fits them and the moment: the talk has run its",
  "course, they are busy or someone needs them, they are sleepy or it is late for them, they are upset, embarrassed",
  "or annoyed, or their personality would simply hang up. A goodbye is optional: a warm character may say one, a",
  "curt or angry one may hang up without it, even mid-sentence. Do not end a call that has only just started unless",
  "that is the point. In a group call, [leave_call] when only that character leaves.",
].join(" ");

async function find() {
  const id = prefs().callGuideId;
  if (id) {
    const book = await api.get(`/lorebooks/${encodeURIComponent(id)}`).catch(() => null);
    if (book?.id) return book;
  }
  const page = await api.get(`/lorebooks?limit=20&offset=0&search=${encodeURIComponent(GUIDE_NAME)}`).catch(() => null);
  const rows = Array.isArray(page) ? page : page?.items || page?.lorebooks || page?.rows || [];
  const book = rows.find((b) => (b.tags || []).includes(TAG) || b.name === GUIDE_NAME) || null;
  if (book) setPrefs({ callGuideId: book.id });
  return book;
}

/** true / false, or null when it has not been made yet (it is made at the first call, on). */
export async function guideOn() {
  const book = await find();
  return book ? book.enabled !== false : null;
}

/** Made once, at the first call; a guide the owner turned off stays off. */
export async function ensureGuide() {
  if (await find()) return;
  const book = await api.post("/lorebooks", {
    name: GUIDE_NAME,
    description: "통화에서 캐릭터가 언제 전화를 끊을지 정하는 지침이에요. Mari Kit이 만들었고, 통화에만 들어가요.",
    isGlobal: true,
    enabled: true,
    excludeFromVectorization: true,
    tags: [TAG],
  });
  await api.post(`/lorebooks/${encodeURIComponent(book.id)}/entries`, {
    lorebookId: book.id,
    name: "통화 끊기",
    content: GUIDE_TEXT,
    keys: [NEVER_KEY],
    order: -1000,
  });
  setPrefs({ callGuideId: book.id });
}

export async function setGuide(on) {
  const book = await find();
  if (!book) return on ? ensureGuide() : undefined;
  await api.patch(`/lorebooks/${encodeURIComponent(book.id)}`, { enabled: on });
}
