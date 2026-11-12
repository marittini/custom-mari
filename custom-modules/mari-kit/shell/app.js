// Mari shell — entry. Hash routes keep every screen addressable and the browser's back button working:
//   #/home  #/library  #/convos  #/settings[/font|/brand]
//   #/rp/<chatId>  #/convo/<chatId>  #/character/<id>  #/memory/<chatId>  #/reader/<chatId>

import { h, icon, I, setChildren } from "./lib/h.js";
import { applyPrefs, onPrefs } from "./lib/prefs.js";
const root = document.getElementById("app");
const TABS = [
  { id: "home", label: "홈", icon: I.home },
  { id: "convos", label: "대화", icon: I.chat },
  { id: "library", label: "서재", icon: I.book },
  { id: "settings", label: "설정", icon: I.gear },
];
// Each screen's module is fetched the first time it is opened, so a visit to Home does not download the
// memory library or the editors.
const SCREENS = {
  home: () => import("./screens/home.js").then((m) => m.homeScreen),
  library: () => import("./screens/library.js").then((m) => m.libraryScreen),
  convos: () => import("./screens/convos.js").then((m) => m.convosScreen),
  settings: () => import("./screens/settings.js").then((m) => m.settingsScreen),
  rp: () => import("./screens/rp.js").then((m) => m.rpScreen),
  convo: () => import("./screens/convo.js").then((m) => m.convoScreen),
  character: () => import("./screens/character.js").then((m) => m.characterScreen),
  reader: () => import("./screens/reader.js").then((m) => m.readerScreen),
  memory: () => import("./screens/memory.js").then((m) => m.memoryScreen),
  "chat-settings": () => import("./screens/chat-settings.js").then((m) => m.chatSettingsScreen),
  translation: () => import("./screens/translation.js").then((m) => m.translationScreen),
  schedule: () => import("./screens/schedule.js").then((m) => m.scheduleScreen),
  voice: () => import("./screens/voice.js").then((m) => m.voiceScreen),
  radio: () => import("./screens/radio.js").then((m) => m.radioScreen),
  "call-settings": () => import("./screens/call-settings.js").then((m) => m.callSettingsScreen),
};

export function go(path) {
  location.hash = `#/${path}`;
}

// Where the user came from, so an on-screen back button always returns there (history.back) and never opens
// the parent as a new page — that is what made two screens send each other back and forth forever.
// Opened directly (no earlier screen in the shell), back goes up to the given parent instead, replacing the entry.
const TRAIL_KEY = "mari-shell:trail";
let trail = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(TRAIL_KEY)) || [];
  } catch {
    return [];
  }
})();
let replacing = false;
function track() {
  const here = location.hash || "#/home";
  if (replacing) {
    trail[trail.length - 1] = here;
    replacing = false;
  } else if (trail[trail.length - 2] === here) trail.pop();
  else if (trail[trail.length - 1] !== here) trail.push(here);
  trail = trail.slice(-50);
  try {
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(trail));
  } catch {}
}
export function back(parent = "home") {
  if (trail.length > 1) return history.back();
  replacing = true;
  location.replace(`#/${parent}`);
}
/** A dock tab starts a fresh trail: back from a tab's top screen leaves the shell, like any app. */
function openTab(id) {
  trail = [];
  replacing = false;
  location.replace(`#/${id}`);
}

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const name = SCREENS[parts[0]] ? parts[0] : "home";
  return { name, args: parts.slice(1) };
}

let current = null;

function dock(active) {
  return h(
    "nav",
    { class: "dock", "aria-label": "주 메뉴" },
    TABS.map((t) =>
      h(
        "button",
        {
          type: "button",
          class: t.id === active ? "dk on" : "dk",
          "aria-current": t.id === active ? "page" : false,
          onClick: () => openTab(t.id),
        },
        icon(t.icon, 22),
        h("span", null, t.label),
      ),
    ),
  );
}

let renderSeq = 0;

async function render() {
  current?.dispose?.();
  current = null;
  const seq = (renderSeq += 1);
  const route = parseRoute();
  let screen;
  try {
    screen = await SCREENS[route.name]();
  } catch (error) {
    if (seq !== renderSeq) return;
    setChildren(
      root,
      h("div", { class: "err", role: "alert" }, `화면을 불러오지 못했어요: ${error?.message || error}`),
    );
    return;
  }
  if (seq !== renderSeq) return;
  const frame = h("div", { class: "app" });
  const body = h("div", {
    style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column", position: "relative" },
  });
  frame.append(body);
  const isTab = TABS.some((t) => t.id === route.name);
  if (isTab) frame.append(dock(route.name));
  setChildren(root, frame);
  current = screen({ mount: body, args: route.args, go, back });
}

addEventListener("hashchange", () => {
  track();
  render();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyPrefs);
onPrefs(() => current?.onPrefs?.());
// The on-screen keyboard: Android Chrome shrinks the page itself (interactive-widget=resizes-content in the
// page's viewport meta); iOS only shrinks the visual viewport and pans the page. Sizing the frame to the visual
// viewport keeps every screen's input box right above the keyboard on both.
const vv = window.visualViewport;
if (vv) {
  const fit = () => {
    document.documentElement.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
    if (vv.offsetTop > 0) window.scrollTo(0, 0);
  };
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
  fit();
}
// Chrome offers to install the shell as an app; the home hint uses it when it is there.
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.__mariInstall = e;
});
// Opening the shell fresh (home-screen icon, bookmark, a typed address, a restored browser tab) starts on 홈, like an
// app. A reload keeps its place, and so does coming back from the Engine (its ‹ Mari로 pill leaves a marker).
try {
  const returning = sessionStorage.getItem("mari-kit:returning") === "1";
  sessionStorage.removeItem("mari-kit:returning");
  const nav = performance.getEntriesByType("navigation")[0];
  if (!returning && nav?.type === "navigate" && location.hash && !location.hash.startsWith("#/home")) {
    location.replace("#/home");
    trail = [];
  }
} catch {}
applyPrefs();
track();
render();
