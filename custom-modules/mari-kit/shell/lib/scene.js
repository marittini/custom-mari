// Scenes, the Engine's own flow (packages/client/src/lib/scene-generation.ts, ScenePromptPreferencesModal,
// SceneBanner, EndSceneBar): a Convo character invites the user (an assistant message's extra.sceneRequest) or the
// user types /scene; a setup sheet asks the writing shape (POV, tense, extra notes, prompt preset and its choices,
// persona, cast); POST /scene/plan writes the plan and POST /scene/create makes the Roleplay chat. While it runs the
// Convo shows a banner (go there, let the cast answer here too); the scene chat can be ended with a summary (it comes
// back to the Convo and into the characters' memories), discarded, or turned into a standalone Roleplay.
// POV, tense, notes and preset are remembered in the Engine's synced settings (scenePromptPreferences), like the
// Engine; persona, cast and preset choices are for one scene only.

import { h, setChildren } from "./h.js";
import { api } from "./api.js";
import { data } from "./data.js";
import { sheet, toast } from "./ui.js";
import { startJob } from "./activity.js";
import { groupsOf, splitByGroup, groupedOptions } from "./groups.js";
import { mergeEngineUi } from "./engine-ui.js";

export const POV = [
  ["first_person", "1인칭"],
  ["second_person", "2인칭"],
  ["third_person", "3인칭"],
];
export const TENSE = [
  ["past", "과거"],
  ["present", "현재"],
  ["future", "미래"],
];
export const EXTRA_MAX = 2000;

/** The Engine's normalizeScenePromptPreferences: { pov, tense, extraInstructions, promptPresetId }. */
export function scenePrefs(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    pov: POV.some(([v]) => v === r.pov) ? r.pov : "third_person",
    tense: TENSE.some(([v]) => v === r.tense) ? r.tense : "present",
    extraInstructions: typeof r.extraInstructions === "string" ? r.extraInstructions.trim().slice(0, EXTRA_MAX) : "",
    promptPresetId: typeof r.promptPresetId === "string" && r.promptPresetId.trim() ? r.promptPresetId.trim() : null,
  };
}

