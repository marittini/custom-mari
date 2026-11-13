// Picking and cropping a picture for an avatar: a WebP made in the browser, and a drag/zoom crop sheet whose result
// is the Engine's avatarCrop ({ srcX, srcY, srcWidth, srcHeight }: a SQUARE region, as fractions of the source).
import { h } from "./h.js";
import { sheet, toast } from "./ui.js";

const MAX_SIDE = 1024;
const MAX_ZOOM = 4;

/** Opens the file chooser; resolves to a WebP data URL (longest side ≤ 1024px) or null if cancelled. */
export async function pickImageWebp() {
  const file = await new Promise((resolve) => {
    const input = h("input", { type: "file", accept: "image/*" });
    input.addEventListener("change", () => resolve(input.files?.[0] || null));
    input.addEventListener("cancel", () => resolve(null));
    // Browsers without the cancel event: when the page gets focus back and no file came, it was cancelled.
    addEventListener(
      "focus",
      () => setTimeout(() => !input.files?.length && resolve(null), 800),
      { once: true },
    );
    input.click();
  });
  if (!file) return null;
  if (!file.type.startsWith("image/")) {
    toast("사진 파일만 고를 수 있어요");
    return null;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
    if (!blob) throw new Error("변환 실패");
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    toast("이 사진을 열 수 없어요");
    return null;
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round4 = (v) => Math.round(v * 10000) / 10000;

/**
 * Crop sheet over `src`. State is a square window in natural pixels: centre (cx, cy), side = min(nw, nh) / zoom.
 * onApply gets { srcX, srcY, srcWidth, srcHeight } (0..1, 4 decimals, inside the image) or null (no crop).
 */
export function cropSheet({ src, crop = null, title = "사진 자르기", onApply }) {
  const img = h("img", { class: "av-img", alt: "", draggable: "false" });
  const note = h("div", { class: "av-note" }, "불러오는 중…");
  const ring = h("span", { class: "av-ring" });
  const stage = h("div", { class: "av-stage" }, img, ring, note);
  const range = h("input", {
    type: "range",
    class: "av-range",
    min: "1",
    max: String(MAX_ZOOM),
    step: "0.01",
    value: "1",
    "aria-label": "확대",
  });
  let nw = 0;
  let nh = 0;
  let zoom = 1;
  let cx = 0;
  let cy = 0;
  let stageSize = 0;

  const side = () => Math.min(nw, nh) / zoom; // region side, natural px
  function place() {
    if (!nw) return;
    zoom = clamp(zoom, 1, MAX_ZOOM);
    const r = side();
    cx = clamp(cx, r / 2, nw - r / 2);
    cy = clamp(cy, r / 2, nh - r / 2);
    stageSize = stage.clientWidth || stageSize || 280;
    const ringSize = stageSize * 0.84;
    const scale = ringSize / r; // display px per natural px
    img.style.width = `${nw * scale}px`;
    img.style.height = `${nh * scale}px`;
    img.style.transform = `translate(${stageSize / 2 - cx * scale}px, ${stageSize / 2 - cy * scale}px)`;
    range.value = String(zoom);
  }
  const pxScale = () => (stageSize * 0.84) / side();
  function reset() {
    zoom = 1;
    cx = nw / 2;
    cy = nh / 2;
    place();
  }
  function result() {
    const r = side();
    const w = round4(r / nw);
    const hh = round4(r / nh);
    return {
      srcX: round4(clamp((cx - r / 2) / nw, 0, 1 - w)),
      srcY: round4(clamp((cy - r / 2) / nh, 0, 1 - hh)),
      srcWidth: w,
      srcHeight: hh,
    };
  }

  img.addEventListener("load", () => {
    nw = img.naturalWidth;
    nh = img.naturalHeight;
    if (!nw || !nh) return void (note.textContent = "사진을 열 수 없어요");
    note.remove();
    const ok = crop && ["srcX", "srcY", "srcWidth", "srcHeight"].every((k) => Number.isFinite(Number(crop[k])));
    if (ok && crop.srcWidth > 0) {
      zoom = Math.min(nw, nh) / (crop.srcWidth * nw);
      cx = (Number(crop.srcX) + crop.srcWidth / 2) * nw;
      cy = (Number(crop.srcY) + crop.srcHeight / 2) * nh;
    } else {
      cx = nw / 2;
      cy = nh / 2;
    }
    place();
  });
  img.addEventListener("error", () => (note.textContent = "사진을 열 수 없어요"));
  img.src = src;

  // Drag with one finger, pinch with two.
  const pts = new Map();
  let pinch = 0;
  const gap = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  stage.addEventListener("pointerdown", (e) => {
    if (!nw) return;
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) pinch = gap();
  });
  stage.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pts.size === 2) {
      const g = gap();
      if (pinch > 0 && g > 0) zoom *= g / pinch;
      pinch = g;
    } else {
      cx -= dx / pxScale();
      cy -= dy / pxScale();
    }
    place();
  });
  const lift = (e) => {
    pts.delete(e.pointerId);
    pinch = 0;
  };
  stage.addEventListener("pointerup", lift);
  stage.addEventListener("pointercancel", lift);
  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom *= e.deltaY < 0 ? 1.08 : 1 / 1.08;
      place();
    },
    { passive: false },
  );
  range.addEventListener("input", () => {
    zoom = Number(range.value);
    place();
  });

  const finish = (value) => {
    close();
    onApply?.(value);
  };
  const { close } = sheet(
    h(
      "div",
      { class: "av-body" },
      h("b", { class: "av-title" }, title),
      stage,
      h("label", { class: "av-zoom" }, h("span", null, "확대"), range),
      h(
        "div",
        { class: "av-row" },
        h("button", { type: "button", class: "pill", onClick: reset }, "처음대로"),
        h("button", { type: "button", class: "pill", onClick: () => finish(null) }, "자르기 없애기"),
        h("button", { type: "button", class: "pill main", onClick: () => nw && finish(result()) }, "적용"),
      ),
    ),
    { label: title },
  );
  return { close };
}
