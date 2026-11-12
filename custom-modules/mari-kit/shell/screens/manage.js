// Engine settings edited from the shell: connections, prompt presets and Text to Speech.
// Everything goes through the Engine's own routes; stored keys never come back to the page (the Engine masks
// them), and leaving a key field empty keeps the stored one.

import { h, icon, I, setChildren } from "../lib/h.js";
import { api, characterCard } from "../lib/api.js";
import { data, characterIndex } from "../lib/data.js";
import { toast, errorBox } from "../lib/ui.js";

const PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "deepseek",
  "xai",
  "mistral",
  "cohere",
  "nanogpt",
  "zai",
  "arli",
  "custom",
];
const TTS_SOURCES = [
  ["openai", "OpenAI 호환"],
  ["elevenlabs", "ElevenLabs"],
  ["xai", "xAI"],
  ["pockettts", "PocketTTS"],
];
const PARAMS = [
  { key: "temperature", label: "온도", min: 0, max: 2, step: 0.05 },
  { key: "topP", label: "Top P", min: 0, max: 1, step: 0.01 },
  { key: "maxTokens", label: "최대 출력 토큰", min: 1, step: 1, int: true },
  { key: "maxContext", label: "최대 컨텍스트", min: 1, step: 1, int: true },
];

const field = (label, input, hint) =>
  h("label", { class: "fld" }, label, input, hint ? h("span", { class: "hint" }, hint) : null);
const text = (value, attrs = {}) => h("input", { class: "inp", type: "text", value: value ?? "", ...attrs });
const select = (value, options, attrs = {}) =>
  h(
    "select",
    { class: "inp", ...attrs },
    options.map(([v, t]) => h("option", { value: v, selected: String(value ?? "") === v }, t)),
  );
const stack = (...children) =>
  h("div", { style: { display: "flex", flexDirection: "column", gap: "20px", padding: "12px 0 28px" } }, children);
const actions = (...buttons) =>
  h("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", padding: "0 20px" } }, buttons);

function row(label, value, onClick) {
  return h(
    "button",
    { type: "button", class: "r two", onClick },
    h("span", null, label),
    h("span", { class: "val" }, `${value} ›`),
  );
}

async function guard(body, fn) {
  try {
    await fn();
  } catch (error) {
    setChildren(body, errorBox(error));
  }
}

// ── connections ───────────────────────────
export function connectionsPage(body, go) {
  guard(body, async () => {
    const list = await api.get("/connections");
    const chat = list.filter(
      (c) => !["image_generation", "video_generation", "audio_generation", "audio"].includes(c.provider),
    );
    setChildren(
      body,
      stack(
        chat.length
          ? h(
              "div",
              { class: "list" },
              chat.map((c) =>
                row(
                  c.name,
                  `${c.model || "모델 없음"}${c.isDefault === "true" || c.isDefault === true ? " · 기본" : ""}`,
                  () => go(`settings/connection/${encodeURIComponent(c.id)}`),
                ),
              ),
            )
          : h("div", { class: "empty" }, "연결이 아직 없어요."),
        actions(
          h(
            "button",
            { type: "button", class: "pill main", onClick: () => go("settings/connection/new") },
            "연결 추가",
          ),
        ),
      ),
    );
  });
}

export function connectionPage(body, go, id) {
  guard(body, async () => {
    const isNew = id === "new";
    const c = isNew
      ? { name: "", provider: "openai", baseUrl: "", model: "" }
      : await api.get(`/connections/${encodeURIComponent(id)}`);
    const name = text(c.name, { placeholder: "예: 메인" });
    const provider = select(
      c.provider,
      PROVIDERS.map((p) => [p, p]),
    );
    const baseUrl = text(c.baseUrl, { placeholder: "비우면 제공사 기본 주소", inputmode: "url" });
    const key = h("input", {
      class: "inp",
      type: "password",
      autocomplete: "off",
      placeholder: isNew ? "API 키" : "비우면 저장된 키 유지",
    });
    const model = text(c.model, { list: "mk-models", placeholder: "모델 ID" });
    const models = h("datalist", { id: "mk-models" });
    const isDefault = h("input", { type: "checkbox", checked: c.isDefault === true || c.isDefault === "true" });
    const loadModels = async () => {
      try {
        const res = await api.get(`/connections/${encodeURIComponent(id)}/models?refresh=1`);
        const ids = (res?.models || res || []).map((m) => (typeof m === "string" ? m : m.id)).filter(Boolean);
        setChildren(
          models,
          ids.map((m) => h("option", { value: m })),
        );
        toast(ids.length ? `모델 ${ids.length}개를 불러왔어요` : "모델 목록이 비어 있어요");
      } catch (error) {
        toast(`불러오지 못했어요: ${error.message}`);
      }
    };
    const save = async () => {
      const body = {
        name: name.value.trim(),
        provider: provider.value,
        baseUrl: baseUrl.value.trim(),
        model: model.value.trim(),
        isDefault: isDefault.checked,
      };
      if (key.value.trim()) body.apiKey = key.value.trim();
      if (!body.name) return toast("이름을 적어 주세요");
      try {
        if (isNew) await api.post("/connections", { apiKey: "", ...body });
        else await api.patch(`/connections/${encodeURIComponent(id)}`, body);
        toast("저장했어요");
        go("settings/connections");
      } catch (error) {
        toast(`저장하지 못했어요: ${error.message}`);
      }
    };
    const remove = async () => {
      if (!confirm(`'${c.name}' 연결을 지울까요?`)) return;
      try {
        await api.delete(`/connections/${encodeURIComponent(id)}`);
        go("settings/connections");
      } catch (error) {
        toast(error.message);
      }
    };
    setChildren(
      body,
      stack(
        field("이름", name),
        field("제공사", provider),
        field("주소", baseUrl),
        field("API 키", key),
        field(
          "모델",
          h(
            "div",
            { style: { display: "flex", gap: "8px" } },
            model,
            models,
            isNew
              ? null
              : h(
                  "button",
                  { type: "button", class: "pill", style: { flexShrink: "0" }, onClick: loadModels },
                  "불러오기",
                ),
          ),
        ),
        h(
          "label",
          { class: "fld", style: { flexDirection: "row", alignItems: "center", gap: "10px" } },
          isDefault,
          "기본 연결로 쓰기",
        ),
        actions(
          isNew ? null : h("button", { type: "button", class: "pill", onClick: remove }, "삭제"),
          h("button", { type: "button", class: "pill main", onClick: save }, "저장"),
        ),
      ),
    );
    data.connections && (await Promise.resolve());
  });
}

