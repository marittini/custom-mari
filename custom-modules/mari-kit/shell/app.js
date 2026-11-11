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
};

export function go(path) {
  location.hash = `#/${path}`;
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
          onClick: () => go(t.id),
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
  current = screen({ mount: body, args: route.args, go });
}

addEventListener("hashchange", render);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyPrefs);
onPrefs(() => current?.onPrefs?.());
applyPrefs();
render();
