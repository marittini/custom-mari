// 음성 — whose voice is whose, then the rarer settings one level down.
//   #/voice            사람별 목소리 · 읽는 법 (characters and personas)
//   #/voice/settings   감정 표현 · 자동 재생 · 쓰는 곳 · 대사 옆 버튼 · 엔진 TTS 연결
//   #/voice/tune       ElevenLabs 다듬기 (account voice settings, key kept on the Mari Kit server)

import { h, icon, I, setChildren } from "../lib/h.js";
import { api, characterCard } from "../lib/api.js";
import { data, firstLetter } from "../lib/data.js";
import { pageHead, toast, errorBox, sheet, popMenu, hbox, avatar } from "../lib/ui.js";
import { syncVoiceSettings, patchVoice, voiceSettings } from "../lib/voice.js";
import * as tts from "../lib/tts.js";

const chip = (label, on, onClick) =>
  h(
    "button",
    { type: "button", class: on ? "chip on" : "chip", "aria-pressed": on ? "true" : "false", onClick },
    label,
  );
const sw = (on) => h("span", { class: on ? "sw on" : "sw" }, h("span"));

export function voiceScreen({ mount, args, go }) {
  const view = args[0] || "people";
  let alive = true;
  let config = null; // Engine TTS config
  let v = null; // Mari Kit voice settings
  let voices = [];
  let people = [];
  const head = h("div");
  const body = h("div", { class: "scroll", style: { padding: view === "people" ? "0 0 32px" : "0 20px 32px" } });
  mount.append(head, body);

  function header() {
    if (view === "settings") return pageHead("음성 설정", { label: "모든 방 공통", back: () => go("voice") });
    if (view === "tune")
      return pageHead("ElevenLabs 다듬기", { label: "내 계정의 목소리 전체에", back: () => go("voice/settings") });
    const label = !config
      ? "엔진 TTS 꺼짐"
      : `${config.source}${config.model ? ` · ${config.model}` : ""} · ${v?.cueResolved === "tags" ? "감정 태그로 읽어요" : "감정 설명으로 읽어요"}`;
    return pageHead("음성", {
      label,
      back: () => go("settings"),
      actions: h(
        "button",
        {
          type: "button",
          class: "ib",
          "aria-label": "음성 메뉴",
          onClick: () =>
            popMenu([
              { label: "음성 설정", sub: "재생 · 감정 · 쓰는 곳", onClick: () => go("voice/settings") },
              { label: "ElevenLabs 다듬기", sub: "›", onClick: () => go("voice/tune") },
              { label: "엔진 TTS 연결", sub: "›", onClick: () => go("settings/voice") },
            ]),
        },
        icon(I.dots),
      ),
    });
  }

  async function load() {
    try {
      const [cfg, chars, personas] = await Promise.all([
        api.get("/tts/config").catch(() => null),
        data.characters(),
        data.personas(),
      ]);
      config = cfg?.enabled ? cfg : null;
      v = (await syncVoiceSettings(cfg)) || (await voiceSettings());
      if (view === "people" && config) {
        try {
          const res = await api.get("/tts/voices");
          voices = (Array.isArray(res) ? res : res?.voices || [])
            .map((x) =>
              typeof x === "string" ? { id: x, name: x } : { id: x.id || x.voice_id || x.name, name: x.name || x.id },
            )
            .filter((x) => x.id);
        } catch {
          voices = [];
        }
      }
      people = [
        ...chars.map((c) => ({
          kind: "character",
          id: c.id,
          name: c.name || "이름 없음",
          pron: c.phoneticName || "",
          avatar: c.avatarPath,
        })),
        ...personas.map((p) => ({
          kind: "persona",
          id: p.id,
          name: `${p.name || "이름 없음"} · 나`,
          pron: p.phoneticName || "",
          avatar: p.avatarPath || null,
        })),
      ];
      if (alive) draw();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  }

  const voiceOf = (id) => (config?.voiceAssignments || []).find((a) => a.characterId === id)?.voice || "";
  const voiceName = (id) => voices.find((x) => x.id === id)?.name || id;

  // ── 사람 ─────────────────────────────
  function peopleView() {
    if (!people.length) return [h("div", { class: "empty" }, "캐릭터나 페르소나가 아직 없어요")];
    return [
      h(
        "div",
        { style: { borderTop: "1px solid var(--line)" } },
        people.map((p) => {
          const vid = voiceOf(p.id);
          const sub = [vid ? voiceName(vid) : "기본 목소리", p.pron].filter(Boolean).join(" · ");
          return h(
            "div",
            { class: "row", style: { gridTemplateColumns: "40px minmax(0,1fr) 44px" } },
            avatar(p.avatar, firstLetter(p.name), 40),
            h(
              "button",
              { type: "button", class: "plain", onClick: () => editPerson(p) },
              h("span", { style: { fontSize: "15px" } }, p.name),
              h("span", { style: { fontSize: "12px", color: "var(--ink-3)" } }, sub),
            ),
            h(
              "button",
              { type: "button", class: "ib", "aria-label": `${p.name} 들어보기`, onClick: () => listen(p) },
              icon(I.play, 14),
            ),
          );
        }),
      ),
      config
        ? null
        : h("p", { class: "hint", style: { padding: "16px 20px" } }, "엔진 TTS가 꺼져 있어요 · ⋯ › 엔진 TTS 연결"),
    ];
  }
  async function listen(p) {
    if (!config) return toast("엔진 TTS가 꺼져 있어요");
    const vid = voiceOf(p.id) || config.voice || "";
    const sample = p.kind === "persona" ? "안녕, 나야." : `안녕, ${p.name.split(" · ")[0]}이야.`;
    try {
      await tts.speak(tts.hashKey(["sample", p.id, vid, config.source, config.model]), {
        text: sample,
        ...(vid ? { voice: vid } : {}),
      });
    } catch (error) {
      toast(`재생하지 못했어요: ${error.message}`);
    }
  }
  function editPerson(p) {
    const pron = h("input", {
      class: "uline",
      type: "text",
      value: p.pron,
      placeholder: "예: kuga terunori",
      style: { fontFamily: "var(--font-read)", fontSize: "18px" },
    });
    const cur = voiceOf(p.id);
    const pick = voices.length
      ? h(
          "select",
          { class: "sel" },
          h("option", { value: "" }, "기본 목소리"),
          voices.map((x) => h("option", { value: x.id, selected: x.id === cur }, x.name)),
        )
      : h("input", { class: "uline", type: "text", value: cur, placeholder: "목소리 ID" });
    const s = sheet(
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "24px", padding: "8px 20px 28px" } },
        h("span", { style: { fontFamily: "var(--font-read)", fontSize: "20px", fontWeight: "600" } }, p.name),
        h(
          "label",
          { style: { display: "flex", flexDirection: "column", gap: "8px" } },
          h("span", { class: "label" }, "읽는 법"),
          pron,
        ),
        h(
          "label",
          { style: { display: "flex", flexDirection: "column", gap: "8px" } },
          h("span", { class: "label" }, "목소리"),
          pick,
        ),
        h(
          "button",
          {
            type: "button",
            class: "pill main",
            onClick: async () => {
              try {
                if (pron.value.trim() !== p.pron) {
                  if (p.kind === "persona")
                    await api.patch(`/characters/personas/${encodeURIComponent(p.id)}`, {
                      phoneticName: pron.value.trim(),
                    });
                  else {
                    // The list has no card; read this one so its other extensions are kept.
                    const ext = characterCard(await data.character(p.id))?.extensions || {};
                    await api.patch(`/characters/${encodeURIComponent(p.id)}`, {
                      data: { extensions: { ...ext, phoneticName: pron.value.trim() } },
                    });
                    data.characters(true);
                  }
                }
                if (pick.value.trim() !== cur)
                  await api.put("/tts/config/voice-assignment", {
                    characterId: p.id,
                    characterName: p.name.split(" · ")[0],
                    voice: pick.value.trim(),
                  });
                s.close();
                toast("저장했어요");
                load();
              } catch (error) {
                toast(error.message);
              }
            },
          },
          "저장",
        ),
      ),
      { label: p.name },
    );
  }

  // ── 설정 ─────────────────────────────
  async function set(patch) {
    try {
      v = await patchVoice(patch);
      draw();
    } catch (error) {
      toast(error.message);
    }
  }
  function settingsView() {
    const q = (label, opts, key) => [
      h("div", { class: "askq" }, label),
      h(
        "div",
        { class: "chips" },
        opts.map(([id, l]) => chip(l, v[key] === id, () => set({ [key]: id }))),
      ),
    ];
    const toggle = (label, sub, key) =>
      h(
        "button",
        {
          type: "button",
          class: "grow",
          role: "switch",
          "aria-checked": v[key] ? "true" : "false",
          onClick: () => set({ [key]: !v[key] }),
        },
        h("span", null, label, h("small", null, sub)),
        sw(v[key]),
      );
    return [
      h("div", { class: "gsec" }, h("span", null, "연결")),
      h(
        "div",
        { class: "gcard" },
        h(
          "button",
          { type: "button", class: "grow", onClick: () => go("settings/voice") },
          h(
            "span",
            null,
            "엔진 TTS 연결",
            h("small", null, config ? `${config.source} · ${config.model || "기본 모델"}` : "꺼져 있어요"),
          ),
          h("span", { class: "val" }, "›"),
        ),
      ),
      h("div", { class: "gsec" }, h("span", null, "대사")),
      h(
        "div",
        { class: "gcard" },
        q(
          "감정 표현",
          [
            ["auto", `모델에 맞게 (${v.cueAuto === "tags" ? "태그" : "설명"})`],
            ["tags", "ElevenLabs 태그"],
            ["free", "자유 설명"],
          ],
          "cue",
        ),
        q(
          "자동 재생",
          [
            ["off", "끄기"],
            ["chars", "캐릭터만"],
            ["all", "캐릭터와 나"],
          ],
          "autoplay",
        ),
        toggle("RP에서 쓰기", "대사를 화자별 목소리로", "rp"),
        toggle("Convo에서 쓰기", "메시지를 그 사람 목소리로", "convo"),
        toggle("대사 옆 재생 버튼", "엔진 화면 · 끄면 대사를 눌러 재생", "lineButtons"),
      ),
      h("p", { class: "label", style: { padding: "10px 4px 0" } }, "방마다 음성 지침 끄기 · 채팅 설정 › 확장"),
      h("div", { class: "gsec" }, h("span", null, "ElevenLabs")),
      h(
        "div",
        { class: "gcard" },
        h(
          "button",
          { type: "button", class: "grow", onClick: () => go("voice/tune") },
          h("span", null, "목소리 다듬기", h("small", null, "안정성 · 유사도 · 스타일 · 화자 강조")),
          h("span", { class: "val" }, "›"),
        ),
      ),
    ];
  }

  // ── 다듬기 ───────────────────────────
  function tuneView() {
    const e = { ...v.eleven };
    const slider = (label, key, min, max, step, fmt) => {
      const out = h("span", { class: "num" }, fmt(e[key]));
      return h(
        "label",
        { class: "slider" },
        h("span", null, label),
        h("input", {
          type: "range",
          min,
          max,
          step,
          value: e[key],
          onInput: (ev) => ((e[key] = Number(ev.target.value)), (out.textContent = fmt(e[key]))),
          onChange: () => set({ eleven: { [key]: e[key] } }),
        }),
        out,
      );
    };
    const key = h("input", {
      class: "bare",
      type: "password",
      autocomplete: "off",
      placeholder: e.hasKey ? `저장됨 ••••${e.keyTail}` : "ElevenLabs API 키",
    });
    const status = h(
      "p",
      { class: "label", style: { padding: "10px 4px 0" } },
      e.appliedAt
        ? `마지막 적용 · ${new Date(e.appliedAt).toLocaleString("ko-KR")} · ${e.appliedCount}개`
        : "아직 적용하지 않았어요",
    );
    return [
      h("div", { class: "gsec" }, h("span", null, "목소리")),
      h(
        "div",
        { class: "gcard" },
        slider("안정성", "stability", 0, 1, 0.05, (x) => x.toFixed(2)),
        slider("유사도", "similarity", 0, 1, 0.05, (x) => x.toFixed(2)),
        slider("스타일", "style", 0, 1, 0.05, (x) => x.toFixed(2)),
        slider("속도", "speed", 0.7, 1.2, 0.05, (x) => x.toFixed(2)),
        h(
          "button",
          {
            type: "button",
            class: "grow",
            role: "switch",
            "aria-checked": e.speakerBoost ? "true" : "false",
            onClick: () => set({ eleven: { speakerBoost: !e.speakerBoost } }),
          },
          h("span", null, "화자 강조"),
          sw(e.speakerBoost),
        ),
      ),
      hbox("ElevenLabs 키 · Mari Kit 서버에만 보관", key),
      status,
      h(
        "button",
        {
          type: "button",
          class: "pill main wide",
          onClick: async (ev) => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            btn.textContent = "적용하는 중…";
            try {
              if (key.value.trim()) v = await api.put("/mari-kit/tts/eleven/key", { key: key.value.trim() });
              const res = await api.post("/mari-kit/tts/eleven/apply");
              v = res;
              await voiceSettings(true);
              toast(`${res.applied}개 목소리에 적용했어요${res.failed ? ` · ${res.failed}개 실패` : ""}`);
            } catch (error) {
              toast(error.message);
            }
            draw();
          },
        },
        "전체에 적용",
      ),
    ];
  }

  function draw() {
    if (!alive) return;
    setChildren(head, header());
    if (!v) return setChildren(body, errorBox(new Error("Mari Kit 음성 설정을 읽지 못했어요")));
    setChildren(body, ...(view === "settings" ? settingsView() : view === "tune" ? tuneView() : peopleView()));
  }

  setChildren(head, header());
  setChildren(body, h("div", { class: "empty" }, "불러오는 중…"));
  load();
  return { dispose: () => (alive = false) };
}
