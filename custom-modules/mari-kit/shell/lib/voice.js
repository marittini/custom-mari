// Mari Kit voice settings as the shell needs them. The server can't read the Engine's TTS config, so the
// browser hands it the source/model it just read; "감정 표현: 모델에 맞게" is decided from that.

import { api } from "./api.js";

let cached = null;

export function voiceSettings(fresh) {
  if (fresh || !cached) cached = api.get("/mari-kit/tts/settings").catch(() => null);
  return cached;
}

export async function syncVoiceSettings(config) {
  let v = await voiceSettings();
  if (!v || !config) return v;
  const engine = {
    source: config.source || "",
    model: config.model || "",
    baseUrl: /^https:\/\//.test(config.baseUrl || "") ? config.baseUrl : "",
  };
  if (engine.source !== v.engine?.source || engine.model !== v.engine?.model || engine.baseUrl !== v.engine?.baseUrl) {
    v = await api.patch("/mari-kit/tts/settings", { engine }).catch(() => v);
    cached = Promise.resolve(v);
  }
  return v;
}

export async function patchVoice(patch) {
  const v = await api.patch("/mari-kit/tts/settings", patch);
  cached = Promise.resolve(v);
  return v;
}

/**
 * The Engine's voice list (GET /tts/voices) as [{ id, name }]: names come from voiceOptions (ElevenLabs voice ids
 * are opaque codes); `voices` alone holds only ids.
 */
export function voiceList(res) {
  const rows = Array.isArray(res) ? res : res?.voiceOptions?.length ? res.voiceOptions : res?.voices || [];
  return rows
    .map((x) =>
      typeof x === "string"
        ? { id: x, name: x, category: "" }
        : { id: x.id || x.voice_id || x.name, name: x.name || x.id, category: x.category || "" },
    )
    .filter((x) => x.id);
}

/**
 * The voices of the audio connection that actually speaks: the one chosen for TTS, else the default audio
 * connection, else the fallback (like the Engine resolves it). Without it the Engine answers with the
 * settings card's list — for ElevenLabs only the premade voices, never the ones on the user's account.
 */
export async function loadVoices() {
  const [cfg, conns] = await Promise.all([
    api.get("/tts/config").catch(() => null),
    api.get("/connections").catch(() => []),
  ]);
  const audio = (conns || []).filter((c) => c.provider === "audio");
  const yes = (v) => v === true || v === "true";
  const id =
    (cfg?.connectionId || "").trim() ||
    audio.find((c) => yes(c.defaultForAgents))?.id ||
    audio.find((c) => yes(c.fallbackForAgents))?.id ||
    "";
  return voiceList(await api.get(`/tts/voices${id ? `?connectionId=${encodeURIComponent(id)}` : ""}`));
}

/**
 * Voices split for lists: 내 목소리 (cloned, generated, professional, added from the library) first, then
 * 기본 목소리 (ElevenLabs premade). Providers without categories give one unlabelled part.
 */
export function voiceGroups(voices) {
  const mine = voices.filter((v) => v.category && v.category !== "premade");
  const premade = voices.filter((v) => v.category === "premade");
  const plain = voices.filter((v) => !v.category);
  if (!mine.length && !premade.length) return [{ label: "", items: plain }];
  return [
    { label: "내 목소리", items: [...mine, ...plain] },
    { label: "기본 목소리", items: premade },
  ].filter((g) => g.items.length);
}

/** <option>/<optgroup> nodes for a voice dropdown, grouped as voiceGroups does. */
export function voiceOptions(h, voices, value, first = [["", "기본 목소리"]]) {
  const opt = (id, name) => h("option", { value: id, selected: (value || "") === id }, name);
  return [
    ...first.map(([id, name]) => opt(id, name)),
    ...voiceGroups(voices).map((g) =>
      g.label
        ? h(
            "optgroup",
            { label: g.label },
            g.items.map((v) => opt(v.id, v.name)),
          )
        : g.items.map((v) => opt(v.id, v.name)),
    ),
  ];
}
