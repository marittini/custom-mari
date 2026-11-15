// 통화 설정 for one Convo room: translation directions (the chat's own translation settings), what the
// conversation keeps of a call, the replay cache, and the Calls package switches this room and the Engine use.

import { h, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data, chatMeta } from "../lib/data.js";
import { pageHead, toast, errorBox, ask } from "../lib/ui.js";
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
        row("내 말 번역해서 보내기", "한국어로 말해도 캐릭터 말로 옮겨 전해요", meta.translateInput === true, () =>
          patchMeta({ translateInput: meta.translateInput !== true }),
        ),
        row("받은 말 자동 번역", "자막에 번역을 같이 보여요", meta.autoTranslate === true, () =>
          patchMeta({ autoTranslate: meta.autoTranslate !== true }),
        ),
        h(
          "button",
          {
            type: "button",
            class: "grow",
            onClick: () => go(`chat-settings/${encodeURIComponent(chatId)}/translation`),
          },
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
                const n = cacheSize ? `${cacheSize}개` : "모든";
                if (
                  !(await ask(
                    `이 기기에 보관한 다시 듣기 음성 ${n}를 지울까요?\n다시 들으려면 음성을 새로 만들어야 해요 (음성 요청이 다시 들어요).`,
                    { ok: "비우기", danger: true },
                  ))
                )
                  return;
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
        // One switch for "can a character call me": the call command the Engine actually checks; the older
        // conversationCharactersCanCall (read by nothing now) is written the same so the two never disagree.
        row(
          "캐릭터가 먼저 전화 걸기",
          meta.characterCommands === false ? "캐릭터 명령이 꺼져 있어 지금은 걸지 않아요" : null,
          meta.characterCommands !== false && toggles.call !== false,
          () => {
            const on = !(toggles.call !== false);
            patchMeta({ conversationCommandToggles: { ...toggles, call: on }, conversationCharactersCanCall: on });
          },
        ),
        row(
          "통화 대사에 감정 표시",
          "음성이 [속삭임] 같은 표시를 읽어요",
          meta.conversationCallVoiceCues !== false,
          () => patchMeta({ conversationCallVoiceCues: meta.conversationCallVoiceCues === false }),
        ),
        // The call voice is for every room, so it is switched in 설정 › 모든 방 공통 기능; here it only says how it is.
        h(
          "button",
          { type: "button", class: "grow", onClick: () => go("settings/shared") },
          h(
            "span",
            null,
            "통화 음성",
            h("small", null, `모든 방 공통 · ${tts?.callAudioEnabled === true ? "켜짐" : "꺼짐"} · 설정에서 바꿔요`),
          ),
          h("span", { class: "val" }, "›"),
        ),
        h(
          "button",
          { type: "button", class: "grow", onClick: () => go("settings/shared") },
          h("span", null, "캐릭터가 알아서 전화 끊기", h("small", null, "모든 방 공통 · 설정에서 바꿔요")),
          h("span", { class: "val" }, "›"),
        ),
      ),
    );
  }

  load();
  return { dispose: () => (alive = false) };
}
