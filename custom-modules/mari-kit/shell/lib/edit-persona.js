// The persona editor (#/edit/persona/<id>), drawn in the shell on top of the shared editor frame.
// Reads and writes the Engine's /characters/personas/:id routes; only this persona is loaded (its groups and
// lorebooks load when their sections are used). Photos and crops go through avatar-edit.js.

import { h, setChildren } from "./h.js";
import { api, download } from "./api.js";
import { data, withCrop } from "./data.js";
import { createEditor } from "./editor.js";
import { toast, sheet, popMenu, avatar, errorBox, openEngine, ask } from "./ui.js";
import { groupsOf, splitByGroup, foldGroup, forgetGroups } from "./groups.js";

const CARD_FIELDS = ["summary", "description", "personality", "backstory", "appearance", "scenario", "mes_example"];
const STRATEGIES = [
  ["constant_after", "카드 뒤에 항상 넣기"],
  ["constant_before", "카드 앞에 항상 넣기"],
  ["post_history_after", "대화 기록 뒤에 덧붙이기"],
  ["post_history_before", "대화 기록 앞에 덧붙이기"],
  ["post_history_replace", "대화 기록 지시 대신 쓰기"],
  ["macro", "{{convo_behavior}}를 적은 자리에만"],
];
const DEFAULT_STRATEGY = "constant_after";

const parse = (v, empty) => {
  if (typeof v !== "string") return v ?? empty;
  if (!v.trim()) return empty;
  try {
    return JSON.parse(v);
  } catch {
    return empty;
  }
};
const strings = (v) => (Array.isArray(parse(v, [])) ? parse(v, []).filter((x) => typeof x === "string") : []);

/** The Engine's persona with its structured fields decoded, in the shape the editor edits. */
function normalize(p) {
  const crop = parse(p.avatarCrop, null);
  const convo = parse(p.convoBehavior, null);
  return {
    ...p,
    avatarCrop: crop && typeof crop === "object" ? crop : null,
    tags: strings(p.tags),
    savedStatusOptions: strings(p.savedStatusOptions),
    convoBehavior: {
      instruction: typeof convo?.instruction === "string" ? convo.instruction : "",
      insertionStrategy: convo?.insertionStrategy || DEFAULT_STRATEGY,
    },
    versioningEnabled: p.versioningEnabled !== false && p.versioningEnabled !== "false",
    imageAppearanceEnabled: p.imageAppearanceEnabled === true || p.imageAppearanceEnabled === "true",
    nameColor: p.nameColor || "",
    dialogueColor: p.dialogueColor || "",
    boxColor: p.boxColor || "",
  };
}

/** The cached persona list (data.personas) has no refresh, so the shell edits the cached copy in place. */
function syncCache(persona, remove = false) {
  data.personas().then((list) => {
    const at = list.findIndex((x) => x.id === persona.id);
    if (remove) return at >= 0 && list.splice(at, 1);
    const entry = { ...persona, avatarPath: withCrop(persona.avatarPath || null, parse(persona.avatarCrop, null)) };
    if (at >= 0) list[at] = { ...list[at], ...entry };
    else list.push(entry);
  });
}

const sw = (on) => h("span", { class: on ? "sw on" : "sw" }, h("span"));