// ── prompt presets ────────────────────────
export function presetsPage(body, go) {
  guard(body, async () => {
    const list = await api.get("/prompts");
    setChildren(
      body,
      stack(
        h(
          "div",
          { class: "list" },
          list.map((p) =>
            row(p.name, p.isDefault === true || p.isDefault === "true" ? "기본" : "", () =>
              go(`settings/preset/${encodeURIComponent(p.id)}`),
            ),
          ),
        ),
      ),
    );
  });
}

export function presetPage(body, go, id) {
  let open = null;
  // The stock preset is read-only in the Engine; like the Engine, edit an editable copy instead.
  const write = async (path, payload) => {
    try {
      return await api.patch(path, payload);
    } catch (error) {
      if (error.status !== 409) throw error;
      if (!confirm("기본 프리셋은 고칠 수 없어요. 복사본을 만들어 고칠까요?")) throw new Error("바꾸지 않았어요");
      const copy = await api.post(`/prompts/${encodeURIComponent(id)}/duplicate`);
      go(`settings/preset/${encodeURIComponent(copy.id)}`);
      throw new Error("복사본을 만들었어요. 여기서 고쳐 주세요");
    }
  };
  const draw = async () => {
    const [preset, sections] = await Promise.all([
      api.get(`/prompts/${encodeURIComponent(id)}`),
      api.get(`/prompts/${encodeURIComponent(id)}/sections`),
    ]);
    const params =
      typeof preset.parameters === "string" ? JSON.parse(preset.parameters || "{}") : preset.parameters || {};
    const inputs = {};
    const paramRows = PARAMS.map((p) => {
      inputs[p.key] = h("input", {
        class: "inp",
        type: "number",
        inputmode: p.int ? "numeric" : "decimal",
        step: p.step,
        min: p.min,
        ...(p.max !== undefined ? { max: p.max } : {}),
        value: params[p.key] ?? "",
        placeholder: "기본",
        style: { width: "130px" },
      });
      return h("label", { class: "r two static" }, h("span", null, p.label), inputs[p.key]);
    });
    const effort = select(
      params.reasoningEffort ?? "",
      [
        ["", "모델 기본"],
        ["low", "low"],
        ["medium", "medium"],
        ["high", "high"],
        ["xhigh", "xhigh"],
        ["maximum", "maximum"],
      ],
      { style: { width: "130px", minHeight: "36px" } },
    );
    const saveParams = async () => {
      const next = {};
      for (const p of PARAMS) {
        const v = inputs[p.key].value.trim();
        if (v === "") continue;
        const n = p.int ? parseInt(v, 10) : Number(v);
        if (!Number.isFinite(n)) return toast(`${p.label} 값을 확인해 주세요`);
        next[p.key] = n;
      }
      next.reasoningEffort = effort.value || null;
      try {
        await write(`/prompts/${encodeURIComponent(id)}`, { parameters: next });
        toast("저장했어요");
      } catch (error) {
        toast(`저장하지 못했어요: ${error.message}`);
      }
    };
    const enabled = (s) => s.enabled === true || s.enabled === "true";
    const marker = (s) => s.isMarker === true || s.isMarker === "true";
    const sectionRows = sections.map((s) => {
      const on = enabled(s);
      const head = h(
        "div",
        { class: "r static", style: { gridTemplateColumns: "minmax(0,1fr) auto auto" } },
        h(
          "span",
          { style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" } },
          s.name || s.identifier,
          h("span", { class: "hint" }, marker(s) ? "자리표시(엔진이 채움)" : s.role),
        ),
        marker(s)
          ? h("span")
          : h(
              "button",
              {
                type: "button",
                class: "ma",
                "aria-label": `${s.name} 편집`,
                onClick: () => {
                  open = open === s.id ? null : s.id;
                  draw();
                },
              },
              icon(I.edit, 16, 1.6),
            ),
        h(
          "button",
          {
            type: "button",
            role: "switch",
            "aria-checked": on ? "true" : "false",
            "aria-label": `${s.name} 사용`,
            style: {
              width: "44px",
              height: "36px",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              flexShrink: "0",
              border: "0",
              background: "transparent",
              padding: "0",
              cursor: "pointer",
            },
            onClick: async () => {
              try {
                await write(`/prompts/${encodeURIComponent(id)}/sections/${encodeURIComponent(s.id)}`, {
                  enabled: !on,
                });
                draw();
              } catch (error) {
                toast(error.message);
              }
            },
          },
          h("span", { class: on ? "sw on" : "sw" }, h("span")),
        ),
      );
      if (open !== s.id) return head;
      const area = h("textarea", {
        class: "inp",
        rows: 8,
        style: { resize: "vertical", fontSize: "13px", lineHeight: "1.55" },
      });
      area.value = s.content || "";
      return h(
        "div",
        null,
        head,
        h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              padding: "0 20px 16px",
              borderBottom: "1px solid var(--line)",
            },
          },
          area,
          actions(
            h(
              "button",
              {
                type: "button",
                class: "pill main",
                onClick: async () => {
                  try {
                    await write(`/prompts/${encodeURIComponent(id)}/sections/${encodeURIComponent(s.id)}`, {
                      content: area.value,
                    });
                    open = null;
                    toast("저장했어요");
                    draw();
                  } catch (error) {
                    toast(error.message);
                  }
                },
              },
              "섹션 저장",
            ),
          ),
        ),
      );
    });
    setChildren(
      body,
      stack(
        h("div", { class: "hint", style: { padding: "0 20px" } }, preset.name),
        h(
          "div",
          { class: "list" },
          paramRows,
          h("label", { class: "r two static" }, h("span", null, "추론 강도"), effort),
        ),
        actions(h("button", { type: "button", class: "pill main", onClick: saveParams }, "파라미터 저장")),
        h("div", { class: "hint", style: { padding: "8px 20px 0" } }, `섹션 ${sections.length}개`),
        h("div", { class: "list" }, sectionRows),
      ),
    );
  };
  guard(body, draw);
}

