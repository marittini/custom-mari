// The Convo composer's helpers, following the Engine's ConversationInput: pictures made small on the phone before
// they are sent (WebP, or JPEG where the browser cannot write WebP), and @mentions ("@Name " in the text, the names
// sent as mentionedCharacterNames). The mention helpers are pure, so custom-modules/tests can check them.

/** Longest edge and quality for a sent picture: enough for a model to see it, small for the phone's data. */
export const PICTURE_EDGE = 1280;
export const PICTURE_QUALITY = 0.8;

const readDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error("읽지 못했어요"));
    r.readAsDataURL(blob);
  });

/** A picked picture as the Engine's attachment ({ type, data: data URL, filename, name }) plus its size in bytes. */
export async function shrinkPicture(file, { edge = PICTURE_EDGE, quality = PICTURE_QUALITY } = {}) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const encode = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  let blob = await encode("image/webp");
  if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg");
  if (!blob) throw new Error("사진을 줄이지 못했어요");
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const name = `${String(file.name || "photo").replace(/\.[^.]+$/, "") || "photo"}.${ext}`;
  return { type: blob.type, data: await readDataUrl(blob), filename: name, name, bytes: blob.size, from: file.size };
}

const MENTION_BEFORE = /(^|[^\p{L}\p{N}_])@([^\n@]*)$/u;
const norm = (s) =>
  String(s || "")
    .normalize("NFKC")
    .toLocaleLowerCase();

/** The "@query" being typed just before the caret: { start, query } (start = index of "@"), or null. */
export function mentionAt(text, caret) {
  const before = String(text || "").slice(0, caret);
  const m = MENTION_BEFORE.exec(before);
  if (!m) return null;
  return { start: before.length - m[2].length - 1, query: m[2] };
}

/** Names that start with the query (the Engine's prefix match), at most 6. */
export function mentionChoices(names, query) {
  const q = norm(query);
  return names.filter((n) => n && norm(n).startsWith(q)).slice(0, 6);
}

/** The text with "@query" replaced by "@Name " and where the caret goes. */
export function insertMention(text, caret, start, name) {
  const next = `${text.slice(0, start)}@${name} ${text.slice(caret)}`;
  return { text: next, caret: start + name.length + 2 };
}

/** The Engine's extractMentions: names written as "@Name" followed by the end, a space or punctuation. */
export function mentionedNames(text, names) {
  const found = [];
  for (const name of [...names].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`@${escaped}(?=$|[\\s\\p{P}\\p{S}])`, "iu").test(text) && !found.includes(name)) found.push(name);
  }
  return found;
}
