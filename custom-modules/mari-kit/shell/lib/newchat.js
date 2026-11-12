// New chat from the shell, the way the Engine's own setup does it: create the chat, then post the chosen greeting
// as the first assistant message and keep the other greetings as silent swipes (Roleplay).

import { h, setChildren } from "./h.js";
import { api, characterCard } from "./api.js";
import { data, characterIndex, firstLetter } from "./data.js";
import { sheet, toast, avatar } from "./ui.js";
import { groupsOf, splitByGroup, groupedOptions, sectioned } from "./groups.js";

function greetingsOf(card) {
  const list = [];
  if (typeof card.first_mes === "string" && card.first_mes.trim()) list.push(card.first_mes.trim());
  for (const g of Array.isArray(card.alternate_greetings) ? card.alternate_greetings : [])
    if (typeof g === "string" && g.trim()) list.push(g.trim());
  return list;
}

export async function openNewChat({ mode = "roleplay", characterId = null, go }) {
  const [chars, allConns, personas, gChars, gConns, gPersonas, presets, gPresets] = await Promise.all([
    data.characters(),
    data.connections(),
    data.personas(),
    groupsOf("characters"),
    groupsOf("connections"),
    groupsOf("personas"),
    api.get("/prompts").catch(() => []),
    groupsOf("presets"),
  ]);
  // Chat models only, like the Engine's chat connection picker.
  const conns = allConns.filter(
    (c) => !["image_generation", "video_generation", "audio_generation", "audio", "decision"].includes(c.provider),
  );
  const index = characterIndex(chars);
  const body = h("div", {
    style: { display: "flex", flexDirection: "column", minHeight: "0", overflowY: "auto", padding: "4px 0 24px" },
  });
  const s = sheet(body, { label: "새 채팅" });
  let pickedChar = characterId ? index.get(characterId) : null;
  let extra = []; // more characters for a group chat; the first one's card gives the greeting
  let kind = mode;
  let greeting = 0;
  let connectionId = (conns.find((c) => c.isDefault === true || c.isDefault === "true") || {}).id || "";
  let personaId = "";
  let presetId = "";

  // The list carries names only; the greetings come with the picked character's own card.
  async function withCard(c) {
    try {
      return { ...c, card: characterCard(await data.character(c.id)) };
    } catch (error) {
      toast(error.message);
      return null;
    }
  }

  const title = (t) => h("div", { style: { padding: "8px 20px 12px", fontSize: "15px", fontWeight: "600" } }, t);

  function pickCharacter(adding = false) {
    const taken = new Set([pickedChar?.id, ...extra.map((c) => c.id)]);
    const rows = [...index.values()]
      .filter((c) => !adding || !taken.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    setChildren(
      body,
      title(adding ? "함께할 캐릭터 추가" : "캐릭터 고르기"),
      rows.length
        ? sectioned(h, splitByGroup(rows, gChars), (c) =>
            h(
              "button",
              {
                type: "button",
                class: "r two",
                style: { gridTemplateColumns: "36px minmax(0,1fr)" },
                onClick: async () => {
                  if (adding) {
                    extra = [...extra, c];
                    return options();
                  }
                  pickedChar = await withCard(c);
                  extra = extra.filter((x) => x.id !== c.id);
                  if (pickedChar) options();
                },
              },
              avatar(c.avatar, firstLetter(c.name), 36),
              h("span", null, c.name),
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
        h("select", { class: "sel", style: { width: "170px" }, onChange: (e) => set(e.target.value) }, list),
      );
    const cast = [pickedChar, ...extra];
    setChildren(
      body,
      title(`${cast.map((c) => c.name).join(", ")}와 새 채팅`),
      seg,
      h("div", { class: "gap" }),
      h(
        "div",
        { class: "list" },
        cast.map((c, i) =>
          h(
            "div",
            { class: "r two static", style: { gridTemplateColumns: "28px minmax(0,1fr) auto" } },
            avatar(c.avatar, firstLetter(c.name), 28),
            h("span", null, c.name, i === 0 && extra.length ? h("small", { class: "hint" }, " · 첫 인사") : null),
            i === 0
              ? null
              : h(
                  "button",
                  {
                    type: "button",
                    class: "txtbtn",
                    onClick: () => {
                      extra = extra.filter((x) => x.id !== c.id);
                      options();
                    },
                  },
                  "빼기",
                ),
          ),
        ),
        h(
          "button",
          { type: "button", class: "r two", onClick: () => pickCharacter(true) },
          h("span", { class: "hint" }, "+ 함께할 캐릭터 추가"),
        ),
      ),
      h("div", { class: "gap" }),
      conns.length
        ? null
        : h(
            "button",
            {
              type: "button",
              class: "r two",
              style: { marginBottom: "8px" },
              onClick: () => {
                s.close();
                go("settings/connections");
              },
            },
            h("span", null, "채팅에 쓸 연결이 아직 없어요"),
            h("span", { class: "val" }, "연결 추가 ›"),
          ),
      h(
        "div",
        { class: "list" },
        sel(
          "연결",
          connectionId,
          groupedOptions(
            h,
            connectionId,
            [["", "기본"]],
            splitByGroup(conns, gConns, { folderOf: (c) => c.folderId }),
            (c) => [c.id, c.name],
          ),
          (v) => (connectionId = v),
        ),
        sel(
          "프리셋",
          presetId,
          groupedOptions(h, presetId, [["", "기본"]], splitByGroup(presets, gPresets), (p) => [p.id, p.name]),
          (v) => (presetId = v),
        ),
        sel(
          "페르소나",
          personaId,
          groupedOptions(h, personaId, [["", "없음"]], splitByGroup(personas, gPersonas), (p) => [
            p.id,
            p.name || "이름 없음",
          ]),
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
        characterId
          ? null
          : h("button", { type: "button", class: "pill", onClick: () => pickCharacter() }, "다른 캐릭터"),
        h("button", { type: "button", class: "pill main", onClick: create }, "시작"),
      ),
    );
  }

  async function create() {
    try {
      const chat = await api.post("/chats", {
        name: [pickedChar, ...extra].map((c) => c.name).join(", "),
        mode: kind,
        characterIds: [pickedChar.id, ...extra.map((c) => c.id)],
        connectionId: connectionId || null,
        personaId: personaId || null,
        promptPresetId: presetId || null,
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

  if (pickedChar) pickedChar = await withCard(pickedChar);
  if (pickedChar) options();
  else pickCharacter();
  void characterCard;
}
