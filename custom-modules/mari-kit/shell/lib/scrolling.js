// Reading position in a chat (RP and Convo):
// - a "맨 아래로" button appears when the reader has scrolled up, and takes them back down;
// - when the screen gets shorter (the keyboard opens) or the last message grows, a reader who was at the bottom
//   stays at the bottom instead of the newest lines sliding behind the keyboard.
// nearBottom() tells streaming code whether to follow new text (someone reading older lines is left alone).

import { h, icon } from "./h.js";

const NEAR = 120; // px from the bottom that still counts as "at the bottom"

export function chatScrolling(scroller) {
  let atBottom = true;
  const gap = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  const btn = h(
    "button",
    {
      type: "button",
      class: "tobottom",
      "aria-label": "맨 아래로",
      hidden: true,
      // Straight to the end (a long chat is too far to glide), and again once late layout settles.
      onClick: () => {
        scroller.scrollTop = scroller.scrollHeight;
        requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));
        update();
      },
    },
    icon("M12 5v14M6 13l6 6 6-6", 20, 2),
  );
  // Sits right above the strip/composer: a zero-height anchor the button hangs from.
  const anchor = h("div", { class: "tobottom-anchor" }, btn);
  const update = () => {
    atBottom = gap() < NEAR;
    btn.hidden = gap() < 400;
  };
  scroller.addEventListener("scroll", update, { passive: true });
  // Height changes (keyboard, new content): keep a reader who was at the bottom there.
  const ro = new ResizeObserver(() => {
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    update();
  });
  ro.observe(scroller);
  if (scroller.firstElementChild) ro.observe(scroller.firstElementChild);
  return {
    anchor,
    nearBottom: () => gap() < NEAR + 40,
    toBottom: () => {
      scroller.scrollTop = scroller.scrollHeight;
      update();
    },
    dispose: () => ro.disconnect(),
  };
}
