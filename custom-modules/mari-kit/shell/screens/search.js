// 메시지 검색 in one chat: Mari Kit searches the transcript on the server and sends only the hits; a hit opens
// the chat at that message.   #/search/<chatId>

import { h, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data, characterIndex, shortTime } from "../lib/data.js";
import { pageHead, errorBox } from "../lib/ui.js";

export function searchScreen({ mount, args, go, back }) {
  const chatId = args[0];
  let alive = true;
  let timer = null;
  let seq = 0;
  let chat = null;
  let index = new Map();
  const results = h("div", { class: "list" });
  const input = h("input", {
    class: "inp",
    type: "search",
    placeholder: "찾을 말 (띄어 쓰면 모두 들어간 메시지)",
    "aria-label": "메시지 검색",
    onInput: () => {
      clearTimeout(timer);
      timer = setTimeout(run, 350);
    },
    onKeydown: (e) => e.key === "Enter" && (clearTimeout(timer), run()),
  });
  mount.append(
    pageHead("메시지 검색", { label: " ", back: () => back(`chat-settings/${encodeURIComponent(chatId)}`) }),
    h(
      "div",
      { class: "scroll", style: { padding: "0 0 32px" } },
      h("div", { style: { padding: "4px 20px 16px" } }, input),
      results,
    ),
  );

  async function run() {
    const q = input.value.trim();
    const mine = ++seq;
    if (q.length < 1) return setChildren(results);
    try {
      const { hits } = await api.get(`/mari-kit/shell/search/${encodeURIComponent(chatId)}?q=${encodeURIComponent(q)}`);
      if (!alive || mine !== seq) return;
      const where = chat?.mode === "conversation" ? "convo" : "rp";
      setChildren(
        results,
        hits.length
          ? hits.map((m) =>
              h(
                "button",
                {
                  type: "button",
                  class: "r two",
                  style: { gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "start" },
                  onClick: () => go(`${where}/${encodeURIComponent(chatId)}/${encodeURIComponent(m.id)}`),
                },
                h(
                  "span",
                  { style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" } },
                  h(
                    "span",
                    { class: "hint", style: { fontSize: "11px" } },
                    m.role === "user"
                      ? "나"
                      : index.get(m.characterId)?.name || (m.role === "assistant" ? "캐릭터" : "알림"),
                  ),
                  h("span", { style: { fontSize: "14px", lineHeight: "1.6", whiteSpace: "normal" } }, m.snippet),
                ),
                h("span", { class: "hint", style: { fontSize: "11px" } }, shortTime(m.createdAt)),
              ),
            )
          : h("div", { class: "empty" }, "찾는 메시지가 없어요."),
        hits.length >= 60
          ? h(
              "div",
              { class: "hint", style: { padding: "12px 20px" } },
              "최근 60개까지만 보여요. 말을 더 붙여 좁혀 보세요.",
            )
          : null,
      );
    } catch (error) {
      if (alive) setChildren(results, errorBox(error));
    }
  }

  (async () => {
    try {
      const [c, chars] = await Promise.all([data.chat(chatId), data.characters()]);
      chat = c;
      index = characterIndex(chars);
      const label = mount.querySelector(".phead .label");
      if (label) label.textContent = chat.name || "이 채팅";
      if (alive) input.focus();
    } catch (error) {
      if (alive) setChildren(results, errorBox(error));
    }
  })();
  return { dispose: () => ((alive = false), clearTimeout(timer)) };
}
