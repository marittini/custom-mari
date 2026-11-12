import { h, icon, I, setChildren } from "../lib/h.js";
import {
  data,
  byLastActivity,
  characterIndex,
  chatTitle,
  firstLetter,
  shortTime,
  coverOf,
  byBranchGroup,
} from "../lib/data.js";
import { pageHead, errorBox, lazyBg, openEngine } from "../lib/ui.js";
import { openNewChat } from "../lib/newchat.js";
import { groupsOf, splitByGroup, foldGroup } from "../lib/groups.js";

let lastSeg = "works";
const SORTS = [
  ["recent", "최근 대화"],
  ["name", "이름"],
  ["fav", "즐겨찾기"],
];
let charSort = (() => {
  try {
    return localStorage.getItem("mari-kit:char-sort") || "recent";
  } catch {
    return "recent";
  }
})();

export function libraryScreen({ mount, go, args = [] }) {
  let alive = true;
  // #/library/chars opens the characters side (설정 › 캐릭터).
  let seg = args[0] === "chars" ? (lastSeg = "chars") : lastSeg;
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

  // The newest story with its last line (one small request, kept until the chat changes).
  function continueCard(c) {
    const { index } = model;
    const title = chatTitle(c, index);
    const line = h("span", { class: "read cline" }, "");
    data
      .previews([c])
      .then((m) => {
        const text = String(m.get(c.id)?.assistant || "");
        const quotes = text.match(/[“"「『][^”"」』]{2,}[”"」』]/g);
        line.textContent = (quotes?.length ? quotes[quotes.length - 1] : text.trim().split(/\n+/).pop()) || "";
      })
      .catch(() => {});
    return h(
      "a",
      { class: "gcard ccard", href: `#/rp/${encodeURIComponent(c.id)}` },
      lazyBg(
        h(
          "span",
          { class: "ph", style: { width: "56px", height: "76px", fontSize: "18px" } },
          coverOf(c) || index.get(c.characterIds?.[0])?.avatar ? "" : firstLetter(title),
        ),
        coverOf(c) || index.get(c.characterIds?.[0])?.avatar,
      ),
      h(
        "span",
        { style: { display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" } },
        h(
          "span",
          { class: "hint", style: { fontSize: "11px" } },
          `이어 읽기 · ${shortTime(c.lastMessageAt || c.updatedAt)}`,
        ),
        h("span", { style: { fontSize: "16px", fontWeight: "600" } }, title),
        line,
      ),
      h("span", { class: "cplay", "aria-label": "이어서" }, icon(I.play, 14, 2)),
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
        placeholder: seg === "works" ? "작품이나 캐릭터 이름" : "캐릭터 이름",
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
        // Split by the Engine's RP chat folders; branches of one story show as one book (the newest branch).
        const rows = byBranchGroup(
          chats
            .filter((c) => c.mode === "roleplay")
            .filter(
              (c) =>
                !ql ||
                chatTitle(c, index).toLowerCase().includes(ql) ||
                (c.characterIds || []).some((id) => (index.get(id)?.name || "").toLowerCase().includes(ql)),
            ),
        );
        const parts = splitByGroup(
          rows,
          (model.folders || []).filter((f) => f.mode === "roleplay"),
          { folderOf: (c) => c.folderId },
        );
        const grouped = parts.length > 1 || parts[0]?.label;
        const engineLine = h(
          "button",
          {
            type: "button",
            class: "grow linkline",
            style: { marginTop: "16px" },
            onClick: () => openEngine(null, { chats: true }),
          },
          h("span", null, "폴더 만들기·옮기기 · 분기 · 가져오기·내보내기"),
          h("span", null, "엔진 ›"),
        );
        const book = (c) => {
          const who = index.get(c.characterIds?.[0]);
          const title = chatTitle(c, index);
          return card(
            `#/rp/${encodeURIComponent(c.id)}`,
            firstLetter(title),
            coverOf(c) || who?.avatar,
            title,
            [
              (c.characterIds || [])
                .map((id) => index.get(id)?.name)
                .filter(Boolean)
                .join(", "),
              c.branches.length > 1 ? `분기 ${c.branches.length}` : "",
              shortTime(c.lastMessageAt || c.updatedAt),
            ]
              .filter(Boolean)
              .join(" · "),
          );
        };
        // 이어 읽기: the story read last, on top (not while searching).
        const latest = !ql ? rows[0] : null;
        setChildren(
          list,
          latest ? continueCard(latest) : null,
          rows.length
            ? parts.map((p) => {
                const grid = h("div", { class: "grid" }, p.items.map(book));
                return grouped ? foldGroup(h, "chat-folders", p.label || "폴더 없음", p.items.length, grid) : grid;
              })
            : h("div", { class: "empty" }, ql ? "찾는 작품이 없어요." : "RP 채팅이 아직 없어요."),
          engineLine,
        );
      } else {
        const lastUse = new Map();
        for (const c of chats)
          for (const id of c.characterIds || []) {
            const t = c.lastMessageAt || c.updatedAt || "";
            if (!lastUse.has(id) || t > lastUse.get(id)) lastUse.set(id, t);
          }
        const recent = (a, b) => String(lastUse.get(b.id) || "").localeCompare(String(lastUse.get(a.id) || ""));
        const order =
          {
            recent,
            name: (a, b) => a.name.localeCompare(b.name),
            // The Engine's favorite star (card extensions.fav) first, then recent.
            fav: (a, b) => Number(!!b.row?.fav) - Number(!!a.row?.fav) || recent(a, b),
          }[charSort] || recent;
        const rows = [...index.values()].sort(order).filter((c) => !ql || c.name.toLowerCase().includes(ql));
        const sorts = h(
          "div",
          { class: "chips", style: { padding: "0 20px 14px" } },
          SORTS.map(([id, label]) =>
            h(
              "button",
              {
                type: "button",
                class: "chip",
                "aria-pressed": charSort === id ? "true" : "false",
                onClick: () => {
                  charSort = id;
                  try {
                    localStorage.setItem("mari-kit:char-sort", id);
                  } catch {}
                  drawList();
                },
              },
              label,
            ),
          ),
        );
        setChildren(
          list,
          h(
            "div",
            { style: { display: "flex", justifyContent: "space-between", alignItems: "center", paddingRight: "20px" } },
            sorts,
            h(
              "a",
              { class: "hint", href: "#/groups/characters", style: { padding: "10px 0", whiteSpace: "nowrap" } },
              "그룹 관리 ›",
            ),
          ),
          rows.length
            ? splitByGroup(rows, model.charGroups || []).map((part, i, all) =>
                (all.length > 1 || part.label
                  ? (grid) => foldGroup(h, "characters", part.label, part.items.length, grid)
                  : (grid) => grid)(
                  h(
                    "div",
                    { class: "grid" },
                    part.items.map((c) =>
                      card(
                        `#/character/${encodeURIComponent(c.id)}`,
                        firstLetter(c.name),
                        c.avatar,
                        c.name,
                        lastUse.has(c.id) ? shortTime(lastUse.get(c.id)) : "",
                      ),
                    ),
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
      const [chats, chars, charGroups, folders] = await Promise.all([
        data.chats("soft"),
        data.characters(true),
        groupsOf("characters"),
        groupsOf("chats"),
      ]);
      if (!alive) return;
      model = { chats, index: characterIndex(chars), charGroups, folders };
      draw();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  })();
  return { dispose: () => (alive = false) };
}
