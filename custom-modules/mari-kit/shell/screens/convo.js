// Convo screen, messenger style: bubbles grouped by sender, a tap on a bubble shows its message tools
// (show / more / hidden, same choice as RP), and the composer offers the same quick-reply menu.
// Convo rooms keep the Engine's own memory system; Mari Kit's memory button is RP only.

import { h, icon, dots, I, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data, characterIndex, chatTitle, messageText, firstLetter, shortTime } from "../lib/data.js";
import { TOOL_DEFS, toolPlace } from "../lib/prefs.js";
import { toast, errorBox, avatar } from "../lib/ui.js";
import { pickVoice } from "../lib/render.js";
import * as tts from "../lib/tts.js";
import { runSlash } from "../lib/slash.js";
import { GUIDE, quickReplies, runTool, streamGenerate } from "../lib/actions.js";

export function convoScreen({ mount, args, go }) {
  const chatId = args[0];
  let alive = true;
  let chat = null;
  let index = new Map();
  let messages = [];
  let busy = false;
  let live = null;
  let picked = null;
  let moreOpen = false;
  let quick = [];
  let qrOpen = false;
  let ttsConfig = null;
  let abort = null;

  const who = h("span", {
    style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", minWidth: "0" },
  });
  const head = h(
    "header",
    {
      style: {
        flexShrink: "0",
        display: "grid",
        gridTemplateColumns: "52px minmax(0,1fr) 52px",
        alignItems: "center",
        padding: "12px 4px",
        borderBottom: "1px solid var(--line)",
        background: "var(--surface)",
      },
    },
    h(
      "button",
      {
        type: "button",
        class: "ib",
        "aria-label": "대화 목록",
        onClick: () => (history.length > 1 ? history.back() : go("convos")),
      },
      icon(I.back, 22, 1.8),
    ),
    who,
    h(
      "span",
      { style: { display: "flex", justifyContent: "flex-end" } },
      h(
        "button",
        {
          type: "button",
          class: "ib",
          "aria-label": "채팅 설정",
          onClick: () => go(`chat-settings/${encodeURIComponent(chatId)}`),
        },
        icon(I.info),
      ),
    ),
  );
  const list = h("div", { class: "cv" });
  const scroller = h("div", { class: "scroll", style: { background: "var(--paper)" } }, list);
  const input = h("textarea", {
    class: "cin",
    rows: 1,
    placeholder: "메시지",
    "aria-label": "메시지",
    onInput: grow,
    onKeydown: (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) {
        e.preventDefault();
        send();
      }
    },
  });
  const qrBtn = h(
    "button",
    {
      type: "button",
      class: "cb",
      "aria-label": "빠른 답장",
      "aria-haspopup": "menu",
      hidden: true,
      onClick: () => {
        qrOpen = !qrOpen;
        drawQuick();
      },
    },
    dots(),
  );
  const sendBtn = h(
    "button",
    { type: "button", class: "cb send", "aria-label": "보내기", onClick: () => (busy ? stopGenerating() : send()) },
    icon(I.send, 16, 2),
  );
  const quickLayer = h("div");
  mount.append(
    head,
    scroller,
    quickLayer,
    h("div", { class: "cmp", style: { background: "var(--paper)" } }, input, qrBtn, sendBtn),
  );

  function grow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }

  async function load(first) {
    try {
      const [c, chars, msgs] = await Promise.all([data.chat(chatId), data.characters(), data.messages(chatId)]);
      if (!alive) return;
      chat = c;
      index = characterIndex(chars);
      messages = (Array.isArray(msgs) ? msgs : []).filter((m) => m.role !== "system");
      if (first) {
        const [ui, config] = await Promise.all([data.engineUi(), api.get("/tts/config").catch(() => null)]);
        quick = quickReplies(ui, I.guide);
        qrBtn.hidden = !quick.length;
        ttsConfig = config?.enabled ? config : null;
        const lead = index.get(chat.characterIds?.[0]);
        const title = chatTitle(chat, index);
        setChildren(
          who,
          avatar(lead?.avatar, firstLetter(title), 40),
          h(
            "span",
            {
              style: {
                fontSize: "12px",
                maxWidth: "100%",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              },
            },
            `${title} ›`,
          ),
        );
        who.style.cursor = lead ? "pointer" : "";
        if (lead) who.onclick = () => go(`character/${encodeURIComponent(lead.id)}`);
      }
      draw();
      if (first) requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));
    } catch (error) {
      if (alive) setChildren(list, errorBox(error));
    }
  }

  function toolsFor(m) {
    const usable = TOOL_DEFS.filter(
      (t) => !(t.assistantOnly && m.role !== "assistant") && !(t.id === "voice" && !ttsConfig),
    );
    return {
      shown: usable.filter((t) => toolPlace(t) === "show"),
      more: usable.filter((t) => toolPlace(t) === "more"),
    };
  }

  function draw() {
    if (!chat) return;
    const items = [];
    const first = messages[0];
    if (first)
      items.push(
        h(
          "span",
          { style: { alignSelf: "center", padding: "0 0 20px", fontSize: "11px", color: "var(--ink-3)" } },
          shortTime(first.createdAt),
        ),
      );
    // Like the Engine's Convo, a blank line starts a new bubble.
    const bubbles = [];
    for (const m of messages) {
      const parts = messageText(m)
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);
      (parts.length ? parts : [""]).forEach((text, k, all) =>
        bubbles.push({ m, text, me: m.role === "user", first: k === 0, last: k === all.length - 1 }),
      );
    }
    const lastMine = messages.map((m) => m.role === "user").lastIndexOf(true);
    bubbles.forEach((bub, i) => {
      const { m, me } = bub;
      const prev = bubbles[i - 1];
      const next = bubbles[i + 1];
      const firstOfRun = !prev || prev.me !== me;
      const lastOfRun = !next || next.me !== me;
      const radius = me
        ? `18px ${firstOfRun ? "18px" : "6px"} ${lastOfRun ? "18px" : "6px"} 18px`
        : `${firstOfRun ? "18px" : "6px"} 18px 18px ${lastOfRun ? "18px" : "6px"}`;
      const on = picked === m.id;
      const wrap = h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            alignItems: me ? "flex-end" : "flex-start",
            marginTop: i === 0 ? "0" : firstOfRun ? "24px" : bub.first ? "14px" : "10px",
          },
        },
        h(
          "button",
          {
            type: "button",
            class: `bub ${me ? "me" : "them"}${on ? " on" : ""}`,
            style: { borderRadius: radius },
            "aria-expanded": on ? "true" : "false",
            onClick: (e) => {
              e.stopPropagation();
              picked = on ? null : m.id;
              moreOpen = false;
              draw();
            },
          },
          bub.text,
        ),
      );
      if (on && bub.last) {
        const { shown, more } = toolsFor(m);
        wrap.append(
          h(
            "div",
            {
              role: "toolbar",
              "aria-label": "메시지 도구",
              style: {
                position: "relative",
                display: "flex",
                marginTop: "6px",
                marginLeft: me ? "0" : "-10px",
                marginRight: me ? "-10px" : "0",
              },
            },
            shown.map((t) =>
              h(
                "button",
                {
                  type: "button",
                  class: "ma",
                  "aria-label": t.label,
                  title: t.label,
                  onClick: (e) => {
                    e.stopPropagation();
                    tool(t.id, m);
                  },
                },
                icon(t.icon, 15, 1.6),
              ),
            ),
            more.length
              ? h(
                  "button",
                  {
                    type: "button",
                    class: "ma",
                    "aria-label": "더보기",
                    "aria-expanded": moreOpen ? "true" : "false",
                    onClick: (e) => {
                      e.stopPropagation();
                      moreOpen = !moreOpen;
                      draw();
                    },
                  },
                  dots(15),
                )
              : null,
            moreOpen
              ? h(
                  "div",
                  { class: "tmenu", role: "menu", style: { [me ? "right" : "left"]: "0", top: "40px" } },
                  more.map((t) =>
                    h(
                      "button",
                      {
                        type: "button",
                        role: "menuitem",
                        onClick: (e) => {
                          e.stopPropagation();
                          moreOpen = false;
                          tool(t.id, m);
                        },
                      },
                      h("span", { style: { display: "flex", color: "var(--ink-2)" } }, icon(t.icon, 16, 1.6)),
                      t.label,
                    ),
                  ),
                )
              : null,
          ),
        );
      }
      if (bub.last && messages.indexOf(m) === lastMine && !busy)
        wrap.append(
          h(
            "span",
            { style: { marginTop: "6px", paddingRight: "4px", fontSize: "11px", color: "var(--ink-3)" } },
            "읽음",
          ),
        );
      items.push(wrap);
    });
    if (busy) {
      const parts = String(live || "")
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);
      (parts.length ? parts : ["…"]).forEach((text, k) =>
        items.push(
          h(
            "div",
            { style: { display: "flex", marginTop: k === 0 ? "24px" : "10px" } },
            h("span", { class: "bub them", style: { cursor: "default" } }, text),
          ),
        ),
      );
    }
    if (!messages.length && !busy) items.push(h("div", { class: "empty" }, "첫 메시지를 보내 보세요."));
    setChildren(list, items);
    setChildren(sendBtn, icon(busy ? I.stop : I.send, busy ? 14 : 16, 2));
    sendBtn.setAttribute("aria-label", busy ? "멈춤" : "보내기");
  }

  function drawQuick() {
    setChildren(
      quickLayer,
      qrOpen
        ? [
            h("button", {
              type: "button",
              class: "scrim",
              style: { background: "transparent" },
              "aria-label": "닫기",
              onClick: () => {
                qrOpen = false;
                drawQuick();
              },
            }),
            h(
              "div",
              { class: "qr", role: "menu", "aria-label": "빠른 답장", style: { zIndex: "22" } },
              quick.map((q) =>
                h(
                  "button",
                  {
                    type: "button",
                    role: "menuitem",
                    disabled: busy,
                    onClick: () => {
                      qrOpen = false;
                      drawQuick();
                      runQuick(q);
                    },
                  },
                  h(
                    "span",
                    {
                      style: {
                        display: "flex",
                        justifyContent: "center",
                        fontSize: "16px",
                        lineHeight: "1",
                        color: "var(--ink-2)",
                      },
                    },
                    q.icon ? icon(q.icon, 17, 1.6) : q.emoji,
                  ),
                  h("span", null, q.label),
                ),
              ),
            ),
          ]
        : [],
    );
  }

  async function speakMessage(m) {
    const key = tts.hashKey([m.id, m.activeSwipeIndex ?? 0, messageText(m), ttsConfig?.voice]);
    if (tts.activeLine() === key) return tts.stop();
    const voice = pickVoice(ttsConfig, m.characterId);
    const speaker = index.get(m.characterId)?.name;
    await tts.speak(key, { text: messageText(m), ...(speaker ? { speaker } : {}), ...(voice ? { voice } : {}) });
  }

  function tool(id, m) {
    picked = null;
    draw();
    return runTool(id, { chatId, chat, message: m, reload: load, generate, go, speak: speakMessage });
  }

  async function generate(body) {
    if (busy) return;
    busy = true;
    live = "";
    draw();
    scroller.scrollTop = scroller.scrollHeight;
    abort = new AbortController();
    try {
      await streamGenerate({
        chatId,
        body,
        signal: abort.signal,
        onToken: (text) => {
          if (!alive) return;
          live = text;
          draw();
          scroller.scrollTop = scroller.scrollHeight;
        },
        onSaved: (saved) => {
          if (!alive || !saved) return;
          messages.push(saved);
          live = "";
          draw();
        },
      });
    } catch (error) {
      if (error.name !== "AbortError") toast(`생성하지 못했어요: ${error.message}`);
    } finally {
      busy = false;
      live = null;
      abort = null;
      if (alive) {
        await load();
        scroller.scrollTop = scroller.scrollHeight;
      }
    }
  }

  async function stopGenerating() {
    try {
      await api.post("/generate/abort", { chatId });
    } catch {}
    abort?.abort();
  }

  function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    grow();
    if (text.startsWith("/")) return slash(text);
    generate({ userMessage: text });
  }

  async function slash(text) {
    try {
      const note = await runSlash(text, {
        chatId,
        chat,
        messages,
        characters: (chat?.characterIds || [])
          .map((id) => ({ id, name: index.get(id)?.name || "" }))
          .filter((c) => c.name),
        generate,
        reload: load,
      });
      if (note) toast(note);
    } catch (error) {
      toast(error.message);
    }
  }

  function runQuick(q) {
    if (q.id === "guide") {
      const text = input.value.trim();
      if (!text) return toast("방향을 먼저 적어 주세요");
      input.value = "";
      grow();
      return generate({
        userMessage: null,
        smartResponse: true,
        generationGuide: GUIDE(text),
        generationGuideSource: "guide",
      });
    }
    if (q.content.startsWith("/")) return slash(q.content);
    generate({ userMessage: q.content });
  }

  list.addEventListener("click", () => {
    if (picked) {
      picked = null;
      moreOpen = false;
      draw();
    }
  });
  const off = tts.onTts(() => {});
  load(true);
  return {
    dispose: () => {
      alive = false;
      off();
      tts.stop();
      abort?.abort();
    },
    onPrefs: draw,
  };
}
