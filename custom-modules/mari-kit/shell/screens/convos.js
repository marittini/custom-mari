import { h, icon, I, setChildren } from "../lib/h.js";
import { openNewChat } from "../lib/newchat.js";
import {
  previewLine,
  data,
  byLastActivity,
  characterIndex,
  chatTitle,
  firstLetter,
  messageText,
  shortTime,
  coverOf,
} from "../lib/data.js";
import { pageHead, avatar, avatarStack, errorBox, timeAndUnread } from "../lib/ui.js";

export function convosScreen({ mount, go }) {
  let alive = true;
  const body = h(
    "div",
    { class: "scroll", style: { paddingTop: "8px" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  mount.append(
    pageHead("대화", {
      actions: [
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
    body,
  );
  (async () => {
    try {
      const [chats, chars] = await Promise.all([data.chats(true), data.characters()]);
      const index = characterIndex(chars);
      const rows = chats.filter((c) => c.mode === "conversation").sort(byLastActivity);
      const lasts = await Promise.all(rows.map((c) => data.messages(c.id, 4).catch(() => [])));
      if (!alive) return;
      if (!rows.length) return setChildren(body, h("div", { class: "empty" }, "Convo 대화가 아직 없어요."));
      setChildren(
        body,
        h(
          "div",
          { style: { borderBottom: "1px solid var(--line)" } },
          rows.map((c, i) => {
            const cast = (c.characterIds || []).map((id) => index.get(id)).filter(Boolean);
            const title = chatTitle(c, index);
            return h(
              "a",
              { class: "row", href: `#/convo/${encodeURIComponent(c.id)}` },
              coverOf(c)
                ? avatar(coverOf(c), firstLetter(title), 40)
                : cast.length > 1
                  ? avatarStack(cast, 40)
                  : avatar(cast[0]?.avatar, firstLetter(title), 40),
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
                  previewLine(lasts[i]),
                ),
              ),
              timeAndUnread(c, shortTime(c.lastMessageAt || c.updatedAt)),
            );
          }),
        ),
      );
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  })();
  return { dispose: () => (alive = false) };
}
