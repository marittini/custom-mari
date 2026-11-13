import assert from "node:assert/strict";
import { installThemeBridge } from "../../custom-modules/mari-kit/src/client.js";
import { installPrefsStorageSync, onPrefs, prefs, setPrefs } from "../../custom-modules/mari-kit/shell/lib/prefs.js";

class TabEvents extends EventTarget {
  emitStorage(key, oldValue, newValue) {
    const event = new Event("storage");
    Object.defineProperties(event, {
      key: { value: key },
      oldValue: { value: oldValue },
      newValue: { value: newValue },
    });
    this.dispatchEvent(event);
  }
}

class SharedStorage {
  values = new Map();
  tabs = new Set();
  writes = [];
  addTab() {
    const events = new TabEvents();
    this.tabs.add(events);
    return events;
  }
  view(source) {
    return {
      getItem: (key) => this.getItem(key),
      setItem: (key, value) => this.setItem(key, value, source),
      removeItem: (key) => this.removeItem(key, source),
    };
  }
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value, source = null) {
    const oldValue = this.getItem(key);
    const newValue = String(value);
    this.values.set(key, newValue);
    this.writes.push([key, newValue]);
    for (const tab of this.tabs) {
      if (tab === source) continue;
      queueMicrotask(() => tab.emitStorage(key, oldValue, newValue));
    }
  }
  removeItem(key, source = null) {
    const oldValue = this.getItem(key);
    this.values.delete(key);
    this.writes.push([key, null]);
    for (const tab of this.tabs) {
      if (tab === source) continue;
      queueMicrotask(() => tab.emitStorage(key, oldValue, null));
    }
  }
}

function mockStore(theme = "light", settingsSyncReady = false) {
  let state;
  const listeners = new Set();
  const store = {
    setThemeCalls: [],
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setState(patch) {
      const previous = state;
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state, previous);
    },
  };
  state = {
    theme,
    settingsSyncReady,
    sidebarWidth: 321,
    setTheme(next) {
      store.setThemeCalls.push(next);
      store.setState({ theme: next });
    },
  };
  return store;
}

const originalWindow = globalThis.window;
const originalStorage = globalThis.localStorage;
const originalDocument = globalThis.document;
const storage = new SharedStorage();
const shellTab = storage.addTab();
const engineTabA = storage.addTab();
const engineTabB = storage.addTab();
globalThis.window = shellTab;
globalThis.localStorage = storage.view(shellTab);
globalThis.document = { getElementById: () => null };

try {
  storage.setItem("mari-shell", JSON.stringify({ theme: "light", appName: "Mari", size: 19 }), shellTab);
  const stopPrefsSync = installPrefsStorageSync(storage, shellTab);
  const engineA = mockStore("light", false);
  const engineB = mockStore("light", false);
  const stopEngineA = installThemeBridge(engineA, storage.view(engineTabA), engineTabA);
  const stopEngineB = installThemeBridge(engineB, storage.view(engineTabB), engineTabB);

  // The shell's real preference write publishes only an explicit fixed theme as pending.
  setPrefs({ theme: "dark" });
  assert.equal(storage.getItem("mari-kit:pending-theme"), "dark");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(engineA.setThemeCalls, [], "native hydration keeps pending preference until sync is ready");
  assert.deepEqual(engineB.setThemeCalls, [], "every open engine tab waits for settings hydration");

  engineA.setState({ settingsSyncReady: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engineA.getState().theme, "dark");
  assert.deepEqual(engineA.setThemeCalls, ["dark"]);
  assert.equal(storage.getItem("mari-kit:pending-theme"), null, "applied selection is consumed");
  assert.equal(prefs().theme, "dark");
  assert.equal(prefs().appName, "Mari", "theme roundtrip preserves other shell preferences");
  assert.equal(prefs().size, 19);

  engineB.setState({ settingsSyncReady: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engineB.getState().theme, "dark", "another open native tab follows the shared theme immediately");
  assert.deepEqual(engineB.setThemeCalls, ["dark"], "a later hydration must not restore the older theme");

  const prefsNotifications = [];
  const stopPrefsListener = onPrefs((value) => prefsNotifications.push(value));
  engineA.getState().setTheme("light");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prefs().theme, "light", "native theme changes flow back to Mari Kit preferences");
  assert.equal(prefs().appName, "Mari");
  assert.equal(engineB.getState().theme, "light", "storage event updates the other open engine tab");
  assert.deepEqual(engineB.setThemeCalls, ["dark", "light"]);
  assert.equal(storage.getItem("mari-kit:pending-theme"), null, "native updates do not republish pending choices");
  assert.equal(prefsNotifications.length, 1, "shell storage updates notify listeners once");

  const writesBeforeSettledLoop = storage.writes.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    storage.writes.length,
    writesBeforeSettledLoop,
    "mirrored changes settle without a storage feedback loop",
  );
  assert.equal(engineA.getState().sidebarWidth, 321, "the bridge leaves unrelated engine settings untouched");
  engineTabA.emitStorage("mari-shell", '{"theme":"light"}', '{"theme":"dark"}');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engineA.getState().theme, "light", "delayed storage events cannot restore an older theme");
  assert.equal(engineB.getState().theme, "light");

  engineA.getState().setTheme("dark");
  setPrefs({ size: 20 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prefs().theme, "dark", "a local font edit cannot overwrite a just-arrived native theme");
  assert.equal(prefs().size, 20);
  assert.equal(engineA.getState().theme, "dark");
  assert.equal(engineB.getState().theme, "dark");

  stopPrefsListener();
  stopPrefsSync();
  stopEngineA();
  stopEngineB();
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}

console.log("Mari Kit theme bridge regression passed.");
