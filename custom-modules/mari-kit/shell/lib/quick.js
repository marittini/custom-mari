// 빠른 설정: the sliders button at the left of the composer (RP and Convo). The chat settings people change
// most, one tap each, without leaving the chat: connection, prompt preset, persona, chat profile, translation
// switches, voice autoplay, organizing memory, reading settings, and 모든 채팅 설정 at the bottom.
// Lists are read only when their row is tapped (the preset list can be large).

import { h, icon, I, setChildren } from "./h.js";
import { api } from "./api.js";
import { data, chatMeta, textConnections } from "./data.js";
import { sheet, toast } from "./ui.js";
import { groupsOf } from "./groups.js";
import { pickPerson } from "./picker.js";
import { voiceSettings, patchVoice } from "./voice.js";
import { profileSheet } from "./profiles.js";

let presetsP = null;
const presetList = () => presetsP || (presetsP = api.get("/prompts").catch(() => ((presetsP = null), [])));

/**
 * chat: the chat as the screen has it; memory: { waiting, busy } or null; organize(): organizes memory;
 * changed(): the screen reloads the chat (translation buttons, persona, …).
 */
export function quickButton({ getChat, getMemory, organize, go, changed }) {
  return h(
    "button",
    {
      type: "button",
      class: "cb",
      "aria-label": "빠른 설정",
      onClick: () => getChat() && openQuick({ getChat, getMemory, organize, go, changed }),
    },
    icon(I.sliders, 17, 1.6),
  );
}

function openQuick({ getChat, getMemory, organize, go, changed }) {
  const body = h("div", { class: "list" });
  const s = sheet(
    h(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "8px", padding: "4px 0 20px", overflowY: "auto" } },
      h("b", { style: { padding: "0 20px 4px", fontSize: "15px" } }, "빠른 설정"),
      body,
    ),
    { label: "빠른 설정" },
  );
  let voice = null;
  const chatId = () => getChat().id;
  const enc = () => encodeURIComponent(chatId());

  const after = async (done) => {
    await changed();
    if (done) toast(done);
    draw();
  };
  const patchChat = async (patch, done) => {
    try {
      await api.patch(`/chats/${enc()}`, patch);
      data.chats(true);
      await after(done);
    } catch (error) {
      toast(error.message);
    }
  };
  const patchMeta = async (patch) => {
    try {
      await api.patch(`/chats/${enc()}/metadata`, patch);
      await after();
    } catch (error) {
      toast(error.message);
    }
  };

  const row = (ic, label, value, onClick) =>
    h(
      "button",
      { type: "button", class: "r", onClick },
      h("span", { class: "ic" }, icon(ic, 18)),
      h("span", null, label),
      h("span", { class: "val" }, value, " ›"),
    );
  const sw = (ic, label, on, onClick) =>
    h(
      "button",
      { type: "button", class: "r", role: "switch", "aria-checked": on ? "true" : "false", onClick },
      h("span", { class: "ic" }, icon(ic, 18)),
      h("span", null, label),
      h("span", { class: on ? "sw on" : "sw" }, h("span")),
    );

  async function pickConnection() {
    const chat = getChat();
    const [list, groups] = await Promise.all([data.connections(), groupsOf("connections")]);
    pickPerson({
      title: "연결",
      key: "pick-connections",
      faces: false,
      items: textConnections(list).map((c) => ({ id: c.id, name: c.name, folderId: c.folderId })),
      groups,
      folderOf: (c) => c.folderId,
      selected: chat.connectionId || null,
      none: "기본 연결",
      onPick: (v) => patchChat({ connectionId: v }, "연결을 바꿨어요"),
    });
  }
  async function pickPreset() {
    const chat = getChat();
    const [list, groups] = await Promise.all([presetList(), groupsOf("presets")]);
    pickPerson({
      title: "프리셋",
      key: "pick-presets",
      faces: false,
      items: (Array.isArray(list) ? list : []).map((p) => ({ id: p.id, name: p.name || "이름 없음" })),
      groups,
      selected: chat.promptPresetId || null,
      none: "기본",
      onPick: (v) =>
        patchChat(
          { promptPresetId: v },
          v && chat.mode === "roleplay"
            ? "프리셋을 바꿨어요 · 선택지는 채팅 설정 › 프리셋 선택지"
            : "프리셋을 바꿨어요",
        ),
    });
  }
  async function pickPersona() {
    const chat = getChat();
    const [list, groups] = await Promise.all([data.personas(), groupsOf("personas")]);
    pickPerson({
      title: "페르소나",
      key: "pick-personas",
      items: list.map((p) => ({ id: p.id, name: p.name || "이름 없음", avatar: p.avatarPath })),
      groups,
      selected: chat.personaId || null,
      onPick: (v) => patchChat({ personaId: v }, "페르소나를 바꿨어요"),
    });
  }

  function draw() {
    const chat = getChat();
    const meta = chatMeta(chat);
    const memory = getMemory?.();
    const personaName = chat.personaId ? personaNames.get(chat.personaId) || "고름" : "없음";
    setChildren(
      body,
      row(I.link, "연결", connName(chat.connectionId), pickConnection),
      row(I.list, "프리셋", "", pickPreset),
      row(I.person, "페르소나", personaName, pickPersona),
      row(I.sliders, "채팅 프로필", "", () => profileSheet({ chat: getChat(), changed: () => after() })),
      sw(I.translate, "자동 번역", meta.autoTranslate === true, () =>
        patchMeta({ autoTranslate: meta.autoTranslate !== true }),
      ),
      sw(I.translate, "보낼 말 번역 버튼", meta.showInputTranslateButton === true, () =>
        patchMeta({ showInputTranslateButton: meta.showInputTranslateButton !== true }),
      ),
      voice
        ? sw(I.voice, "음성 자동 재생", voice.autoplay && voice.autoplay !== "off", async () => {
            try {
              voice = await patchVoice({ autoplay: voice.autoplay && voice.autoplay !== "off" ? "off" : "chars" });
              draw();
            } catch (error) {
              toast(error.message);
            }
          })
        : null,
      memory
        ? row(I.memory, "기억 정리", memory.busy ? "정리 중" : `대기 ${memory.waiting}`, () => {
            s.close();
            organize();
          })
        : null,
      row(I.reader, "읽기 설정", "", () => (s.close(), go("reader"))),
      row(I.gear, "모든 채팅 설정", "", () => (s.close(), go(`chat-settings/${enc()}`))),
    );
  }

  // Names shown on the rows, from lists the shell already keeps.
  const connNames = new Map();
  const personaNames = new Map();
  const connName = (id) => (id ? connNames.get(id) || "고름" : "기본");
  draw();
  Promise.all([data.connections(), data.personas(), voiceSettings()]).then(([conns, personas, v]) => {
    for (const c of conns || []) connNames.set(c.id, c.name);
    for (const p of personas || []) personaNames.set(p.id, p.name || "이름 없음");
    voice = v;
    if (body.isConnected) draw();
  });
  return s;
}
