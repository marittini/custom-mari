// ──────────────────────────────────────────────
// Mari Kit TTS — server half
//
// The main model writes voice markup in the same reply, so no extra model call is made:
//   <audio_character id="ID">"[low, amused] You came back."</audio_character>
// The browser half reads that markup to play each line with the speaker's voice. Conversation messages
// already belong to one speaker each, so there they only get delivery cues.
//
// Cues come in two forms: a short free description ("[low, amused]", any TTS can be told it as a tone) or
// ElevenLabs v3/v4 audio tags ("[sighs] … [short pause] …", read by the model itself). "auto" picks the tags
// when the Engine's TTS is ElevenLabs with a tag-capable model (merged from the ElevenLabs TTS extension).
// ──────────────────────────────────────────────

const MAX_PARTICIPANTS = 40;

function parseRecordData(data) {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  return data && typeof data === "object" ? data : {};
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Character records keep the card as JSON in `data`; the phonetic name lives in its extensions. */
export function characterParticipant(record) {
  const data = parseRecordData(record?.data);
  const name = text(data.name) || text(record?.comment) || text(record?.id);
  const extensions = data.extensions && typeof data.extensions === "object" ? data.extensions : {};
  return { kind: "character", id: record.id, name, phoneticName: text(extensions.phoneticName) };
}

/** Persona records are the persona row itself. */
export function personaParticipant(record) {
  const data = parseRecordData(record?.data);
  return { kind: "persona", id: record.id, name: text(data.name) || record.id, phoneticName: text(data.phoneticName) };
}

export async function listParticipants(runtime, chatId, personaId) {
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat) return [];
  const characterIds = [...new Set(chat.characterIds ?? [])].slice(0, MAX_PARTICIPANTS);
  const characters = characterIds.length ? await runtime.resources.listCharacters(characterIds) : [];
  const persona = personaId ?? chat.personaId ?? null;
  const personas = persona ? await runtime.resources.listPersonas([persona]) : [];
  return [...characters.map(characterParticipant), ...personas.map(personaParticipant)].filter((p) => p.name);
}

const VOICE_DOC = "mari-kit:voice";
export const CUE_MODES = ["auto", "tags", "free"];
export const AUTOPLAY = ["off", "chars", "all"];

export function normalizeVoiceSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const e = src.eleven && typeof src.eleven === "object" ? src.eleven : {};
  const unit = (v, d) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : d);
  const rooms = {};
  for (const [id, on] of Object.entries(src.rooms && typeof src.rooms === "object" ? src.rooms : {}))
    if (/^[A-Za-z0-9_-]{1,200}$/.test(id) && on === false) rooms[id] = false;
  return {
    cue: CUE_MODES.includes(src.cue) ? src.cue : "auto",
    autoplay: AUTOPLAY.includes(src.autoplay) ? src.autoplay : "off",
    rp: src.rp !== false,
    convo: src.convo === true,
    lineButtons: src.lineButtons !== false,
    rooms,
    engine: {
      source: text(src.engine?.source).slice(0, 40),
      model: text(src.engine?.model).slice(0, 80),
      baseUrl: /^https:\/\//.test(text(src.engine?.baseUrl)) ? text(src.engine.baseUrl).slice(0, 200) : "",
    },
    eleven: {
      stability: unit(e.stability, 0.5),
      similarity: unit(e.similarity, 0.75),
      style: unit(e.style, 0),
      speed: Number.isFinite(Number(e.speed)) ? Math.min(1.2, Math.max(0.7, Number(e.speed))) : 1,
      speakerBoost: e.speakerBoost !== false,
      key: text(e.key).slice(0, 200),
      appliedAt: text(e.appliedAt).slice(0, 40) || null,
      appliedCount: Number.isFinite(e.appliedCount) ? e.appliedCount : 0,
    },
  };
}

/** What the browser may see: everything but the key itself. */
export function publicVoiceSettings(v) {
  const { key, ...eleven } = v.eleven;
  return {
    ...v,
    eleven: { ...eleven, hasKey: !!key, keyTail: key ? key.slice(-4) : "" },
    cueResolved: resolveCue(v),
    cueAuto: resolveCue({ ...v, cue: "auto" }),
  };
}

