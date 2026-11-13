// Editors in Mari (no Engine screen):
//   #/edit/character/<id>   #/edit/persona/<id>
// Each editor module loads only when opened.

import { h } from "../lib/h.js";

export function editScreen({ mount, args, go, back }) {
  const kind = args[0] === "persona" ? "persona" : "character";
  const id = args[1] || "";
  let editor = null;
  let gone = false;
  const load =
    kind === "persona"
      ? import("../lib/edit-persona.js").then((m) => m.personaEditor)
      : import("../lib/edit-character.js").then((m) => m.characterEditor);
  load
    .then((open) => {
      if (!gone) editor = open({ mount, id, go, back });
    })
    .catch((error) => mount.append(h("div", { class: "err", role: "alert" }, error.message)));
  return {
    dispose() {
      gone = true;
      editor?.dispose?.();
    },
  };
}