/** The planning prompt: the scenario, then the inviter's plot plan (the Engine's wording). */
export function planningPrompt(prompt, planHint) {
  return [prompt || "", planHint ? `Suggested plot plan:\n${planHint}` : ""]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** What a chat's metadata says about scenes: { activeSceneId } on a Convo, { isScene, active, originId } on a scene. */
export function sceneOf(meta) {
  const m = meta || {};
  return {
    activeSceneId: typeof m.activeSceneChatId === "string" && m.activeSceneChatId ? m.activeSceneChatId : null,
    isScene: m.sceneStatus === "active" || typeof m.sceneOriginChatId === "string",
    active: m.sceneStatus === "active",
    originId: typeof m.sceneOriginChatId === "string" ? m.sceneOriginChatId : null,
    repliesHere: m.sceneOriginRepliesAllowed === true,
  };
}

/** The /scene/create body from the plan and the setup sheet's answer (undefined keys are left out). */
export function createBody({ chatId, initiatorCharId, plan, connectionId, prefs }) {
  return {
    originChatId: chatId,
    initiatorCharId: initiatorCharId ?? null,
    plan,
    connectionId: connectionId ?? null,
    promptPresetId: prefs.promptPresetId ?? null,
    ...(prefs.presetChoices ? { presetChoices: prefs.presetChoices } : {}),
    ...(prefs.participantCharacterIds ? { participantCharacterIds: prefs.participantCharacterIds } : {}),
    ...(prefs.personaId !== undefined ? { personaId: prefs.personaId } : {}),
  };
}

const chipRow = (label, list, value, pick) =>
  h(
    "div",
    { class: "scn-row" },
    h("span", { class: "label" }, label),
    h(
      "div",
      { class: "chips", role: "radiogroup", "aria-label": label },
      list.map(([v, t]) =>
        h(
          "button",
          {
            type: "button",
            class: v === value ? "chip on" : "chip",
            role: "radio",
            "aria-checked": v === value ? "true" : "false",
            onClick: () => pick(v),
          },
          t,
        ),
      ),
    ),
  );

/**
 * The setup sheet (the Engine's Scene Prompt Setup). chat: the Convo; index: character id → { name }; from: who
 * invites (a name) or null. Resolves ScenePromptPreferences, or null when closed.
 */
export async function sceneSetup({ chat, index, from }) {
  const [ui, presets, personas, presetGroups] = await Promise.all([
    data.engineUi().catch(() => ({})),
    api.get("/prompts").catch(() => []),
    data.personas(),
    groupsOf("presets"),
  ]);
  const p = scenePrefs(ui?.scenePromptPreferences);
  if (p.promptPresetId && !presets.some((x) => x.id === p.promptPresetId)) p.promptPresetId = null;
  const cast = chat.characterIds || [];
  let persona = "source"; // "source" = the Convo's persona (sends nothing), "" = none
  let auto = true;
  let chosen = [...cast];
  let choices = null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      s.close();
      resolve(v);
    };
    const box = h("div", { class: "psheet pad scn" });
    const s = sheet(box, { label: "장면 준비", onClose: () => finish(null) });
    const extra = h("textarea", {
      class: "inp",
      rows: 3,
      maxlength: EXTRA_MAX,
      placeholder: "장면 글에 바라는 점 (비워도 돼요)",
      "aria-label": "추가 지시",
      onInput: (e) => (p.extraInstructions = e.target.value),
    });
    extra.value = p.extraInstructions;
    async function askChoices() {
      const { pickPresetChoices, NO_CHOICES } = await import("./preset-choices.js");
      const picks = await pickPresetChoices({
        presetId: p.promptPresetId,
        existing: choices || {},
        title: (n) => `${n} · 이 장면의 선택`,
        ok: "확인",
      });
      if (picks === NO_CHOICES) return true;
      if (!picks) return false;
      choices = picks;
      return true;
    }
    async function submit() {
      if (!auto && !chosen.length) return toast("캐릭터를 한 명 이상 골라 주세요");
      if (p.promptPresetId && !choices) {
        try {
          if (!(await askChoices())) return;
        } catch (error) {
          return toast(error.message);
        }
      }
      const saved = scenePrefs(p);
      mergeEngineUi({ scenePromptPreferences: saved }).catch(() => {});
      finish({
        ...saved,
        ...(choices ? { presetChoices: choices } : {}),
        ...(auto ? {} : { participantCharacterIds: chosen }),
        ...(persona === "source" ? {} : { personaId: persona || null }),
      });
    }
    const paint = () =>
      setChildren(
        box,
        h("b", { class: "psheet-title" }, from ? `${from}이(가) 장면을 시작하고 싶어 해요` : "장면 시작"),
        h("p", { class: "hint", style: { margin: "0" } }, "장면을 짜기 전에 글의 모양을 골라요."),
        chipRow("시점", POV, p.pov, (v) => ((p.pov = v), paint())),
        chipRow("시제", TENSE, p.tense, (v) => ((p.tense = v), paint())),
        h(
          "label",
          { class: "scn-row" },
          h("span", { class: "label" }, "프리셋"),
          h(
            "select",
            {
              class: "sel",
              "aria-label": "프리셋",
              onChange: async (e) => {
                p.promptPresetId = e.target.value || null;
                choices = null;
                // Like the Engine: picking a preset asks its choices right away.
                if (p.promptPresetId) await askChoices().catch((error) => toast(error.message));
                paint();
              },
            },
            groupedOptions(h, p.promptPresetId || "", [["", "없음"]], splitByGroup(presets, presetGroups), (x) => [
              x.id,
              x.name,
            ]),
          ),
          h(
            "small",
            { class: "hint" },
            p.promptPresetId && choices
              ? "선택지를 골랐어요 · 다음 장면에도 이 프리셋을 써요"
              : "다음 장면에도 기억해요",
          ),
        ),
        h(
          "details",
          { class: "scn-more" },
          h("summary", null, "더 정하기 · 추가 지시, 페르소나, 나올 캐릭터"),
          h("div", { class: "scn-row" }, h("span", { class: "label" }, "추가 지시"), extra),
          h(
            "label",
            { class: "scn-row" },
            h("span", { class: "label" }, "장면 페르소나"),
            h(
              "select",
              { class: "sel", "aria-label": "장면 페르소나", onChange: (e) => (persona = e.target.value) },
              [["source", "대화의 페르소나 그대로"], ["", "없음"], ...personas.map((x) => [x.id, x.name])].map(
                ([v, t]) => h("option", { value: v, selected: v === persona }, t),
              ),
            ),
          ),
          h(
            "div",
            { class: "scn-row" },
            h("span", { class: "label" }, "나올 캐릭터"),
            h(
              "button",
              {
                type: "button",
                class: "r",
                role: "switch",
                "aria-checked": auto ? "true" : "false",
                disabled: !cast.length,
                onClick: () => ((auto = !auto), (chosen = [...cast]), paint()),
              },
              h("span", null, "장면을 짤 때 알아서 고르기"),
              h("span", { class: auto ? "sw on" : "sw" }, h("span")),
            ),
            auto
              ? null
              : h(
                  "div",
                  { class: "chips", role: "group", "aria-label": "나올 캐릭터" },
                  cast.map((id) => {
                    const on = chosen.includes(id);
                    return h(
                      "button",
                      {
                        type: "button",
                        class: on ? "chip on" : "chip",
                        "aria-pressed": on ? "true" : "false",
                        onClick: () => ((chosen = on ? chosen.filter((x) => x !== id) : [...chosen, id]), paint()),
                      },
                      index.get(id)?.name || "캐릭터",
                    );
                  }),
                ),
            !auto && !chosen.length ? h("small", { class: "hint" }, "한 명 이상 골라 주세요") : null,
          ),
        ),
        h(
          "div",
          { class: "scn-acts" },
          h("button", { type: "button", class: "pill", onClick: () => finish(null) }, "취소"),
          h(
            "button",
            { type: "button", class: "pill main", disabled: !auto && !chosen.length, onClick: submit },
            "장면 짜기",
          ),
        ),
      );
    paint();
  });
}

