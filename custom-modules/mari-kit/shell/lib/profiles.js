// 채팅 프로필: the Engine's own settings profiles (/chat-presets), one list per mode. The same calls and the same
// rules as the Engine's Chat Settings: apply one to this chat, save this chat's settings into it (and, if asked,
// into the other chats that follow it), save as a new profile, make one the start of new chats, rename, delete.
// The Default profile can only be applied or made the start of new chats.

import { h, setChildren } from "./h.js";
import { api } from "./api.js";
import { chatMeta } from "./data.js";
import { sheet, toast } from "./ui.js";

/** The chat's settings as a profile holds them (the Engine strips what profiles don't keep). */
export function snapshotOf(chat, { withStart = false } = {}) {
  const metadata = chatMeta(chat);
  const lore = Array.isArray(metadata.activeLorebookIds)
    ? metadata.activeLorebookIds.filter((x) => typeof x === "string")
    : [];
  return {
    connectionId: chat.connectionId ?? null,
    promptPresetId: chat.promptPresetId ?? null,
    metadata,
    ...(withStart && chat.personaId ? { personaId: chat.personaId } : {}),
    ...(withStart && lore.length ? { lorebookIds: lore } : {}),
  };
}

/** Saving into a profile keeps the profile's own background, persona and lorebooks (the Engine's rule). */
export function saveInto(snapshot, own = {}) {
  const metadata = { ...snapshot.metadata };
  if (own.metadata?.background !== undefined) metadata.background = own.metadata.background;
  return {
    ...snapshot,
    metadata,
    ...(own.personaId ? { personaId: own.personaId } : {}),
    ...(own.lorebookIds?.length ? { lorebookIds: own.lorebookIds } : {}),
  };
}

const follows = (meta, id) => meta.appliedChatPresetId === id && !meta.multiplayer && meta.multiplayerSetup !== true;

