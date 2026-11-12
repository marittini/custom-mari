// ──────────────────────────────────────────────
// Mari Kit — browser entry
//
// Plain DOM (no bundled framework) so the client file stays small. The Engine mounts this element:
//   view="settings" — in Chat Settings for a chat that added the Mari Kit agent
//   view="surface"  — inside that chat's Roleplay/Conversation view (no visible box of its own)
// Requests go through the Engine's own api client and TTS service, exposed on globalThis.__MARINARA_HOST__.
//
// The client is one file because the Engine loads only this entry. Pure helpers are exported so
// custom-modules/scripts/check.mjs can test them in Node.
// ──────────────────────────────────────────────

const PACKAGE_ID = "mari-kit";
const TAG = `marinara-capability-${PACKAGE_ID}`;

// ── Voice markup ────────────────────────────────

/** Same opening-tag shape the display rule turns into <span class="mk-line …">, so lines and spans pair up by order. */
const OPEN_TAG_SOURCE = String.raw`<audio_(character|persona)\s+id="([A-Za-z0-9_-]{1,200})">`;

/** Display-only regex scripts (Engine feature). Stored messages keep their markup; only the screen changes. */
export const DISPLAY_RULES = Object.freeze([
  {
    name: "Mari Kit: voice line open (display)",
    findRegex: OPEN_TAG_SOURCE,
    replaceString: '<span class="mk-line mk-$1-$2">',
    flags: "gi",
  },
  {
    name: "Mari Kit: voice line close (display)",
    findRegex: String.raw`</audio_(?:character|persona)\s*>`,
    replaceString: "</span>",
    flags: "gi",
  },
  {
    // Only the cue right at the start of a voiced line, so brackets elsewhere in any chat stay visible.
    name: "Mari Kit: voice cue (display)",
    findRegex: String.raw`(<span class="mk-line[^"]{0,260}">["“]?)\[[a-z][a-z ,.'-]{0,78}\] ?`,
    replaceString: "$1",
    flags: "gi",
  },
  {
    // ElevenLabs audio tags anywhere in a reply ([sighs] … [short pause]): read aloud, not shown. Lowercase
    // English only, so bracketed text the story itself writes stays visible.
    name: "Mari Kit: voice tags (display)",
    findRegex: String.raw`\[[a-z][a-z ,.'-]{0,40}\] ?`,
    replaceString: "",
    flags: "g",
  },
]);

