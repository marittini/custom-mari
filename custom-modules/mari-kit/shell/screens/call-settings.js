// 통화 설정 for one Convo room: translation directions (the chat's own translation settings), what the
// conversation keeps of a call, the replay cache, and the Calls package switches this room and the Engine use.

import { h, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data, chatMeta } from "../lib/data.js";
import { pageHead, toast, errorBox } from "../lib/ui.js";
import { callPrefs, setCallPrefs } from "../lib/call.js";

const sw = (on) => h("span", { class: on ? "sw on" : "sw" }, h("span"));
const CACHE = "mari-shell-tts";

export function callSettingsScreen({ mount, args, go, back }) {
  const chatId = args[0];
  let alive = true;
  let chat = null;
  let tts = null;
  let cacheSize = null;
  const body = h(
    "div",
    { class: "scroll", style: { padding: "0 20px 32px" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  mount.append(pageHead("통화 설정", { label: " ", back: () => back("convos") }), body);

  async function load() {
    try {
      [chat, tts] = await Promise.all([data.chat(chatId), api.get("/tts/config").catch(() => null)]);
      mount.querySelector(".phead .label").textContent = `${chat.name || "이 방"} · 이 방`;
      try {
        const keys = await (await caches.open(CACHE)).keys();
        cacheSize = keys.length;
      } catch {
        cacheSize = null;
      }
      if (alive) draw();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  }
  async function patchMeta(patch) {
    try {
      await api.patch(`/chats/${encodeURIComponent(chatId)}/metadata`, patch);
      await load();
    } catch (error) {
      toast(error.message);
    }
  }
  const row = (label, sub, on, onClick) =>
    h(
      "button",
      { type: "button", class: "grow", role: "switch", "aria-checked": on ? "true" : "false", onClick },
      h("span", null, label, sub ? h("small", null, sub) : null),
      sw(on),
    );

  function draw() {
    const meta = chatMeta(chat);
    const toggles =
      typeof meta.conversationCommandToggles === "object" && meta.conversationCommandToggles
        ? meta.conversationCommandToggles
        : {};
    const p = callPrefs();
    setChildren(
      body,
      h("div", { class: "gsec" }, h("span", null, "번역"), h("span", null, "이 방의 번역 설정을 써요")),
      h(
        "div",
        { class: "gcard" },
        row("내 말 번역해서 말하기", "한국어로 말해도 캐릭터 말로 옮겨 전해요", meta.translateInput === true, () =>
          patchMeta({ translateInput: meta.translateInput !== true }),
        ),
        row("상대 말 번역해서 보기", "자막에 번역을 같이 보여요", meta.autoTranslate === true, () =>
          patchMeta({ autoTranslate: meta.autoTranslate !== true }),
        ),
        h(
          "button",
          { type: "button", class: "grow", onClick: () => go(`chat-settings/${encodeURIComponent(chatId)}`) },
          h(
            "span",
            null,
            "번역 방식 · 언어",
            h(
              "small",
              null,
              `${meta.translationProvider || "google"} · ${meta.translationInputTargetLang || meta.translationTargetLang || "en"} ↔ ${meta.translationOutputTargetLang || "ko"}`,
            ),
          ),
          h("span", { class: "val" }, "›"),
        ),
      ),
      h("div", { class: "gsec" }, h("span", null, "기록")),
      h(
        "div",
        { class: "gcard" },
        row(
          "대화에 통화 남기기",
          "끝난 통화를 눌러 대사와 다시 듣기",
          p.log,
          () => (setCallPrefs({ log: !p.log }), draw()),
        ),
        h(
          "div",
          { class: "grow" },
          h(
            "span",
            null,
            "다시 듣기 음성",
            h("small", null, cacheSize === null ? "이 기기에 보관" : `이 기기에 보관 · ${cacheSize}개`),
          ),
          h(
            "button",
            {
              type: "button",
              class: "chip",
              onClick: async () => {
                try {
                  await caches.delete(CACHE);
                  toast("비웠어요");
                } catch {}
                load();
              },
            },
            "비우기",
          ),
        ),
      ),
      h("div", { class: "gsec" }, h("span", null, "통화")),
      h(
        "div",
        { class: "gcard" },
        row("이 방에서 통화", "Calls 패키지 · 이 방 스위치", meta.conversationCallsEnabled === true, () =>
          patchMeta({ conversationCallsEnabled: meta.conversationCallsEnabled !== true }),
        ),
        row("캐릭터가 먼저 걸기", null, meta.characterCommands !== false && toggles.call !== false, () =>
          patchMeta({ conversationCommandToggles: { ...toggles, call: !(toggles.call !== false) } }),
        ),
        row("통화 음성 (모든 방)", "엔진 TTS 설정", tts?.callAudioEnabled === true, async () => {
          try {
            await api.put("/tts/config", { ...tts, callAudioEnabled: tts?.callAudioEnabled !== true });
            await load();
          } catch (error) {
            toast(error.message);
          }
        }),
      ),
    );
  }

  load();
  return { dispose: () => (alive = false) };
}
