// 음성 — whose voice is whose, then the rarer settings one level down.
//   #/voice            사람별 목소리 · 읽는 법 (characters and personas)
//   #/voice/settings   감정 표현 · 자동 재생 · 쓰는 곳 · 대사 옆 버튼 · 엔진 TTS 연결
//   #/voice/tune       ElevenLabs 다듬기 (account voice settings, key kept on the Mari Kit server)

import { prefs, setPrefs } from "../lib/prefs.js";
import { h, icon, I, setChildren, dots } from "../lib/h.js";
import { api, characterCard } from "../lib/api.js";
import { data, firstLetter } from "../lib/data.js";
import { pageHead, toast, errorBox, sheet, popMenu, hbox, avatar } from "../lib/ui.js";
import {
  voiceList,
  syncVoiceSettings,
  patchVoice,
  voiceSettings,
  loadVoices,
  voiceGroups,
  voiceOptions,
} from "../lib/voice.js";
import * as tts from "../lib/tts.js";
import { groupsOf, splitByGroup, foldGroup } from "../lib/groups.js";

const chip = (label, on, onClick) =>
  h(
    "button",
    { type: "button", class: on ? "chip on" : "chip", "aria-pressed": on ? "true" : "false", onClick },
    label,
  );
const sw = (on) => h("span", { class: on ? "sw on" : "sw" }, h("span"));

