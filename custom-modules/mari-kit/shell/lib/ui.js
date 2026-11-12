import { h, icon, I } from "./h.js";
import { todayLabel } from "./data.js";

export function pageHead(title, { label = todayLabel(), actions = [], back } = {}) {
  return h(
    "header",
    { class: "phead" },
    back
      ? h(
          "button",
          { type: "button", class: "ib", "aria-label": "뒤로", onClick: back, style: { marginLeft: "-12px" } },
          icon(I.back),
        )
      : null,
    h("div", { class: "t" }, label ? h("span", { class: "label" }, label) : null, h("b", null, title)),
    actions,
  );
}

export function topBar({ back, title, sub, actions = [], plain = false }) {
  return h(
    "header",
    { class: plain ? "top noline" : "top" },
    back ? h("button", { type: "button", class: "ib", "aria-label": "뒤로", onClick: back }, icon(I.back)) : null,
    h(
      "div",
      { class: "ttl" },
      title ? h("span", { class: "h" }, title) : null,
      sub ? h("span", { class: "sub" }, sub) : null,
    ),
    actions,
  );
}

export function iconButton(path, label, onClick, extra = {}) {
  return h("button", { type: "button", class: "ib", "aria-label": label, title: label, onClick, ...extra }, icon(path));
}

// Pictures are set only when their box comes near the screen: a library of cards would otherwise download
// every avatar at full size on the first visit, most of them never scrolled to.
let seen = null;

