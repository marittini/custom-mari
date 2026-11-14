// Mari Kit translation instructions and notes for one chat. These are applied to the chat's
// independent translationOutputPrompt (incoming replies) and translationInputPrompt (user drafts).

import { h, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { topBar, toast, errorBox } from "../lib/ui.js";

function parseGlossary(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [pair, ...notes] = line.split(" # ");
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    const source = pair.slice(0, at).trim();
    const target = pair.slice(at + 1).trim();
    if (source && target) out.push({ source, target, notes: notes.join(" # ").trim() });
  }
  return out;
}

const formatGlossary = (rows) =>
  (rows ?? []).map((e) => `${e.source} = ${e.target}${e.notes ? ` # ${e.notes}` : ""}`).join("\n");
const languageName = (code) =>
  ({
    ko: "한국어",
    Korean: "한국어",
    en: "영어",
    English: "영어",
    ja: "일본어",
    Japanese: "일본어",
    "zh-CN": "중국어 간체",
    "zh-TW": "중국어 번체",
    Chinese: "중국어",
    fr: "프랑스어",
    French: "프랑스어",
    es: "스페인어",
    Spanish: "스페인어",
    de: "독일어",
    German: "독일어",
    ru: "러시아어",
    Russian: "러시아어",
  })[code] ||
  code ||
  "기본 언어";
const providerName = (value) =>
  ({ ai: "AI", google: "Google 번역", deepl: "DeepL", deeplx: "DeepLX" })[value] || value || "Google 번역";
const COPY = {
  ko: {
    incoming: "받는 답장 · AI → 내 언어",
    outgoing: "보내는 글 · 내 언어 → AI 언어",
    incomingPrompt: "받는 답장 번역 지침",
    outgoingPrompt: "보내는 글 번역 지침",
    incomingPreset: "받는 답장 번역 프리셋",
    outgoingPreset: "보내는 글 번역 프리셋",
    glossary: "공통 단어장",
    speech: "말투 메모 · 받는 답장에 적용",
    world: "세계 메모 · 양쪽에 적용",
    preview: "실제 적용 지침 미리보기",
    loadPreset: "선택한 프리셋 지침 불러오기",
    clearPrompt: "직접 작성 지우기 · 프리셋 사용",
  },
  en: {
    incoming: "Incoming reply · AI → my language",
    outgoing: "Outgoing text · my language → AI language",
    incomingPrompt: "Incoming translation instructions",
    outgoingPrompt: "Outgoing translation instructions",
    incomingPreset: "Incoming translation preset",
    outgoingPreset: "Outgoing translation preset",
    glossary: "Shared glossary",
    speech: "Character voice notes · incoming replies",
    world: "World notes · both directions",
    preview: "Preview effective instructions",
    loadPreset: "Load selected preset instructions",
    clearPrompt: "Clear custom instructions · use preset",
  },
};
const copy = (key) => {
  const lang = String(document.documentElement.lang || "ko")
    .toLowerCase()
    .startsWith("ko")
    ? "ko"
    : "en";
  return COPY[lang][key] || COPY.en[key] || key;
};

export function translationScreen({ mount, args, back }) {
  const chatId = args[0];
  let alive = true;
  let activeScan = null;
  const body = h(
    "div",
    { class: "scroll", style: { paddingBottom: "28px" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  mount.append(topBar({ back: () => back("convos"), title: "번역" }), body);

  const route = `/mari-kit/translation/${encodeURIComponent(chatId)}`;
  const scanRequest = async (kind, signal) => {
    const response = await fetch(`/api${route}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-marinara-csrf": "1" },
      credentials: "same-origin",
      body: JSON.stringify({ kind }),
      signal,
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (!response.ok) throw new Error(data?.error || data?.message || `${response.status}`);
    return data;
  };

  async function load() {
    try {
      const [presets, state] = await Promise.all([api.get("/mari-kit/translation/presets"), api.get(route)]);
      if (alive) draw(presets, state);
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  }

  function draw(presets, state) {
    const { room, status } = state;
    const options = presets.presets.map((p) => [p.id, p.name]);
    const incoming = makeSelect(room.incomingPresetId);
    const outgoing = makeSelect(room.outgoingPresetId);
    const incomingPrompt = makeArea(
      room.incomingPrompt || "",
      7,
      "이 방향에 적용할 지침을 직접 입력하세요.",
      copy("incomingPrompt"),
    );
    const outgoingPrompt = makeArea(
      room.outgoingPrompt || "",
      7,
      "이 방향에 적용할 지침을 직접 입력하세요.",
      copy("outgoingPrompt"),
    );
    const glossary = makeArea(formatGlossary(room.glossary), 6, "원어 = 번역 # 메모", copy("glossary"));
    const speech = makeArea(room.speech || "", 4, "캐릭터별 말투", copy("speech"));
    const world = makeArea(room.world || "", 4, "세계관·고유명사 메모", copy("world"));
    const candidates = h("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } });
    const scanStatus = h("p", { class: "hint", role: "status", style: { margin: "0", lineHeight: "1.5" } });
    const cancelScanButton = h(
      "button",
      { type: "button", class: "chip", hidden: true, onClick: () => activeScan?.abort() },
      "읽기 취소",
    );
    const scanProgress = h(
      "div",
      {
        style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" },
      },
      scanStatus,
      cancelScanButton,
    );
    const scanButtons = [];
    const previewStates = {};
    let proposed = [];
    let applying = false;
    let restoring = false;
    let pendingDraftReads = 0;
    let saveLocks = [];

    const setHint = (node, message, isError = false) => {
      node.textContent = message;
      node.style.color = isError ? "var(--ink-2)" : "";
    };
    const label = (title, extra = null) =>
      h(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" } },
        h("span", null, title),
        extra,
      );
    const updateScanButtons = (busy) => {
      for (const button of scanButtons) button.disabled = busy;
    };
    const draftBody = () => ({
      incomingPresetId: incoming.value,
      outgoingPresetId: outgoing.value,
      incomingPrompt: incomingPrompt.value.trim() || null,
      outgoingPrompt: outgoingPrompt.value.trim() || null,
      glossary: parseGlossary(glossary.value),
      speech: speech.value,
      world: world.value,
    });

    function makeDirection(title, description, select, prompt, key) {
      select.setAttribute("aria-label", copy(key === "incoming" ? "incomingPreset" : "outgoingPreset"));
      prompt.setAttribute("aria-label", copy(key === "incoming" ? "incomingPrompt" : "outgoingPrompt"));
      const previewText = h("pre", {
        class: "inp",
        style: {
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontSize: "12px",
          lineHeight: "1.55",
          maxHeight: "360px",
          overflow: "auto",
        },
      });
      previewText.hidden = true;
      const previewStatus = h(
        "p",
        { class: "hint", role: "status", style: { margin: "0", lineHeight: "1.5" } },
        "미리보기를 누르면 실제 적용 지침을 보여 줍니다.",
      );
      previewStates[key] = { status: previewStatus, text: previewText };
      const previewButton = h("button", { type: "button", class: "chip", onClick: preview }, copy("preview"));
      const loadButton = h(
        "button",
        {
          type: "button",
          class: "chip",
          onClick: loadSelected,
        },
        copy("loadPreset"),
      );
      let promptRevision = 0;
      prompt.addEventListener("focus", () => {
        promptRevision += 1;
      });
      prompt.addEventListener("beforeinput", () => {
        promptRevision += 1;
      });
      const clearButton = h(
        "button",
        {
          type: "button",
          class: "chip",
          onClick: clearCustom,
        },
        copy("clearPrompt"),
      );

      function showErrors(result) {
        const notes = [];
        if (result.error) notes.push(result.error);
        if (result.droppedWorld) notes.push("길이 한도 때문에 세계 메모가 빠집니다.");
        if (result.droppedGlossary) notes.push(`길이 한도 때문에 단어장 ${result.droppedGlossary}개가 빠집니다.`);
        if (result.shortenedVoice) notes.push("길이 한도 때문에 말투 메모가 줄어듭니다.");
        return notes;
      }
      const signature = () => JSON.stringify({ ...draftBody(), side: key });
      const invalidate = () => {
        previewText.textContent = "";
        previewText.hidden = true;
        setHint(previewStatus, "입력값이 바뀌었습니다. 다시 미리보기를 눌러 확인하세요.");
      };
      async function preview() {
        if (previewButton.disabled) return;
        const requestSignature = signature();
        pendingDraftReads += 1;
        updateActionButtons();
        previewButton.disabled = true;
        previewButton.textContent = "미리보는 중…";
        setHint(previewStatus, "현재 입력값으로 미리보는 중…");
        try {
          const result = await api.post(`${route}/preview`, { ...draftBody(), side: key });
          if (!alive) return;
          if (requestSignature !== signature()) {
            invalidate();
            return;
          }
          const side = result[key];
          if (!side) throw new Error("미리보기 응답에 지침이 없습니다.");
          previewText.textContent = side.text || "(비어 있음)";
          previewText.hidden = false;
          const notes = showErrors(side);
          const length = `${side.length ?? side.text?.length ?? 0} / ${status.limit}자`;
          setHint(previewStatus, [length, ...notes].join(" · "), notes.length > 0);
        } catch (error) {
          if (alive && requestSignature !== signature()) invalidate();
          else if (alive) setHint(previewStatus, `미리보지 못했어요: ${error.message}`, true);
        } finally {
          pendingDraftReads -= 1;
          if (alive) {
            previewButton.disabled = false;
            previewButton.textContent = "실제 적용 지침 미리보기";
            updateActionButtons();
          }
        }
      }
      async function loadSelected() {
        if (loadButton.disabled) return;
        const beforePrompt = prompt.value;
        const beforePreset = select.value;
        const beforeRevision = promptRevision;
        pendingDraftReads += 1;
        updateActionButtons();
        loadButton.disabled = true;
        loadButton.textContent = "불러오는 중…";
        try {
          const draft = draftBody();
          draft[`${key}Prompt`] = null;
          const result = await api.post(`${route}/preview`, { ...draft, side: key });
          if (!alive) return;
          const side = result[key];
          if (!side || typeof side.basePrompt !== "string") throw new Error("프리셋 지침을 받지 못했어요.");
          if (promptRevision !== beforeRevision || prompt.value !== beforePrompt || select.value !== beforePreset) {
            invalidate();
            setHint(previewStatus, "입력값이 바뀌어 불러오기를 취소했어요. 다시 눌러 주세요.");
            return;
          }
          prompt.value = side.basePrompt;
          prompt.dispatchEvent(new Event("input", { bubbles: true }));
          setHint(previewStatus, "선택한 프리셋 지침을 편집 칸에 불러왔어요. 바꾼 뒤 적용하세요.");
        } catch (error) {
          if (
            alive &&
            (promptRevision !== beforeRevision || prompt.value !== beforePrompt || select.value !== beforePreset)
          ) {
            invalidate();
            setHint(previewStatus, "입력값이 바뀌어 불러오기를 취소했어요. 다시 눌러 주세요.");
          } else if (alive) setHint(previewStatus, `불러오지 못했어요: ${error.message}`, true);
        } finally {
          pendingDraftReads -= 1;
          if (alive) {
            loadButton.disabled = false;
            loadButton.textContent = "선택한 프리셋 지침 불러오기";
            updateActionButtons();
          }
        }
      }
      function clearCustom() {
        prompt.value = "";
        invalidate();
        setHint(previewStatus, "직접 작성 지침을 비웠어요. 적용하면 선택한 프리셋을 사용합니다.");
      }

      const details = h(
        "details",
        { style: { marginTop: "10px" } },
        h(
          "summary",
          { style: { minHeight: "44px", display: "flex", alignItems: "center", cursor: "pointer" } },
          "직접 작성 지침 (필요할 때 펼치기)",
        ),
        h(
          "p",
          { class: "hint", style: { margin: "0 0 8px", lineHeight: "1.5" } },
          "내용을 입력하면 이 방향에서 선택한 프리셋 대신 사용합니다. 비우면 프리셋 지침을 씁니다.",
        ),
        h(
          "div",
          { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "8px" } },
          loadButton,
          clearButton,
        ),
        prompt,
      );
      prompt.addEventListener("input", invalidate);
      select.addEventListener("change", invalidate);

      return h(
        "section",
        { class: "fld" },
        label(title),
        h("p", { class: "hint", style: { margin: "4px 0 8px", lineHeight: "1.5" } }, description),
        select,
        details,
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" } },
          previewButton,
          previewStatus,
          previewText,
        ),
      );
    }

    function renderCandidates() {
      setChildren(candidates);
      if (!proposed.length) return;
      const checkboxes = proposed.map((entry, index) => {
        const known = new Set(parseGlossary(glossary.value).map((row) => row.source.trim()));
        const exists = known.has(String(entry.source || "").trim());
        const checkbox = h("input", {
          type: "checkbox",
          checked: !exists,
          disabled: exists,
          "aria-label": `${entry.source}를 추가`,
        });
        checkbox.dataset.index = String(index);
        return h(
          "label",
          {
            class: "hint",
            style: { display: "flex", alignItems: "center", gap: "10px", minHeight: "44px", lineHeight: "1.4" },
          },
          checkbox,
          h("span", null, `${entry.source} = ${entry.target}${exists ? " · 이미 있음" : ""}`),
        );
      });
      const add = h(
        "button",
        {
          type: "button",
          class: "pill",
          onClick: () => {
            const known = new Set(parseGlossary(glossary.value).map((row) => row.source.trim()));
            const picked = checkboxes
              .map((row) => row.children[0])
              .filter((checkbox) => checkbox.checked && !checkbox.disabled)
              .map((checkbox) => proposed[Number(checkbox.dataset.index)])
              .filter((entry) => {
                const key = String(entry.source || "").trim();
                if (!key || known.has(key)) return false;
                known.add(key);
                return true;
              });
            if (!picked.length) {
              setHint(scanStatus, "추가할 후보를 선택하세요.");
              return;
            }
            glossary.value = [glossary.value.trim(), formatGlossary(picked)].filter(Boolean).join("\n");
            invalidatePreviews();
            proposed = proposed.filter((entry) => !picked.some((row) => row.source === entry.source));
            renderCandidates();
            setHint(scanStatus, `${picked.length}개 후보를 단어장 초안에 추가했어요. 적용을 눌러 저장하세요.`);
          },
        },
        "선택한 항목 추가",
      );
      setChildren(candidates, ...checkboxes, add);
    }

    async function scan(kind, target, button) {
      if (activeScan || applying || restoring || !alive) return;
      const controller = new AbortController();
      activeScan = controller;
      proposed = [];
      renderCandidates();
      updateScanButtons(true);
      const caption = button.textContent;
      button.textContent = "읽는 중…";
      target.closest("section")?.append(scanProgress);
      cancelScanButton.hidden = false;
      updateActionButtons();
      setHint(scanStatus, "채팅 내용을 읽는 중… 모델 호출 1번");
      try {
        const result = await scanRequest(kind, controller.signal);
        if (!alive || controller.signal.aborted) return;
        if (kind === "glossary") {
          proposed = Array.isArray(result.glossary) ? result.glossary.filter((row) => row?.source && row?.target) : [];
          renderCandidates();
          setHint(
            scanStatus,
            proposed.length
              ? `${proposed.length}개 후보를 찾았어요. 추가할 항목을 고르세요.`
              : "새 단어장 후보를 찾지 못했어요.",
          );
        } else {
          const addition = String(result.text || "").trim();
          if (addition) {
            target.value = [target.value.trim(), addition].filter(Boolean).join("\n\n");
            invalidatePreviews();
            setHint(scanStatus, "찾은 내용을 초안에 덧붙였어요. 적용을 눌러 저장하세요.");
          } else setHint(scanStatus, "추가할 내용을 찾지 못했어요.");
        }
      } catch (error) {
        if (alive && error.name === "AbortError") setHint(scanStatus, "읽기를 취소했어요.");
        else if (alive) setHint(scanStatus, `읽지 못했어요: ${error.message}`, true);
      } finally {
        if (activeScan === controller) activeScan = null;
        if (alive) {
          button.textContent = caption;
          cancelScanButton.hidden = true;
          updateScanButtons(false);
          updateActionButtons();
        }
      }
    }
    const scanButton = (kind, target) => {
      const button = h(
        "button",
        { type: "button", class: "chip", onClick: () => scan(kind, target, button) },
        "AI로 찾기",
      );
      scanButtons.push(button);
      return button;
    };

    const directionStatus = (key) => {
      const side = status[key] || {};
      const target = side.targetLanguage || status.targetLanguage || "";
      const length = typeof side.length === "number" ? ` · ${side.length} / ${status.limit}자` : "";
      const notes = [];
      if (side.error) notes.push(side.error);
      if (side.droppedWorld) notes.push("세계 메모가 한도 때문에 빠짐");
      if (side.droppedGlossary) notes.push(`단어장 ${side.droppedGlossary}개가 한도 때문에 빠짐`);
      if (side.shortenedVoice) notes.push("말투 메모가 한도 때문에 줄어듦");
      return `${providerName(status.provider)} · 대상 언어: ${languageName(target)}${length}${notes.length ? ` · ${notes.join(" · ")}` : ""}`;
    };
    const providerNote =
      status.provider === "ai"
        ? "AI 지침과 단어장은 AI 번역에서 적용됩니다."
        : "현재 공급자는 AI 지침과 단어장을 사용하지 않습니다. 말투·세계 메모도 AI 공급자에서만 적용됩니다.";

    const applyButton = h("button", { type: "button", class: "pill main", onClick: apply }, "적용");
    const restoreButton = h("button", { type: "button", class: "pill", onClick: restore }, "원래대로");
    const actionStatus = h("p", { class: "hint", role: "status", style: { margin: "0", lineHeight: "1.5" } });
    const invalidatePreviews = () => {
      for (const side of Object.values(previewStates)) {
        side.text.textContent = "";
        side.text.hidden = true;
        setHint(side.status, "공통 메모가 바뀌었습니다. 다시 미리보기를 눌러 확인하세요.");
      }
    };
    glossary.addEventListener("input", invalidatePreviews);
    speech.addEventListener("input", invalidatePreviews);
    world.addEventListener("input", invalidatePreviews);
    async function apply() {
      if (applying || restoring || activeScan || pendingDraftReads) return;
      applying = true;
      lockDraftControls();
      updateActionButtons();
      setHint(actionStatus, "적용하는 중…");
      try {
        const result = await api.put(route, draftBody());
        if (!alive) return;
        toast("이 채팅의 번역 지침에 적용했어요");
        draw(presets, result);
      } catch (error) {
        if (alive) setHint(actionStatus, `적용하지 못했어요: ${error.message}`, true);
      } finally {
        applying = false;
        unlockDraftControls();
        if (alive) updateActionButtons();
      }
    }
    async function restore() {
      if (restoring || applying || activeScan || pendingDraftReads) return;
      restoring = true;
      lockDraftControls();
      updateActionButtons();
      setHint(actionStatus, "원래 지침으로 되돌리는 중…");
      try {
        const result = await api.post(`${route}/restore`);
        if (!alive) return;
        toast("원래 지침으로 되돌렸어요");
        draw(presets, result);
      } catch (error) {
        if (alive) setHint(actionStatus, `되돌리지 못했어요: ${error.message}`, true);
      } finally {
        restoring = false;
        unlockDraftControls();
        if (alive) updateActionButtons();
      }
    }

    function lockDraftControls() {
      saveLocks = [...body.querySelectorAll("input, textarea, select, button")].map((control) => [
        control,
        control.disabled,
      ]);
      for (const [control] of saveLocks) control.disabled = true;
    }
    function unlockDraftControls() {
      for (const [control, disabled] of saveLocks) control.disabled = disabled;
      saveLocks = [];
    }
    function updateActionButtons() {
      const locked = applying || restoring || Boolean(activeScan) || pendingDraftReads > 0;
      applyButton.disabled = locked;
      restoreButton.disabled = locked;
      updateScanButtons(locked);
    }

    setChildren(
      body,
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "20px", padding: "16px 0 0" } },
        h(
          "p",
          { class: "hint", style: { margin: "0", padding: "0 20px", lineHeight: "1.5" } },
          `${directionStatus("incoming")} · ${status.applied ? "적용됨" : "아직 적용 전"}${status.editedSinceApply ? " · 적용 후 채팅 설정에서 지침을 고침" : ""}`,
        ),
        h("p", { class: "hint", style: { margin: "-14px 20px 0", lineHeight: "1.5" } }, providerNote),
        makeDirection(copy("incoming"), directionStatus("incoming"), incoming, incomingPrompt, "incoming"),
        makeDirection(copy("outgoing"), directionStatus("outgoing"), outgoing, outgoingPrompt, "outgoing"),
        h(
          "section",
          { class: "fld" },
          label(copy("glossary"), scanButton("glossary", glossary)),
          h(
            "p",
            { class: "hint", style: { margin: "4px 0 8px", lineHeight: "1.5" } },
            "받는 답장에는 원어 → 번역어, 보내는 글에는 반대 방향으로 적용됩니다.",
          ),
          glossary,
          candidates,
          scanProgress,
        ),
        h("section", { class: "fld" }, label(copy("speech"), scanButton("speech", speech)), speech),
        h("section", { class: "fld" }, label(copy("world"), scanButton("world", world)), world),
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "8px", padding: "0 20px" } },
          actionStatus,
          h(
            "div",
            { style: { display: "flex", justifyContent: "flex-end", gap: "8px" } },
            status.applied ? restoreButton : null,
            applyButton,
          ),
        ),
      ),
    );

    function makeSelect(value) {
      return h(
        "select",
        { class: "inp" },
        options.map(([v, text]) => h("option", { value: v, selected: value === v }, text)),
      );
    }
    function makeArea(value, rows, placeholder, accessibleName) {
      const area = h("textarea", {
        class: "inp",
        rows,
        placeholder,
        "aria-label": accessibleName,
        style: { resize: "vertical", fontSize: "13px", lineHeight: "1.6" },
      });
      area.value = value;
      return area;
    }
  }

  load();
  return {
    dispose: () => {
      alive = false;
      activeScan?.abort();
      activeScan = null;
    },
  };
}
