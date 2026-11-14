import { api, upload } from "./api.js";
import { h, setChildren } from "./h.js";
import { ask, sheet } from "./ui.js";

const STRINGS = {
  en: {
    title: "Stickers",
    search: "Search stickers",
    close: "Close sticker picker",
    loading: "Loading stickers…",
    retry: "Try again",
    empty: "No matching stickers.",
    failed: "Could not load stickers.",
    add: "Add sticker",
    manage: "Manage global stickers",
    name: "Name",
    file: "Image file",
    save: "Save sticker",
    cancel: "Cancel",
    constraints:
      "Use 1–32 lowercase letters, numbers, or underscores. JPG, PNG, GIF, WebP, or AVIF; up to 512 × 512 px.",
    duplicate: "A sticker with this name already exists.",
    rename: "Rename",
    delete: "Delete",
    global: "Global",
    persona: "Persona",
    character: "Character",
    saving: "Saving…",
    deleting: "Deleting…",
    unnamed: "Sticker",
    nameRequired: "Enter a valid sticker name.",
    fileRequired: "Choose an image file.",
    open: "Open stickers",
    translationChanged: "A translated message changed this sticker token, so the original text was kept.",
    confirmDelete: (name) => `Delete the global sticker “${name}”?`,
  },
  ko: {
    title: "스티커",
    search: "스티커 검색",
    close: "스티커 선택 닫기",
    loading: "스티커 불러오는 중…",
    retry: "다시 시도",
    empty: "일치하는 스티커가 없어요.",
    failed: "스티커를 불러오지 못했어요.",
    add: "스티커 추가",
    manage: "전체 스티커 관리",
    name: "이름",
    file: "이미지 파일",
    save: "스티커 저장",
    cancel: "취소",
    constraints: "영문 소문자, 숫자, 밑줄로 1~32자. JPG, PNG, GIF, WebP, AVIF, 최대 512 × 512 픽셀.",
    duplicate: "같은 이름의 스티커가 있어요.",
    rename: "이름 변경",
    delete: "삭제",
    global: "전체",
    persona: "페르소나",
    character: "캐릭터",
    saving: "저장 중…",
    deleting: "삭제 중…",
    unnamed: "스티커",
    nameRequired: "올바른 스티커 이름을 입력해 주세요.",
    fileRequired: "이미지 파일을 선택해 주세요.",
    open: "스티커 열기",
    translationChanged: "번역에서 스티커 토큰이 바뀌어 원문을 유지했어요.",
    confirmDelete: (name) => `전체 스티커 “${name}”을(를) 삭제할까요?`,
  },
};

export function stickerLabel(key) {
  const lang = String(document.documentElement.lang || "ko")
    .toLowerCase()
    .startsWith("ko")
    ? "ko"
    : "en";
  return STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
}

const enc = (v) => encodeURIComponent(v);
const stickerRows = (rows) =>
  (Array.isArray(rows) ? rows : []).filter((r) => r?.customKind === "sticker" && r.customName && safeUrl(r.url));
