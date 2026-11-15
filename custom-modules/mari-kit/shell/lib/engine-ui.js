// The Engine's synced UI settings (/app-settings/ui: one JSON string the Engine's own screens read and write, with
// __updatedAt for its sync). Mari copies the few choices it shares with the Engine here, so both show the same.

import { api } from "./api.js";

/** The Engine's UI settings as an object ({} when unset or unreadable). */
export async function readEngineUi() {
  const res = await api.get("/app-settings/ui");
  const value = res?.value;
  if (typeof value !== "string") return value && typeof value === "object" ? value : {};
  try {
    return JSON.parse(value || "{}") || {};
  } catch {
    return {};
  }
}

/** Merges `patch` into the Engine's UI settings (read first, so nothing else there is lost). */
export async function mergeEngineUi(patch) {
  const current = await readEngineUi();
  await api.put("/app-settings/ui", { value: JSON.stringify({ ...current, ...patch, __updatedAt: Date.now() }) });
}
