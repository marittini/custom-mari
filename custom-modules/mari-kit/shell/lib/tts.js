// Read-aloud for the shell: the Engine's /api/tts/speak renders a line; clips are kept per browser session
// (and in Cache Storage where the page is a secure context) so a replay costs nothing.

const memory = new Map();
const CACHE = "mari-shell-tts";
let audio = null;
let activeKey = null;
const listeners = new Set();

export function onTts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn(activeKey));

export function activeLine() {
  return activeKey;
}

async function cached(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    const hit = await (await caches.open(CACHE)).match(`/__mari_tts/${encodeURIComponent(key)}`);
    if (hit) {
      const blob = await hit.blob();
      memory.set(key, blob);
      return blob;
    }
  } catch {}
  return null;
}

export async function isCached(key) {
  return !!(await cached(key));
}

async function store(key, blob) {
  memory.set(key, blob);
  try {
    await (await caches.open(CACHE)).put(`/__mari_tts/${encodeURIComponent(key)}`, new Response(blob));
  } catch {}
}

export async function forget(key) {
  memory.delete(key);
  try {
    await (await caches.open(CACHE)).delete(`/__mari_tts/${encodeURIComponent(key)}`);
  } catch {}
}

let seq = 0;

/** Stops playback and any running sequence. */
export function stop() {
  seq += 1;
  end();
}

function end() {
  if (audio) {
    audio.pause();
    URL.revokeObjectURL(audio.src);
  }
  audio = null;
  activeKey = null;
  emit();
}

export async function speak(key, request) {
  end();
  activeKey = key;
  emit();
  try {
    let blob = await cached(key);
    if (!blob) {
      const res = await fetch("/api/tts/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-marinara-csrf": "1" },
        credentials: "same-origin",
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        let message = `${res.status}`;
        try {
          const body = await res.json();
          message = body.error || body.message || message;
        } catch {}
        throw new Error(message);
      }
      blob = await res.blob();
      await store(key, blob);
    }
    if (activeKey !== key) return;
    audio = new Audio(URL.createObjectURL(blob));
    audio.addEventListener("ended", () => {
      if (activeKey === key) end();
    });
    await audio.play();
  } catch (error) {
    if (activeKey === key) end();
    throw error;
  }
}

/** Plays [{ key, body }] one after another (autoplay); a stop() ends the whole run. */
export async function speakSequence(items) {
  const mine = ++seq;
  for (const item of items) {
    if (seq !== mine) return;
    try {
      await speak(item.key, item.body);
    } catch {
      continue;
    }
    if (activeKey !== item.key) continue; // already over (or replaced)
    await new Promise((resolve) => {
      const off = onTts((k) => {
        if (k !== item.key) {
          off();
          resolve();
        }
      });
    });
  }
}

export function hashKey(parts) {
  let h = 2166136261;
  const text = parts.join("\u0001");
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