/**
 * The whole start: setup sheet, plan, create, then into the scene. request: the invitation's sceneRequest (or
 * { prompt } from /scene). Shows the work in the activity strip with 멈추기 (the Engine's calls cannot be cancelled
 * once sent; 멈추기 drops the answer before the next step).
 */
export async function startScene({ chat, index, request, go }) {
  let prefs;
  try {
    prefs = await sceneSetup({ chat, index, from: request.initiatorCharName || null });
  } catch (error) {
    return toast(`장면 준비를 열지 못했어요: ${error.message}`);
  }
  if (!prefs) return;
  let stopped = false;
  let done = startJob("장면 짜는 중…", { label: "멈추기", fn: () => ((stopped = true), done()) }, { chat: chat.id });
  try {
    const res = await api.post("/scene/plan", {
      chatId: chat.id,
      prompt: planningPrompt(request.prompt, request.planHint),
      connectionId: request.connectionId ?? null,
      promptPreferences: prefs,
      initiatorCharId: request.initiatorCharId ?? null,
    });
    if (stopped) return;
    const plan = res?.plan;
    if (!plan) return toast(res?.error || "장면을 짜지 못했어요. 다시 해 주세요.");
    if (request.background) plan.background = request.background;
    done();
    done = startJob("장면 만드는 중…", { label: "멈추기", fn: () => ((stopped = true), done()) }, { chat: chat.id });
    const made = await api.post(
      "/scene/create",
      createBody({
        chatId: chat.id,
        initiatorCharId: request.initiatorCharId,
        plan,
        connectionId: request.connectionId,
        prefs,
      }),
    );
    if (stopped) return;
    toast(`장면을 만들었어요: ${made.chatName || "장면"}`);
    go(`rp/${encodeURIComponent(made.chatId)}`);
  } catch (error) {
    if (stopped) return;
    toast(
      /409|already has an active Scene/i.test(error.message)
        ? "이 대화에는 이미 진행 중인 장면이 있어요"
        : `장면을 만들지 못했어요: ${error.message}`,
    );
  } finally {
    if (!stopped) done();
  }
}

/** The scene chat's ends: conclude (summary back to the Convo), abandon (delete), convert (standalone Roleplay). */
export async function concludeScene(sceneChatId) {
  return api.post("/scene/conclude", { sceneChatId, connectionId: null });
}
export const abandonScene = (sceneChatId) => api.post("/scene/abandon", { sceneChatId });
export const forkScene = (sceneChatId, mode, upToMessageId) =>
  api.post("/scene/fork", {
    sceneChatId,
    mode,
    ...(upToMessageId ? { upToMessageId } : {}),
    includePreSceneSummary: true,
    includeParticipationGuide: true,
  });

/** Lets the scene's cast answer in the Convo while the scene runs (the switch lives on the scene chat). */
export const setRepliesHere = (sceneChatId, on) =>
  api.patch(`/chats/${encodeURIComponent(sceneChatId)}/metadata`, { sceneOriginRepliesAllowed: on });
