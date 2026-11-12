// The Engine's own groups, so the shell's lists and dropdowns are split the same way:
//   connections  connection folders (/connection-folders; each connection has folderId)
//   presets      library folders (/library-folders/presets; each folder lists itemIds)
//   lorebooks    library folders (/library-folders/lorebooks)
//   characters   character groups (/characters/groups/list; characterIds)
//   personas     persona groups (/characters/persona-groups/list; personaIds)
// Read once per page load and only where a grouped list is shown. An item in several groups shows in the first.

import { api } from "./api.js";

const cache = new Map();
// Group member lists come back as arrays or as JSON text (character and persona groups), depending on the store.
const ids = (v) => {
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
};
const SOURCES = {
  connections: async () =>
    (await api.get("/connection-folders"))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((f) => ({ id: f.id, name: f.name, items: null })),
  presets: async () => folders(await api.get("/library-folders/presets")),
  lorebooks: async () => folders(await api.get("/library-folders/lorebooks")),
  characters: async () =>
    (await api.get("/characters/groups/list")).map((g) => ({ id: g.id, name: g.name, items: ids(g.characterIds) })),
  personas: async () =>
    (await api.get("/characters/persona-groups/list")).map((g) => ({
      id: g.id,
      name: g.name,
      items: ids(g.personaIds),
    })),
};
const folders = (list) =>
  (Array.isArray(list) ? list : [])
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((f) => ({ id: f.id, name: f.name, items: ids(f.itemIds) }));

/** The groups of one kind ([] when there are none or they cannot be read). */
export function groupsOf(kind) {
  if (!cache.has(kind))
    cache.set(
      kind,
      (SOURCES[kind]?.() ?? Promise.resolve([])).catch(() => []),
    );
  return cache.get(kind);
}

/**
 * Items split into the Engine's groups, in the groups' order, ungrouped ones last:
 * [{ label, items }] — label "" for the ungrouped part. `folderOf(item)` gives an item's folder id where the item
 * itself carries it (connections); otherwise the groups' item lists decide.
 */
export function splitByGroup(items, groups, { idOf = (x) => x.id, folderOf = null } = {}) {
  const groupOf = new Map();
  for (const g of groups) for (const id of g.items || []) if (!groupOf.has(id)) groupOf.set(id, g.id);
  const out = groups.map((g) => ({ id: g.id, label: g.name, items: [] }));
  const byId = new Map(out.map((g) => [g.id, g]));
  const rest = { id: "", label: "", items: [] };
  for (const item of items) {
    const gid = folderOf ? folderOf(item) : groupOf.get(idOf(item));
    (byId.get(gid) || rest).items.push(item);
  }
  return [...out.filter((g) => g.items.length), ...(rest.items.length ? [rest] : [])];
}

/** <select> options grouped with <optgroup>: [["", "기본"], …plain] first, then the groups. */
export function groupedOptions(h, value, plain, parts, toOption) {
  const opt = ([v, t]) => h("option", { value: v, selected: (value || "") === v }, t);
  const grouped = parts.length > 1 || (parts.length === 1 && parts[0].label);
  return [
    ...plain.map(opt),
    ...(grouped
      ? parts.map((p) =>
          h(
            "optgroup",
            { label: p.label || "그룹 없음" },
            p.items.map((i) => opt(toOption(i))),
          ),
        )
      : parts.flatMap((p) => p.items.map((i) => opt(toOption(i))))),
  ];
}

/** A list split by group: a small heading over each group (none when nothing is grouped), rows from `render`. */
export function sectioned(h, parts, render) {
  const grouped = parts.length > 1 || (parts.length === 1 && parts[0].label);
  return parts.map((p) =>
    h(
      "div",
      null,
      grouped
        ? h(
            "div",
            { class: "sec", style: { padding: "14px 20px 6px" } },
            h("span", { class: "hint" }, p.label || "그룹 없음"),
          )
        : null,
      h("div", { class: "list" }, p.items.map(render)),
    ),
  );
}
