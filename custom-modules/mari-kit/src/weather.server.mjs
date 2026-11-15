// ──────────────────────────────────────────────
// Mari Kit Weather — current weather in Conversation chats
//
// A shared "my place" for the user, and per chat an on/off switch and an optional place for the character.
// Each Conversation turn of a chat that turned it on gets the current weather and temperature only:
// place names, coordinates and time zones never reach the model. No model call; one Open-Meteo request per
// place at most every 15 minutes (cached). Data: Open-Meteo (CC BY 4.0).
// ──────────────────────────────────────────────

import weatherCore from "./convo-weather-core.mjs";

const DOC_ID = "mari-kit:weather";
const DOC_KIND = "weather";
const FETCH_TIMEOUT_MS = 5000;

/** Test hook: point the forecast at another Open-Meteo–compatible server. Unset in normal use. */
const FORECAST_OVERRIDE = process.env.MARI_KIT_OPEN_METEO_FORECAST_URL?.trim() || "";

const str = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const finite = (value) => typeof value === "number" && Number.isFinite(value);

export function normalizeLocation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { latitude, longitude } = raw;
  if (!finite(latitude) || !finite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const name = str(raw.name, 100);
  return {
    name,
    label: str(raw.label, 200) || name,
    latitude,
    longitude,
    timezone: str(raw.timezone, 100),
    source: str(raw.source, 30),
  };
}

export function normalizeWeatherState(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const rooms = {};
  for (const [chatId, room] of Object.entries(data.rooms && typeof data.rooms === "object" ? data.rooms : {})) {
    if (!chatId || chatId.length > 200 || !room || typeof room !== "object") continue;
    rooms[chatId] = { enabled: room.enabled === true, characterLocation: normalizeLocation(room.characterLocation) };
  }
  return { version: 1, userLocation: normalizeLocation(data.userLocation), rooms };
}

function forecastUrl(location) {
  const url = weatherCore.buildWeatherURL(location);
  return FORECAST_OVERRIDE ? FORECAST_OVERRIDE + url.slice(url.indexOf("?")) : url;
}

const cache = new Map();
// A failed place is not asked again for 2 minutes, so a phone without a way out does not wait 5 s on every reply.
const RETRY_MS = 120_000;
export async function getWeather(location, fetchImpl = fetch, { fresh = false } = {}) {
  const key = `${location.latitude},${location.longitude}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now() && !(fresh && hit.failed)) return hit.value;
  const value = (async () => {
    const response = await fetchImpl(forecastUrl(location), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Weather response ${response.status}`);
    return weatherCore.normalizeWeather(await response.json(), location);
  })();
  cache.set(key, { until: Date.now() + weatherCore.CACHE_TTL_MS, value });
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.set(key, { until: Date.now() + RETRY_MS, value, failed: true });
  });
  return value;
}

/** Why a request failed, in a few words the owner can act on (no answer, no network, the service said no). */
export function failureReason(error) {
  if (error?.name === "TimeoutError" || /timeout|aborted/i.test(String(error?.message))) return "응답이 없어요 (5초)";
  const code = error?.cause?.code || error?.code;
  if (code) return `연결하지 못했어요 (${code})`;
  return String(error?.message ?? error);
}

function weatherLine(snapshot) {
  const c = snapshot.current;
  const feels = c.apparentTemperature == null ? "" : `, feels like ${c.apparentTemperature}°C`;
  return `${c.weatherTextEn}, ${c.temperature}°C${feels}${c.isDay === 0 ? ", night" : ""}`;
}

/** Only weather and temperature: place labels, coordinates and time zones stay out of the prompt. */
export function buildWeatherContext({ user, character, userName, characterName }) {
  if (!user) return null;
  const lines = character
    ? [
        `${userName || "The user"}'s weather: ${weatherLine(user)}`,
        `${characterName || "The character"}'s weather: ${weatherLine(character)}`,
      ]
    : [`Current weather: ${weatherLine(user)}`];
  return [
    "<weather_context>",
    ...lines,
    "Real-world weather where each person is now. Mention it only when it fits naturally; never force it.",
    "</weather_context>",
  ].join("\n");
}

function nameOf(record) {
  let data = record?.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = {};
    }
  }
  return str(data?.name, 100);
}

async function readState(runtime) {
  const doc = await runtime.persistence.documents.getById("mari-kit", DOC_ID);
  return { doc, state: normalizeWeatherState(doc?.data) };
}

