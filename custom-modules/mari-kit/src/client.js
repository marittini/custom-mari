// ──────────────────────────────────────────────
// Mari Kit — browser entry
//
// Plain DOM (no bundled framework) so the client file stays a few kilobytes. The Engine mounts this element
// in Chat Settings for a chat that added the Mari Kit agent ("settings" view) and passes capabilityProps.
// Requests go through the Engine's own api client (auth, CSRF), exposed on globalThis.__MARINARA_HOST__.
// ──────────────────────────────────────────────

const PACKAGE_ID = "mari-kit";
const TAG = `marinara-capability-${PACKAGE_ID}`;

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
  },
};

function strings(props) {
  const locale = props?.localization?.locale ?? "en";
  return String(locale).toLowerCase().startsWith("ko") ? STRINGS.ko : STRINGS.en;
}

function apiClient() {
  const api = globalThis.__MARINARA_HOST__?.api?.api;
  if (!api) throw new Error("Marinara host api is unavailable");
  return api;
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

class MariKitElement extends HTMLElement {
  static observedAttributes = ["view"];

  constructor() {
    super();
    this.capabilityProps = undefined;
    this.state = { status: null, error: null, saving: false };
    this.onProps = () => this.render();
  }

  connectedCallback() {
    this.addEventListener("marinara-capability-props", this.onProps);
    if (this.getAttribute("view") === "settings") void this.load();
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener("marinara-capability-props", this.onProps);
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  async load() {
    try {
      this.state = { ...this.state, status: await apiClient().get(`/${PACKAGE_ID}/status`), error: null };
    } catch (error) {
      this.state = { ...this.state, error: `${strings(this.capabilityProps).loadFailed}: ${error?.message ?? error}` };
    }
    this.render();
  }

  async toggle(id, value) {
    if (this.state.saving) return;
    this.state = { ...this.state, saving: true, error: null };
    this.render();
    try {
      const settings = await apiClient().patch(`/${PACKAGE_ID}/settings`, { features: { [id]: value } });
      this.state = { ...this.state, status: { ...this.state.status, settings } };
    } catch (error) {
      this.state = { ...this.state, error: `${strings(this.capabilityProps).saveFailed}: ${error?.message ?? error}` };
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
    const { status, error, saving } = this.state;
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
        const label = t.features[id];
        const input = el("input", {
          type: "checkbox",
          checked: Boolean(status.settings?.features?.[id]),
          disabled: saving,
        });
        input.addEventListener("change", () => void this.toggle(id, input.checked));
        box.append(
          el("label", { style: "display:flex;align-items:center;gap:6px;cursor:pointer" }, [
            input,
            el("span", { textContent: label }),
          ]),
        );
      }
    }
    if (error) box.append(el("span", { textContent: error, role: "alert", style: "color:var(--destructive)" }));
    this.replaceChildren(box);
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, MariKitElement);
