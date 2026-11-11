// Mari shell — entry. Hash routes keep every screen addressable and the browser's back button working:
//   #/home  #/library  #/convos  #/settings[/font|/brand]
//   #/rp/<chatId>  #/convo/<chatId>  #/character/<id>  #/memory/<chatId>  #/reader/<chatId>

import { h, icon, I, setChildren } from "./lib/h.js";
import { applyPrefs, onPrefs } from "./lib/prefs.js";
import { homeScreen } from "./screens/home.js";
import { libraryScreen } from "./screens/library.js";
import { convosScreen } from "./screens/convos.js";
import { settingsScreen } from "./screens/settings.js";
import { rpScreen } from "./screens/rp.js";
import { convoScreen } from "./screens/convo.js";
import { characterScreen } from "./screens/character.js";
import { readerScreen } from "./screens/reader.js";
import { memoryScreen } from "./screens/memory.js";
import { chatSettingsScreen } from "./screens/chat-settings.js";

const root = document.getElementById("app");
const TABS = [
  { id: "home", label: "홈", icon: I.home },
  { id: "convos", label: "대화", icon: I.chat },
  { id: "library", label: "서재", icon: I.book },
  { id: "settings", label: "설정", icon: I.gear },
];
const SCREENS = {
  home: homeScreen,
  library: libraryScreen,
  convos: convosScreen,
  settings: settingsScreen,
  rp: rpScreen,
  convo: convoScreen,
  character: characterScreen,
  reader: readerScreen,
  memory: memoryScreen,
  "chat-settings": chatSettingsScreen,
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

function render() {
  current?.dispose?.();
  const route = parseRoute();
  const frame = h("div", { class: "app" });
  const body = h("div", {
    style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column", position: "relative" },
  });
  frame.append(body);
  const isTab = TABS.some((t) => t.id === route.name);
  if (isTab) frame.append(dock(route.name));
  setChildren(root, frame);
  current = SCREENS[route.name]({ mount: body, args: route.args, go });
}

addEventListener("hashchange", render);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyPrefs);
onPrefs(() => current?.onPrefs?.());
applyPrefs();
render();
