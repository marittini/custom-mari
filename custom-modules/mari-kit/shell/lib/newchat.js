// New chat from the shell, the way the Engine's own setup does it: create the chat, then post the chosen greeting
// as the first assistant message and keep the other greetings as silent swipes (Roleplay).

import { h, setChildren } from "./h.js";
import { api, characterCard } from "./api.js";
import { data, characterIndex, firstLetter } from "./data.js";
import { sheet, toast, avatar } from "./ui.js";

function greetingsOf(card) {
  const list = [];
  if (typeof card.first_mes === "string" && card.first_mes.trim()) list.push(card.first_mes.trim());
  for (const g of Array.isArray(card.alternate_greetings) ? card.alternate_greetings : [])
    if (typeof g === "string" && g.trim()) list.push(g.trim());
  return list;
}

export async function openNewChat({ mode = "roleplay", characterId = null, go }) {
  const [chars, conns, personas] = await Promise.all([data.characters(), data.connections(), data.personas()]);
  const index = characterIndex(chars);
  const body = h("div", {
    style: { display: "flex", flexDirection: "column", minHeight: "0", overflowY: "auto", padding: "4px 0 24px" },
  });
  const s = sheet(body, { label: "새 채팅" });
  let pickedChar = characterId ? index.get(characterId) : null;
  let kind = mode;
  let greeting = 0;
  let connectionId = (conns.find((c) => c.isDefault === true || c.isDefault === "true") || {}).id || "";
  let personaId = "";

  const title = (t) => h("div", { style: { padding: "8px 20px 12px", fontSize: "15px", fontWeight: "600" } }, t);

  function pickCharacter() {
    const rows = [...index.values()].sort((a, b) => a.name.localeCompare(b.name));
    setChildren(
      body,
      title("캐릭터 고르기"),
      rows.length
        ? h(
            "div",
            { class: "list" },
            rows.map((c) =>
              h(
                "button",
                {
                  type: "button",
                  class: "r two",
                  style: { gridTemplateColumns: "36px minmax(0,1fr)" },
                  onClick: () => {
                    pickedChar = c;
                    options();
                  },
                },
                avatar(c.avatar, firstLetter(c.name), 36),
                h("span", null, c.name),
              ),
            ),
          )
        : h("div", { class: "empty" }, "캐릭터가 아직 없어요. 엔진 화면에서 만들거나 가져와 주세요."),
    );
  }

  function options() {
    const greetings = greetingsOf(pickedChar.card);
    const seg = h(
      "div",
      { class: "seg2", style: { margin: "0 20px" } },
      [
        ["roleplay", "RP"],
        ["conversation", "Convo"],
      ].map(([k, label]) =>
        h(
          "button",
          {
            type: "button",
            "aria-pressed": kind === k ? "true" : "false",
            onClick: () => {
              kind = k;
              options();
            },
          },
          label,
        ),
      ),
    );
    const sel = (label, value, list, set) =>
      h(
        "label",
        { class: "r two static" },
        h("span", null, label),
        h(
          "select",
          { class: "sel", style: { width: "170px" }, onChange: (e) => set(e.target.value) },
          list.map(([v, t]) => h("option", { value: v, selected: value === v }, t)),
        ),
      );
    setChildren(
      body,
      title(`${pickedChar.name}와 새 채팅`),
      seg,
      h("div", { class: "gap" }),
      h(
        "div",
        { class: "list" },
        sel("연결", connectionId, [["", "기본"], ...conns.map((c) => [c.id, c.name])], (v) => (connectionId = v)),
        sel(
          "페르소나",
          personaId,
          [["", "없음"], ...personas.map((p) => [p.id, p.name || "이름 없음"])],
          (v) => (personaId = v),
        ),
      ),
      greetings.length && kind === "roleplay"
        ? [
            h(
              "div",
              { class: "hint", style: { padding: "20px 20px 8px" } },
              `첫 인사 ${greetings.length}개 중 고르기 · 나머지는 넘겨 볼 수 있게 남아요`,
            ),
            h(
              "div",
              { class: "list" },
              [...greetings.map((g, i) => [i, g]), [-1, "인사 없이 시작"]].map(([i, g]) =>
                h(
                  "button",
                  {
                    type: "button",
                    class: "r two",
                    "aria-pressed": greeting === i ? "true" : "false",
                    onClick: () => {
                      greeting = i;
                      options();
                    },
                    style: { gridTemplateColumns: "minmax(0,1fr) 20px", alignItems: "start" },
                  },
                  h(
                    "span",
                    {
                      class: i < 0 ? "hint" : "read",
                      style: {
                        fontSize: "14px",
                        lineHeight: "1.6",
                        display: "-webkit-box",
                        WebkitLineClamp: "3",
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      },
                    },
                    g,
                  ),
                  h("span", {
                    "aria-hidden": "true",
                    style: {
                      width: "16px",
                      height: "16px",
                      marginTop: "3px",
                      borderRadius: "50%",
                      border: "1.5px solid var(--line-2)",
                      background: greeting === i ? "var(--me)" : "transparent",
                    },
                  }),
                ),
              ),
            ),
          ]
        : null,
      h(
        "div",
        { style: { padding: "20px", display: "flex", justifyContent: "flex-end", gap: "8px" } },
        characterId ? null : h("button", { type: "button", class: "pill", onClick: pickCharacter }, "다른 캐릭터"),
        h("button", { type: "button", class: "pill main", onClick: create }, "시작"),
      ),
    );
  }

  async function create() {
    try {
      const chat = await api.post("/chats", {
        name: pickedChar.name,
        mode: kind,
        characterIds: [pickedChar.id],
        connectionId: connectionId || null,
        personaId: personaId || null,
      });
      const greetings = greetingsOf(pickedChar.card);
      if (kind === "roleplay" && greeting >= 0 && greetings[greeting]) {
        const message = await api.post(`/chats/${encodeURIComponent(chat.id)}/messages`, {
          role: "assistant",
          content: greetings[greeting],
          characterId: pickedChar.id,
        });
        const rest = greetings.filter((_g, i) => i !== greeting);
        if (message?.id && rest.length)
          await api
            .post(`/chats/${encodeURIComponent(chat.id)}/messages/${encodeURIComponent(message.id)}/swipes/bulk`, {
              contents: rest,
              silent: true,
            })
            .catch(() => {});
      } else if (kind === "conversation" && greetings[0]) {
        await api.post(`/chats/${encodeURIComponent(chat.id)}/messages`, {
          role: "assistant",
          content: greetings[0],
          characterId: pickedChar.id,
        });
      }
      data.chats(true);
      s.close();
      go(`${kind === "conversation" ? "convo" : "rp"}/${encodeURIComponent(chat.id)}`);
    } catch (error) {
      toast(`만들지 못했어요: ${error.message}`);
    }
  }

  if (pickedChar) options();
  else pickCharacter();
  void characterCard;
}
