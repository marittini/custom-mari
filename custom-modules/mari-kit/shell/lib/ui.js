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

export function avatar(src, letter, size, round = true) {
  return h(
    "span",
    {
      class: round ? "av" : "ph",
      style: {
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.round(size * 0.36)}px`,
        ...(src ? { backgroundImage: `url("${src}")` } : {}),
      },
    },
    src ? "" : letter,
  );
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
