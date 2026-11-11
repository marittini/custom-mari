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
    { class: plain ? "top plain" : "top" },
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
  const m = /^\/api\/avatars\/file\/([^/?#]+)$/.exec(String(src || ""));
  return m ? `/api/mari-kit/shell/avatar?f=${m[1]}&w=${width}` : src;
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
export function toast(text) {
  const frame = document.querySelector(".app");
  if (!frame) return;
  frame.querySelector(".toast")?.remove();
  const el = h("div", { class: "toast", role: "status" }, text);
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
