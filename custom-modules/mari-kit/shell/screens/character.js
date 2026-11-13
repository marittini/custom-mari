import { h, icon, I, setChildren } from "../lib/h.js";
import { api, characterCard } from "../lib/api.js";
import { data, characterIndex, firstLetter, chatTitle, byLastActivity } from "../lib/data.js";
import { topBar, errorBox, toast, thumb } from "../lib/ui.js";
import { openNewChat } from "../lib/newchat.js";

const FIELDS = [
  ["description", "설명"],
  ["personality", "성격"],
  ["scenario", "시나리오"],
  ["extensions.backstory", "배경"],
  ["extensions.appearance", "외모"],
];

function pick(card, path) {
  return path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), card);
}

export function characterScreen({ mount, args, go, back }) {
  let alive = true;
  const id = args[0];
  const body = h(
    "div",
    { class: "scroll", style: { padding: "4px 20px 0" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  const editBtn = h(
    "button",
    { type: "button", class: "pill", onClick: () => go(`edit/character/${encodeURIComponent(id)}`) },
    "편집",
  );
  mount.append(topBar({ back: () => back("library"), plain: true, actions: [editBtn] }), body);
  (async () => {
    try {
      const [chars, chats, mk, row] = await Promise.all([
        data.characters(),
        data.chats(),
        api.get("/mari-kit/status").catch(() => null),
        data.character(id).catch(() => null),
      ]);
      const c = characterIndex(chars).get(id);
      if (!alive) return;
      if (!c || !row) return setChildren(body, h("div", { class: "empty" }, "캐릭터를 찾지 못했어요."));
      const card = characterCard(row);
      const ext = card.extensions || {};
      const voice = ext.ttsVoice || ext.voice || "";
      const pron = ext.phoneticName || "";
      const sub = [pron, voice].filter(Boolean).join(" · ");
      const intro = String(card.summary || card.creator_notes || "").trim();
      const rows = FIELDS.map(([path, label]) => [label, String(pick(card, path) ?? "").trim()]).filter(([, v]) => v);
      const tags = Array.isArray(card.tags) ? card.tags.filter(Boolean).join(" · ") : "";
      if (tags) rows.push(["태그", tags]);
      const lines = String(card.mes_example || "")
        .split(/<START>/i)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5);
      const book = card.character_book?.entries?.length ? card.character_book : null;
      const greetings = [card.first_mes, ...(Array.isArray(card.alternate_greetings) ? card.alternate_greetings : [])]
        .map((g) => String(g || "").trim())
        .filter(Boolean);
      const theirChats = chats.filter((x) => (x.characterIds || []).includes(id)).sort(byLastActivity);
      void mk;
      setChildren(
        body,
        h(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 72px",
              alignItems: "end",
              gap: "16px",
              paddingBottom: "8px",
            },
          },
          h(
            "span",
            { style: { display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" } },
            h("span", { style: { fontSize: "24px", fontWeight: "600", lineHeight: "1.2" } }, c.name),
            sub ? h("span", { class: "label", style: { fontSize: "12px" } }, sub) : null,
            intro
              ? h(
                  "span",
                  {
                    class: "read",
                    style: { fontStyle: "italic", fontSize: "14px", lineHeight: "1.6", color: "var(--ink-2)" },
                  },
                  intro,
                )
              : null,
          ),
          h(
            "span",
            {
              class: "ph",
              style: {
                width: "72px",
                height: "96px",
                fontSize: "20px",
                ...(c.avatar ? { backgroundImage: `url("${thumb(c.avatar, 240)}")` } : {}),
              },
            },
            c.avatar ? "" : firstLetter(c.name),
          ),
        ),
        rows.length
          ? h(
              "div",
              { class: "box" },
              h("span", { class: "tag" }, "profile"),
              rows.map(([k, v]) =>
                h("div", { class: "rr" }, h("span", { class: "rk" }, k), h("span", { class: "rv" }, v)),
              ),
            )
          : null,
        lines.length
          ? h(
              "div",
              { class: "box" },
              h("span", { class: "tag" }, "lines"),
              lines.map((l) => h("div", { class: "q" }, l.replace(/\{\{char\}\}/g, c.name))),
            )
          : null,
        greetings.length
          ? h(
              "div",
              { class: "box" },
              h("span", { class: "tag" }, "greetings"),
              greetings.map((g, i) =>
                h(
                  "details",
                  { class: "greet" },
                  h("summary", null, i === 0 ? "첫 인사말" : `다른 인사말 ${i}`),
                  h("div", { class: "read" }, g.replace(/\{\{char\}\}/g, c.name)),
                ),
              ),
            )
          : null,
        book
          ? h(
              "div",
              { class: "box" },
              h("span", { class: "tag" }, "lorebook"),
              h(
                "div",
                { class: "rr", style: { gridTemplateColumns: "minmax(0,1fr) auto" } },
                h("span", { class: "rv" }, book.name || "캐릭터 로어북"),
                h("span", { class: "rk" }, `${book.entries.length}항목`),
              ),
            )
          : null,
        theirChats.length
          ? h(
              "div",
              { class: "box" },
              h("span", { class: "tag" }, "chats"),
              theirChats.slice(0, 5).map((x) =>
                h(
                  "a",
                  {
                    class: "rr",
                    href: `#/${x.mode === "conversation" ? "convo" : "rp"}/${encodeURIComponent(x.id)}`,
                    style: { gridTemplateColumns: "minmax(0,1fr) auto" },
                  },
                  h("span", { class: "rv" }, chatTitle(x, characterIndex(chars))),
                  h("span", { class: "rk" }, "›"),
                ),
              ),
            )
          : null,
        h(
          "div",
          {
            style: {
              position: "sticky",
              bottom: "0",
              padding: "20px 0 16px",
              background: "linear-gradient(to bottom, transparent, var(--paper) 40%)",
            },
          },
          h(
            "button",
            {
              type: "button",
              class: "pill main",
              style: { width: "100%", minHeight: "44px" },
              onClick: () => openNewChat({ mode: "roleplay", characterId: id, go }),
            },
            "새 채팅",
          ),
        ),
      );
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  })();
  return { dispose: () => (alive = false) };
}