/** A small WebP of an Engine avatar (Mari Kit makes it); other pictures stay as they are. */
export function thumb(src, width = 96) {
  // A chat cover (Mari Kit keeps these) has its own small versions.
  if (/^\/api\/mari-kit\/shell\/cover\/[^/?#]+$/.test(String(src || ""))) return `${src}?w=${width}`;
  const m = /^\/api\/avatars\/file\/([^/?#]+)(?:\?crop=([RL][-\d.,]+))?$/.exec(String(src || ""));
  return m ? `/api/mari-kit/shell/avatar?f=${m[1]}&w=${width}${m[2] ? `&c=${m[2]}` : ""}` : src;
}

export function lazyBg(el, src, width = 240) {
  if (!src) return el;
  src = thumb(src, width);
  if (typeof IntersectionObserver !== "function") {
    el.style.backgroundImage = `url("${src}")`;
    return el;
  }
  seen ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.style.backgroundImage = `url("${e.target.dataset.bg}")`;
        seen.unobserve(e.target);
      }
    },
    { rootMargin: "300px" },
  );
  el.dataset.bg = src;
  seen.observe(el);
  return el;
}

export function avatar(src, letter, size, round = true) {
  return lazyBg(
    h(
      "span",
      {
        class: round ? "av" : "ph",
        style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.36)}px` },
      },
      src ? "" : letter,
    ),
    src,
    size <= 40 ? 96 : 240,
  );
}

/** Faces of a chat's cast: one avatar, or the first two overlapped (a third and more show as "+n"). */
export function avatarStack(people, size) {
  const list = people.filter(Boolean);
  if (list.length <= 1) return avatar(list[0]?.avatar, list[0]?.name?.[0] || "·", size);
  const small = Math.round(size * 0.72);
  return h(
    "span",
    { class: "avs", style: { width: `${size}px`, height: `${size}px` }, "aria-hidden": "true" },
    avatar(list[1].avatar, list[1].name?.[0] || "·", small),
    avatar(list[0].avatar, list[0].name?.[0] || "·", small),
    list.length > 2 ? h("span", { class: "avs-n" }, `+${list.length - 2}`) : null,
  );
}

/** "이전 메시지" at the top of a story: reads the page before, keeping the reader's place on screen. */
export function olderButton(win, scroller, redraw) {
  const btn = h(
    "button",
    {
      type: "button",
      class: "older",
      onClick: async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        btn.textContent = "불러오는 중…";
        const from = scroller.scrollHeight - scroller.scrollTop;
        try {
          await win.older();
        } catch (error) {
          toast(error.message);
        }
        redraw();
        scroller.scrollTop = scroller.scrollHeight - from;
      },
    },
    "이전 메시지",
  );
  return btn;
}

export function errorBox(error) {
  return h("div", { class: "err", role: "alert" }, `불러오지 못했어요: ${error?.message || error}`);
}

let toastTimer = null;
export function toast(text, onClick = null) {
  const frame = document.querySelector(".app");
  if (!frame) return;
  frame.querySelector(".toast")?.remove();
  const el = onClick
    ? h("button", { type: "button", class: "toast", role: "status", onClick: () => (el.remove(), onClick()) }, text)
    : h("div", { class: "toast", role: "status" }, text);
  frame.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

/** Bottom sheet over the current frame; returns { el, close }. */
export function sheet(content, { onClose, label } = {}) {
  const frame = document.querySelector(".app");
  const scrim = h("button", { type: "button", class: "scrim", "aria-label": "닫기" });
  const el = h(
    "section",
    { class: "sheet", role: "dialog", "aria-label": label || "" },
    h("div", { class: "grab" }, h("span")),
    content,
  );
  const close = () => {
    scrim.remove();
    el.remove();
    onClose?.();
  };
  scrim.addEventListener("click", close);
  frame.append(scrim, el);
  return { el, close };
}

/**
 * A small dropdown under the top-right of the frame (the ⋯ menus). items: { label, sub?, onClick } or "-".
 * Closes on any choice or outside tap.
 */
export function popMenu(items) {
  const frame = document.querySelector(".app");
  frame.querySelector(".menu")?.remove();
  const close = () => {
    el.remove();
    frame.removeEventListener("click", outside, true);
  };
  const outside = (e) => {
    if (!el.contains(e.target)) close();
  };
  const el = h(
    "div",
    { class: "menu", role: "menu" },
    items.map((it) =>
      it === "-"
        ? h("hr")
        : h(
            "button",
            {
              type: "button",
              role: "menuitem",
              onClick: () => {
                close();
                it.onClick?.();
              },
            },
            h("span", null, it.label),
            it.sub ? h("small", null, it.sub) : null,
          ),
    ),
  );
  frame.append(el);
  setTimeout(() => frame.addEventListener("click", outside, true));
  return { close };
}

/** A box whose label sits on its top border (the shell's form field). */
export function hbox(label, ...children) {
  return h("div", { class: "hbox" }, h("span", { class: "htag" }, label), ...children);
}

/**
 * The Engine's own screen, for what the shell does not draw itself. `target` (optional) names what to open there:
 * { section: [ids] } a chat settings section (the first id found), or { character, tab } / { preset } / { lorebook }
 * / { panel }. Mari Kit's Engine-side script opens it and shows a pill back to this screen.
 */
export function openEngine(chatId, target = null) {
  try {
    if (chatId) localStorage.setItem("marinara-active-chat-id", chatId);
    // Mari Kit's Engine-side script sends the Engine's start page to the shell; this tab asked for the Engine.
    sessionStorage.setItem("mari-kit:engine-tab", "1");
    if (target) sessionStorage.setItem("mari-kit:open", JSON.stringify({ ...target, chatId, back: location.hash }));
  } catch {}
  location.href = "/";
}

/** Time with the Engine's unread mark (Convo characters that wrote while the chat was closed). */
export function timeAndUnread(chat, time, size = "11px") {
  let n = 0;
  try {
    const m = typeof chat?.metadata === "string" ? JSON.parse(chat.metadata) : chat?.metadata;
    n = Number(m?.autonomousUnreadCount) || 0;
  } catch {}
  return h(
    "span",
    { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" } },
    h("span", { class: "hint", style: { fontSize: size } }, time),
    n > 0 ? h("span", { class: "unread", "aria-label": `안 읽은 메시지 ${n}개` }, n > 99 ? "99+" : String(n)) : null,
  );
}

/** Message menus open toward the side with room, so none hides under the top bar or the composer. */
export function fitMenus(root) {
  for (const menu of root.querySelectorAll(".tmenu")) {
    const area = menu.closest(".scroll")?.getBoundingClientRect();
    if (!area) continue;
    const r = menu.getBoundingClientRect();
    if (r.top < area.top) Object.assign(menu.style, { bottom: "auto", top: "40px" });
    else if (r.bottom > area.bottom) Object.assign(menu.style, { top: "auto", bottom: "40px" });
  }
}