export function voiceScreen({ mount, args, go, back }) {
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
    if (view === "settings") return pageHead("음성 설정", { label: "모든 방 공통", back: () => back("voice") });
    if (view === "tune")
      return pageHead("ElevenLabs 다듬기", { label: "내 계정의 목소리 전체에", back: () => back("voice/settings") });
    const label = !config
      ? "엔진 TTS 꺼짐"
      : `${config.source}${config.model ? ` · ${config.model}` : ""} · ${v?.cueResolved === "tags" ? "감정 태그로 읽어요" : "감정 설명으로 읽어요"}`;
    return pageHead("음성", {
      label,
      back: () => back("settings"),
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
        dots(),
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
          voices = await loadVoices();
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
  let query = "";
  let selecting = false;
  const picked = new Set();
  function personCard(p, onToggle) {
    const vid = voiceOf(p.id);
    const on = picked.has(p.id);
    return h(
      "button",
      {
        type: "button",
        class: selecting && on ? "vc-card on" : "vc-card",
        ...(selecting ? { "aria-pressed": on ? "true" : "false" } : {}),
        onClick: () => (selecting ? onToggle(p) : editPerson(p)),
      },
      avatar(p.avatar, firstLetter(p.name), 40),
      h(
        "span",
        { class: "vc-txt" },
        h("span", { class: "vc-name" }, p.name),
        h("span", { class: "vc-voice" }, vid ? voiceName(vid) : "기본 목소리"),
        p.pron ? h("span", { class: "vc-pron" }, p.pron) : null,
      ),
      selecting ? h("span", { class: "vc-check", "aria-hidden": "true" }, on ? "✓" : null) : null,
    );
  }
  // Voice list for one or many people. onPick(voiceId) — "" means the default voice.
  function voiceListSheet({ title, current = "", onPick }) {
    let s;
    const choose = async (id) => {
      try {
        await onPick(id);
        s.close();
      } catch (error) {
        toast(error.message);
      }
    };
    const row = (id, name) =>
      h(
        "button",
        { type: "button", class: id === current ? "vc-vrow on" : "vc-vrow", onClick: () => choose(id) },
        h("span", null, name),
        id === current ? "✓" : null,
      );
    let free = null;
    if (!voices.length)
      free = h("input", { class: "uline", type: "text", placeholder: "목소리 ID", "aria-label": "목소리 ID" });
    s = sheet(
      h(
        "div",
        { class: "vc-vlist" },
        h("span", { class: "vc-vtitle" }, title),
        row("", "정하지 않음 (기본 목소리)"),
        ...voiceGroups(voices).map((g) => [
          g.label ? h("span", { class: "vc-vtitle", style: { fontSize: "13px", marginTop: "10px" } }, g.label) : null,
          ...g.items.map((x) => row(x.id, x.name)),
        ]),
        free
          ? [
              free,
              h(
                "button",
                { type: "button", class: "pill main", onClick: () => free.value.trim() && choose(free.value.trim()) },
                "정하기",
              ),
            ]
          : null,
      ),
      { label: title },
    );
  }
  // One save for everyone: read the stored config fresh, replace these people's entries, keep the rest.
  async function assignMany(list, voice) {
    const fresh = (await api.get("/tts/config")) || config;
    const ids = new Set(list.map((p) => p.id));
    const kept = (fresh.voiceAssignments || []).filter((a) => !ids.has(a.characterId));
    const added = voice ? list.map((p) => ({ characterId: p.id, characterName: p.name.split(" · ")[0], voice })) : [];
    await api.put("/tts/config", { ...fresh, voiceAssignments: [...kept, ...added] });
  }
  function peopleView() {
    if (!people.length) return [h("div", { class: "empty" }, "캐릭터나 페르소나가 아직 없어요")];
    const listEl = h("div", { class: "vc-wrap" });
    const bar = h("div", { class: "vc-bar", hidden: true });
    const modeBtn = h("button", { type: "button", class: "chip", onClick: () => toggleMode() }, "여러 명 고르기");
    let kinds = null; // [{ key, label, parts }] once the groups are read
    const visible = () => {
      const q = query.trim().toLowerCase();
      return q ? people.filter((p) => `${p.name} ${p.pron}`.toLowerCase().includes(q)) : people;
    };
    const refreshBar = () => {
      modeBtn.className = selecting ? "chip on" : "chip";
      modeBtn.setAttribute("aria-pressed", selecting ? "true" : "false");
      modeBtn.textContent = selecting ? "고르기 끝내기" : "여러 명 고르기";
      bar.hidden = !(selecting && picked.size);
      setChildren(
        bar,
        h("span", { class: "vc-count" }, `${picked.size}명 골랐어요`),
        h("button", { type: "button", class: "pill main", onClick: bulkPick }, "목소리 정하기 ›"),
      );
    };
    function toggleMode() {
      selecting = !selecting;
      picked.clear();
      fill();
    }
    function toggle(p) {
      picked.has(p.id) ? picked.delete(p.id) : picked.add(p.id);
      fill();
    }
    function bulkPick() {
      const list = people.filter((p) => picked.has(p.id));
      if (!list.length) return;
      voiceListSheet({
        title: `${list.length}명의 목소리`,
        onPick: async (id) => {
          await assignMany(list, id);
          const name = id ? voiceName(id) : "기본 목소리";
          selecting = false;
          picked.clear();
          toast(`${list.length}명에게 '${name}'`);
          load();
        },
      });
    }
    const grid = (list) =>
      h(
        "div",
        { class: "vc-grid" },
        list.map((p) => personCard(p, toggle)),
      );
    const section = (key, title, parts) => {
      const grouped = parts.length > 1 || (parts.length === 1 && parts[0].label);
      return [
        h("div", { class: "gsec vc-sec" }, h("span", null, title)),
        ...parts.map((part) => {
          const g = grid(part.items);
          if (!grouped) return h("div", { class: "vc-part" }, selectAll(part.items), g);
          const label = part.label || "그룹 없음";
          const el = foldGroup(
            h,
            key,
            label,
            part.items.length,
            h("div", { class: "vc-part" }, selectAll(part.items), g),
          );
          return el;
        }),
      ];
    };
    const selectAll = (items) => {
      if (!selecting) return null;
      const all = items.every((p) => picked.has(p.id));
      return h(
        "div",
        { class: "vc-all" },
        h(
          "button",
          {
            type: "button",
            class: "chip",
            onClick: () => {
              for (const p of items) all ? picked.delete(p.id) : picked.add(p.id);
              fill();
            },
          },
          all ? "전체 해제" : "전체 선택",
        ),
      );
    };
    function fill() {
      const q = query.trim();
      const list = visible();
      refreshBar();
      if (!list.length) return setChildren(listEl, h("div", { class: "empty" }, "찾는 사람이 없어요"));
      if (q || !kinds) return setChildren(listEl, h("div", { class: "vc-part" }, selectAll(list), grid(list)));
      const out = [];
      for (const k of kinds) {
        const items = list.filter((p) => p.kind === k.kind);
        if (!items.length) continue;
        out.push(...section(k.key, k.title, splitByGroup(items, k.groups)));
      }
      setChildren(listEl, out);
    }
    fill();
    Promise.all([groupsOf("characters"), groupsOf("personas")]).then(([cg, pg]) => {
      if (!alive) return;
      kinds = [
        { kind: "character", key: "voice-characters", title: "캐릭터", groups: cg },
        { kind: "persona", key: "voice-personas", title: "페르소나", groups: pg },
      ];
      fill();
    });
    return [
      h(
        "div",
        { class: "vc-top" },
        // A long cast gets a search box; only the list redraws, so typing keeps focus.
        people.length > 8
          ? h("input", {
              class: "inp",
              type: "search",
              placeholder: "이름으로 찾기",
              "aria-label": "이름으로 찾기",
              value: query,
              onInput: (e) => ((query = e.target.value), fill()),
            })
          : null,
        config ? modeBtn : null,
      ),
      listEl,
      config
        ? null
        : h("p", { class: "hint", style: { padding: "16px 20px" } }, "엔진 TTS가 꺼져 있어요 · ⋯ › 엔진 TTS 연결"),
      bar,
    ];
  }
  async function listen(p, picked) {
    if (!config) return toast("엔진 TTS가 꺼져 있어요");
    const vid = (picked ?? voiceOf(p.id)) || config.voice || "";
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
      ? h("select", { class: "sel" }, voiceOptions(h, voices, cur))
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
            class: "pill",
            style: { alignSelf: "flex-start" },
            // 미리 듣기 with the voice picked in this sheet (saved or not).
            onClick: () => listen(p, pick.value),
          },
          "미리 듣기",
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
        // Mari's own switch (this phone): the Engine's switch below is for the Engine's chat screen only.
        h(
          "button",
          {
            type: "button",
            class: "grow",
            role: "switch",
            "aria-checked": prefs().lineVoice === true ? "true" : "false",
            onClick: () => (setPrefs({ lineVoice: prefs().lineVoice !== true }), draw()),
          },
          h(
            "span",
            null,
            "Mari 화면 · 대사 옆 ▶ 늘 보이기",
            h("small", null, "끄면 대사를 눌렀을 때만 듣기 버튼이 떠요"),
          ),
          sw(prefs().lineVoice === true),
        ),
        toggle("엔진 화면 · 대사 옆 재생 버튼", "엔진 채팅 화면에서만 · 끄면 대사를 눌러 재생", "lineButtons"),
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