export function resolveCue(v) {
  if (v.cue !== "auto") return v.cue;
  return v.engine.source === "elevenlabs" && /v3|v4/i.test(v.engine.model) ? "tags" : "free";
}

const TAG_RULE =
  "Add ElevenLabs audio tags in square brackets inside spoken dialogue, wherever the delivery changes: [sighs], [whispers], [laughs], [short pause], [annoyed], [thoughtful], [chuckles] and any other suitable English delivery, emotion or pacing tag. Keep tags brief, in English, and never in narration.";
const FREE_RULE =
  "Start each spoken line with one short English delivery cue in square brackets, inside the quotes, describing only audible voice quality, volume, pace or emotion in plain words, at most 80 characters. No visual actions, sound effects or music.";

/** The instruction appended to a Roleplay turn. Returns null when there is nobody to tag. */
export function buildTtsGuidance(participants, cue = "free") {
  if (!participants.length) return null;
  const list = participants.map(({ kind, id, name }) => ({ kind, id, name }));
  return [
    "<voice_markup>",
    'Wrap every spoken line in <audio_character id="ID">"…"</audio_character>, or <audio_persona id="ID">"…"</audio_persona> for the persona, using the exact IDs from the participant list. Keep narration outside the wrappers. Do not nest wrappers or put any other markup inside them.',
    cue === "tags"
      ? `${TAG_RULE} Example: <audio_character id="ID">"[sighs] You came back. [short pause] Finally."</audio_character>`
      : `${FREE_RULE} Example: <audio_character id="ID">"[low, amused] You came back."</audio_character>`,
    "This markup does not change who may speak: write persona dialogue only where the existing rules allow it.",
    `Participants: ${JSON.stringify(list)}`,
    "</voice_markup>",
  ].join("\n");
}

/** Conversation: one speaker per message, so only the cues. */
export function buildConvoTtsGuidance(cue = "free") {
  return [
    "<voice_cues>",
    "Your messages are read aloud.",
    cue === "tags"
      ? `${TAG_RULE.replace("inside spoken dialogue", "inside your message")} Example: "[sighs] 진짜 늦었네. [short pause] 그래도 왔구나."`
      : 'Start each message with one short English delivery cue in square brackets describing only audible voice quality, pace or emotion, at most 80 characters. Example: "[low, amused] 진짜 늦었네."',
    "</voice_cues>",
  ].join("\n");
}

const usesKit = (meta) =>
  meta?.enableAgents === true && Array.isArray(meta?.activeAgentIds) && meta.activeAgentIds.includes("mari-kit");

async function readVoice(runtime) {
  const doc = await runtime.persistence.documents.getById("mari-kit", VOICE_DOC);
  return { doc, voice: normalizeVoiceSettings(doc?.data) };
}