/** changed(): the caller re-reads the chat; called after anything that changed this chat. */
export function profileSheet({ chat, changed }) {
  const box = h("div", { style: { display: "flex", flexDirection: "column", gap: "10px", minHeight: "0" } });
  const s = sheet(
    h(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "10px", padding: "4px 0 24px", overflowY: "auto" } },
      h("b", { style: { padding: "0 20px", fontSize: "15px" } }, "채팅 프로필"),
      h(
        "p",
        { class: "hint", style: { margin: "0", padding: "0 20px" } },
        "채팅 설정을 묶어 둔 것 · 엔진의 채팅 프로필과 같아요",
      ),
      box,
    ),
    { label: "채팅 프로필" },
  );
  let profiles = [];
  const enc = encodeURIComponent;

  const run = async (fn, done, chatChanged = true) => {
    try {
      const res = await fn();
      if (chatChanged && res && typeof res === "object" && res.id === chat.id) chat = res;
      if (chatChanged) await changed?.();
      if (done) toast(done);
      await load();
    } catch (error) {
      toast(error.message);
    }
  };

  async function load() {
    try {
      profiles = await api.get(`/chat-presets?mode=${enc(chat.mode)}`);
      if (box.isConnected) draw();
    } catch (error) {
      setChildren(box, h("div", { class: "empty" }, error.message));
    }
  }

  async function saveHere(p) {
    const settings = saveInto(snapshotOf(chat), p.settings);
    const others = (await api.get("/chats").catch(() => [])).filter(
      (o) => o.id !== chat.id && o.mode === chat.mode && follows(chatMeta(o), p.id),
    ).length;
    await api.put(`/chat-presets/${enc(p.id)}/settings`, settings);
    if (others && confirm(`'${p.name}'을 따르는 다른 채팅 ${others}개에도 이 설정을 넣을까요?`)) {
      const r = await api.post(`/chat-presets/${enc(p.id)}/apply-to-followers`, { exceptChatId: chat.id });
      return r.failed ? `저장 · ${r.updated}개 반영, ${r.failed}개 실패` : `저장 · 다른 채팅 ${r.updated}개에도 반영`;
    }
    return `'${p.name}'에 저장했어요`;
  }

  function draw() {
    const meta = chatMeta(chat);
    const applied = profiles.find((p) => p.id === meta.appliedChatPresetId) || null;
    const target = applied || profiles.find((p) => p.isDefault) || null;
    const name = h("input", {
      class: "inp",
      placeholder: "새 프로필 이름",
      maxlength: 120,
      "aria-label": "새 프로필 이름",
    });
    const rename = h("input", {
      class: "inp",
      value: target && !target.isDefault ? target.name : "",
      maxlength: 120,
      "aria-label": "프로필 이름",
    });
    setChildren(
      box,
      h(
        "div",
        { class: "list" },
        profiles.map((p) =>
          h(
            "button",
            {
              type: "button",
              class: "r two",
              role: "radio",
              "aria-checked": applied?.id === p.id ? "true" : "false",
              onClick: () =>
                run(
                  () => api.post(`/chat-presets/${enc(p.id)}/apply/${enc(chat.id)}`, {}),
                  `'${p.isDefault ? "기본" : p.name}' 적용`,
                ),
            },
            h(
              "span",
              null,
              p.isDefault ? "기본" : p.name,
              p.isActive ? h("small", { class: "hint" }, "  · 새 채팅 기본") : null,
            ),
            h("span", { class: "val" }, applied?.id === p.id ? "적용됨" : "적용"),
          ),
        ),
      ),
      target
        ? h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "10px", padding: "6px 20px 0" } },
            h("div", { class: "label" }, `지금 고른 프로필 · ${target.isDefault ? "기본" : target.name}`),
            h(
              "div",
              { style: { display: "flex", flexWrap: "wrap", gap: "8px" } },
              target.isDefault
                ? null
                : h(
                    "button",
                    {
                      type: "button",
                      class: "pill main",
                      onClick: () => run(() => saveHere(target).then(toast), null, false),
                    },
                    "이 채팅 설정으로 저장",
                  ),
              target.isActive
                ? null
                : h(
                    "button",
                    {
                      type: "button",
                      class: "pill",
                      onClick: () =>
                        run(
                          () => api.post(`/chat-presets/${enc(target.id)}/set-active`),
                          "새 채팅이 이걸로 시작해요",
                          false,
                        ),
                    },
                    "새 채팅 기본으로",
                  ),
            ),
            target.isDefault
              ? null
              : h(
                  "details",
                  null,
                  h(
                    "summary",
                    { class: "hint", style: { cursor: "pointer", minHeight: "32px" } },
                    "이름 바꾸기 · 지우기",
                  ),
                  h(
                    "div",
                    { class: "rowform", style: { paddingTop: "8px" } },
                    rename,
                    h(
                      "button",
                      {
                        type: "button",
                        class: "pill",
                        onClick: () =>
                          rename.value.trim() &&
                          run(
                            () => api.patch(`/chat-presets/${enc(target.id)}`, { name: rename.value.trim() }),
                            "이름을 바꿨어요",
                            false,
                          ),
                      },
                      "이름 저장",
                    ),
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      class: "pill",
                      style: { marginTop: "10px" },
                      onClick: () =>
                        confirm(`'${target.name}' 프로필을 지울까요? 이 채팅은 기본 프로필로 돌아가요.`) &&
                        run(async () => {
                          await api.delete(`/chat-presets/${enc(target.id)}`);
                          // Like the Engine: a chat that had it goes back to Default.
                          const def = profiles.find((p) => p.isDefault);
                          if (applied && def) return api.post(`/chat-presets/${enc(def.id)}/apply/${enc(chat.id)}`, {});
                        }, "지웠어요"),
                    },
                    "프로필 지우기",
                  ),
                ),
          )
        : null,
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "8px", padding: "14px 20px 0" } },
        h("div", { class: "label" }, "이 채팅 설정을 새 프로필로"),
        h(
          "div",
          { class: "rowform" },
          name,
          h(
            "button",
            {
              type: "button",
              class: "pill",
              onClick: () => {
                const n = name.value.trim();
                if (!n) return toast("이름을 적어 주세요");
                run(async () => {
                  const p = await api.post("/chat-presets", {
                    name: n,
                    mode: chat.mode,
                    settings: snapshotOf(chat, { withStart: true }),
                  });
                  return api.post(`/chat-presets/${enc(p.id)}/apply/${enc(chat.id)}`, { keepPersona: true });
                }, `'${n}' 만들고 적용했어요`);
              },
            },
            "만들기",
          ),
        ),
      ),
    );
  }

  setChildren(box, h("div", { class: "empty" }, "불러오는 중…"));
  load();
  return s;
}
