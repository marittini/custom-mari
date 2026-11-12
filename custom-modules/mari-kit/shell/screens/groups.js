// 그룹 관리: the Engine's character groups or persona groups — make one, rename, delete, pick who is in it.
//   #/groups/characters   #/groups/personas
// Everything goes through the Engine's own group routes; the shell's lists and pickers follow these groups.

import { h, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data, characterIndex, firstLetter } from "../lib/data.js";
import { pageHead, toast, errorBox, avatar, hbox } from "../lib/ui.js";
import { forgetGroups } from "../lib/groups.js";

const KINDS = {
  characters: { title: "캐릭터 그룹", base: "/characters/groups", member: "characterIds", parent: "library/chars" },
  personas: {
    title: "페르소나 그룹",
    base: "/characters/persona-groups",
    member: "personaIds",
    parent: "settings/personas",
  },
};
const ids = (v) => {
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v : [];
};

export function groupsScreen({ mount, args, back }) {
  const kind = KINDS[args[0]] ? args[0] : "characters";
  const k = KINDS[kind];
  let alive = true;
  let groups = [];
  let people = [];
  let open = null; // the group whose members are shown
  const body = h(
    "div",
    { class: "scroll", style: { padding: "0 20px 32px" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  mount.append(pageHead(k.title, { label: "그룹 관리", back: () => back(k.parent) }), body);

  async function load() {
    try {
      const [list, rows] = await Promise.all([
        api.get(`${k.base}/list`),
        kind === "characters" ? data.characters() : data.personas(),
      ]);
      groups = Array.isArray(list) ? list : [];
      people =
        kind === "characters"
          ? [...characterIndex(rows).values()].map((c) => ({ id: c.id, name: c.name, avatar: c.avatar }))
          : rows.map((p) => ({ id: p.id, name: p.name || "이름 없음", avatar: p.avatarPath }));
      people.sort((a, b) => a.name.localeCompare(b.name));
      if (alive) draw();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  }
  const run = async (fn, done) => {
    try {
      await fn();
      forgetGroups(kind);
      if (done) toast(done);
      await load();
    } catch (error) {
      toast(error.message);
    }
  };

  function groupBox(g) {
    const members = ids(g[k.member]);
    const name = h("input", { class: "inp", value: g.name, "aria-label": "그룹 이름", maxlength: 80 });
    const shown = open === g.id;
    return hbox(
      `${g.name} · ${members.length}`,
      h(
        "div",
        { style: { display: "flex", gap: "8px" } },
        name,
        h(
          "button",
          {
            type: "button",
            class: "pill",
            onClick: () =>
              name.value.trim() &&
              run(
                () => api.patch(`${k.base}/${encodeURIComponent(g.id)}`, { name: name.value.trim() }),
                "이름을 바꿨어요",
              ),
          },
          "이름 저장",
        ),
      ),
      h(
        "div",
        { style: { display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "12px" } },
        h(
          "button",
          {
            type: "button",
            class: "pill",
            "aria-expanded": shown ? "true" : "false",
            onClick: () => ((open = shown ? null : g.id), draw()),
          },
          shown ? "고르기 닫기" : "넣을 사람 고르기",
        ),
        h(
          "button",
          {
            type: "button",
            class: "pill",
            onClick: () =>
              confirm(
                `'${g.name}' 그룹을 지울까요? 들어 있던 ${kind === "characters" ? "캐릭터" : "페르소나"}는 지워지지 않아요.`,
              ) && run(() => api.delete(`${k.base}/${encodeURIComponent(g.id)}`), "그룹을 지웠어요"),
          },
          "그룹 지우기",
        ),
      ),
      shown
        ? h(
            "div",
            { class: "list", style: { margin: "12px -16px 0" } },
            people.map((p) => {
              const on = members.includes(p.id);
              return h(
                "button",
                {
                  type: "button",
                  class: "r two",
                  role: "checkbox",
                  "aria-checked": on ? "true" : "false",
                  style: { gridTemplateColumns: "32px minmax(0,1fr) 20px" },
                  onClick: () =>
                    run(() =>
                      api.patch(`${k.base}/${encodeURIComponent(g.id)}`, {
                        [k.member]: on ? members.filter((x) => x !== p.id) : [...members, p.id],
                      }),
                    ),
                },
                avatar(p.avatar, firstLetter(p.name), 32),
                h("span", null, p.name),
                h("span", { class: on ? "tick on" : "tick", "aria-hidden": "true" }),
              );
            }),
          )
        : null,
    );
  }

  function draw() {
    const name = h("input", { class: "inp", placeholder: "새 그룹 이름", maxlength: 80, "aria-label": "새 그룹 이름" });
    setChildren(
      body,
      h(
        "div",
        { style: { display: "flex", gap: "8px", padding: "8px 0 20px" } },
        name,
        h(
          "button",
          {
            type: "button",
            class: "pill main",
            onClick: () => {
              if (!name.value.trim()) return toast("그룹 이름을 적어 주세요");
              run(async () => {
                const made = await api.post(k.base, { name: name.value.trim() });
                open = made?.id || null;
              }, "그룹을 만들었어요");
            },
          },
          "만들기",
        ),
      ),
      groups.length
        ? h("div", { style: { display: "flex", flexDirection: "column", gap: "20px" } }, groups.map(groupBox))
        : h("div", { class: "empty" }, "그룹이 아직 없어요."),
    );
  }

  load();
  return { dispose: () => (alive = false) };
}
