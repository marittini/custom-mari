// Engine API: same origin, so the browser's session cookie and the CSRF header are all it needs.

const CSRF = { "x-marinara-csrf": "1" };

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Counts writes that change a chat (its messages, settings, folder, cover), so a cached chat list knows it is old.
let chatWrites = 0;
const CHAT_WRITE = /^\/(chats|chat-folders|generate|mari-kit\/shell\/cover)(\/|\?|$)/;
export const chatWriteCount = () => chatWrites;

async function request(method, path, body) {
  if (method !== "GET" && CHAT_WRITE.test(path)) chatWrites += 1;
  const headers = { ...CSRF };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new ApiError(res.status, (data && (data.error || data.message)) || `${res.status}`);
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body ?? {}),
  patch: (path, body) => request("PATCH", path, body ?? {}),
  put: (path, body) => request("PUT", path, body ?? {}),
  delete: (path) => request("DELETE", path),
  /** POST that answers with Server-Sent Events; yields { type, data, ... } objects. */
  async *stream(path, body, signal) {
    if (CHAT_WRITE.test(path)) chatWrites += 1;
    const res = await fetch(`/api${path}`, {
      method: "POST",
      headers: { ...CSRF, "Content-Type": "application/json", Accept: "text/event-stream" },
      credentials: "same-origin",
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      let message = `${res.status}`;
      try {
        const data = await res.json();
        message = data.error || data.message || message;
      } catch {}
      throw new ApiError(res.status, message);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let cut;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data === "[DONE]") return;
        if (!data) continue;
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (!event || typeof event.type !== "string") continue;
        yield event;
        if (event.type === "error") return;
      }
    }
  },
};

/** Character rows store their card as a JSON string. */
export function characterCard(row) {
  let data = row?.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = {};
    }
  }
  return data && typeof data === "object" ? data : {};
}

export function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
