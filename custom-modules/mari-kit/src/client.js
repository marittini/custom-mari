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
    rulesReady: "화면 표시 규칙 설치됨 (정규식 스크립트 3개)",
    rulesFailed: "화면 표시 규칙을 설치하지 못했습니다",
    play: "이 대사 듣기",
    stop: "멈추기",
    ttsOff: "음성(TTS)이 꺼져 있습니다. 설정 → 연결 → 음성에서 켜 주세요.",
    noVoice: "보이스를 먼저 고르세요.",
    lineMissing: "이 대사를 원문에서 찾지 못했습니다.",
    playFailed: "재생하지 못했습니다",
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
    rulesReady: "Display rules installed (3 regex scripts)",
    rulesFailed: "Could not install the display rules",
    play: "Play this line",
    stop: "Stop",
    ttsOff: "Text to speech is off. Turn it on in Settings → Connections → Voice.",
    noVoice: "Choose a voice first.",
    lineMissing: "This line was not found in the message.",
    playFailed: "Could not play",
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
      await service.speak(spoken, id, {
        speaker,
        characterId: line.kind === "character" ? line.id : undefined,
        chatId: this.chatId,
        tone: line.cue || undefined,
        voice: voice || undefined,
        cacheKey: `mari-kit:${hashText([spoken, line.cue, voice, config.source, config.model].join("\u0001"))}`,
        throwOnError: true,
      });
    } catch (error) {
      notify(`${t.playFailed}: ${error?.message ?? error}`);
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
      if (view === "settings" && !this.state.status && !this.state.error) void this.load();
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
      if (this.getAttribute("view") !== "settings") {
        this.replaceChildren();
        return;
      }
      const t = strings(this.capabilityProps);
      const { status, error, saving, notice } = this.state;
      const box = el("div", {
        style: "display:flex;flex-direction:column;gap:6px;padding:8px 10px;font-size:12px;color:var(--foreground)",
      });
      box.append(el("strong", { textContent: t.title }));
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
      if (notice) box.append(el("span", { textContent: notice, role: "status", style: "opacity:.8" }));
      if (error) box.append(el("span", { textContent: error, role: "alert", style: "color:var(--destructive)" }));
      this.replaceChildren(box);
    }
  }
  if (!customElements.get(TAG)) customElements.define(TAG, MariKitElement);
}

if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") defineElement();
