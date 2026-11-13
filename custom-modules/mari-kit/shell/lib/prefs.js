// Viewer preferences of the shell (this browser only): theme, fonts, reading layout, message tools, app name.
// Nothing here names a font: the default is the device's own UI font.

const KEY = "mari-shell";
const PENDING_THEME_KEY = "mari-kit:pending-theme";

export const TOOL_DEFS = [
  { id: "regen", label: "다시 생성", icon: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5", def: "show", assistantOnly: true },
  {
    id: "voice",
    label: "음성",
    icon: ["M11 5L6 9H3v6h3l5 4z", "M15.5 8.5a5 5 0 0 1 0 7"],
    def: "show",
    convoOnly: true,
    assistantOnly: true,
  },
  { id: "copy", label: "복사", icon: ["M8 8h12v12H8z", "M16 8V4H4v12h4"], def: "show" },
  {
    id: "translate",
    label: "번역",
    icon: ["M4 6h9M8.5 4v2M6 6c.8 3.5 3 6 6 7M11 6c-.8 3.5-3 6-6 7", "M13 20l3.5-8 3.5 8M14.2 17.5h4.6"],
    def: "show",
  },
  { id: "edit", label: "편집", icon: "M4 20h4L19 9l-4-4L4 16z", def: "more" },
  {
    id: "branch",
    label: "분기",
    icon: ["M6 3v12", "M6 21a3 3 0 1 0 0-.1M18 9a3 3 0 1 0 0-.1", "M18 12c0 4-6 3-12 6"],
    def: "more",
  },
  {
    id: "hide",
    label: "AI에게서 숨기기",
    icon: [
      "M3 3l18 18",
      "M10.6 6.1A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.6M6.4 7.4C3.8 9.2 2.5 12 2.5 12s3.5 6 9.5 6c1.6 0 3-.4 4.2-1",
    ],
    def: "more",
  },
  {
    id: "engine",
    label: "엔진에서 열기",
    icon: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
    def: "more",
  },
  { id: "del", label: "삭제", icon: ["M4 7h16M10 11v6M14 11v6", "M6 7l1 13h10l1-13M9 7V4h6v3"], def: "more" },
];

const DEFAULTS = {
  theme: null, // null → follow the device
  font: "",
  fontRp: "", // "" → same as font
  fontConvo: "",
  highlight: false, // 대사 형광펜
  lineVoice: false, // RP: ▶ after every spoken line; off → tap a line for its popup (Mari only)
  fontCss: "",
  families: [],
  size: 16,
  leading: 1.8,
  tracking: 0,
  stroke: 0,
  align: "start",
  tools: {},
  quick: null, // 빠른 설정 rows: null → defaults (QUICK_ITEMS in quick.js); else the chosen ids in order
  appName: "",
  icon: "",
};

let cache = null;
const listeners = new Set();

export function prefs() {
  if (cache) return cache;
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {}
  cache = { ...DEFAULTS, ...stored };
  return cache;
}

export function setPrefs(patch) {
  let current = prefs();
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (stored && typeof stored === "object" && !Array.isArray(stored)) current = { ...current, ...stored };
  } catch {}
  cache = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
  if (patch && (patch.theme === "dark" || patch.theme === "light")) {
    try {
      localStorage.setItem(PENDING_THEME_KEY, patch.theme);
    } catch {}
  }
  applyPrefs();
  for (const fn of listeners) fn(cache);
}

/** Apply preference changes made in another tab without re-publishing a pending theme selection. */
export function installPrefsStorageSync(storage = globalThis.localStorage, events = globalThis.window) {
  if (!storage || !events?.addEventListener) return () => {};
  const onStorage = (event) => {
    if (event.key !== KEY) return;
    cache = null;
    const current = prefs();
    applyPrefs();
    for (const fn of listeners) fn(current);
  };
  events.addEventListener("storage", onStorage);
  return () => events.removeEventListener("storage", onStorage);
}

export function onPrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function toolPlace(tool) {
  return prefs().tools?.[tool.id] || tool.def;
}

export function isDark() {
  const p = prefs();
  return p.theme ? p.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

const quote = (name) => `"${String(name).replace(/["\\]/g, "")}"`;

export function applyPrefs() {
  const p = prefs();
  const root = document.getElementById("app");
  if (!root) return;
  const dark = isDark();
  const mode = dark ? "dark" : "light";
  const color = dark ? "#000000" : "#ffffff";
  root.classList.toggle("dark", dark);
  // Browser/PWA chrome and the safe-area backing belong to the document, outside #app.
  document.documentElement.style.colorScheme = mode;
  document.documentElement.style.backgroundColor = color;
  document.body.style.backgroundColor = color;
  for (const [name, content] of [
    ["theme-color", color],
    ["color-scheme", mode],
    ["apple-mobile-web-app-status-bar-style", dark ? "black" : "default"],
  ]) {
    let meta = document.querySelector(`meta[name="${name}"]`);
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = name;
      document.head.append(meta);
    }
    if (meta.content !== content) meta.content = content;
  }
  const style = root.style;
  style.setProperty("--user-font", p.font ? `${quote(p.font)}, system-ui, sans-serif` : "system-ui, sans-serif");
  const family = (name) => (name ? `${quote(name)}, system-ui, sans-serif` : "var(--user-font)");
  style.setProperty("--font-rp", family(p.fontRp));
  style.setProperty("--font-convo", family(p.fontConvo));
  root.classList.toggle("hl-dlg", p.highlight === true);
  style.setProperty("--read-size", `${p.size}px`);
  style.setProperty("--read-leading", String(p.leading));
  style.setProperty("--read-tracking", `${p.tracking}px`);
  style.setProperty("--text-stroke", `${p.stroke}px`);
  // Web fonts come through Mari Kit's same-origin font route (the Engine's CSP blocks other font hosts).
  let link = document.getElementById("mk-webfont");
  if (p.fontCss && !link) {
    link = document.createElement("link");
    link.id = "mk-webfont";
    link.rel = "stylesheet";
    document.head.append(link);
  }
  if (link) {
    const href = p.fontCss ? `/api/mari-kit/fonts/css?v=${encodeURIComponent(hash(p.fontCss))}` : "";
    if (!p.fontCss) link.remove();
    else if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  }
  document.title = p.appName || "Marinara";
  const manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) {
    const params = new URLSearchParams({ theme: mode });
    if (p.appName) params.set("name", p.appName);
    const href = `/api/mari-kit/manifest?${params}`;
    if (manifest.getAttribute("href") !== href) manifest.setAttribute("href", href);
  }
  let fav = document.querySelector('link[rel="icon"]');
  if (p.icon) {
    if (!fav) {
      fav = document.createElement("link");
      fav.rel = "icon";
      document.head.append(fav);
    }
    if (fav.href !== p.icon) fav.href = p.icon;
  } else fav?.remove();
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Family names declared by pasted web-font CSS (@font-face or a Google-style @import URL). */
export function parseFamilies(css) {
  const out = [];
  for (const m of css.matchAll(/font-family\s*:\s*['"]?([^;'"}]+?)['"]?\s*[;}]/g)) out.push(m[1].trim());
  for (const m of css.matchAll(/family=([^:&;)'"]+)/g)) out.push(decodeURIComponent(m[1]).replace(/\+/g, " ").trim());
  return [...new Set(out.filter(Boolean))];
}

if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
  installPrefsStorageSync(localStorage, window);
}
