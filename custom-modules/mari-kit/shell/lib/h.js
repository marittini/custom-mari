// Tiny DOM builder: h("div", { class: "x", onClick }, child, [children]) → Element. No virtual DOM; screens
// re-render their root when their state changes.

export function h(tag, attrs, ...children) {
  const el =
    tag === "svg" || tag === "path" || tag === "circle" || tag === "rect" || tag === "polyline"
      ? document.createElementNS("http://www.w3.org/2000/svg", tag)
      : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key === "html") el.innerHTML = value;
    else if (key === "value" && "value" in el) el.value = value;
    else el.setAttribute(key === "className" ? "class" : key, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Outline icon (24×24 viewBox) from one or more path strings. */
export function icon(d, size = 20, stroke = 1.5) {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": stroke,
      "aria-hidden": "true",
    },
    ...[].concat(d).map((p) => h("path", { d: p })),
  );
}

export function dots(size = 18) {
  return h(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true" },
    h("circle", { cx: 5, cy: 12, r: 1.6 }),
    h("circle", { cx: 12, cy: 12, r: 1.6 }),
    h("circle", { cx: 19, cy: 12, r: 1.6 }),
  );
}

export const I = {
  back: "M15 5l-7 7 7 7",
  home: "M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z",
  chat: "M5 5h14v10H9l-4 4z",
  book: [
    "M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z",
    "M13 4h5.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H13z",
  ],
  gear: [
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1",
  ],
  search: ["M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z", "M20 20l-4.5-4.5"],
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  sliders: ["M4 7h10M18 7h2M4 17h4M12 17h8", "M16 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM10 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"],
  info: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 11v6M12 7.5v.5"],
  memory: "M6 3h12v18l-6-4-6 4z",
  send: "M12 19V5M6 11l6-6 6 6",
  play: "M7 4l13 8-13 8z",
  stop: "M5 5h14v14H5z",
  edit: "M4 20h4L19 9l-4-4L4 16z",
  guide: "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  link: "M9 7l-3 3a3 3 0 0 0 4 4l3-3M15 17l3-3a3 3 0 0 0-4-4l-3 3",
  list: "M5 6h14M5 12h14M5 18h9",
  voice: ["M11 5L6 9H3v6h3l5 4z", "M15.5 8.5a5 5 0 0 1 0 7"],
  translate: ["M4 6h9M8.5 4v2M6 6c.8 3.5 3 6 6 7M11 6c-.8 3.5-3 6-6 7", "M13 20l3.5-8 3.5 8M14.2 17.5h4.6"],
  font: "M5 19l6-14h2l6 14M8 13h8",
  square: "M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z",
  contrast: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z"],
  person: ["M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"],
  lore: ["M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z", "M5 17a3 3 0 0 1 3-3h11"],
  glossary: ["M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z", "M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"],
  reader: "M6 19l5-14h2l5 14M8.5 13h7",
};

/** replaceChildren that skips empty slots (null/false) and flattens arrays; plain replaceChildren prints "null". */
export function setChildren(el, ...children) {
  const out = [];
  const walk = (list) => {
    for (const c of list) {
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) walk(c);
      else out.push(c);
    }
  };
  walk(children);
  el.replaceChildren(...out);
}
