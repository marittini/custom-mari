import { h, icon, I, setChildren } from "../lib/h.js";
import { openNewChat } from "../lib/newchat.js";
import { data, characterIndex, chatTitle, firstLetter, shortTime, coverOf, byBranchGroup } from "../lib/data.js";
import { pageHead, avatar, avatarStack, errorBox, timeAndUnread } from "../lib/ui.js";
import { groupsOf, splitByGroup, foldGroup } from "../lib/groups.js";

// 대화: Convo chats split by the Engine's chat folders (folding), branches of one chat folded under it, searchable
// by chat or character name. Making folders, moving chats, import/export stay in the Engine's chat list.
export function convosScreen({ mount, go }) {
  let alive = true;
  let model = null;
  let query = "";
  let searching = false;
  const opened = new Set(); // branch groups shown open
  const body = h(
    "div",
    { class: "scroll", style: { paddingTop: "8px" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  const search = h("input", {
    class: "inp",
    type: "search",
    placeholder: "채팅이나 캐릭터 이름",
    "aria-label": "대화 검색",
    onInput: (e) => {
      query = e.target.value;
      draw();
    },
  });
  const searchBox = h("div", { style: { padding: "4px 20px 8px" }, hidden: true }, search);
  mount.append(
    pageHead("대화", {
      actions: [
        h(
          "button",
          {
            type: "button",
            class: "ib",
            "aria-label": "검색",
            onClick: () => {
              searching = !searching;
              searchBox.hidden = !searching;
              if (searching) search.focus();
              else ((query = ""), (search.value = ""), draw());
            },
          },
          icon(I.search),
        ),
        h(
          "button",
          {
            type: "button",
            class: "ib",
            "aria-label": "새 대화",
            onClick: () => openNewChat({ mode: "conversation", go }),
          },
          icon(I.plus),
        ),
      ],
    }),
    searchBox,
    body,
  );

  function row(c, size = 40, nested = false) {
    const { index, lasts } = model;
    const cast = (c.characterIds || []).map((id) => index.get(id)).filter(Boolean);
    const title = chatTitle(c, index);
    return h(
      "a",
      {
        class: nested ? "row nested" : "row",
        href: `#/convo/${encodeURIComponent(c.id)}`,
      },
      coverOf(c)
        ? avatar(coverOf(c), firstLetter(title), size)
        : cast.length > 1
          ? avatarStack(cast, size)
          : avatar(cast[0]?.avatar, firstLetter(title), size),
      h(
        "span",
        { style: { display: "flex", flexDirection: "column", gap: "3px", minWidth: "0" } },
        h("span", { style: { fontSize: "14px", fontWeight: "500" } }, title),
        h(
          "span",
          {
            class: "hint",
            style: { fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
          },
          lasts.get(c.id)?.line || "",
        ),
      ),
      timeAndUnread(c, shortTime(c.lastMessageAt || c.updatedAt)),
    );
  }

  function entry(c) {
    const others = c.branches.slice(1);
    if (!others.length) return row(c);
    const key = c.groupId || c.id;
    const open = opened.has(key);
    return h(
      "div",
      null,
      row(c),
      h(
        "button",
        {
          type: "button",
          class: "branchl",
          "aria-expanded": open ? "true" : "false",
          onClick: () => {
            open ? opened.delete(key) : opened.add(key);
            draw();
          },
        },
        `다른 분기 ${others.length}개 ${open ? "▴" : "▾"}`,
      ),
      open ? others.map((b) => row(b, 32, true)) : null,
    );
  }

  function draw() {
    if (!model) return;
    const { chats, index, folders } = model;
    const q = query.trim().toLowerCase();
    const match = (c) =>
      !q ||
      chatTitle(c, index).toLowerCase().includes(q) ||
      (c.characterIds || []).some((id) => (index.get(id)?.name || "").toLowerCase().includes(q));
    const all = chats.filter((c) => c.mode === "conversation");
    const groups = byBranchGroup(all.filter(match));
    const engineLine = h(
      "button",
      { type: "button", class: "grow linkline", onClick: () => go("folders/convo") },
      h("span", null, "폴더 관리 · 채팅 가져오기"),
      h("span", null, "›"),
    );
    if (!all.length) return setChildren(body, h("div", { class: "empty" }, "Convo 대화가 아직 없어요."), engineLine);
    if (!groups.length) return setChildren(body, h("div", { class: "empty" }, "찾는 대화가 없어요."));
    const parts = splitByGroup(
      groups,
      folders.filter((f) => f.mode === "conversation"),
      { folderOf: (c) => c.folderId },
    );
    const grouped = parts.length > 1 || parts[0]?.label;
    setChildren(
      body,
      parts.map((p) => {
        const rows = h("div", { style: { borderBottom: "1px solid var(--line)" } }, p.items.map(entry));
        return grouped ? foldGroup(h, "chat-folders", p.label || "폴더 없음", p.items.length, rows) : rows;
      }),
      engineLine,
    );
  }

  (async () => {
    try {
      const [chats, chars, folders] = await Promise.all([data.chats("soft"), data.characters(), groupsOf("chats")]);
      const convos = chats.filter((c) => c.mode === "conversation");
      // One line per chat, for every branch (folded ones too), in one small request.
      const lasts = await data.previews(convos).catch(() => new Map());
      if (!alive) return;
      model = { chats, index: characterIndex(chars), folders, lasts };
      draw();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  })();
  return { dispose: () => (alive = false) };
}