// ── text to speech ────────────────────────
export function voicePage(body) {
  guard(body, async () => {
    const config = await api.get("/tts/config");
    let voices = [];
    try {
      const res = await api.get("/tts/voices");
      voices = (Array.isArray(res) ? res : res?.voices || [])
        .map((v) =>
          typeof v === "string" ? { id: v, name: v } : { id: v.id || v.voice_id || v.name, name: v.name || v.id },
        )
        .filter((v) => v.id);
    } catch {}
    const voiceOptions = [["", "기본 보이스"], ...voices.map((v) => [v.id, v.name])];
    const enabled = h("input", { type: "checkbox", checked: !!config.enabled });
    const source = select(config.source, TTS_SOURCES);
    const baseUrl = text(config.baseUrl, { placeholder: "비우면 기본 주소", inputmode: "url" });
    const key = h("input", {
      class: "inp",
      type: "password",
      autocomplete: "off",
      placeholder: "비우면 저장된 키 유지",
    });
    const model = text(config.model);
    const voice = voices.length
      ? select(config.voice, voiceOptions.slice(1).length ? voiceOptions.slice(1) : voiceOptions)
      : text(config.voice);
    const speed = h("input", { class: "inp", type: "number", step: 0.05, min: 0.25, max: 4, value: config.speed ?? 1 });
    const mode = select(config.voiceMode, [
      ["single", "모두 같은 보이스"],
      ["per-character", "캐릭터마다 다른 보이스"],
    ]);
    const save = async () => {
      const next = {
        ...config,
        enabled: enabled.checked,
        source: source.value,
        baseUrl: baseUrl.value.trim(),
        model: model.value.trim(),
        voice: voice.value.trim(),
        speed: Number(speed.value) || 1,
        voiceMode: mode.value,
      };
      if (key.value.trim()) next.apiKey = key.value.trim();
      try {
        await api.put("/tts/config", next);
        toast("저장했어요");
      } catch (error) {
        toast(`저장하지 못했어요: ${error.message}`);
      }
    };
    setChildren(
      body,
      stack(
        h(
          "label",
          { class: "fld", style: { flexDirection: "row", alignItems: "center", gap: "10px" } },
          enabled,
          "음성 사용",
        ),
        field("소스", source),
        field("주소", baseUrl),
        field("API 키", key),
        field("모델", model),
        field("기본 보이스", voice, voices.length ? null : "보이스 목록을 불러오지 못해 직접 적어요"),
        field("속도", speed),
        field("보이스 방식", mode),
        actions(h("button", { type: "button", class: "pill main", onClick: save }, "저장")),
        h(
          "div",
          { class: "hint", style: { padding: "8px 20px 0" } },
          "사람별 목소리와 읽는 법은 설정 › 음성에서 정해요",
        ),
      ),
    );
  });
}