async function writeState(runtime, update) {
  const documents = runtime.persistence.documents;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { doc, state } = await readState(runtime);
    const next = normalizeWeatherState(update(state));
    const now = new Date().toISOString();
    if (!doc) {
      try {
        await documents.create({
          id: DOC_ID,
          packageId: "mari-kit",
          kind: DOC_KIND,
          name: "Weather places",
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
    const saved = await documents.update({
      id: doc.id,
      packageId: "mari-kit",
      expectedRevision: doc.revision,
      name: doc.name,
      description: doc.description,
      data: next,
      updatedAt: now,
    });
    if (saved) return next;
  }
  throw Object.assign(new Error("Weather settings changed while saving. Try again."), { statusCode: 409 });
}

// now: false → the settings only, at once (the screen draws them and asks for the weather after). fresh: ask again
// even for a place that failed a moment ago (다시 불러오기).
async function summaries(state, chatId, { now = true, fresh = false } = {}) {
  const room = state.rooms[chatId] ?? { enabled: false, characterLocation: null };
  if (!now) return { userLocation: state.userLocation, room, summaries: null };
  const failed = {};
  const summary = async (who, location) => {
    if (!location) return null;
    try {
      return weatherCore.formatSummary(await getWeather(location, fetch, { fresh }));
    } catch (error) {
      failed[who] = true;
      return `날씨를 불러오지 못했어요 · ${failureReason(error)}`;
    }
  };
  const [user, character] = await Promise.all([
    summary("user", state.userLocation),
    summary("character", room.characterLocation),
  ]);
  return { userLocation: state.userLocation, room, summaries: { user, character, failed } };
}
const nowOf = (request) => ({ now: request.query?.now !== "0", fresh: request.query?.fresh === "1" });

export const weatherFeature = {
  id: "weather",
  // Turned on per chat in the weather settings, not by adding the agent (Conversation has no agent list).
  ownChatSwitch: true,
  async promptContext(request, { runtime }) {
    if (request.mode !== "conversation") return null;
    const { state } = await readState(runtime);
    const room = state.rooms[request.chatId];
    if (!state.userLocation || !room?.enabled) return null;
    try {
      const [user, character] = await Promise.all([
        getWeather(state.userLocation),
        room.characterLocation ? getWeather(room.characterLocation) : null,
      ]);
      const [persona] = request.personaId ? await runtime.resources.listPersonas([request.personaId]) : [];
      const targetId = request.targetCharacterIds?.length === 1 ? request.targetCharacterIds[0] : null;
      const [target] = targetId ? await runtime.resources.listCharacters([targetId]) : [];
      return buildWeatherContext({ user, character, userName: nameOf(persona), characterName: nameOf(target) });
    } catch (error) {
      runtime.logger.warn("[mari-kit] weather unavailable, continuing without it: %s", String(error?.message ?? error));
      return null;
    }
  },
  routes(app, { runtime, httpError }) {
    // Place search (Open-Meteo geocoding). An empty query lists the built-in Korean cities.
    app.get("/weather/places", async (request) => {
      const query = str(request.query?.q, 100);
      if (!query) return { places: weatherCore.PRESET_CITIES };
      const response = await fetch(weatherCore.buildGeocodingURL(query, request.query?.worldwide !== "true"), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw httpError(502, `Place search failed (${response.status}).`);
      return { places: weatherCore.normalizePlaces(await response.json()) };
    });

    app.get("/weather/:chatId", async (request) => {
      const chatId = str(request.params.chatId, 200);
      if (!chatId) throw httpError(400, "Chat ID is required.");
      return summaries((await readState(runtime)).state, chatId, nowOf(request));
    });

    app.put("/weather/user", async (request) => {
      const raw = request.body?.location;
      const location = raw === null ? null : normalizeLocation(raw);
      if (raw !== null && !location) throw httpError(400, "A place with latitude and longitude is required.");
      const state = await writeState(runtime, (current) => ({ ...current, userLocation: location }));
      return { userLocation: state.userLocation };
    });

    app.put("/weather/:chatId", async (request) => {
      const chatId = str(request.params.chatId, 200);
      if (!chatId) throw httpError(400, "Chat ID is required.");
      if (!(await runtime.persistence.getChat(chatId))) throw httpError(404, "Chat not found.");
      const body = request.body && typeof request.body === "object" ? request.body : {};
      const state = await writeState(runtime, (current) => {
        const room = current.rooms[chatId] ?? { enabled: false, characterLocation: null };
        return {
          ...current,
          rooms: {
            ...current.rooms,
            [chatId]: {
              enabled: typeof body.enabled === "boolean" ? body.enabled : room.enabled,
              characterLocation:
                body.characterLocation === undefined
                  ? room.characterLocation
                  : body.characterLocation === null
                    ? null
                    : normalizeLocation(body.characterLocation),
            },
          },
        };
      });
      return summaries(state, chatId, nowOf(request));
    });
  },
};
