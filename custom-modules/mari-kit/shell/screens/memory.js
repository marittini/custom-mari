import { h } from "../lib/h.js";
import { topBar } from "../lib/ui.js";
export function memoryScreen({ mount }) {
  mount.append(topBar({ back: () => history.back(), title: "" }), h("div", { class: "empty" }, "준비 중"));
  return {};
}