export function personaEditor({ mount, id, go, back }) {
  const leave = () => back("settings/personas");
  const root = h("div", { class: "ed-load" });
  mount.append(root);
  let ed = null;
  let gone = false;

  api
    .get(`/characters/personas/${encodeURIComponent(id)}`)
    .then((raw) => {
      if (gone) return;
      root.remove();
      ed = build(normalize(raw));
    })
    .catch((error) => {
      root.replaceChildren(errorBox(error));
    });

  function build(record) {
    const path = `/characters/personas/${encodeURIComponent(id)}`;
    let editor = null;

    async function save({ draft, changed }) {
      const keys = [...new Set(changed.map((p) => p.split(".")[0]))];
      if (keys.includes("name") && !String(draft.name || "").trim()) throw new Error("이름을 적어 주세요");
      const body = {};
      for (const key of keys) {
        let value = draft[key];
        if (key === "convoBehavior") {
          const text = String(value?.instruction ?? "").trim();
          value = text ? { instruction: text, insertionStrategy: value.insertionStrategy || DEFAULT_STRATEGY } : null;
        } else if (key === "savedStatusOptions") value = (value || []).map((s) => s.trim()).filter(Boolean);
        else if (key === "nameColor" || key === "dialogueColor" || key === "boxColor") value = value || "";
        else if (key === "name") value = String(value).trim();
        body[key] = value;
      }
      const saved = normalize(await api.patch(path, body));
      syncCache(saved);
      return saved;
    }

    editor = createEditor({
      mount,
      title: "페르소나 편집",
      label: record.name || "이름 없음",
      back: leave,
      record,
      save,
      more: moreMenu,
    });
    const ed = editor;
    ed.track("avatarCrop");

    // ── AI draft: the Engine writes into a draft only; the sheet asks before it replaces anything.
    const draftFor = (field) => async () => {
      const d = ed.draft();
      const card = { name: String(d.name || "").trim() || "이름 없음" };
      for (const f of CARD_FIELDS) card[f] = String(d[f] || "");
      const res = await api.post(`${path}/card-field/generate`, { field, card, debugMode: false });
      return res?.text;
    };
    const card = (key, label, opts = {}) => ed.long(key, label, { vars: ["user", "char"], ai: draftFor(key), ...opts });

    // ── 정보 ───────────────────────────
    const avatarRow = h("div", { class: "ed-avatar", style: { display: "flex", gap: "16px", alignItems: "center" } });
    const drawAvatar = () => {
      const d = ed.draft();
      const src = d.avatarPath || null;
      setChildren(
        avatarRow,
        avatar(withCrop(src, d.avatarCrop), String(d.name || "·")[0], 88),
        h(
          "div",
          { class: "ed-stack", style: { alignItems: "flex-start" } },
          h("button", { type: "button", class: "pill", onClick: changePhoto }, src ? "사진 바꾸기" : "사진 넣기"),
          src ? h("button", { type: "button", class: "pill", onClick: cropPhoto }, "자르기") : null,
          src ? h("button", { type: "button", class: "pill", onClick: removePhoto }, "사진 지우기") : null,
        ),
      );
    };
    // A photo change is written at once (the Engine clears the crop with it), so unsaved text is saved first.
    async function withSaved(work) {
      if (!(await ed.save({ quiet: true }))) return;
      try {
        const next = normalize(await work());
        const keepName = ed.draft().name;
        ed.reset({ ...next, name: keepName });
        syncCache(next);
        drawAvatar();
      } catch (error) {
        toast(`사진을 바꾸지 못했어요: ${error.message}`);
      }
    }
    async function changePhoto() {
      let url = null;
      try {
        url = await (await import("./avatar-edit.js")).pickImageWebp();
      } catch (error) {
        return toast(`사진을 열지 못했어요: ${error.message}`);
      }
      if (!url) return;
      await withSaved(() => api.post(`${path}/avatar`, { avatar: url }));
    }
    async function cropPhoto() {
      let mod;
      try {
        mod = await import("./avatar-edit.js");
      } catch (error) {
        return toast(`자르기 화면을 열지 못했어요: ${error.message}`);
      }
      mod.cropSheet({
        src: ed.draft().avatarPath,
        crop: ed.get("avatarCrop"),
        title: "페르소나 사진 자르기",
        onApply: (crop) => {
          ed.set("avatarCrop", crop || null);
          drawAvatar();
        },
      });
    }
    async function removePhoto() {
      if (!(await ask("사진을 지울까요?"))) return;
      await withSaved(() => api.delete(`${path}/avatar`));
    }
    drawAvatar();

    // Persona groups (a Mari addition): chips toggle at once.
    const groupBox = h("div", { class: "ed-chiprow" });
    let groups = [];
    const drawGroups = () =>
      setChildren(
        groupBox,
        groups.map((g) => {
          const on = (g.items || []).includes(id);
          return h(
            "button",
            {
              type: "button",
              class: on ? "chip on" : "chip",
              role: "switch",
              "aria-checked": on ? "true" : "false",
              onClick: () => toggleGroup(g),
            },
            g.name,
          );
        }),
        h("button", { type: "button", class: "chip", onClick: newGroup }, "+ 새 그룹"),
      );
    async function toggleGroup(g) {
      const on = (g.items || []).includes(id);
      const next = on ? g.items.filter((x) => x !== id) : [...(g.items || []), id];
      try {
        await api.patch(`/characters/persona-groups/${encodeURIComponent(g.id)}`, { personaIds: next });
        g.items = next;
        forgetGroups("personas");
        drawGroups();
      } catch (error) {
        toast(`그룹을 바꾸지 못했어요: ${error.message}`);
      }
    }
    function newGroup() {
      askName("새 그룹", "그룹 이름", async (name) => {
        const made = await api.post("/characters/persona-groups", { name, personaIds: [id] });
        groups.push({ id: made.id, name: made.name || name, items: [id] });
        forgetGroups("personas");
        drawGroups();
      });
    }
    groupsOf("personas").then((list) => {
      groups = list.map((g) => ({ ...g, items: [...(g.items || [])] }));
      drawGroups();
    });
    drawGroups();

    const info = ed.section(
      "info",
      "정보",
      "이름과 사진, 분류. 이름은 꼭 있어야 해요.",
      h("div", { class: "ed-field" }, h("div", { class: "ed-label" }, h("label", null, "사진")), avatarRow),
      ed.text("name", "이름", { placeholder: "페르소나 이름", hint: "채팅에서 나를 부르는 이름이에요." }),
      ed.text("comment", "제목", { hint: "목록에서 이름 옆에 보이는 짧은 설명이에요." }),
      ed.text("phoneticName", "읽는 법", { hint: "음성이 이름을 잘못 읽을 때 소리 나는 대로 적어요." }),
      ed.text("creator", "만든 이"),
      ed.text("personaVersion", "버전", { placeholder: "예: 1.0" }),
      ed.toggle("versioningEnabled", "자동 버전 기록", {
        def: true,
        hint: "저장할 때마다 이전 모습을 남겨 두어요. ⋯ 메뉴의 버전 기록에서 되돌려요.",
      }),
      ed.tags("tags", "태그"),
      h(
        "div",
        { class: "ed-field" },
        h("div", { class: "ed-label" }, h("label", null, "그룹")),
        groupBox,
        h("p", { class: "ed-hint" }, "누르면 바로 바뀌어요. 저장 버튼은 필요 없어요."),
      ),
      ed.long("creatorNotes", "메모", { rows: 4, hint: "나만 보는 메모예요. AI에게는 보내지 않아요." }),
    );

    // ── 카드 ───────────────────────────
    const cardSec = ed.section(
      "card",
      "카드",
      "AI가 나를 이해하는 데 쓰는 내용이에요. 칸마다 짧게 적어도 괜찮아요.",
      card("summary", "요약", { rows: 3, hint: "한두 문장으로 나를 소개해요." }),
      card("description", "설명", { rows: 8 }),
      card("personality", "성격", { rows: 6 }),
      card("backstory", "배경", { rows: 6 }),
      card("appearance", "외모", { rows: 5 }),
      ed.toggle("imageAppearanceEnabled", "이미지용 외모 따로 쓰기", {
        hint: "그림을 만들 때만 아래 글을 외모 대신 써요.",
      }),
      ed.long("imageAppearance", "이미지용 외모", { rows: 4, vars: ["user", "char"] }),
      card("scenario", "시나리오", { rows: 5 }),
      card("mes_example", "예시 대사", { rows: 8, hint: "말투를 보여 주는 짧은 대화를 적어요." }),
    );

    // ── Convo ───────────────────────────
    const convo = ed.section(
      "convo",
      "Convo",
      "메신저처럼 이어지는 대화에서 쓰는 내 모습이에요.",
      ed.text("convoDisplayName", "표시 이름", { hint: "비우면 이름을 그대로 써요." }),
      ed.long("aboutMe", "소개", { rows: 4, hint: "대화 상대에게 보이는 자기소개예요." }),
      ed.long("convoBehavior.instruction", "행동 지시", {
        rows: 5,
        vars: ["user", "char"],
        hint: "대화할 때 지킬 말투나 습관이에요. 비우면 쓰지 않아요.",
      }),
      ed.choice("convoBehavior.insertionStrategy", "넣는 위치", STRATEGIES, {
        def: DEFAULT_STRATEGY,
        hint: "행동 지시를 프롬프트의 어디에 넣을지 정해요. 잘 모르겠으면 그대로 두세요.",
      }),
      ed.list("savedStatusOptions", "상태 문구", {
        oneLine: true,
        addLabel: "+ 문구 추가",
        itemLabel: (i) => `문구 ${i + 1}`,
        hint: "자주 쓰는 상태 메시지를 모아 두면 골라 쓸 수 있어요.",
      }),
    );

    // ── 색 ───────────────────────────
    const preview = h("div", {
      class: "ed-hint",
      style: { padding: "10px 14px", borderRadius: "12px", marginTop: "4px" },
    });
    const drawPreview = () => {
      const d = ed.draft();
      const paint = (el, prop, v) => {
        el.style[prop] = "";
        if (v) el.style[prop] = v;
      };
      const nameEl = h("b", null, d.name || "이름");
      const textEl = h("span", null, " “안녕, 오늘 어땠어?”");
      paint(nameEl, "color", d.nameColor);
      paint(textEl, "color", d.dialogueColor);
      paint(preview, "background", d.boxColor);
      setChildren(preview, nameEl, textEl);
    };
    const colors = ed.section(
      "color",
      "색",
      "채팅에서 내 이름과 말풍선이 보이는 색이에요. 비우면 기본 색을 써요.",
      ed.color("nameColor", "이름 색"),
      ed.color("dialogueColor", "대사 색"),
      ed.color("boxColor", "말풍선 색", {
        hint: "색 하나 또는 gradient 하나만 쓸 수 있어요. 안전하지 않은 값은 저장할 때 거절돼요.",
      }),
      h("div", { class: "ed-field" }, h("div", { class: "ed-label" }, h("label", null, "미리보기")), preview),
    );
    colors.addEventListener("input", drawPreview);
    colors.addEventListener("change", drawPreview);
    drawPreview();

    // ── 로어북 ───────────────────────────
    const loreBox = h("div", { class: "ed-stack" }, h("p", { class: "ed-hint" }, "이 칸이 보이면 불러와요…"));
    let loreLoaded = false;
    async function loadLore() {
      if (loreLoaded) return;
      loreLoaded = true;
      try {
        const [books, folders] = await Promise.all([api.get("/lorebooks"), groupsOf("lorebooks")]);
        const list = (Array.isArray(books) ? books : []).map((b) => ({
          ...b,
          ids: (() => {
            const own = strings(b.personaIds);
            return own.length ? own : b.personaId ? [b.personaId] : [];
          })(),
        }));
        const globals = list.filter((b) => b.isGlobal === true || b.isGlobal === "true");
        const own = list.filter((b) => !globals.includes(b));
        const row = (b) => {
          const on = () => b.ids.includes(id);
          const btn = h("button", { type: "button", class: "ed-switch", role: "switch", "aria-checked": String(on()) });
          let knob = sw(on());
          btn.append(h("span", { class: "ed-switch-t" }, b.name || "이름 없음"), knob);
          btn.onclick = async () => {
            const next = on() ? b.ids.filter((x) => x !== id) : [...b.ids, id];
            btn.disabled = true;
            try {
              await api.patch(`/lorebooks/${encodeURIComponent(b.id)}`, { personaIds: next, personaId: null });
              b.ids = next;
              btn.setAttribute("aria-checked", String(on()));
              knob.className = on() ? "sw on" : "sw";
            } catch (error) {
              toast(`로어북을 바꾸지 못했어요: ${error.message}`);
            } finally {
              btn.disabled = false;
            }
          };
          return h("div", { class: "ed-field" }, btn);
        };
        const parts = splitByGroup(own, folders);
        const grouped = parts.length > 1 || (parts.length === 1 && parts[0].label);
        setChildren(
          loreBox,
          own.length
            ? parts.map((p) => {
                const rows = h("div", { class: "ed-stack" }, p.items.map(row));
                return grouped ? foldGroup(h, "persona-lore", p.label, p.items.length, rows) : rows;
              })
            : h("p", { class: "ed-hint" }, "로어북이 아직 없어요."),
          globals.length
            ? h(
                "p",
                { class: "ed-hint" },
                `전체용 로어북 ${globals.length}개는 모든 채팅에 쓰이니 여기서 고르지 않아요.`,
              )
            : null,
        );
      } catch (error) {
        loreLoaded = false;
        setChildren(loreBox, errorBox(error));
      }
    }
    const lore = ed.section(
      "lore",
      "로어북",
      "켜 둔 로어북은 이 페르소나로 하는 채팅에서 쓰여요. 누르면 바로 바뀌어요.",
      loreBox,
    );
    new IntersectionObserver((entries, io) => {
      if (entries.some((e) => e.isIntersecting)) (io.disconnect(), loadLore());
    }).observe(lore);

    // ── 엔진에서 ───────────────────────────
    const engineRow = (label) =>
      h(
        "button",
        { type: "button", class: "r two", onClick: () => openEngine(null, { persona: id }) },
        h("span", null, label),
        h("span", { class: "val" }, "엔진 화면 · 처음 약 14MB ›"),
      );
    const engine = ed.section(
      "engine",
      "엔진에서",
      "아직 Mari에서 그리지 않은 것들이에요(2차 예정). 누르면 엔진의 이 페르소나 화면이 열리고, ‹ Mari로 버튼으로 돌아와요.",
      engineRow("갤러리"),
      engineRow("스프라이트"),
      engineRow("스탯"),
    );

    const sections = () => [info, cardSec, convo, colors, lore, engine];
    ed.render(sections());

    // ── ⋯ menu ───────────────────────────
    function moreMenu() {
      popMenu([
        { label: "복제", onClick: duplicate },
        { label: "내보내기", sub: "마리나라 형식", onClick: () => exportAs("native") },
        { label: "내보내기", sub: "호환 JSON", onClick: () => exportAs("compatible") },
        { label: "버전 기록", onClick: versions },
        "-",
        { label: "지우기", onClick: remove },
      ]);
    }
    async function duplicate() {
      if (!(await ed.save({ quiet: true }))) return;
      try {
        const copy = await api.post(`${path}/duplicate`);
        syncCache(copy);
        toast("복제했어요");
        go(`edit/persona/${encodeURIComponent(copy.id)}`);
      } catch (error) {
        toast(`복제하지 못했어요: ${error.message}`);
      }
    }
    async function exportAs(format) {
      if (!(await ed.save({ quiet: true }))) return;
      const name =
        String(ed.get("name") || "persona")
          .replace(/[\\/:*?"<>|]+/g, " ")
          .trim() || "persona";
      try {
        await download(`${path}/export?format=${format}`, `${name}.${format === "native" ? "marinara.json" : "json"}`);
      } catch (error) {
        toast(`내보내지 못했어요: ${error.message}`);
      }
    }
    async function remove() {
      if (!(await ask(`'${ed.get("name") || "이 페르소나"}'를 지울까요? 되돌릴 수 없어요.`))) return;
      try {
        await api.delete(path);
        syncCache({ id }, true);
        forgetGroups("personas");
        ed.reset(ed.draft()); // nothing left to save
        leave();
      } catch (error) {
        toast(`지우지 못했어요: ${error.message}`);
      }
    }
    async function versions() {
      if (!(await ed.save({ quiet: true }))) return;
      const list = h("div", { class: "ed-stack" }, h("p", { class: "ed-hint" }, "불러오는 중…"));
      const s = sheet(h("div", { class: "ed-sheet" }, h("b", { class: "ed-sheet-t" }, "버전 기록"), list), {
        label: "버전 기록",
      });
      try {
        const rows = await api.get(`${path}/versions`);
        if (!Array.isArray(rows) || !rows.length)
          return setChildren(list, h("p", { class: "ed-hint" }, "기록이 아직 없어요."));
        setChildren(
          list,
          rows.map((v) =>
            h(
              "div",
              { class: "ed-item" },
              h(
                "div",
                { class: "ed-item-head" },
                h(
                  "span",
                  { class: "ed-item-n" },
                  `${v.isCurrent ? "지금" : `#${v.revision}`} · ${v.createdAt ? new Date(v.createdAt).toLocaleString("ko-KR") : ""}`,
                ),
                v.isCurrent
                  ? null
                  : h("button", { type: "button", class: "ed-mini", onClick: () => restore(v, s) }, "되돌리기"),
              ),
              h(
                "p",
                { class: "ed-hint" },
                [v.version ? `버전 ${v.version}` : "", v.reason || v.comment || ""].filter(Boolean).join(" · ") || "—",
              ),
            ),
          ),
        );
      } catch (error) {
        setChildren(list, errorBox(error));
      }
    }
    async function restore(v, s) {
      if (!(await ask("이 버전으로 되돌릴까요? 지금 모습도 기록에 남아요."))) return;
      try {
        const next = normalize(await api.post(`${path}/versions/${encodeURIComponent(v.id)}/restore`));
        syncCache(next);
        s.close();
        ed.reset(next);
        drawAvatar();
        ed.render(sections());
        drawPreview();
        toast("되돌렸어요");
      } catch (error) {
        toast(`되돌리지 못했어요: ${error.message}`);
      }
    }

    return ed;
  }

  return {
    dispose() {
      gone = true;
      ed?.dispose();
    },
  };
}

/** A small sheet that asks for one name. */
function askName(title, placeholder, onDone) {
  const input = h("input", { class: "inp ed-inp", type: "text", placeholder, maxlength: 100 });
  const go = h("button", { type: "button", class: "pill main" }, "만들기");
  const s = sheet(
    h(
      "div",
      { class: "ed-sheet" },
      h("b", { class: "ed-sheet-t" }, title),
      input,
      h(
        "div",
        { class: "ed-actions" },
        h("button", { type: "button", class: "pill", onClick: () => s.close() }, "취소"),
        go,
      ),
    ),
    { label: title },
  );
  const submit = async () => {
    const name = input.value.trim();
    if (!name) return input.focus();
    go.disabled = true;
    try {
      await onDone(name);
      s.close();
    } catch (error) {
      go.disabled = false;
      toast(`만들지 못했어요: ${error.message}`);
    }
  };
  go.onclick = submit;
  input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
  setTimeout(() => input.focus(), 50);
}
