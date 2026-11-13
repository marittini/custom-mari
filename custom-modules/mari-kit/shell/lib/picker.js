// Picking a persona (or a character) from a list with pictures: the Engine's crop on each picture, the Engine's
// groups as folding sections (remembered), search by name, the current one ticked.

import { h, setChildren } from "./h.js";
import { sheet, avatar } from "./ui.js";
import { firstLetter } from "./data.js";
import { splitByGroup, foldGroup } from "./groups.js";

/**
 * items: [{ id, name, avatar }]; groups: the Engine's groups of that kind; selected: id or null.
 * none: label of the "nobody" row (null hides it). onPick(id | null).
 */
export function pickPerson({
  title,
  items,
  groups = [],
  selected = null,
  none = "없음",
  key = "pick",
  folderOf = null, // for groups that do not list their items (connection folders)
  faces = true, // false: names only (connections, presets)
  onPick,
}) {
  const list = h("div", { style: { overflowY: "auto", minHeight: "0" } });
  const search = h("input", {
    class: "inp",
    type: "search",
    placeholder: "이름으로 찾기",
    "aria-label": `${title} 찾기`,
    onInput: () => draw(),
  });
  const choose = (id) => {
    s.close();
    if (id !== selected) onPick(id);
  };
  const row = (p) =>
    h(
      "button",
      {
        type: "button",
        class: "r two",
        role: "radio",
        "aria-checked": p.id === selected ? "true" : "false",
        style: { gridTemplateColumns: faces ? "32px minmax(0,1fr) 20px" : "minmax(0,1fr) 20px" },
        onClick: () => choose(p.id),
      },
      faces ? avatar(p.avatar, firstLetter(p.name), 32) : null,
      h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, p.name),
      h("span", { class: p.id === selected ? "tick on" : "tick", "aria-hidden": "true" }),
    );
  function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = items.filter(
      (p) =>
        !q ||
        String(p.name || "")
          .toLowerCase()
          .includes(q),
    );
    const parts = splitByGroup(shown, groups, folderOf ? { folderOf } : {});
    const grouped = !q && (parts.length > 1 || parts[0]?.label);
    setChildren(
      list,
      shown.length
        ? parts.map((p) => {
            const rows = h("div", { class: "list" }, p.items.map(row));
            return grouped ? foldGroup(h, key, p.label, p.items.length, rows) : rows;
          })
        : h("div", { class: "empty" }, "찾는 이름이 없어요."),
      none && !q
        ? h(
            "div",
            { class: "list", style: { marginTop: "8px" } },
            h(
              "button",
              {
                type: "button",
                class: "r two",
                role: "radio",
                "aria-checked": selected ? "false" : "true",
                style: { gridTemplateColumns: faces ? "32px minmax(0,1fr) 20px" : "minmax(0,1fr) 20px" },
                onClick: () => choose(null),
              },
              faces
                ? h("span", { class: "ph", style: { width: "32px", height: "32px", borderRadius: "50%" } }, "—")
                : null,
              h("span", { class: "hint" }, none),
              h("span", { class: selected ? "tick" : "tick on", "aria-hidden": "true" }),
            ),
          )
        : null,
    );
  }
  const s = sheet(
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          padding: "4px 0 20px",
          minHeight: "0",
          maxHeight: "78vh",
        },
      },
      h("b", { style: { padding: "0 20px", fontSize: "15px" } }, title),
      h("div", { style: { padding: "0 20px" } }, search),
      list,
    ),
    { label: title },
  );
  draw();
  return s;
}
