// Mari shell — entry. Hash routes keep every screen addressable and the browser's back button working:
//   #/home  #/library  #/convos  #/settings[/font|/brand]
//   #/rp/<chatId>  #/convo/<chatId>  #/character/<id>  #/memory/<chatId>  #/reader/<chatId>

import { h, icon, I, setChildren } from "./lib/h.js";
import { applyPrefs, onPrefs } from "./lib/prefs.js";
import { backgroundAutonomy } from "./lib/autonomy.js";
import { streamGenerate } from "./lib/actions.js";
import { data, chatMeta } from "./lib/data.js";
import { toast } from "./lib/ui.js";
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
  home: ["home", "homeScreen"],
  library: ["library", "libraryScreen"],
  convos: ["convos", "convosScreen"],
  settings: ["settings", "settingsScreen"],
  generations: ["generations", "generationsScreen"],
  rp: ["rp", "rpScreen"],
  convo: ["convo", "convoScreen"],
  character: ["character", "characterScreen"],
  reader: ["reader", "readerScreen"],
  memory: ["memory", "memoryScreen"],
  "chat-settings": ["chat-settings", "chatSettingsScreen"],
  translation: ["translation", "translationScreen"],
  schedule: ["schedule", "scheduleScreen"],
  "char-schedule": ["char-schedule", "charScheduleScreen"],
  voice: ["voice", "voiceScreen"],
  radio: ["radio", "radioScreen"],
  "call-settings": ["call-settings", "callSettingsScreen"],
  weather: ["weather", "weatherScreen"],
  credit: ["credit", "creditScreen"],
  groups: ["groups", "groupsScreen"],
  search: ["search", "searchScreen"],
  folders: ["folders", "foldersScreen"],
  edit: ["edit", "editScreen"],
};
// A file that failed to arrive stays failed in the browser's module cache, so the retry asks with a fresh address.
const loadScreen = (name, retry = false) => {
  const [file, fn] = SCREENS[name];
  return import(`./screens/${file}.js${retry ? `?retry=${Date.now()}` : ""}`).then((m) => m[fn]);
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
  const nav = h(
    "nav",
    { class: "dock", "aria-label": "주 메뉴" },
    TABS.map((t) =>
      h(
        "button",
        {
          type: "button",
          class: t.id === active ? "dk on" : "dk",
          "aria-current": t.id === active ? "page" : false,
          "data-tab": t.id,
          onClick: () => openTab(t.id),
        },
        icon(t.icon, 22),
        h("span", null, t.label),
      ),
    ),
  );
  // 대화: how many messages characters wrote while their chat was closed (the Engine's unread marks), from the
  // chat list the tab screens read anyway (the copy is reused for 20 seconds).
  data
    .chats("soft")
    .then((chats) => {
      const n = chats
        .filter((c) => c.mode === "conversation")
        .reduce((sum, c) => sum + (Number(chatMeta(c).autonomousUnreadCount) || 0), 0);
      const tab = nav.querySelector('[data-tab="convos"]');
      if (tab && n > 0) {
        tab.setAttribute("aria-label", `대화, 안 읽은 메시지 ${n}개`);
        tab.append(h("span", { class: "unread" }, n > 99 ? "99+" : String(n)));
      }
    })
    .catch(() => {});
  return nav;
}

let renderSeq = 0;

async function render() {
  current?.dispose?.();
  current = null;
  const seq = (renderSeq += 1);
  const route = parseRoute();
  let screen;
  try {
    // A screen's file can fail to arrive (the phone's connection dropped, the Engine was busy): try once more.
    screen = await loadScreen(route.name).catch(() =>
      new Promise((r) => setTimeout(r, 800)).then(() => loadScreen(route.name, true)),
    );
  } catch (error) {
    if (seq !== renderSeq) return;
    console.error(error);
    // A reload keeps this screen (the shell's rule), so 다시 시도 reloads; 홈 is the way out.
    setChildren(
      root,
      h(
        "div",
        { class: "loadfail", role: "alert" },
        h("b", null, "화면을 불러오지 못했어요"),
        h("p", null, "인터넷이 잠깐 끊겼거나 엔진이 바빴을 수 있어요. 다시 시도해 주세요."),
        h(
          "div",
          { class: "loadfail-acts" },
          h("button", { type: "button", class: "pill main", onClick: () => location.reload() }, "다시 시도"),
          h("button", { type: "button", class: "pill", onClick: () => go("home") }, "홈으로"),
        ),
      ),
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
// Convo autonomy for chats the user is not looking at (the Engine runs this in its client, so the shell must):
// a character may write first; the chat gets an unread mark and a notice that opens it. Polls only while visible.
let lastUnread = null; // chat id → unread count, as last drawn
const openConvo = () => /^#\/convo\/([^/]+)/.exec(location.hash)?.[1] ?? null;
backgroundAutonomy({
  activeChatId: () => (openConvo() ? decodeURIComponent(openConvo()) : null),
  userStatus: () => "active",
  generate: async (chatId, body) => {
    let produced = false;
    await streamGenerate({ chatId, body, onSaved: (m) => m && (produced = true) });
    return { produced };
  },
  onArrived: (chat) => {
    showUnread();
    if (chat?.id) toast(`${chat.name || "대화"} · 새 메시지 ›`, () => go(`convo/${encodeURIComponent(chat.id)}`));
  },
  // 선톡 written elsewhere: when a chat's unread count differs from what the screen drew, draw it again.
  onUnread: (list) => {
    const now = new Map(list.map((c) => [c.id, Number(chatMeta(c).autonomousUnreadCount) || 0]));
    if (lastUnread && [...now].every(([id, n]) => (lastUnread.get(id) || 0) === n)) return;
    const first = !lastUnread;
    lastUnread = now;
    if (!first) showUnread();
  },
});
function showUnread() {
  data.chats(true);
  if (["home", "convos"].includes(parseRoute().name)) render();
  else document.querySelector(".dock")?.replaceWith(dock(parseRoute().name)); // the 대화 count
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
