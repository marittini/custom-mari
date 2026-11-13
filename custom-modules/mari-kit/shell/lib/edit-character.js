// The character editor (#/edit/character/<id>): the Engine's character card in the shell's editor frame.
// Record edited: { comment, data: <card> }. Save: PATCH /characters/:id { data, comment }.
// Things that act at once (avatar, groups, lorebook links, voice, embedded book) save themselves and say so.

import { h, setChildren } from "./h.js";
import { api, characterCard, parseJson, download } from "./api.js";
import { data, firstLetter, withCrop } from "./data.js";
import { createEditor } from "./editor.js";
import { toast, sheet, popMenu, avatar, errorBox, openEngine, ask } from "./ui.js";
import { loadVoices, voiceGroups } from "./voice.js";
import { groupsOf, forgetGroups, splitByGroup, foldGroup } from "./groups.js";

const enc = encodeURIComponent;
const COLOR_PATHS = ["nameColor", "dialogueColor", "boxColor"];
const STRATEGIES = [
  ["constant_after", "카드 뒤에 항상"],
  ["constant_before", "카드 앞에 항상"],
  ["post_history_after", "대화 뒤 지시 끝에 덧붙이기"],
  ["post_history_before", "대화 뒤 지시 앞에 붙이기"],
  ["post_history_replace", "대화 뒤 지시를 대신하기"],
  ["macro", "{{convo_behavior}} 자리에만"],
];
const ENGINE_ROWS = [
  ["gallery", "갤러리", "이 캐릭터의 그림 모음"],
  ["sprites", "스프라이트 · 표정", "표정별 그림"],
  ["stats", "스탯", "수치·상태 칸"],
  ["onboarding", "온보딩 질문", "채팅 시작 때 묻는 질문"],
  ["convo", "캐릭터 일정", "Convo 탭의 일정 편집"],
  ["metadata", "페르소나로 가져오기", "이 카드로 내 페르소나 만들기 (정보 탭 맨 위)"],
];
const idsOf = (v) => (Array.isArray(parseJson(v, [])) ? parseJson(v, []).filter((x) => typeof x === "string") : []);
const toRecord = (row) => {
  const card = characterCard(row);
  return { comment: row?.comment ?? "", data: card };
};
const sub = (text) => h("p", { class: "ed-hint" }, text);
const miniBtn = (label, onClick, cls = "pill") => h("button", { type: "button", class: cls, onClick }, label);