export const ttsFeature = {
  id: "tts",
  // Conversation chats have no agent list, so the feature keeps its own switches: RP still needs the agent.
  ownChatSwitch: true,
  async promptContext(request, { runtime }) {
    const { voice } = await readVoice(runtime);
    if (voice.rooms[request.chatId] === false) return null;
    const cue = resolveCue(voice);
    if (request.mode === "roleplay") {
      if (!voice.rp || !usesKit(request.chatMeta)) return null;
      return buildTtsGuidance(await listParticipants(runtime, request.chatId, request.personaId), cue);
    }
    if (request.mode === "conversation" && voice.convo) return buildConvoTtsGuidance(cue);
    return null;
  },
  routes(app, { runtime, httpError }) {
    // Names and phonetic names of the chat's speakers, for the browser's per-line playback.
    app.get("/tts/participants/:chatId", async (request) => {
      const chatId = text(request.params.chatId);
      if (!chatId || chatId.length > 200) throw httpError(400, "Chat ID is required.");
      if (!(await runtime.persistence.getChat(chatId))) throw httpError(404, "Chat not found.");
      return { participants: await listParticipants(runtime, chatId, null) };
    });

    const docs = () => runtime.persistence.documents;
    async function save(mutate) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { doc, voice } = await readVoice(runtime);
        const next = normalizeVoiceSettings(mutate(structuredClone(voice)));
        const now = new Date().toISOString();
        if (!doc) {
          try {
            await docs().create({
              id: VOICE_DOC,
              packageId: "mari-kit",
              kind: "voice",
              name: "Voice settings",
              description: "",
              data: next,
              createdAt: now,
              updatedAt: now,
            });
            return next;
          } catch {
            continue;
          }
        }
        if (
          await docs().update({
            id: VOICE_DOC,
            packageId: "mari-kit",
            expectedRevision: doc.revision,
            name: doc.name,
            description: doc.description,
            data: next,
            updatedAt: now,
          })
        )
          return next;
      }
      throw httpError(409, "Voice settings changed while saving. Try again.");
    }
    app.get("/tts/settings", async () => publicVoiceSettings((await readVoice(runtime)).voice));
    // Everything but the key; `engine` is the Engine TTS source/model the browser last read (for "auto").
    app.patch("/tts/settings", async (request) => {
      const b = request.body && typeof request.body === "object" ? request.body : {};
      const next = await save((v) => {
        for (const k of ["cue", "autoplay", "rp", "convo", "lineButtons", "engine"])
          if (b[k] !== undefined) v[k] = b[k];
        if (b.eleven && typeof b.eleven === "object") {
          const { key, appliedAt, appliedCount, ...rest } = b.eleven;
          v.eleven = { ...v.eleven, ...rest };
        }
        return v;
      });
      return publicVoiceSettings(next);
    });
    app.put("/tts/room/:chatId", async (request) => {
      const chatId = text(request.params.chatId);
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(chatId)) throw httpError(400, "Bad chat ID.");
      const on = request.body?.guidance !== false;
      const next = await save((v) => {
        if (on) delete v.rooms[chatId];
        else v.rooms[chatId] = false;
        return v;
      });
      return publicVoiceSettings(next);
    });
    app.put("/tts/eleven/key", async (request) => {
      const key = text(request.body?.key);
      if (key && !/^[A-Za-z0-9_-]{16,200}$/.test(key))
        throw httpError(400, "That does not look like an ElevenLabs key.");
      return publicVoiceSettings(await save((v) => ((v.eleven.key = key), v)));
    });
    // Applies stability / similarity / style / speaker boost / speed to every voice in the ElevenLabs account.
    app.post("/tts/eleven/apply", async () => {
      const { voice } = await readVoice(runtime);
      if (!voice.eleven.key) throw httpError(400, "Save an ElevenLabs key first.");
      const root = (voice.engine.baseUrl || "https://api.elevenlabs.io").replace(/\/+$/, "").replace(/\/v1$/, "");
      const headers = { "xi-api-key": voice.eleven.key, "Content-Type": "application/json" };
      const list = await fetch(`${root}/v1/voices`, { headers, signal: AbortSignal.timeout(20000) });
      if (list.status === 401) throw httpError(400, "ElevenLabs rejected the key.");
      if (!list.ok) throw httpError(502, `ElevenLabs voices: ${list.status}`);
      const ids = (((await list.json()) ?? {}).voices ?? [])
        .map((v) => v?.voice_id)
        .filter((id) => typeof id === "string");
      const body = JSON.stringify({
        stability: voice.eleven.stability,
        similarity_boost: voice.eleven.similarity,
        style: voice.eleven.style,
        use_speaker_boost: voice.eleven.speakerBoost,
        speed: voice.eleven.speed,
      });
      let done = 0;
      const failed = [];
      for (let i = 0; i < ids.length; i += 4) {
        await Promise.all(
          ids.slice(i, i + 4).map(async (id) => {
            const res = await fetch(`${root}/v1/voices/${encodeURIComponent(id)}/settings/edit`, {
              method: "POST",
              headers,
              body,
              signal: AbortSignal.timeout(20000),
            }).catch(() => null);
            if (res?.ok) done += 1;
            else failed.push(id);
          }),
        );
      }
      const next = await save((v) => {
        v.eleven.appliedAt = new Date().toISOString();
        v.eleven.appliedCount = done;
        return v;
      });
      return { ...publicVoiceSettings(next), applied: done, failed: failed.length };
    });
  },
};
