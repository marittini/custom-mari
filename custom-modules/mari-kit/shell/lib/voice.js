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