export function characterEditor({ mount, id, go, back }) {
  const wrap = h("div", { style: { display: "contents" } }, h("div", { class: "empty" }, "불러오는 중…"));
  mount.append(wrap);
  let ed = null;
  let gone = false;

  (async () => {
    let row;
    try {
      row = await api.get(`/characters/${enc(id)}`);
    } catch (error) {
      if (!gone) setChildren(wrap, errorBox(error));
      return;
    }
    if (gone) return;
    wrap.remove();
    ed = build(row);
  })();

  function build(row0) {
    let row = row0;
    const keepColors = (card) => {
      const ext = card.extensions || (card.extensions = {});
      for (const k of COLOR_PATHS) if (ext[k] == null && k in ext) ext[k] = "";
      return card;
    };
    const reload = async () => {
      row = await api.get(`/characters/${enc(id)}`);
      data.characters(true);
      return toRecord(row);
    };

    const e = createEditor({
      mount,
      title: "캐릭터 편집",
      label: row.data ? characterCard(row).name || "이름 없음" : "이름 없음",
      back: () => back(`character/${id}`),
      record: toRecord(row),
      save: async ({ draft }) => {
        if (!String(draft.data.name || "").trim()) throw new Error("이름을 적어 주세요");
        const saved = await api.patch(`/characters/${enc(id)}`, {
          data: keepColors(draft.data),
          comment: draft.comment ?? "",
        });
        row = saved || row;
        data.characters(true);
        return toRecord(row);
      },
      more: () => moreMenu(),
    });

    const onb = e.get("data.extensions.onboarding.variables");
    const vars = ["char", "user", ...(Array.isArray(onb) ? onb.map((v) => v?.variableName).filter(Boolean) : [])];
    const aiFor = (field) => async () => {
      const { text } = await api.post(`/characters/${enc(id)}/card-field/generate`, {
        field,
        card: { ...pickCard(e.draft().data) },
        debugMode: false,
      });
      return text;
    };
    // The Engine wants the prose fields flat: { name, summary, …, backstory, appearance, … }.
    const pickCard = (d) => ({
      name: d.name || "",
      summary: d.summary || "",
      description: d.description || "",
      personality: d.personality || "",
      backstory: d.extensions?.backstory || "",
      appearance: d.extensions?.appearance || "",
      scenario: d.scenario || "",
      mes_example: d.mes_example || "",
      first_mes: d.first_mes || "",
    });
    const L = (path, label, opts = {}, aiField = null) =>
      e.long(path, label, { vars, ...opts, ai: aiField ? aiFor(aiField) : null });

    // ── 정보 ─────────────────────────
    const avBox = h("div", { class: "ed-field", style: { display: "flex", gap: "16px", alignItems: "center" } });
    const drawAvatar = () => {
      const crop = e.get("data.extensions.avatarCrop");
      const src = row.avatarPath ? withCrop(row.avatarPath, crop) : null;
      setChildren(
        avBox,
        avatar(src, firstLetter(e.get("data.name") || "?"), 88),
        h(
          "div",
          { class: "ed-stack", style: { alignItems: "flex-start" } },
          miniBtn("사진 바꾸기", changePhoto),
          row.avatarPath ? miniBtn("자르기", cropPhoto) : null,
          row.avatarPath ? miniBtn("사진 지우기", removePhoto) : null,
        ),
      );
    };
    async function afterAvatar() {
      e.reset(await reload());
      drawAvatar();
    }
    async function changePhoto() {
      try {
        const { pickImageWebp } = await import("./avatar-edit.js");
        const url = await pickImageWebp();
        if (!url) return;
        if (!(await e.save({ quiet: true }))) return;
        await api.post(`/characters/${enc(id)}/avatar`, { avatar: url });
        await afterAvatar();
        toast("사진을 바꿨어요");
      } catch (error) {
        toast(`사진을 바꾸지 못했어요: ${error.message}`);
      }
    }
    async function cropPhoto() {
      try {
        const { cropSheet } = await import("./avatar-edit.js");
        cropSheet({
          src: row.avatarPath,
          crop: e.get("data.extensions.avatarCrop") || null,
          title: "사진 자르기",
          onApply: (crop) => {
            e.set("data.extensions.avatarCrop", crop || null);
            drawAvatar();
          },
        });
      } catch (error) {
        toast(error.message);
      }
    }
    async function removePhoto() {
      if (!(await ask("사진을 지울까요?"))) return;
      try {
        await e.save({ quiet: true });
        await api.delete(`/characters/${enc(id)}/avatar`);
        await afterAvatar();
        toast("사진을 지웠어요");
      } catch (error) {
        toast(error.message);
      }
    }
    drawAvatar();

    const groupBox = h("div", { class: "ed-chiprow" });
    const groupField = h(
      "div",
      { class: "ed-field" },
      h("div", { class: "ed-label" }, h("label", null, "그룹")),
      groupBox,
      sub("눌러서 넣고 빼요. 바로 저장돼요."),
    );
    async function drawGroups() {
      const groups = await groupsOf("characters");
      setChildren(
        groupBox,
        groups.map((g) => {
          const on = (g.items || []).includes(id);
          return h(
            "button",
            {
              type: "button",
              class: on ? "chip on" : "chip",
              "aria-pressed": on ? "true" : "false",
              onClick: async () => {
                try {
                  const items = on ? g.items.filter((x) => x !== id) : [...(g.items || []), id];
                  await api.patch(`/characters/groups/${enc(g.id)}`, { characterIds: items });
                  forgetGroups("characters");
                  drawGroups();
                } catch (error) {
                  toast(error.message);
                }
              },
            },
            g.name,
          );
        }),
        h("button", { type: "button", class: "chip", onClick: newGroup }, "+ 새 그룹"),
      );
    }
    function newGroup() {
      const input = h("input", { class: "inp ed-inp", placeholder: "그룹 이름", maxlength: 100 });
      const s = sheet(
        h(
          "div",
          { class: "ed-sheet" },
          h("b", { class: "ed-sheet-t" }, "새 그룹"),
          input,
          h(
            "div",
            { class: "ed-actions" },
            miniBtn("취소", () => s.close()),
            miniBtn(
              "만들기",
              async () => {
                const name = input.value.trim();
                if (!name) return;
                try {
                  await api.post("/characters/groups", { name, characterIds: [id] });
                  forgetGroups("characters");
                  s.close();
                  drawGroups();
                } catch (error) {
                  toast(error.message);
                }
              },
              "pill main",
            ),
          ),
        ),
        { label: "새 그룹" },
      );
      setTimeout(() => input.focus(), 50);
    }
    drawGroups().catch(() => {});

    const idRow = h(
      "div",
      { class: "ed-field" },
      miniBtn("ID 복사", async () => {
        try {
          await navigator.clipboard.writeText(id);
          toast("ID를 복사했어요");
        } catch {
          toast(id);
        }
      }),
    );

    // ── 색 · 음성 ────────────────────
    const preview = h("div", { class: "ed-field" });
    const drawPreview = () => {
      const g = (k) => e.get(`data.extensions.${k}`) || "";
      setChildren(
        preview,
        h("div", { class: "ed-label" }, h("label", null, "미리 보기")),
        h(
          "div",
          {
            style: {
              padding: "12px 14px",
              borderRadius: "14px",
              border: "1px solid var(--line, #8884)",
              background: g("boxColor") || "transparent",
              lineHeight: "1.6",
            },
          },
          h("b", { style: { color: g("nameColor") || "inherit" } }, e.get("data.name") || "이름"),
          " ",
          h("span", { style: { color: g("dialogueColor") || "inherit" } }, "“안녕, 오늘은 어땠어?”"),
        ),
      );
    };
    drawPreview();
    mount.addEventListener("input", drawPreview);
    mount.addEventListener("change", drawPreview);

    const voiceRow = h("div", { class: "ed-field" });
    let cfg = null;
    let voices = null;
    const voiceNow = () => (cfg?.voiceAssignments || []).find((a) => a.characterId === id)?.voice || "";
    const drawVoice = () =>
      setChildren(
        voiceRow,
        h("div", { class: "ed-label" }, h("label", null, "목소리")),
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" } },
          h(
            "span",
            { style: { fontSize: "16px" } },
            cfg
              ? voiceNow()
                ? voices?.find((v) => v.id === voiceNow())?.name || voiceNow()
                : "정해진 목소리 없음"
              : "엔진 TTS가 꺼져 있어요",
          ),
          cfg ? miniBtn("목소리 고르기", pickVoice) : null,
        ),
        sub("고르면 바로 저장돼요."),
      );
    api
      .get("/tts/config")
      .then((c) => {
        cfg = c?.enabled ? c : null;
        drawVoice();
      })
      .catch(drawVoice);
    async function pickVoice() {
      try {
        if (!voices) voices = await loadVoices();
      } catch (error) {
        return toast(`목소리 목록을 못 읽었어요: ${error.message}`);
      }
      const set = async (voice) => {
        try {
          await api.put("/tts/config/voice-assignment", {
            characterId: id,
            characterName: e.get("data.name") || "",
            voice,
          });
          cfg = await api.get("/tts/config");
          s.close();
          drawVoice();
          toast("목소리를 저장했어요");
        } catch (error) {
          toast(error.message);
        }
      };
      const s = sheet(
        h(
          "div",
          { class: "ed-sheet" },
          h("b", { class: "ed-sheet-t" }, "목소리 고르기"),
          h(
            "div",
            { class: "ed-stack", style: { maxHeight: "55vh", overflowY: "auto" } },
            h("button", { type: "button", class: "grow", onClick: () => set("") }, h("span", null, "정하지 않음")),
            voiceGroups(voices).map((g) => [
              g.label ? h("div", { class: "label", style: { margin: "12px 0 2px" } }, g.label) : null,
              g.items.map((v) =>
                h(
                  "button",
                  {
                    type: "button",
                    class: "grow",
                    "aria-pressed": v.id === voiceNow() ? "true" : "false",
                    onClick: () => set(v.id),
                  },
                  h("span", null, v.name),
                  h("span", null, v.id === voiceNow() ? "✓" : ""),
                ),
              ),
            ]),
          ),
        ),
        { label: "목소리" },
      );
    }
    drawVoice();

    // ── 로어북 ───────────────────────
    const bookBox = h("div", { class: "ed-stack" });
    const embedBox = h("div", { class: "ed-field" });
    const drawEmbedded = () => {
      const entries = e.original().data.character_book?.entries;
      setChildren(
        embedBox,
        Array.isArray(entries) && entries.length
          ? [
              h("div", { class: "ed-label" }, h("label", null, "카드에 들어 있는 로어북")),
              sub(`${entries.length}개 항목이 카드 안에 들어 있어요. 따로 꺼내 쓰거나 카드에서 뺄 수 있어요.`),
              h(
                "div",
                { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
                miniBtn("로어북으로 꺼내기", async () => {
                  try {
                    await api.post(`/characters/${enc(id)}/embedded-lorebook/import`, {});
                    await afterBook("꺼냈어요");
                  } catch (error) {
                    toast(error.message);
                  }
                }),
                miniBtn("카드에서 빼기", async () => {
                  if (!(await ask("카드 안의 로어북을 지울까요?"))) return;
                  try {
                    await api.delete(`/characters/${enc(id)}/embedded-lorebook`);
                    await afterBook("뺐어요");
                  } catch (error) {
                    toast(error.message);
                  }
                }),
              ),
            ]
          : null,
      );
    };
    async function afterBook(msg) {
      await e.save({ quiet: true });
      e.reset(await reload());
      drawEmbedded();
      drawBooks();
      toast(msg);
    }
    async function drawBooks() {
      try {
        const [all, groups] = await Promise.all([api.get("/lorebooks"), groupsOf("lorebooks")]);
        const books = (Array.isArray(all) ? all : all?.lorebooks || []).map((b) => ({
          ...b,
          owners: idsOf(b.characterIds),
        }));
        if (!books.length) return setChildren(bookBox, sub("로어북이 아직 없어요."));
        const line = (b) => {
          const on = b.owners.includes(id) || b.characterId === id;
          const sw = h("span", { class: on ? "sw on" : "sw" }, h("span"));
          const btn = h(
            "button",
            {
              type: "button",
              class: "ed-switch",
              role: "switch",
              "aria-checked": on ? "true" : "false",
              onClick: async () => {
                try {
                  const next = on ? b.owners.filter((x) => x !== id) : [...b.owners, id];
                  await api.patch(`/lorebooks/${enc(b.id)}`, { characterIds: next });
                  drawBooks();
                } catch (error) {
                  toast(error.message);
                }
              },
            },
            h("span", { class: "ed-switch-t" }, b.name || "이름 없음"),
            sw,
          );
          return btn;
        };
        const parts = splitByGroup(books, groups);
        const grouped = parts.length > 1 || parts[0]?.label;
        setChildren(
          bookBox,
          parts.map((p) => {
            const list = h("div", { class: "ed-stack" }, p.items.map(line));
            return grouped ? foldGroup(h, "lorebooks", p.label || "폴더 없음", p.items.length, list) : list;
          }),
        );
      } catch (error) {
        setChildren(bookBox, errorBox(error));
      }
    }
    drawBooks();
    drawEmbedded();

    // ── ⋯ 메뉴 ───────────────────────
    function moreMenu() {
      popMenu([
        { label: "복제", onClick: duplicate },
        { label: "내보내기", onClick: exportSheet },
        { label: "버전 기록", onClick: versions },
        "-",
        { label: "지우기", onClick: remove },
      ]);
    }
    const leaveClean = () => e.reset(e.original()); // nothing left to auto-save when the character is gone
    async function duplicate() {
      try {
        await e.save({ quiet: true });
        const copy = await api.post(`/characters/${enc(id)}/duplicate`, {});
        data.characters(true);
        toast("복제했어요", () => go(`edit/character/${copy.id}`));
      } catch (error) {
        toast(error.message);
      }
    }
    function exportSheet() {
      const name = e.get("data.name") || "character";
      const go1 = async (path, file) => {
        try {
          await e.save({ quiet: true });
          await download(path, file);
        } catch (error) {
          toast(error.message);
        }
      };
      const s = sheet(
        h(
          "div",
          { class: "ed-sheet" },
          h("b", { class: "ed-sheet-t" }, "내보내기"),
          [
            [
              "마리나라 형식 (.json)",
              "사진·표정까지 전부",
              `/characters/${enc(id)}/export?format=native`,
              `${name}.marinara.json`,
            ],
            [
              "호환 JSON (.json)",
              "다른 앱에서 읽는 카드 형식",
              `/characters/${enc(id)}/export?format=compatible`,
              `${name}.json`,
            ],
            ["PNG 카드 (.png)", "사진 안에 카드가 들어가요", `/characters/${enc(id)}/export-png`, `${name}.png`],
          ].map(([t, about, path, file]) =>
            h(
              "button",
              { type: "button", class: "grow", onClick: () => (s.close(), go1(path, file)) },
              h("span", null, t, h("small", { style: { display: "block" } }, about)),
              h("span", null, "›"),
            ),
          ),
        ),
        { label: "내보내기" },
      );
    }
    async function versions() {
      let list;
      try {
        await e.save({ quiet: true });
        list = await api.get(`/characters/${enc(id)}/versions`);
      } catch (error) {
        return toast(error.message);
      }
      const box = h("div", { class: "ed-stack", style: { maxHeight: "60vh", overflowY: "auto" } });
      const s = sheet(h("div", { class: "ed-sheet" }, h("b", { class: "ed-sheet-t" }, "버전 기록"), box), {
        label: "버전 기록",
      });
      const when = (t) => (t ? new Date(t).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "");
      const draw = () =>
        setChildren(
          box,
          list.length ? null : sub("저장된 버전이 없어요."),
          list.map((v) =>
            h(
              "div",
              { class: "ed-item" },
              h(
                "div",
                { class: "ed-item-head" },
                h("span", { class: "ed-item-n" }, `${v.isCurrent ? "지금 · " : ""}${v.version || `#${v.revision}`}`),
                h("span", { class: "ed-hint" }, when(v.createdAt)),
              ),
              v.reason ? sub(v.reason) : null,
              v.isCurrent
                ? null
                : h(
                    "div",
                    { class: "ed-item-tools" },
                    miniBtn("되돌리기", async () => {
                      if (!(await ask("이 버전으로 되돌릴까요? 지금 내용은 버전 기록에 남아요."))) return;
                      try {
                        await api.post(`/characters/${enc(id)}/versions/${enc(v.id)}/restore`, {});
                        e.reset(await reload());
                        drawAvatar();
                        s.close();
                        toast("되돌렸어요");
                      } catch (error) {
                        toast(error.message);
                      }
                    }),
                    miniBtn("지우기", async () => {
                      try {
                        await api.delete(`/characters/${enc(id)}/versions/${enc(v.id)}`);
                        list = list.filter((x) => x.id !== v.id);
                        draw();
                      } catch (error) {
                        toast(error.message);
                      }
                    }),
                  ),
            ),
          ),
        );
      draw();
    }
    async function remove() {
      if (!(await ask(`'${e.get("data.name") || "이 캐릭터"}'를 지울까요? 되돌릴 수 없어요.`))) return;
      try {
        leaveClean();
        await api.delete(`/characters/${enc(id)}`);
        forgetGroups("characters");
        data.characters(true);
        back("library");
      } catch (error) {
        toast(error.message);
      }
    }

    // ── sections ─────────────────────
    e.track("data.extensions.avatarCrop");
    e.render([
      e.section(
        "info",
        "정보",
        "이름, 사진, 태그처럼 캐릭터를 알아보는 기본 정보예요.",
        avBox,
        e.text("data.name", "이름", { hint: "꼭 필요해요", max: 200 }),
        e.text("comment", "제목", { hint: "목록에서 이름 옆에 보이는 짧은 메모" }),
        e.text("data.creator", "만든 이"),
        e.text("data.character_version", "버전", { hint: "저장할 때 자동으로 올라가요", max: 40 }),
        e.toggle("data.extensions.versioningEnabled", "자동 버전 기록", {
          def: true,
          hint: "저장할 때마다 이전 모습을 버전 기록에 남겨요",
        }),
        e.number("data.extensions.talkativeness", "수다 정도", {
          min: 0,
          max: 1,
          step: 0.05,
          def: 0.5,
          fmt: (v) => `${Math.round(Number(v) * 100)}%`,
          hint: "그룹 채팅에서 얼마나 자주 말하는지",
        }),
        e.tags("data.tags", "태그"),
        groupField,
        L("data.creator_notes", "만든 이 메모", {
          rows: 4,
          hint: "카드를 만든 사람이 남기는 설명 (모델에 보내지 않아요)",
        }),
        idRow,
      ),
      e.section(
        "card",
        "카드",
        "캐릭터가 어떤 사람인지 적는 곳이에요.",
        L("data.summary", "요약", { rows: 3, hint: "한두 문장으로 줄인 소개" }, "summary"),
        L("data.description", "설명", { rows: 8 }, "description"),
        L("data.personality", "성격", { rows: 5 }, "personality"),
        L("data.extensions.backstory", "배경", { rows: 6 }, "backstory"),
        L("data.extensions.appearance", "외모", { rows: 5 }, "appearance"),
        e.toggle("data.extensions.imageAppearanceEnabled", "이미지용 외모 따로 쓰기", {
          hint: "그림을 그릴 때는 아래 글을 외모 대신 써요",
        }),
        L("data.extensions.imageAppearance", "이미지용 외모", { rows: 4 }),
        L("data.scenario", "시나리오", { rows: 5, hint: "이야기가 시작되는 상황" }, "scenario"),
      ),
      e.section(
        "greetings",
        "인사말",
        "채팅을 열 때 먼저 나오는 말과 말투 예시예요.",
        L("data.first_mes", "첫 메시지", { rows: 8 }, "first_mes"),
        e.list("data.alternate_greetings", "대체 인사", {
          addLabel: "+ 인사 추가",
          rows: 5,
          itemLabel: (i) => `인사 ${i + 1}`,
          hint: "채팅을 열 때 고를 수 있는 다른 첫 인사",
        }),
        L("data.mes_example", "예시 대사", { rows: 8, hint: "<START>로 예시를 나눠요" }, "mes_example"),
      ),
      e.section(
        "convo",
        "Convo",
        "메신저 같은 대화(Convo)에서 쓰는 모습이에요.",
        e.text("data.extensions.convoDisplayName", "표시 이름", { hint: "Convo에서 이름 대신 보이는 이름" }),
        e.toggle("data.extensions.convoDisplayNameInCard", "카드에도 표시", {
          hint: "카드 안에서도 이 이름으로 불러요",
        }),
        L("data.extensions.aboutMe", "소개", { rows: 4, hint: "Convo 프로필에 보이는 한마디" }),
        L("data.extensions.convoBehavior.instruction", "행동 지시", {
          rows: 5,
          hint: "Convo에서 어떻게 말하고 행동할지",
        }),
        e.choice("data.extensions.convoBehavior.insertionStrategy", "넣는 위치", STRATEGIES, {
          def: "constant_after",
          hint: "행동 지시를 프롬프트의 어디에 넣을지",
        }),
        L("data.extensions.conversationImageInstructions", "사진 지시", {
          rows: 4,
          hint: "Convo에서 사진을 보낼 때의 안내",
        }),
      ),
      e.section(
        "colors",
        "색 · 음성",
        "채팅에서 보이는 색과 읽어 주는 목소리예요.",
        e.color("data.extensions.nameColor", "이름 색"),
        e.color("data.extensions.dialogueColor", "대사 색"),
        e.color("data.extensions.boxColor", "말풍선 색"),
        preview,
        e.list("data.extensions.nameAliases", "다른 이름", {
          oneLine: true,
          addLabel: "+ 이름 추가",
          itemLabel: (i) => `이름 ${i + 1}`,
          hint: "대사에서 이 이름으로 불려도 같은 사람으로 봐요",
        }),
        e.text("data.extensions.phoneticName", "읽는 법", { hint: "음성으로 읽을 때의 발음 (예: 마리)" }),
        voiceRow,
      ),
      e.section(
        "lorebook",
        "로어북",
        "이 캐릭터와 함께 쓰는 로어북이에요. 켜고 끄면 바로 저장돼요.",
        bookBox,
        embedBox,
      ),
      e.section(
        "advanced",
        "고급",
        "프롬프트를 직접 다듬는 곳이에요. 잘 모르면 비워 두세요.",
        L("data.system_prompt", "시스템 프롬프트", { rows: 6, hint: "이 캐릭터에게만 쓰는 맨 앞 지시" }),
        L("data.post_history_instructions", "대화 뒤 지시", { rows: 5, hint: "대화 내용 다음에 붙는 지시" }),
        L("data.extensions.depth_prompt.prompt", "깊이 프롬프트", {
          rows: 4,
          hint: "대화 끝에서 몇 번째 메시지 앞에 넣을지 아래에서 정해요",
        }),
        e.number("data.extensions.depth_prompt.depth", "깊이", {
          min: 0,
          max: 100,
          def: 4,
          hint: "0이면 맨 끝, 클수록 더 위쪽에 들어가요",
        }),
        e.choice(
          "data.extensions.depth_prompt.role",
          "역할",
          [
            ["system", "시스템"],
            ["user", "사용자"],
            ["assistant", "캐릭터"],
          ],
          { def: "system", hint: "깊이 프롬프트를 누구의 말로 넣을지" },
        ),
      ),
      e.section(
        "engine",
        "엔진에서",
        "아직 셸에 없는 화면이에요. 누르면 엔진 화면이 열리고, ‹ Mari로 돌아올 수 있어요.",
        ENGINE_ROWS.map(([tab, title, about]) =>
          h(
            "button",
            { type: "button", class: "grow linkline", onClick: () => openEngine(null, { character: id, tab }) },
            h("span", null, title, h("small", { style: { display: "block" } }, `${about} · 엔진 화면 · 처음 약 14MB`)),
            h("span", null, "›"),
          ),
        ),
      ),
    ]);
    return e;
  }

  return {
    dispose() {
      gone = true;
      ed?.dispose();
    },
  };
}
