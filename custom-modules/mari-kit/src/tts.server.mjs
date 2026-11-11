// ──────────────────────────────────────────────
// Mari Kit TTS — server half
//
// The main model writes voice markup in the same reply, so no extra model call is made:
//   <audio_character id="ID">"[low, amused] You came back."</audio_character>
// The browser half reads that markup to play each line with the speaker's voice.
// Roleplay only: Conversation messages already belong to one speaker each.
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

/** The instruction appended to a Roleplay turn. Returns null when there is nobody to tag. */
export function buildTtsGuidance(participants) {
  if (!participants.length) return null;
  const list = participants.map(({ kind, id, name }) => ({ kind, id, name }));
  return [
    "<voice_markup>",
    'Wrap every spoken line in <audio_character id="ID">"…"</audio_character>, or <audio_persona id="ID">"…"</audio_persona> for the persona, using the exact IDs from the participant list. Keep narration outside the wrappers. Do not nest wrappers or put any other markup inside them.',
    'Start each wrapped line with one short English delivery cue in square brackets, inside the quotes: <audio_character id="ID">"[low, amused] You came back."</audio_character>. Describe only audible voice quality, volume, pace or emotion in plain words, at most 80 characters. No visual actions, sound effects or music.',
    "This markup does not change who may speak: write persona dialogue only where the existing rules allow it.",
    `Participants: ${JSON.stringify(list)}`,
    "</voice_markup>",
  ].join("\n");
}

export const ttsFeature = {
  id: "tts",
  async promptContext(request, { runtime }) {
    if (request.mode !== "roleplay") return null;
    return buildTtsGuidance(await listParticipants(runtime, request.chatId, request.personaId));
  },
  routes(app, { runtime, httpError }) {
    // Names and phonetic names of the chat's speakers, for the browser's per-line playback.
    app.get("/tts/participants/:chatId", async (request) => {
      const chatId = text(request.params.chatId);
      if (!chatId || chatId.length > 200) throw httpError(400, "Chat ID is required.");
      if (!(await runtime.persistence.getChat(chatId))) throw httpError(404, "Chat not found.");
      return { participants: await listParticipants(runtime, chatId, null) };
    });
  },
};