function safeUrl(value) {
  return (
    typeof value === "string" &&
    /^\/api\/[A-Za-z0-9_./?=&%#-]+$/.test(value) &&
    !value.includes("\\") &&
    !value.includes("..") &&
    !value.startsWith("//")
  );
}
function labelOf(character, index) {
  const item = index?.get?.(character?.id);
  return typeof item === "string" ? item : item?.displayName || item?.name || item?.title || stickerLabel("character");
}

/** Resolve native global, persona, then character sticker galleries. Later sources shadow earlier names. */
export function resolveStickers(globals = [], personaImages = [], characters = []) {
  const byName = new Map();
  for (const row of Array.isArray(globals) ? globals : []) {
    if (row?.name && safeUrl(row.url))
      byName.set(row.name, {
        name: row.name,
        url: row.url,
        source: stickerLabel("global"),
        editable: true,
        id: row.id,
      });
  }
  for (const row of stickerRows(personaImages)) {
    byName.set(row.customName, {
      name: row.customName,
      url: row.url,
      source: stickerLabel("persona"),
      editable: false,
    });
  }
  for (const character of Array.isArray(characters) ? characters : []) {
    const source = character?.name || stickerLabel("character");
    for (const row of stickerRows(character?.images)) {
      byName.set(row.customName, { name: row.customName, url: row.url, source, editable: false });
    }
  }
  const list = [...byName.values()];
  return {
    list,
    map: new Map(list.map(({ name, url }) => [name, url])),
    globals: (Array.isArray(globals) ? globals : []).filter((r) => r?.id && r?.name && safeUrl(r.url)),
  };
}

/** Fetch the sticker sources needed by this chat. Gallery endpoints are optional; the global pool is required. */
export async function loadStickers(chat = {}, index = new Map()) {
  const chars = [...new Set(chat?.characterIds || [])].filter((id) => typeof id === "string" && id);
  const jobs = [api.get("/custom-stickers")];
  const persona = chat?.personaId ? jobs.length : -1;
  if (persona >= 0) jobs.push(api.get(`/characters/personas/${enc(chat.personaId)}/gallery`).catch(() => []));
  const charStart = jobs.length;
  for (const id of chars) jobs.push(api.get(`/characters/${enc(id)}/gallery`).catch(() => []));
  const result = await Promise.all(jobs);
  const personaImages = persona >= 0 ? result[persona] : [];
  const characters = chars.map((id, i) => ({ name: labelOf({ id }, index), images: result[charStart + i] }));
  return resolveStickers(result[0], personaImages, characters);
}

/** Convert only known sticker:name: tokens into images; all other content remains text nodes. */
export function stickerContent(text, map) {
  const source = String(text ?? "");
  const entries = map instanceof Map ? map : new Map(Object.entries(map || {}));
  const token = /\bsticker:([a-z0-9_]{1,32}):/g;
  const out = [];
  let pos = 0;
  for (const match of source.matchAll(token)) {
    const url = entries.get(match[1]);
    if (!url || !safeUrl(url)) continue;
    const at = match.index;
    if (at > pos) out.push(document.createTextNode(source.slice(pos, at)));
    out.push(h("img", { class: "sticker-image", src: url, loading: "lazy", decoding: "async", alt: match[0] }));
    pos = at + match[0].length;
  }
  if (pos < source.length || !out.length) out.push(document.createTextNode(source.slice(pos)));
  return out;
}

/** Media identifiers belong in saved messages, never in the text sent to a voice provider. */
export function withoutStickerTokens(text) {
  return String(text ?? "")
    .replace(/sticker:[a-z0-9_]+:/g, "")
    .trim();
}

const cleanName = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
const validName = (value) => /^[a-z0-9_]{1,32}$/.test(value);
const errText = (error) => (error?.status === 409 ? stickerLabel("duplicate") : error?.message || String(error));

/** Existing bottom-sheet picker with global sticker CRUD and read-only gallery entries. */
export function stickerPicker({ load, onPick, onClose } = {}) {
  let closed = false;
  let busy = false;
  let loading = true;
  let error = "";
  let resolved = { list: [], globals: [] };
  let query = "";
  let showForm = false;
  let manage = false;
  let editId = "";
  let editName = "";
  let draftName = "";
  let draftFile = null;
  let pickRestore = document.activeElement;
  let searchInput;
  let errorNode;
  let body;
  let formName;
  let fileInput;
  let busyButton;
  const alive = () => !closed && sheetEl?.isConnected;
  const refresh = async () => {
    loading = true;
    error = "";
    if (alive()) draw();
    try {
      const next = await load();
      if (!alive()) return;
      resolved = next || { list: [], globals: [] };
      error = "";
    } catch (e) {
      if (!alive()) return;
      error = errText(e);
    } finally {
      if (alive()) {
        loading = false;
        draw();
      }
    }
  };
  const report = (e) => {
    if (alive() && errorNode) {
      errorNode.textContent = errText(e);
      errorNode.hidden = false;
    }
  };
  const mutate = async (button, fn) => {
    if (busy || !alive()) return;
    busy = true;
    busyButton = button;
    body?.querySelectorAll("button:not(.sticker-close), input").forEach((node) => (node.disabled = true));
    if (button) button.disabled = true;
    if (errorNode) errorNode.hidden = true;
    try {
      await fn();
    } catch (e) {
      report(e);
    } finally {
      busy = false;
      if (alive()) body?.querySelectorAll("button, input").forEach((node) => (node.disabled = false));
      if (alive() && manage) body?.querySelectorAll(".sticker-pick").forEach((node) => (node.disabled = true));
      if (alive() && busyButton) busyButton.disabled = false;
      busyButton = null;
    }
  };
  const choose = (name) => {
    if (!alive() || busy) return;
    const fn = onPick;
    close();
    fn?.(name);
  };
  const startEdit = (row) => {
    if (busy) return;
    editId = row.id;
    editName = row.name;
    draw();
    formName?.focus();
    formName?.select();
  };
  const makeGrid = () => {
    const needle = query.trim().toLowerCase();
    const sourceList = manage
      ? (resolved.globals || []).map((row) => ({ ...row, source: stickerLabel("global"), editable: true }))
      : resolved.list || [];
    const list = sourceList.filter(
      (row) => !needle || row.name.toLowerCase().includes(needle) || row.source.toLowerCase().includes(needle),
    );
    if (loading) return h("div", { class: "sticker-state", role: "status" }, stickerLabel("loading"));
    if (!list.length) return h("div", { class: "sticker-state" }, stickerLabel("empty"));
    return h(
      "div",
      { class: "sticker-grid" },
      list.map((row) =>
        h(
          "div",
          { class: "sticker-card" },
          h(
            "button",
            {
              type: "button",
              class: "sticker-pick",
              disabled: manage || busy,
              onClick: () => choose(row.name),
              "aria-label": `${row.name}, ${row.source}`,
            },
            h("img", { src: row.url, alt: "", loading: "lazy", decoding: "async" }),
            h("span", { class: "sticker-card-name" }, row.name),
            h("small", null, row.source),
          ),
          manage && row.editable
            ? h(
                "div",
                { class: "sticker-manage" },
                h("button", { type: "button", class: "pill", onClick: () => startEdit(row) }, stickerLabel("rename")),
                h(
                  "button",
                  {
                    type: "button",
                    class: "pill",
                    onClick: (event) =>
                      mutate(event.currentTarget, async () => {
                        if (!(await ask(stickerLabel("confirmDelete")(row.name))) || !alive()) return;
                        await api.delete(`/custom-stickers/${enc(row.id)}`);
                        if (!alive()) return;
                        await refresh();
                        if (!alive()) return;
                        editId = "";
                        draw();
                      }),
                  },
                  stickerLabel("delete"),
                ),
              )
            : null,
        ),
      ),
    );
  };
  const makeForm = () => {
    formName = null;
    fileInput = null;
    if (!showForm && !editId) return null;
    const editing = Boolean(editId);
    const save = (button) =>
      mutate(button, async () => {
        const name = cleanName(formName?.value ?? (editing ? editName : draftName));
        if (!validName(name)) {
          report(new Error(stickerLabel("nameRequired")));
          formName?.focus();
          return;
        }
        if (editing) {
          await api.patch(`/custom-stickers/${enc(editId)}`, { name });
        } else {
          const file = fileInput?.files?.[0] || draftFile;
          if (!file) {
            report(new Error(stickerLabel("fileRequired")));
            return;
          }
          const form = new FormData();
          form.append("name", name);
          form.append("file", file);
          await upload("/custom-stickers/upload", form);
        }
        if (!alive()) return;
        draftName = "";
        draftFile = null;
        editId = "";
        showForm = false;
        draw();
        await refresh();
      });
    const nameField = h("input", {
      class: "sticker-field",
      type: "text",
      name: "name",
      maxlength: "32",
      autocomplete: "off",
      value: editing ? editName : draftName,
      "aria-label": stickerLabel("name"),
      onInput: (e) => {
        if (busy) return;
        if (editing) editName = e.target.value;
        else draftName = e.target.value;
      },
    });
    formName = nameField;
    const input = editing
      ? null
      : h("input", {
          class: "sticker-field",
          type: "file",
          accept: "image/jpeg,image/png,image/gif,image/webp,image/avif",
          "aria-label": stickerLabel("file"),
          onChange: (e) => {
            if (busy) return;
            draftFile = e.target.files?.[0] || null;
          },
        });
    if (!editing) fileInput = input;
    const saveBtn = h(
      "button",
      { type: "button", class: "pill main", onClick: (e) => save(e.currentTarget) },
      stickerLabel("save"),
    );
    return h(
      "form",
      {
        class: "sticker-form",
        onSubmit: (e) => {
          e.preventDefault();
          save(saveBtn);
        },
      },
      h("label", null, stickerLabel("name"), nameField),
      editing ? null : h("label", null, stickerLabel("file"), input),
      editing ? null : h("small", { class: "sticker-constraints" }, stickerLabel("constraints")),
      h(
        "div",
        { class: "sticker-form-actions" },
        h(
          "button",
          {
            type: "button",
            class: "pill",
            onClick: () => {
              if (busy) return;
              showForm = false;
              editId = "";
              draw();
            },
          },
          stickerLabel("cancel"),
        ),
        saveBtn,
      ),
    );
  };
  function draw() {
    if (!alive()) return;
    const oldSearch = searchInput;
    const activeSearch = document.activeElement === oldSearch;
    setChildren(
      body,
      h(
        "div",
        { class: "sticker-head" },
        h("b", null, stickerLabel("title")),
        h(
          "button",
          { type: "button", class: "ib sticker-close", "aria-label": stickerLabel("close"), onClick: close },
          "×",
        ),
      ),
      h(
        "label",
        { class: "sticker-search" },
        h("span", { class: "sr" }, stickerLabel("search")),
        (searchInput = h("input", {
          type: "search",
          placeholder: stickerLabel("search"),
          value: query,
          onInput: (e) => {
            if (busy) return;
            query = e.target.value;
            draw();
            searchInput?.focus();
            searchInput?.setSelectionRange(query.length, query.length);
          },
        })),
      ),
      error
        ? h(
            "div",
            { class: "sticker-inline-error", role: "alert" },
            error,
            h("button", { type: "button", class: "pill", onClick: refresh }, stickerLabel("retry")),
          )
        : null,
      makeGrid(),
      (errorNode = h("div", { class: "sticker-inline-error", role: "alert", hidden: true })),
      makeForm(),
      h(
        "div",
        { class: "sticker-toolbar" },
        h(
          "button",
          {
            type: "button",
            class: "pill",
            disabled: busy,
            onClick: () => {
              if (busy) return;
              showForm = !showForm;
              editId = "";
              draw();
              if (showForm) {
                formName?.focus();
              }
            },
          },
          stickerLabel("add"),
        ),
        h(
          "button",
          {
            type: "button",
            class: "pill",
            disabled: busy,
            "aria-pressed": String(manage),
            onClick: () => {
              if (busy) return;
              manage = !manage;
              editId = "";
              draw();
            },
          },
          stickerLabel("manage"),
        ),
      ),
    );
    if (activeSearch) searchInput?.focus();
  }
  const bodyNode = h("div", { class: "sticker-body" });
  body = bodyNode;
  let sheetEl;
  // sheet() owns the visible section; alive() uses the assigned element after construction.
  const handle = sheet(bodyNode, {
    label: stickerLabel("title"),
    onClose: () => {
      closed = true;
      document.removeEventListener("keydown", onKey);
      onClose?.();
      if (pickRestore?.isConnected) pickRestore.focus();
    },
  });
  const actualSheet = handle.el;
  // The local binding used by callbacks is intentionally assigned immediately after sheet creation.
  sheetEl = actualSheet;
  function onKey(e) {
    if (e.key === "Escape" && alive()) {
      e.preventDefault();
      close();
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    handle.close();
  }
  document.addEventListener("keydown", onKey);
  draw();
  sheetEl.tabIndex = -1;
  sheetEl.focus();
  refresh();
  return { close };
}
