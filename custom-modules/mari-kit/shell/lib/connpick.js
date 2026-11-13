// A dropdown of connections that write text, split by the Engine's connection folders (image, video and audio
// connections are left out). The list fills in when the connections arrive (read once per page load).

import { h } from "./h.js";
import { data, textConnections } from "./data.js";
import { groupsOf, groupedOptions, splitByGroup } from "./groups.js";

export function connectionSelect({ value, empty = "기본 연결", onPick, attrs = {} }) {
  const sel = h(
    "select",
    { ...attrs, onChange: (e) => onPick(e.target.value || "") },
    h("option", { value: "" }, empty),
  );
  Promise.all([data.connections(), groupsOf("connections")]).then(([list, groups]) =>
    sel.replaceChildren(
      ...groupedOptions(
        h,
        value || "",
        [["", empty]],
        splitByGroup(textConnections(list), groups, { folderOf: (c) => c.folderId }),
        (c) => [c.id, c.name],
      ),
    ),
  );
  return sel;
}
