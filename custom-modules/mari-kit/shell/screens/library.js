import { h, icon, I, setChildren } from "../lib/h.js";
import { data, byLastActivity, characterIndex, chatTitle, firstLetter, shortTime } from "../lib/data.js";
import { pageHead, errorBox, lazyBg } from "../lib/ui.js";
import { openNewChat } from "../lib/newchat.js";

let lastSeg = "works";

export function libraryScreen({ mount, go }) {
  let alive = true;
  let seg = lastSeg;
  let query = "";
  let searching = false;
  let model = null;
  const body = h(
    "div",
    { class: "scroll", style: { padding: "12px 0 32px" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  const searchBtn = h(
    "button",
    {
      type: "button",
      class: "ib",
      "aria-label": "검색",
      onClick: () => {
        searching = !searching;
        if (!searching) query = "";
        draw();
      },
    },
    icon(I.search),
  );
  const addBtn = h(
    "button",
    { type: "button", class: "ib", "aria-label": "새 채팅", onClick: () => openNewChat({ mode: "roleplay", go }) },
    icon(I.plus),
  );
  mount.append(pageHead("서재", { actions: [searchBtn, addBtn] }), body);

  function card(href, letter, img, name, meta) {
    return h(
      "a",
      { class: "book", href },
      lazyBg(h("span", { class: "ph", style: { aspectRatio: "3 / 4", fontSize: "20px" } }, img ? "" : letter), img),
      h(
        "span",
        { style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" } },
        h("span", { class: "n" }, name),
        h("span", { class: "label" }, meta),
      ),
    );
  }

  function draw() {
    if (!model) return;
    const { chats, index } = model;
    const q = query.trim().toLowerCase();
    const segs = h(
      "div",
      { class: "seg2" },
      [
        ["works", "작품"],
        ["chars", "캐릭터"],
      ].map(([id, label]) =>
        h(
          "button",
          {
            type: "button",
            "aria-pressed": seg === id ? "true" : "false",
            onClick: () => {
              seg = lastSeg = id;
              draw();
            },
          },
          label,
        ),
      ),
    );
    const parts = [segs];
    if (searching) {
      const input = h("input", {
        class: "inp",
        type: "search",
        placeholder: seg === "works" ? "작품 이름" : "캐릭터 이름",
        value: query,
        onInput: (e) => {
          query = e.target.value;
          drawList();
        },
      });
      parts.push(h("div", { style: { padding: "12px 20px 0" } }, input));
      queueMicrotask(() => input.focus());
    }
    const list = h("div", { style: { marginTop: "20px" } });
    parts.push(list);
    function drawList() {
      const ql = query.trim().toLowerCase();
      if (seg === "works") {
        const rows = chats
          .filter((c) => c.mode === "roleplay")
          .sort(byLastActivity)
          .filter((c) => !ql || chatTitle(c, index).toLowerCase().includes(ql));
        setChildren(
          list,
          rows.length
            ? h(
                "div",
                { class: "grid" },
                rows.map((c) => {
                  const who = index.get(c.characterIds?.[0]);
                  const title = chatTitle(c, index);
                  return card(
                    `#/rp/${encodeURIComponent(c.id)}`,
                    firstLetter(title),
                    who?.avatar,
                    title,
                    [
                      (c.characterIds || [])
                        .map((id) => index.get(id)?.name)
                        .filter(Boolean)
                        .join(", "),
                      shortTime(c.lastMessageAt || c.updatedAt),
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  );
                }),
              )
            : h("div", { class: "empty" }, ql ? "찾는 작품이 없어요." : "RP 채팅이 아직 없어요."),
        );
      } else {
        const lastUse = new Map();
        for (const c of chats)
          for (const id of c.characterIds || []) {
            const t = c.lastMessageAt || c.updatedAt || "";
            if (!lastUse.has(id) || t > lastUse.get(id)) lastUse.set(id, t);
          }
        const rows = [...index.values()]
          .sort((a, b) => String(lastUse.get(b.id) || "").localeCompare(String(lastUse.get(a.id) || "")))
          .filter((c) => !ql || c.name.toLowerCase().includes(ql));
        setChildren(
          list,
          rows.length
            ? h(
                "div",
                { class: "grid" },
                rows.map((c) =>
                  card(
                    `#/character/${encodeURIComponent(c.id)}`,
                    firstLetter(c.name),
                    c.avatar,
                    c.name,
                    lastUse.has(c.id) ? shortTime(lastUse.get(c.id)) : "",
                  ),
                ),
              )
            : h("div", { class: "empty" }, ql ? "찾는 캐릭터가 없어요." : "캐릭터가 아직 없어요."),
        );
      }
    }
    drawList();
    setChildren(body, ...parts);
    void q;
  }

  (async () => {
    try {
      const [chats, chars] = await Promise.all([data.chats(true), data.characters(true)]);
      if (!alive) return;
      model = { chats, index: characterIndex(chars) };
      draw();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  })();
  return { dispose: () => (alive = false) };
}