function stripSpeechMarkdown(text) {
  return text
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/__([\s\S]*?)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Voiced lines in a stored message, in the order the screen shows them.
 * Each line: { kind: "character"|"persona", id, cue, text } — `text` is what is read aloud, without the cue.
 */
export function parseVoiceLines(content) {
  if (typeof content !== "string" || !content) return [];
  const open = new RegExp(OPEN_TAG_SOURCE, "gi");
  const lines = [];
  for (const match of content.matchAll(open)) {
    const kind = match[1].toLowerCase();
    const start = match.index + match[0].length;
    const close = content.slice(start).search(new RegExp(String.raw`</audio_${kind}\s*>`, "i"));
    const nextOpen = content.slice(start).search(/<audio_(?:character|persona)\s/i);
    const ends = [close, nextOpen].filter((at) => at >= 0);
    const body = content.slice(start, ends.length ? start + Math.min(...ends) : content.length);
    const cueMatch = /^\s*["“]?\s*\[([^\]\n]{1,80})\]\s*/.exec(body);
    const cue = cueMatch ? cueMatch[1].trim() : "";
    const spoken = cueMatch ? body.slice(cueMatch[0].length) : body;
    const text = stripSpeechMarkdown(spoken)
      .replace(/^["“”]+|["“”]+$/g, "")
      .trim();
    lines.push({ kind, id: match[2], cue, text });
  }
  return lines;
}

// ── Pronunciation ───────────────────────────────

const LATIN = /[A-Za-z0-9]/;

/**
 * Replacement pairs from each speaker's phonetic name: the whole name, and — when the written name and the
 * phonetic name have the same number of words — each word on its own, so "테루노리" alone still becomes
 * "terunori" when "쿠가 테루노리" is pronounced "kuga terunori". Longer names win.
 */
export function buildPronunciations(participants) {
  const pairs = new Map();
  const add = (from, to) => {
    const key = from.trim();
    const value = to.trim();
    if (key.length < 2 || !value || key === value || pairs.has(key)) return;
    pairs.set(key, value);
  };
  for (const { name, phoneticName } of participants ?? []) {
    if (typeof name !== "string" || typeof phoneticName !== "string" || !phoneticName.trim()) continue;
    add(name, phoneticName);
    const nameParts = name.trim().split(/\s+/);
    const spokenParts = phoneticName.trim().split(/\s+/);
    if (nameParts.length > 1 && nameParts.length === spokenParts.length) {
      nameParts.forEach((part, index) => add(part, spokenParts[index]));
    }
  }
  return [...pairs].map(([from, to]) => ({ from, to })).sort((a, b) => b.from.length - a.from.length);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Latin names keep word edges ("IV" is not replaced inside "IVY"); other scripts match where they appear,
 *  so Korean particles after a name ("테루노리가") still match. */
export function applyPronunciations(text, pronunciations) {
  if (!text || !pronunciations?.length) return text;
  const pattern = new RegExp(
    pronunciations
      .map(({ from }) => {
        const start = LATIN.test(from[0]) ? "(?<![A-Za-z0-9])" : "";
        const end = LATIN.test(from[from.length - 1]) ? "(?![A-Za-z0-9])" : "";
        return `${start}${escapeRegex(from)}${end}`;
      })
      .join("|"),
    "gu",
  );
  return text.replace(pattern, (found) => pronunciations.find((entry) => entry.from === found)?.to ?? found);
}

// ── Voice choice ────────────────────────────────

/** The speaker's own voice row when voices are per character, else the default voice. */
export function pickVoice(config, speakerId) {
  const fallback = typeof config?.voice === "string" ? config.voice : "";
  if (config?.voiceMode !== "per-character" || !speakerId) return fallback;
  const rows = Array.isArray(config.voiceAssignments) ? config.voiceAssignments : [];
  const own = rows.find((row) => row?.characterId === speakerId && typeof row.voice === "string" && row.voice.trim());
  return own ? own.voice.trim() : fallback;
}

function hashText(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// ── Glossary text ───────────────────────────────

/** One entry per line: "원문 = 번역" with an optional "# 메모". */
export function parseGlossaryText(text) {
  const entries = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [pair, ...noteParts] = line.split(" # ");
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    const source = pair.slice(0, at).trim();
    const target = pair.slice(at + 1).trim();
    if (source && target) entries.push({ source, target, notes: noteParts.join(" # ").trim() });
  }
  return entries;
}

export function formatGlossaryText(entries) {
  return (entries ?? []).map((e) => `${e.source} = ${e.target}${e.notes ? ` # ${e.notes}` : ""}`).join("\n");
}

/** Adds proposed entries whose source is not in the text yet; existing lines are kept as written. */
export function mergeGlossaryText(text, proposed) {
  const known = new Set(parseGlossaryText(text).map((e) => e.source));
  const added = (proposed ?? []).filter((e) => !known.has(e.source));
  return {
    text: [String(text ?? "").trim(), formatGlossaryText(added)].filter(Boolean).join("\n"),
    added: added.length,
  };
}

// ── Browser-only part ───────────────────────────

const STRINGS = {
  ko: {
    title: "Mari Kit 기능",
    hint: "켠 기능만 이 채팅의 프롬프트와 화면에 쓰입니다.",
    none: "아직 설치된 기능이 없습니다.",
    loading: "불러오는 중…",
    saveFailed: "저장하지 못했습니다",
    loadFailed: "설정을 불러오지 못했습니다",
    features: {
      tts: "TTS (지침·대사별 재생·발음)",
      translation: "번역 (프리셋·단어장·말투)",
      weather: "Convo 날씨",
      memory: "기억",
    },
    rulesReady: "화면 표시 규칙 설치됨 (정규식 스크립트 4개)",
    rulesFailed: "화면 표시 규칙을 설치하지 못했습니다",
    play: "이 대사 듣기",
    stop: "멈추기",
    ttsOff: "음성(TTS)이 꺼져 있습니다. 설정 → 연결 → 음성에서 켜 주세요.",
    noVoice: "보이스를 먼저 고르세요.",
    lineMissing: "이 대사를 원문에서 찾지 못했습니다.",
    playFailed: "재생하지 못했습니다",
    tr: {
      title: "번역",
      notAi:
        "이 채팅의 번역 공급자가 AI가 아닙니다. 프리셋·단어장·말투는 채팅 설정 → 번역의 공급자가 AI일 때만 쓰입니다.",
      incoming: "응답 번역 프리셋",
      outgoing: "입력 번역 프리셋",
      glossary: "단어장 (한 줄에 하나: 원문 = 번역 # 메모)",
      speech: "말투 (응답 번역에만 들어감)",
      world: "세계관",
      scanGlossary: "단어장 자동 수집",
      scanSpeech: "말투 자동 정리",
      scanWorld: "세계관 정리",
      scanCost: "누를 때마다 번역 연결로 AI 요청 1번. 결과는 칸에 채워지고, 저장해야 적용됩니다.",
      apply: "저장하고 적용",
      restore: "원래대로",
      applied: "적용됨: 채팅의 번역 지시문을 Mari Kit가 씁니다.",
      notApplied: "아직 적용하지 않았습니다.",
      edited: "채팅 설정에서 번역 지시문을 직접 고쳤습니다. 다시 적용하면 고친 지시문을 바탕으로 씁니다.",
      length: (label, n, max) => `${label} ${n.toLocaleString()} / ${max.toLocaleString()}자`,
      dropped: (r) =>
        [
          r.droppedWorld && "세계관을 뺐습니다",
          r.droppedGlossary && `단어장 ${r.droppedGlossary}개를 뺐습니다(아래쪽부터)`,
          r.shortenedVoice && "말투를 줄였습니다",
        ]
          .filter(Boolean)
          .join(", "),
      scanned: (n) => `${n}개를 추가했습니다. 확인하고 저장하세요.`,
      scannedText: "결과를 채웠습니다. 확인하고 저장하세요.",
      working: "처리 중…",
    },
    wx: {
      title: "Convo 날씨",
      onlyConvo: "날씨는 Convo 채팅에만 들어갑니다.",
      mine: "내 지역 (모든 방 공통)",
      character: "캐릭터 지역 (선택, 이 방만)",
      enable: "이 방에 날씨 넣기",
      search: "지역 검색",
      worldwide: "해외 포함",
      find: "찾기",
      clear: "지우기",
      none: "선택 안 함",
      noResults: "검색 결과가 없습니다.",
      privacy: "모델에는 날씨와 기온만 보냅니다. 지역 이름·좌표는 보내지 않습니다. AI 요청 없음.",
      source: "날씨: Open-Meteo (CC BY 4.0)",
      needMine: "내 지역을 먼저 고르세요.",
      chat: "Convo 채팅",
      pickChat: "채팅을 고르세요",
      noChats: "Convo 채팅이 없습니다.",
    },
    homeNote: "TTS·번역·기억은 RP 채팅의 채팅 설정 → 에이전트 → Mari Kit에서 그 채팅에 맞게 설정합니다.",
    mem: {
      title: "기억",
      model: "정리에 쓸 연결",
      chatModel: "이 채팅의 연결",
      organize: "정리하기",
      organizeRest: "남은 메시지까지 정리",
      undo: "마지막 정리 되돌리기",
      preview: "다음 턴에 들어갈 기억 보기",
      reset: "기억 지우기",
      resetConfirm: "이 채팅의 기억을 모두 지울까요? (한 번은 되돌릴 수 있습니다)",
      cost: "정리는 누를 때만 합니다. 묶음 하나에 AI 요청 1번(형식 오류 시 1번 더, 장면이 많이 쌓이면 장 요약 1번). 답장할 때는 AI 요청이 없습니다.",
      status: (s) =>
        [
          `정리된 메시지 ${s.organizedMessages}개 · 대기 ${s.waitingMessages}개 (최근 ${s.keepRecent}개는 바뀔 수 있어 정리하지 않음)`,
          `장면 ${s.counts.scenes} · 장 ${s.counts.chapters} · 대상 ${s.counts.entities} · 사실 ${s.counts.facts} · 끝나지 않은 일 ${s.counts.openThreads}`,
          s.changedChunks ? `원문이 바뀐 묶음 ${s.changedChunks}개 (기억은 그대로입니다)` : "",
          s.counts.sameNameToReview ? `같은 이름의 새 대상 ${s.counts.sameNameToReview}개 (자동으로 합치지 않음)` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      done: (n, calls) => `${n}묶음 정리 · AI 요청 ${calls}번`,
      nothing: "정리할 묶음이 아직 없습니다.",
      tokens: (n, max) => `약 ${n.toLocaleString()} / ${max.toLocaleString()} 토큰`,
      empty: "아직 넣을 기억이 없습니다.",
    },
  },
  en: {
    title: "Mari Kit features",
    hint: "Only features you turn on are used in this chat's prompt and screen.",
    none: "No features are available yet.",
    loading: "Loading…",
    saveFailed: "Could not save",
    loadFailed: "Could not load settings",
    features: {
      tts: "TTS (cues, per-line playback, pronunciation)",
      translation: "Translation (presets, glossary, voice)",
      weather: "Convo weather",
      memory: "Memory",
    },
    rulesReady: "Display rules installed (4 regex scripts)",
    rulesFailed: "Could not install the display rules",
    play: "Play this line",
    stop: "Stop",
    ttsOff: "Text to speech is off. Turn it on in Settings → Connections → Voice.",
    noVoice: "Choose a voice first.",
    lineMissing: "This line was not found in the message.",
    playFailed: "Could not play",
    tr: {
      title: "Translation",
      notAi:
        "This chat's translation provider is not AI. Presets, glossary and voice notes apply only when Chat Settings → Translation uses AI.",
      incoming: "Response preset",
      outgoing: "Draft preset",
      glossary: "Glossary (one per line: source = translation # note)",
      speech: "Voice notes (response translation only)",
      world: "World notes",
      scanGlossary: "Collect glossary",
      scanSpeech: "Write voice notes",
      scanWorld: "Write world notes",
      scanCost: "Each press makes 1 AI request with the translation connection. Results fill the box; save to apply.",
      apply: "Save and apply",
      restore: "Restore",
      applied: "Applied: Mari Kit writes this chat's translation prompts.",
      notApplied: "Not applied yet.",
      edited: "The translation prompt was edited in Chat Settings. Applying again builds on the edited prompt.",
      length: (label, n, max) => `${label} ${n.toLocaleString()} / ${max.toLocaleString()} chars`,
      dropped: (r) =>
        [
          r.droppedWorld && "world notes left out",
          r.droppedGlossary && `${r.droppedGlossary} glossary entries left out (from the bottom)`,
          r.shortenedVoice && "voice notes shortened",
        ]
          .filter(Boolean)
          .join(", "),
      scanned: (n) => `Added ${n}. Review and save.`,
      scannedText: "Filled in. Review and save.",
      working: "Working…",
    },
    wx: {
      title: "Convo weather",
      onlyConvo: "Weather is added to Conversation chats only.",
      mine: "My place (all chats)",
      character: "Character's place (optional, this chat)",
      enable: "Add weather to this chat",
      search: "Search places",
      worldwide: "Worldwide",
      find: "Find",
      clear: "Clear",
      none: "Not set",
      noResults: "No places found.",
      privacy: "The model gets only the weather and temperature, never the place name or coordinates. No AI request.",
      source: "Weather: Open-Meteo (CC BY 4.0)",
      needMine: "Choose your place first.",
      chat: "Conversation chat",
      pickChat: "Choose a chat",
      noChats: "No Conversation chats yet.",
    },
    homeNote: "TTS, translation and memory are set per chat in a Roleplay chat: Chat Settings → Agents → Mari Kit.",
    mem: {
      title: "Memory",
      model: "Connection for organizing",
      chatModel: "This chat's connection",
      organize: "Organize",
      organizeRest: "Organize remaining messages too",
      undo: "Undo last organize",
      preview: "Show next turn's memory",
      reset: "Clear memory",
      resetConfirm: "Clear this chat's memory? (You can undo once.)",
      cost: "Organizing happens only when you press it: 1 AI request per chunk (1 more if the reply was malformed, 1 for a chapter summary when many scenes pile up). Replies make no AI request.",
      status: (s) =>
        [
          `${s.organizedMessages} messages organized · ${s.waitingMessages} waiting (the newest ${s.keepRecent} may still change and are left alone)`,
          `${s.counts.scenes} scenes · ${s.counts.chapters} chapters · ${s.counts.entities} entities · ${s.counts.facts} facts · ${s.counts.openThreads} open threads`,
          s.changedChunks ? `${s.changedChunks} chunks whose source changed (memory unchanged)` : "",
          s.counts.sameNameToReview ? `${s.counts.sameNameToReview} new entities share a name (not merged)` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      done: (n, calls) => `Organized ${n} chunk(s) · ${calls} AI request(s)`,
      nothing: "No chunk to organize yet.",
      tokens: (n, max) => `about ${n.toLocaleString()} / ${max.toLocaleString()} tokens`,
      empty: "No memory to add yet.",
    },
  },
};

function strings(props) {
  const locale = props?.localization?.locale ?? globalThis.document?.documentElement?.lang ?? "en";
  return String(locale).toLowerCase().startsWith("ko") ? STRINGS.ko : STRINGS.en;
}

function host() {
  const value = globalThis.__MARINARA_HOST__;
  if (!value?.api?.api) throw new Error("Marinara host api is unavailable");
  return value;
}

const apiClient = () => host().api.api;
const ttsService = () => host().services?.tts?.ttsService ?? null;

function notify(message, kind = "error") {
  const toast = host().modules?.sonner?.toast;
  if (typeof toast?.[kind] === "function") toast[kind](message);
  else if (typeof toast === "function") toast(message);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "style") node.style.cssText = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

/** Adds any missing display rule. Existing rules (even ones the user edited or turned off) are left alone. */
async function ensureDisplayRules() {
  const api = apiClient();
  const existing = await api.get("/regex-scripts");
  const names = new Set((Array.isArray(existing) ? existing : []).map((row) => row?.name));
  let added = 0;
  for (const rule of DISPLAY_RULES) {
    if (names.has(rule.name)) continue;
    await api.post("/regex-scripts", { ...rule, placement: ["ai_output"], applyMode: "display" });
    added += 1;
  }
  // The Engine caches its regex list under this key; refresh it so open messages redraw with the new rules.
  if (added) await host().queryClient?.invalidateQueries?.({ queryKey: ["regex-scripts"] });
}

const SETTINGS_EVENT = "mari-kit:settings-changed";
const STYLE_ID = "mari-kit-style";
const STYLE = `
.mk-play{display:inline-flex;align-items:center;justify-content:center;width:1.25rem;height:1.25rem;margin:0 .15rem;
  padding:0;border:0;border-radius:999px;background:transparent;color:inherit;opacity:.55;cursor:pointer;
  vertical-align:middle;font-size:11px;line-height:1}
.mk-play:hover,.mk-play:focus-visible{opacity:1;background:color-mix(in srgb,currentColor 12%,transparent)}
.mk-play[data-state="loading"]{opacity:1;animation:mk-pulse 1s ease-in-out infinite}
.mk-play[data-state="playing"]{opacity:1}
@keyframes mk-pulse{50%{opacity:.35}}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  document.head.append(el("style", { id: STYLE_ID, textContent: STYLE }));
}

/** Finds voiced lines on screen and gives each a play button. One instance per mounted chat view. */
// ── Start screen ────────────────────────────────
// The Mari shell is the start screen: opening the Engine's own address lands there. A tab the shell's "엔진 화면" link
// opened stays on the Engine (sessionStorage), and choosing the Engine as start screen in the shell turns this off.

export const SHELL_PATH = "/api/mari-kit/app";
export const START_KEY = "mari-kit:start";
export const ENGINE_TAB_KEY = "mari-kit:engine-tab";

/** Should this page load go to the shell? Only the Engine's root page, and only when nothing asked for the Engine. */
export function shouldOpenShell(path, start, engineTab) {
  return path === "/" && start !== "engine" && engineTab !== "1";
}

function openShellOnStart() {
  try {
    if (shouldOpenShell(location.pathname, localStorage.getItem(START_KEY), sessionStorage.getItem(ENGINE_TAB_KEY))) {
      // The shell tells this visitor once that its own home-screen icon skips the Engine's app (much lighter).
      sessionStorage.setItem("mari-kit:via-engine", "1");
      location.replace(SHELL_PATH);
    }
  } catch {
    // Storage can be blocked; the Engine screen then simply stays.
  }
}

// ── Opened from the shell ───────────────────────
// The shell sends a visitor here for what it does not draw itself: a chat's settings section, or the character,
// preset or lorebook editor. It leaves the target in sessionStorage; this opens it through the Engine's own
// package API and shows one pill back to the shell screen the visitor came from.

export const OPEN_KEY = "mari-kit:open";

function waitFor(test, timeout = 10000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      let value = null;
      try {
        value = test();
      } catch {}
      if (value) return resolve(value);
      if (Date.now() - started > timeout) return resolve(null);
      setTimeout(tick, 120);
    };
    tick();
  });
}

function backPill(back) {
  const pill = document.createElement("a");
  pill.href = `${SHELL_PATH}${back && back.startsWith("#/") ? back : "#/home"}`;
  pill.textContent = "‹ Mari로";
  pill.setAttribute("aria-label", "Mari 화면으로 돌아가기");
  // The Engine sends no referrer, so the shell learns this way that it is a return, not a fresh start.
  pill.addEventListener("click", () => {
    try {
      sessionStorage.setItem("mari-kit:returning", "1");
    } catch {}
  });
  pill.style.cssText =
    "position:fixed;z-index:2147483000;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 8px);" +
    "padding:8px 16px;border-radius:999px;background:#1c1c1e;color:#fff;font:600 13px/1.2 system-ui,sans-serif;" +
    "text-decoration:none;box-shadow:0 2px 10px rgba(0,0,0,.25)";
  document.body.append(pill);
}

async function openFromShell() {
  let target = null;
  try {
    target = JSON.parse(sessionStorage.getItem(OPEN_KEY) || "null");
    sessionStorage.removeItem(OPEN_KEY);
  } catch {}
  if (!target || typeof target !== "object") return;
  backPill(target.back);
  const host = await waitFor(() => globalThis.__MARINARA_HOST__);
  if (!host) return;
  const ui = host.stores.ui.getState;
  const chat = host.stores.chat.getState;
  if (target.chatId) {
    if (chat().activeChatId !== target.chatId) chat().setActiveChatId?.(target.chatId);
    await waitFor(() => chat().activeChatId === target.chatId);
  }
  // On a phone the Engine starts with its chat list drawn over everything; the visitor came for one thing.
  ui().setSidebarOpen?.(false);
  if (Array.isArray(target.section) && target.section.length) {
    chat().setShouldOpenSettings(true);
    const el = await waitFor(() =>
      target.section
        .map((id) => document.querySelector(`[data-chat-settings-section="${CSS.escape(id)}"]`))
        .find(Boolean),
    );
    if (!el) return;
    const toggle = el.querySelector('[aria-expanded="false"]');
    if (toggle) toggle.click();
    setTimeout(() => el.scrollIntoView({ block: "start", behavior: "smooth" }), 150);
  } else if (target.character)
    ui().openCharacterDetail(target.character, target.tab ? { initialTab: target.tab } : undefined);
  else if (target.preset) ui().openPresetDetail(target.preset, target.tab ? { initialTab: target.tab } : undefined);
  else if (target.lorebook) ui().openLorebookDetail(target.lorebook);
  else if (target.connection) ui().openConnectionDetail(target.connection);
  else if (target.settings) {
    ui().openRightPanel("settings");
    if (target.tab) ui().setSettingsTab(target.tab);
    ui().setSettingsTargetSectionId?.(target.settings);
  } else if (target.panel) ui().openRightPanel(target.panel);
}

class LinePlayer {
  constructor(element) {
    this.element = element;
    this.observer = null;
    this.scheduled = false;
    this.participants = [];
    this.unsubscribe = null;
  }

  get chatId() {
    return this.element.capabilityProps?.chatId ?? null;
  }

  async start() {
    ensureStyle();
    try {
      const settings = await apiClient().get(`/${PACKAGE_ID}/settings`);
      if (!settings?.features?.tts || !this.element.isConnected) return;
      // 음성 설정: 대사 옆 버튼 or tap-the-line, and whether the voice reads cues inline (ElevenLabs tags).
      this.voice = await apiClient()
        .get(`/${PACKAGE_ID}/tts/settings`)
        .catch(() => null);
      if (this.chatId) {
        const result = await apiClient().get(`/${PACKAGE_ID}/tts/participants/${encodeURIComponent(this.chatId)}`);
        this.participants = Array.isArray(result?.participants) ? result.participants : [];
      }
    } catch (error) {
      console.warn("[mari-kit] TTS setup failed", error);
      return;
    }
    if (!this.element.isConnected) return;
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(document.body, { childList: true, subtree: true });
    const service = ttsService();
    if (service) this.unsubscribe = service.subscribe((state, activeId) => this.paint(state, activeId));
    this.schedule();
  }

  stop() {
    this.observer?.disconnect();
    this.observer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const button of document.querySelectorAll("button.mk-play")) button.remove();
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.decorate();
    });
  }

  decorate() {
    for (const message of document.querySelectorAll("[data-message-id]")) {
      const spans = message.querySelectorAll("span.mk-line");
      spans.forEach((span, index) => {
        if (span.nextElementSibling?.classList?.contains("mk-play")) return;
        const t = strings(this.element.capabilityProps);
        const button = el("button", {
          type: "button",
          className: "mk-play",
          textContent: "▶",
          title: t.play,
          ariaLabel: t.play,
        });
        button.dataset.messageId = message.getAttribute("data-message-id");
        button.dataset.lineIndex = String(index);
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void this.play(button);
        });
        span.after(button);
        if (this.voice?.lineButtons === false) {
          // No visible button: the line itself plays.
          button.style.display = "none";
          span.style.cursor = "pointer";
          span.addEventListener("click", () => button.click());
        }
      });
    }
    const service = ttsService();
    if (service) this.paint(service.getState(), service.getActiveId());
  }

  paint(state, activeId) {
    const t = strings(this.element.capabilityProps);
    for (const button of document.querySelectorAll("button.mk-play")) {
      const active = activeId && activeId === this.playId(button);
      const buttonState = active && (state === "loading" || state === "playing") ? state : "idle";
      if (button.dataset.state === buttonState) continue;
      button.dataset.state = buttonState;
      button.textContent = buttonState === "playing" ? "■" : "▶";
      button.title = buttonState === "idle" ? t.play : t.stop;
      button.ariaLabel = button.title;
    }
  }

  playId(button) {
    return `mari-kit:${button.dataset.messageId}:${button.dataset.lineIndex}`;
  }

  async findMessage(messageId) {
    const api = apiClient();
    const chatId = encodeURIComponent(this.chatId);
    const recent = await api.get(`/chats/${chatId}/messages?limit=200`);
    const found = (Array.isArray(recent) ? recent : []).find((message) => message?.id === messageId);
    if (found) return found;
    const all = await api.get(`/chats/${chatId}/messages`);
    return (Array.isArray(all) ? all : []).find((message) => message?.id === messageId) ?? null;
  }

  async play(button) {
    const t = strings(this.element.capabilityProps);
    const service = ttsService();
    if (!service || !this.chatId) return;
    const id = this.playId(button);
    if (service.getActiveId() === id && ["loading", "playing"].includes(service.getState())) {
      service.stop();
      return;
    }
    try {
      const config = await apiClient().get("/tts/config");
      if (!config?.enabled) {
        notify(t.ttsOff);
        return;
      }
      const message = await this.findMessage(button.dataset.messageId);
      const line = parseVoiceLines(message?.content)[Number(button.dataset.lineIndex)];
      if (!line?.text) {
        notify(t.lineMissing);
        return;
      }
      const voice = pickVoice(config, line.id);
      if (!voice && config.source === "elevenlabs") {
        notify(t.noVoice);
        return;
      }
      const speaker = this.participants.find((p) => p.id === line.id)?.name;
      const spoken = applyPronunciations(line.text, buildPronunciations(this.participants));
      const inlineCue = this.voice?.cueResolved === "tags" && line.cue;
      await service.speak(inlineCue ? `[${line.cue}] ${spoken}` : spoken, id, {
        speaker,
        characterId: line.kind === "character" ? line.id : undefined,
        chatId: this.chatId,
        tone: inlineCue ? undefined : line.cue || undefined,
        voice: voice || undefined,
        cacheKey: `mari-kit:${hashText([spoken, line.cue, voice, config.source, config.model].join("\u0001"))}`,
        throwOnError: true,
      });
    } catch (error) {
      notify(`${t.playFailed}: ${error?.message ?? error}`);
    }
  }
}

const FIELD =
  "width:100%;box-sizing:border-box;padding:6px;border-radius:6px;border:1px solid var(--border);background:var(--background);color:var(--foreground);font:inherit";
const BUTTON =
  "padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:transparent;color:inherit;cursor:pointer;font:inherit";

/** Translation notes for one chat. Owns its DOM so typing survives the host re-rendering the settings box. */
class TranslationPanel {
  constructor(element) {
    this.element = element;
    this.chatId = null;
    this.presets = [];
    this.data = null;
    this.busy = false;
    this.message = null;
    this.error = null;
    this.node = el("div", { style: "display:flex;flex-direction:column;gap:6px;margin-top:6px" });
    this.fields = null;
  }

  t() {
    return strings(this.element.capabilityProps).tr;
  }

  async load(chatId) {
    if (!chatId || this.chatId === chatId) return;
    this.chatId = chatId;
    this.fields = null;
    try {
      const api = apiClient();
      const [presets, data] = await Promise.all([
        api.get(`/${PACKAGE_ID}/translation/presets`),
        api.get(`/${PACKAGE_ID}/translation/${encodeURIComponent(chatId)}`),
      ]);
      this.presets = presets?.presets ?? [];
      this.data = data;
      this.error = null;
    } catch (error) {
      this.error = String(error?.message ?? error);
    }
    this.render();
  }

  values() {
    const f = this.fields;
    return {
      incomingPresetId: f.incoming.value,
      outgoingPresetId: f.outgoing.value,
      glossary: parseGlossaryText(f.glossary.value),
      speech: f.speech.value,
      world: f.world.value,
    };
  }

  async run(task) {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.message = this.t().working;
    this.paintStatus();
    try {
      await task();
    } catch (error) {
      this.error = String(error?.message ?? error);
      this.message = null;
    }
    this.busy = false;
    this.paintStatus();
  }

  async save() {
    await this.run(async () => {
      this.data = await apiClient().put(`/${PACKAGE_ID}/translation/${encodeURIComponent(this.chatId)}`, this.values());
      this.message = null;
      await host().queryClient?.invalidateQueries?.({ queryKey: ["chats"] });
    });
  }

  async restore() {
    await this.run(async () => {
      this.data = await apiClient().post(`/${PACKAGE_ID}/translation/${encodeURIComponent(this.chatId)}/restore`, {});
      this.message = null;
      await host().queryClient?.invalidateQueries?.({ queryKey: ["chats"] });
    });
  }

  async scan(kind) {
    await this.run(async () => {
      const result = await apiClient().post(`/${PACKAGE_ID}/translation/${encodeURIComponent(this.chatId)}/scan`, {
        kind,
        ...(this.element.capabilityProps?.debugMode === true ? { debugMode: true } : {}),
      });
      const t = this.t();
      if (kind === "glossary") {
        const merged = mergeGlossaryText(this.fields.glossary.value, result.glossary);
        this.fields.glossary.value = merged.text;
        this.message = t.scanned(merged.added);
      } else {
        this.fields[kind].value = result.text ?? "";
        this.message = t.scannedText;
      }
    });
  }

  paintStatus() {
    if (!this.fields) return;
    const t = this.t();
    const status = this.data?.status;
    const lines = [];
    if (status) {
      if (status.provider !== "ai") lines.push(t.notAi);
      lines.push(status.applied ? t.applied : t.notApplied);
      if (status.editedSinceApply) lines.push(t.edited);
      lines.push(
        `${t.length(t.incoming, status.incoming.length, status.limit)} · ${t.length(t.outgoing, status.outgoing.length, status.limit)}`,
      );
      const dropped = [t.dropped(status.incoming), t.dropped(status.outgoing)].filter(Boolean);
      if (dropped.length) lines.push(dropped[0]);
    }
    if (this.message) lines.push(this.message);
    this.fields.status.textContent = lines.join("\n");
    this.fields.error.textContent = this.error ?? "";
    for (const button of this.node.querySelectorAll("button")) button.disabled = this.busy;
  }

  render() {
    const t = this.t();
    if (!this.data) {
      this.node.replaceChildren(
        el("span", { textContent: this.error ?? strings(this.element.capabilityProps).loading }),
      );
      return this.node;
    }
    if (this.fields) return this.node;
    const room = this.data.room;
    const select = (value) => {
      const node = el("select", { style: FIELD });
      for (const preset of this.presets) node.append(el("option", { value: preset.id, textContent: preset.name }));
      node.value = value;
      return node;
    };
    const area = (value, rows) => el("textarea", { value: value ?? "", rows, style: FIELD });
    const button = (label, action) => {
      const node = el("button", { type: "button", textContent: label, style: BUTTON });
      node.addEventListener("click", action);
      return node;
    };
    const label = (text, control) =>
      el("label", { style: "display:flex;flex-direction:column;gap:3px" }, [
        el("span", { textContent: text }),
        control,
      ]);
    this.fields = {
      incoming: select(room.incomingPresetId),
      outgoing: select(room.outgoingPresetId),
      glossary: area(formatGlossaryText(room.glossary), 5),
      speech: area(room.speech, 5),
      world: area(room.world, 3),
      status: el("span", { role: "status", style: "white-space:pre-line;opacity:.8" }),
      error: el("span", { role: "alert", style: "color:var(--destructive)" }),
    };
    for (const [key, name] of [
      ["glossary", "glossary"],
      ["speech", "speech"],
      ["world", "world"],
    ]) {
      this.fields[key].dataset.translationField = name;
    }
    const row = (...children) => el("div", { style: "display:flex;flex-wrap:wrap;gap:6px" }, children);
    this.node.replaceChildren(
      el("strong", { textContent: t.title }),
      label(t.incoming, this.fields.incoming),
      label(t.outgoing, this.fields.outgoing),
      label(t.glossary, this.fields.glossary),
      label(t.speech, this.fields.speech),
      label(t.world, this.fields.world),
      row(
        button(t.scanGlossary, () => void this.scan("glossary")),
        button(t.scanSpeech, () => void this.scan("speech")),
        button(t.scanWorld, () => void this.scan("world")),
      ),
      el("span", { textContent: t.scanCost, style: "opacity:.7" }),
      row(
        button(t.apply, () => void this.save()),
        button(t.restore, () => void this.restore()),
      ),
      this.fields.status,
      this.fields.error,
    );
    this.paintStatus();
    return this.node;
  }
}

/** Weather places for one chat. Owns its DOM like the translation panel. */
class WeatherPanel {
  constructor(element) {
    this.element = element;
    this.chatId = null;
    this.data = null;
    this.error = null;
    this.busy = false;
    this.node = el("div", { style: "display:flex;flex-direction:column;gap:6px;margin-top:6px" });
  }

  t() {
    return strings(this.element.capabilityProps).wx;
  }

  async load(chatId) {
    if (!chatId || this.chatId === chatId) return;
    this.chatId = chatId;
    await this.run(() => apiClient().get(`/${PACKAGE_ID}/weather/${encodeURIComponent(chatId)}`));
  }

  async run(task) {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      const result = await task();
      if (result && "room" in result) this.data = result;
    } catch (error) {
      this.error = String(error?.message ?? error);
    }
    this.busy = false;
    this.paint();
    const loaded = this.onLoaded;
    this.onLoaded = null;
    loaded?.();
  }

  setMine(location) {
    return this.run(async () => {
      await apiClient().put(`/${PACKAGE_ID}/weather/user`, { location });
      return apiClient().get(`/${PACKAGE_ID}/weather/${encodeURIComponent(this.chatId)}`);
    });
  }

  setRoom(patch) {
    return this.run(() => apiClient().put(`/${PACKAGE_ID}/weather/${encodeURIComponent(this.chatId)}`, patch));
  }

  picker(label, current, onPick, testId) {
    const t = this.t();
    const query = el("input", { type: "search", placeholder: t.search, style: FIELD });
    const worldwide = el("input", { type: "checkbox" });
    const results = el("div", { style: "display:flex;flex-wrap:wrap;gap:4px" });
    const find = el("button", { type: "button", textContent: t.find, style: BUTTON });
    const clear = el("button", { type: "button", textContent: t.clear, style: BUTTON });
    query.dataset.weatherSearch = testId;
    find.addEventListener("click", async () => {
      results.replaceChildren(el("span", { textContent: "…" }));
      try {
        const q = encodeURIComponent(query.value.trim());
        const { places } = await apiClient().get(
          `/${PACKAGE_ID}/weather/places?q=${q}${worldwide.checked ? "&worldwide=true" : ""}`,
        );
        results.replaceChildren(
          ...(places.length
            ? places.map((place) => {
                const option = el("button", { type: "button", textContent: place.label, style: BUTTON });
                option.addEventListener("click", () => void onPick(place));
                return option;
              })
            : [el("span", { textContent: t.noResults })]),
        );
      } catch (error) {
        results.replaceChildren(
          el("span", { textContent: String(error?.message ?? error), style: "color:var(--destructive)" }),
        );
      }
    });
    clear.addEventListener("click", () => void onPick(null));
    return el("div", { style: "display:flex;flex-direction:column;gap:4px" }, [
      el("span", { textContent: `${label}: ${current?.label ?? t.none}` }),
      el("div", { style: "display:flex;gap:4px;align-items:center" }, [
        query,
        find,
        el("label", { style: "display:flex;gap:3px;align-items:center;white-space:nowrap" }, [
          worldwide,
          el("span", { textContent: t.worldwide }),
        ]),
        clear,
      ]),
      results,
    ]);
  }

  paint() {
    const t = this.t();
    const children = [el("strong", { textContent: t.title })];
    if (this.element.capabilityProps?.chatMode && this.element.capabilityProps.chatMode !== "conversation") {
      children.push(el("span", { textContent: t.onlyConvo, style: "opacity:.8" }));
    }
    if (this.data) {
      const { userLocation, room, summaries } = this.data;
      const enable = el("input", { type: "checkbox", checked: room.enabled, disabled: this.busy || !userLocation });
      enable.dataset.weatherEnable = "true";
      enable.addEventListener("change", () => void this.setRoom({ enabled: enable.checked }));
      children.push(
        this.picker(t.mine, userLocation, (place) => this.setMine(place), "mine"),
        el("label", { style: "display:flex;gap:6px;align-items:center" }, [
          enable,
          el("span", { textContent: t.enable }),
        ]),
        ...(userLocation ? [] : [el("span", { textContent: t.needMine, style: "opacity:.8" })]),
        this.picker(
          t.character,
          room.characterLocation,
          (place) => this.setRoom({ characterLocation: place }),
          "character",
        ),
        ...[summaries.user, summaries.character]
          .filter(Boolean)
          .map((text) => el("span", { textContent: text, style: "white-space:pre-line;opacity:.85" })),
        el("span", { textContent: t.privacy, style: "opacity:.7" }),
        el("span", { textContent: t.source, style: "opacity:.6" }),
      );
    } else if (!this.error) {
      children.push(el("span", { textContent: strings(this.element.capabilityProps).loading }));
    }
    if (this.error)
      children.push(el("span", { textContent: this.error, role: "alert", style: "color:var(--destructive)" }));
    this.node.replaceChildren(...children);
  }

  render() {
    if (!this.node.childElementCount) this.paint();
    return this.node;
  }
}

/** Memory for one Roleplay chat: status, organize, undo, preview. */
class MemoryPanel {
  constructor(element) {
    this.element = element;
    this.chatId = null;
    this.status = null;
    this.connections = [];
    this.busy = false;
    this.message = "";
    this.error = "";
    this.previewText = "";
    this.node = el("div", { style: "display:flex;flex-direction:column;gap:6px;margin-top:6px" });
  }

  t() {
    return strings(this.element.capabilityProps).mem;
  }

  url(path = "") {
    return `/${PACKAGE_ID}/memory/${encodeURIComponent(this.chatId)}${path}`;
  }

  async load(chatId) {
    if (!chatId || this.chatId === chatId) return;
    this.chatId = chatId;
    await this.run(async () => {
      const [state, connections] = await Promise.all([apiClient().get(this.url()), apiClient().get("/connections")]);
      this.connections = (Array.isArray(connections) ? connections : []).map((c) => ({ id: c.id, name: c.name }));
      return state;
    });
  }

  async run(task) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.paint();
    try {
      const result = await task();
      if (result?.status) this.status = result.status;
    } catch (error) {
      this.error = String(error?.message ?? error);
    }
    this.busy = false;
    this.paint();
  }

  organize(force) {
    return this.run(async () => {
      let chunks = 0;
      let calls = 0;
      let last = null;
      // Full chunks one by one; with force, one more for whatever is left.
      for (let i = 0; i < 50; i += 1) {
        const body = this.element.capabilityProps?.debugMode ? { debugMode: true } : {};
        last = await apiClient().post(this.url("/organize"), body);
        calls += last.calls ?? 0;
        if (!last.organized) break;
        chunks += 1;
        this.status = last.status;
        this.message = this.t().done(chunks, calls);
        this.paint();
      }
      if (force) {
        last = await apiClient().post(this.url("/organize"), {
          force: true,
          ...(this.element.capabilityProps?.debugMode ? { debugMode: true } : {}),
        });
        calls += last.calls ?? 0;
        if (last.organized) chunks += 1;
      }
      this.message = chunks ? this.t().done(chunks, calls) : this.t().nothing;
      return last;
    });
  }

  paint() {
    const t = this.t();
    const button = (label, action, testId) => {
      const node = el("button", { type: "button", textContent: label, style: BUTTON, disabled: this.busy });
      node.dataset.memoryAction = testId;
      node.addEventListener("click", action);
      return node;
    };
    const children = [el("strong", { textContent: t.title })];
    if (this.status) {
      const select = el("select", { style: FIELD, disabled: this.busy });
      select.append(el("option", { value: "", textContent: t.chatModel }));
      for (const c of this.connections) select.append(el("option", { value: c.id, textContent: c.name }));
      select.value = this.status.connectionId ?? "";
      select.addEventListener(
        "change",
        () => void this.run(() => apiClient().patch(this.url("/settings"), { connectionId: select.value || null })),
      );
      children.push(
        el("label", { style: "display:flex;flex-direction:column;gap:3px" }, [
          el("span", { textContent: t.model }),
          select,
        ]),
        el("span", { textContent: t.status(this.status), role: "status", style: "white-space:pre-line;opacity:.85" }),
        el("div", { style: "display:flex;flex-wrap:wrap;gap:6px" }, [
          button(t.organize, () => void this.organize(false), "organize"),
          button(t.organizeRest, () => void this.organize(true), "organize-rest"),
          ...(this.status.canUndo
            ? [button(t.undo, () => void this.run(() => apiClient().post(this.url("/undo"), {})), "undo")]
            : []),
          button(
            t.preview,
            () =>
              void this.run(async () => {
                const preview = await apiClient().get(this.url("/preview"));
                this.previewText = preview.text
                  ? `${t.tokens(preview.tokens, preview.budget)}\n\n${preview.text}`
                  : t.empty;
              }),
            "preview",
          ),
          button(
            t.reset,
            () => {
              if (window.confirm(t.resetConfirm))
                void this.run(() => apiClient().post(this.url("/reset"), { confirm: true }));
            },
            "reset",
          ),
        ]),
        el("span", { textContent: t.cost, style: "opacity:.7" }),
      );
    } else if (!this.error) {
      children.push(el("span", { textContent: strings(this.element.capabilityProps).loading }));
    }
    if (this.message) children.push(el("span", { textContent: this.message, style: "opacity:.85" }));
    if (this.previewText) {
      const pre = el("pre", {
        textContent: this.previewText,
        style: "white-space:pre-wrap;max-height:320px;overflow:auto;font-size:11px;opacity:.85;margin:0",
      });
      pre.dataset.memoryPreview = "true";
      children.push(pre);
    }
    if (this.error)
      children.push(el("span", { textContent: this.error, role: "alert", style: "color:var(--destructive)" }));
    this.node.replaceChildren(...children);
  }

  render() {
    if (!this.node.childElementCount) this.paint();
    return this.node;
  }
}

/** Home tab: choose which Conversation chat's weather to edit. */
class WeatherChatPicker {
  constructor(element, weather) {
    this.element = element;
    this.weather = weather;
    this.node = el("div", { style: "display:flex;flex-direction:column;gap:4px" });
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    const t = strings(this.element.capabilityProps).wx;
    try {
      const chats = (await apiClient().get("/chats")).filter((chat) => chat?.mode === "conversation");
      if (!chats.length) {
        this.node.replaceChildren(el("span", { textContent: t.noChats }));
        return;
      }
      const select = el("select", { style: FIELD });
      select.dataset.weatherChat = "true";
      select.append(el("option", { value: "", textContent: t.pickChat }));
      for (const chat of chats) select.append(el("option", { value: chat.id, textContent: chat.name || chat.id }));
      select.addEventListener("change", () => {
        if (select.value) void this.weather.load(select.value);
      });
      this.node.replaceChildren(el("span", { textContent: t.chat }), select);
    } catch (error) {
      this.node.replaceChildren(
        el("span", { textContent: String(error?.message ?? error), style: "color:var(--destructive)" }),
      );
    }
  }
}

function defineElement() {
  class MariKitElement extends HTMLElement {
    static observedAttributes = ["view"];

    constructor() {
      super();
      this.capabilityProps = undefined;
      this.state = { status: null, error: null, saving: false, notice: null };
      this.player = null;
      this.translation = null;
      this.weather = null;
      this.weatherChats = null;
      this.memory = null;
      this.onProps = () => this.render();
      this.onSettings = () => {
        if (this.getAttribute("view") !== "surface") return;
        this.player?.stop();
        this.player = new LinePlayer(this);
        void this.player.start();
      };
    }

    connectedCallback() {
      this.addEventListener("marinara-capability-props", this.onProps);
      window.addEventListener(SETTINGS_EVENT, this.onSettings);
      this.mount();
    }

    disconnectedCallback() {
      this.removeEventListener("marinara-capability-props", this.onProps);
      window.removeEventListener(SETTINGS_EVENT, this.onSettings);
      this.player?.stop();
      this.player = null;
    }

    attributeChangedCallback() {
      if (this.isConnected) this.mount();
    }

    mount() {
      const view = this.getAttribute("view");
      if (view === "surface" && !this.player) {
        this.player = new LinePlayer(this);
        void this.player.start();
      }
      if ((view === "settings" || view === "browser") && !this.state.status && !this.state.error) void this.load();
      this.render();
    }

    async load() {
      try {
        this.state = { ...this.state, status: await apiClient().get(`/${PACKAGE_ID}/status`), error: null };
      } catch (error) {
        this.state = {
          ...this.state,
          error: `${strings(this.capabilityProps).loadFailed}: ${error?.message ?? error}`,
        };
      }
      this.render();
    }

    async toggle(id, value) {
      if (this.state.saving) return;
      const t = strings(this.capabilityProps);
      this.state = { ...this.state, saving: true, error: null, notice: null };
      this.render();
      try {
        if (id === "tts" && value) {
          try {
            await ensureDisplayRules();
            this.state = { ...this.state, notice: t.rulesReady };
          } catch (error) {
            this.state = { ...this.state, error: `${t.rulesFailed}: ${error?.message ?? error}` };
          }
        }
        const settings = await apiClient().patch(`/${PACKAGE_ID}/settings`, { features: { [id]: value } });
        this.state = { ...this.state, status: { ...this.state.status, settings } };
        window.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
      } catch (error) {
        this.state = { ...this.state, error: `${t.saveFailed}: ${error?.message ?? error}` };
      }
      this.state = { ...this.state, saving: false };
      this.render();
    }

    render() {
      const view = this.getAttribute("view");
      if (view !== "settings" && view !== "browser") {
        this.replaceChildren();
        return;
      }
      const home = view === "browser";
      const t = strings(this.capabilityProps);
      const { status, error, saving, notice } = this.state;
      const box = el("div", {
        style: home
          ? "display:flex;flex-direction:column;gap:8px;padding:16px;max-width:640px;margin:0 auto;font-size:13px;color:var(--foreground)"
          : "display:flex;flex-direction:column;gap:6px;padding:8px 10px;font-size:12px;color:var(--foreground)",
      });
      box.append(el("strong", { textContent: t.title }));
      if (home) {
        const open = el("a", {
          href: SHELL_PATH,
          textContent: "Mari 화면 열기",
          style:
            "align-self:flex-start;padding:8px 14px;border:1px solid var(--border);border-radius:8px;color:var(--foreground);text-decoration:none",
        });
        open.addEventListener("click", () => {
          try {
            sessionStorage.removeItem(ENGINE_TAB_KEY);
          } catch {}
        });
        box.append(open);
      }
      box.append(el("span", { textContent: t.hint, style: "opacity:.7" }));
      if (!status && !error) box.append(el("span", { textContent: t.loading }));
      if (status) {
        const implemented = (status.implemented ?? []).filter((id) => id in t.features);
        if (implemented.length === 0) box.append(el("span", { textContent: t.none }));
        for (const id of implemented) {
          const input = el("input", {
            type: "checkbox",
            checked: Boolean(status.settings?.features?.[id]),
            disabled: saving,
          });
          input.dataset.feature = id;
          input.addEventListener("change", () => void this.toggle(id, input.checked));
          box.append(
            el("label", { style: "display:flex;align-items:center;gap:6px;cursor:pointer" }, [
              input,
              el("span", { textContent: t.features[id] }),
            ]),
          );
        }
      }
      if (home) box.append(el("span", { textContent: t.homeNote, style: "opacity:.7" }));
      if (!home && status?.settings?.features?.translation && (status.implemented ?? []).includes("translation")) {
        this.translation ??= new TranslationPanel(this);
        void this.translation.load(this.capabilityProps?.chatId);
        box.append(this.translation.render());
      }
      if (!home && status?.settings?.features?.memory && (status.implemented ?? []).includes("memory")) {
        this.memory ??= new MemoryPanel(this);
        void this.memory.load(this.capabilityProps?.chatId);
        box.append(this.memory.render());
      }
      const weatherOn = status?.settings?.features?.weather && (status.implemented ?? []).includes("weather");
      if (weatherOn && home) {
        this.weather ??= new WeatherPanel(this);
        this.weatherChats ??= new WeatherChatPicker(this, this.weather);
        void this.weatherChats.load();
        box.append(this.weatherChats.node);
        if (this.weather.chatId) box.append(this.weather.render());
        else this.weather.onLoaded = () => this.render();
      } else if (weatherOn && this.capabilityProps?.chatMode === "conversation") {
        this.weather ??= new WeatherPanel(this);
        void this.weather.load(this.capabilityProps?.chatId);
        box.append(this.weather.render());
      }
      if (notice) box.append(el("span", { textContent: notice, role: "status", style: "opacity:.8" }));
      if (error) box.append(el("span", { textContent: error, role: "alert", style: "color:var(--destructive)" }));
      this.replaceChildren(box);
    }
  }
  if (!customElements.get(TAG)) customElements.define(TAG, MariKitElement);
}

if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  defineElement();
  openShellOnStart();
  if (typeof document !== "undefined") void openFromShell();
}
