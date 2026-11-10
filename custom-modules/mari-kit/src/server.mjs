// ──────────────────────────────────────────────
// Mari Kit — server entry
//
// One capability package that carries this fork's own features (TTS, translation, weather, memory)
// without patching Engine source. It talks to the Engine only through the capability API:
// routes, package documents, and the per-generation prompt-context hook.
//
// A chat uses Mari Kit only when the chat has agents on and lists the "mari-kit" agent, so a chat that
// never added it pays nothing: no prompt text and no model calls.
// ──────────────────────────────────────────────

export const PACKAGE_ID = "mari-kit";
export const FEATURE_IDS = Object.freeze(["tts", "translation", "weather", "memory"]);

const SETTINGS_DOC_ID = `${PACKAGE_ID}:settings`;
const SETTINGS_KIND = "settings";

/** Feature modules register here as they are built. Each may contribute prompt text for a turn. */
const features = [];

let runtime = null;

function host() {
  if (!runtime) throw new Error("Mari Kit runtime is not configured");
  return runtime;
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

export function defaultSettings() {
  return { version: 1, features: Object.fromEntries(FEATURE_IDS.map((id) => [id, false])) };
}

/** Accepts stored or submitted settings and keeps only known feature switches. */
export function normalizeSettings(raw) {
  const base = defaultSettings();
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.features : null;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const id of FEATURE_IDS) if (typeof source[id] === "boolean") base.features[id] = source[id];
  }
  return base;
}

/** True when the chat turned agents on and added the Mari Kit agent. */
export function chatUsesMariKit(chatMeta) {
  if (!chatMeta || typeof chatMeta !== "object") return false;
  const ids = Array.isArray(chatMeta.activeAgentIds) ? chatMeta.activeAgentIds : [];
  return chatMeta.enableAgents === true && ids.includes(PACKAGE_ID);
}

async function readSettings() {
  const doc = await host().persistence.documents.getById(PACKAGE_ID, SETTINGS_DOC_ID);
  return { doc, settings: normalizeSettings(doc?.data) };
}

async function writeSettings(patchFeatures) {
  const documents = host().persistence.documents;
  // Optimistic revision check: retry a few times if another write landed in between.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { doc, settings } = await readSettings();
    const next = normalizeSettings({ features: { ...settings.features, ...patchFeatures } });
    const now = new Date().toISOString();
    if (!doc) {
      try {
        await documents.create({
          id: SETTINGS_DOC_ID,
          packageId: PACKAGE_ID,
          kind: SETTINGS_KIND,
          name: "Mari Kit settings",
          description: "",
          data: next,
          createdAt: now,
          updatedAt: now,
        });
        return next;
      } catch {
        continue; // Created concurrently: read again and update instead.
      }
    }
    const updated = await documents.update({
      id: SETTINGS_DOC_ID,
      packageId: PACKAGE_ID,
      expectedRevision: doc.revision,
      name: doc.name,
      description: doc.description,
      data: next,
      updatedAt: now,
    });
    if (updated) return next;
  }
  throw httpError(409, "Settings changed while saving. Try again.");
}

function parseFeaturePatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw httpError(400, "A JSON body is required.");
  const source = body.features;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw httpError(400, "features is required.");
  const patch = {};
  for (const [id, value] of Object.entries(source)) {
    if (!FEATURE_IDS.includes(id)) throw httpError(400, `Unknown feature: ${id}`);
    if (typeof value !== "boolean") throw httpError(400, `Feature ${id} must be true or false.`);
    patch[id] = value;
  }
  return patch;
}

async function routes(app) {
  app.get("/status", async () => {
    const { settings } = await readSettings();
    return {
      packageId: PACKAGE_ID,
      settings,
      implemented: features.map((feature) => feature.id),
    };
  });
  app.get("/settings", async () => (await readSettings()).settings);
  app.patch("/settings", async (request) => writeSettings(parseFeaturePatch(request.body)));
}

/** Called once per generation by the Engine. Returns null when this chat does not use Mari Kit. */
async function promptContext(request) {
  if (!chatUsesMariKit(request.chatMeta) || features.length === 0) return null;
  const { settings } = await readSettings();
  const blocks = [];
  for (const feature of features) {
    if (!settings.features[feature.id] || typeof feature.promptContext !== "function") continue;
    try {
      const text = await feature.promptContext(request, { runtime: host(), settings });
      if (typeof text === "string" && text.trim()) blocks.push(text.trim());
    } catch (error) {
      host().logger?.error?.(error, "[mari-kit] %s prompt context failed", feature.id);
    }
  }
  return blocks.length ? blocks.join("\n\n") : null;
}

let ready = false;

export async function activate({ api }) {
  runtime = api.runtime;
  const cleanups = [];
  const release = () => {
    while (cleanups.length) cleanups.pop()();
  };
  try {
    cleanups.push(await api.registerPrivilegedRoutes(routes, { prefix: `/api/${PACKAGE_ID}` }));
    cleanups.push(api.registerPromptContext(promptContext));
    ready = true;
    return () => {
      ready = false;
      release();
      runtime = null;
    };
  } catch (error) {
    release();
    runtime = null;
    throw error;
  }
}

export async function selfCheck() {
  if (!ready) throw new Error("Mari Kit did not initialize");
  await readSettings();
}
