// 날씨 for one Convo room (Mari Kit weather, the Engine-side WeatherPanel redrawn): my place (all rooms), this
// room's switch, the character's place (optional, this room), what the model is told now, and the privacy and data
// source notes. A place is picked from the built-in cities or searched (Korea, or worldwide).
//   #/weather/<chatId>

import { h, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { data } from "../lib/data.js";
import { pageHead, toast, errorBox, sheet } from "../lib/ui.js";

const sw = (on) => h("span", { class: on ? "sw on" : "sw" }, h("span"));
const enc = encodeURIComponent;

/** The place sheet: built-in cities first, then a search. Resolves the chosen place, or undefined when closed. */
export function pickPlace(title) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      s.close();
      resolve(v);
    };
    let worldwide = false;
    const results = h("div", { class: "list" }, h("div", { class: "empty" }, "불러오는 중…"));
    const query = h("input", {
      class: "inp",
      type: "search",
      placeholder: "도시나 동네 이름",
      "aria-label": "장소 찾기",
      enterkeyhint: "search",
      onKeydown: (e) => e.key === "Enter" && find(),
    });
    const scope = h("button", {
      type: "button",
      class: "chip",
      "aria-pressed": "false",
      onClick: () => {
        worldwide = !worldwide;
        scope.className = worldwide ? "chip on" : "chip";
        scope.setAttribute("aria-pressed", String(worldwide));
        if (query.value.trim()) find();
      },
    });
    scope.textContent = "세계 전체";
    async function find() {
      setChildren(results, h("div", { class: "empty" }, "찾는 중…"));
      try {
        const q = query.value.trim();
        const { places } = await api.get(
          `/mari-kit/weather/places?q=${enc(q)}${worldwide && q ? "&worldwide=true" : ""}`,
        );
        setChildren(
          results,
          places?.length
            ? places.map((p) =>
                h(
                  "button",
                  { type: "button", class: "r two", onClick: () => finish(p) },
                  h("span", null, p.label || p.name),
                  h("span", { class: "val" }, "›"),
                ),
              )
            : h("div", { class: "empty" }, "찾은 곳이 없어요"),
        );
      } catch (error) {
        setChildren(results, h("div", { class: "empty" }, `찾지 못했어요: ${error.message}`));
      }
    }
    const s = sheet(
      h(
        "div",
        { class: "psheet pad" },
        h("b", { class: "psheet-title" }, title),
        h(
          "div",
          { class: "wx-find" },
          query,
          h("button", { type: "button", class: "pill main", onClick: find }, "찾기"),
        ),
        h("div", { class: "chips" }, scope),
        results,
      ),
      { label: title, onClose: () => finish(undefined) },
    );
    find();
  });
}

export function weatherScreen({ mount, args, back }) {
  const chatId = args[0];
  let alive = true;
  let chat = null;
  let wx = null;
  let features = {};
  let busy = false;
  const body = h(
    "div",
    { class: "scroll", style: { padding: "0 20px 32px" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  mount.append(pageHead("날씨", { label: " ", back: () => back(`chat-settings/${enc(chatId)}/kit`) }), body);

  async function load() {
    try {
      const [c, w, settings] = await Promise.all([
        data.chat(chatId),
        api.get(`/mari-kit/weather/${enc(chatId)}?now=0`),
        api.get("/mari-kit/settings").catch(() => null),
      ]);
      if (!alive) return;
      chat = c;
      wx = w;
      features = settings?.features || {};
      mount.querySelector(".phead .label").textContent = `${chat.name || "이 방"} · Convo`;
      draw();
      fillNow();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  }
  // The weather itself comes after the screen is drawn (Open-Meteo can take seconds, or not answer on a phone).
  let nowLoading = false;
  async function fillNow(fresh = false) {
    if (!wx || (!wx.userLocation && !wx.room?.characterLocation)) return;
    nowLoading = true;
    draw();
    try {
      const w = await api.get(`/mari-kit/weather/${enc(chatId)}${fresh ? "?fresh=1" : ""}`);
      if (alive) wx = { ...wx, summaries: w.summaries };
    } catch (error) {
      if (alive) wx = { ...wx, summaries: { failed: { user: true, character: true }, error: error.message } };
    } finally {
      nowLoading = false;
      if (alive) draw();
    }
  }
  async function act(fn, done) {
    if (busy) return;
    busy = true;
    draw();
    try {
      const res = await fn();
      if (res && "room" in res) {
        wx = res;
        fillNow();
      } else await load();
      if (done) toast(done);
    } catch (error) {
      toast(`바꾸지 못했어요: ${error.message}`);
    } finally {
      busy = false;
      if (alive) draw();
    }
  }
  const setMine = (place) =>
    act(
      async () => {
        await api.put("/mari-kit/weather/user", { location: place });
        return api.get(`/mari-kit/weather/${enc(chatId)}?now=0`);
      },
      place ? `내 위치: ${place.label || place.name}` : "내 위치를 지웠어요",
    );
  const setRoom = (patch, done) => act(() => api.put(`/mari-kit/weather/${enc(chatId)}?now=0`, patch), done);

  const row = (label, sub, on, onClick, disabled = false) =>
    h(
      "button",
      { type: "button", class: "grow", role: "switch", "aria-checked": on ? "true" : "false", disabled, onClick },
      h("span", null, label, sub ? h("small", null, sub) : null),
      sw(on),
    );
  const place = (label, sub, current, onPick, title) =>
    h(
      "div",
      { class: "grow" },
      h("span", null, label, h("small", null, current ? current.label || current.name : sub)),
      h(
        "span",
        { class: "wx-acts" },
        current
          ? h("button", { type: "button", class: "chip", disabled: busy, onClick: () => onPick(null) }, "지우기")
          : null,
        h(
          "button",
          {
            type: "button",
            class: "chip",
            disabled: busy,
            onClick: async () => {
              const p = await pickPlace(title);
              if (p) onPick(p);
            },
          },
          current ? "바꾸기" : "고르기",
        ),
      ),
    );
  // One place's weather: loading, the line the screen shows, or why it failed with 다시 불러오기.
  const summary = (who, located) => {
    if (!located) return null;
    const text = wx.summaries?.[who] || (wx.summaries?.error ? `날씨를 불러오지 못했어요 · ${wx.summaries.error}` : "");
    if (nowLoading || !wx.summaries) return h("p", { class: "wx-sum hint" }, "날씨 불러오는 중…");
    if (!wx.summaries.failed?.[who]) return text ? h("p", { class: "wx-sum" }, text) : null;
    return h(
      "div",
      { class: "wx-sum", style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
      h("span", { style: { flex: "1 1 180px", minWidth: "0" } }, text),
      h("button", { type: "button", class: "chip", onClick: () => fillNow(true) }, "다시 불러오기"),
    );
  };

  function draw() {
    if (!wx) return;
    const { userLocation, room } = wx;
    const on = features.weather === true;
    const convo = chat?.mode === "conversation";
    setChildren(
      body,
      convo ? null : h("p", { class: "hint" }, "날씨는 Convo 채팅에만 들어가요."),
      h("div", { class: "gsec" }, h("span", null, "날씨 기능"), h("span", null, "모든 방 공통")),
      h(
        "div",
        { class: "gcard" },
        row("Mari Kit 날씨", "켜면 날씨를 넣기로 한 방에 들어가요", on, async () => {
          await act(() => api.patch("/mari-kit/settings", { features: { weather: !on } }));
        }),
      ),
      h("div", { class: "gsec" }, h("span", null, "내 위치"), h("span", null, "모든 방 공통")),
      h(
        "div",
        { class: "gcard" },
        place("내가 있는 곳", "정하지 않음", userLocation, setMine, "내 위치 고르기"),
        summary("user", userLocation),
      ),
      h("div", { class: "gsec" }, h("span", null, "이 방")),
      h(
        "div",
        { class: "gcard" },
        row(
          "이 방에 날씨 넣기",
          userLocation
            ? on
              ? "답장할 때마다 지금 날씨를 알려 줘요"
              : "위의 날씨 기능도 켜야 해요"
            : "내 위치를 먼저 골라 주세요",
          room?.enabled === true,
          () =>
            setRoom({ enabled: !(room?.enabled === true) }, room?.enabled ? "이 방에서 껐어요" : "이 방에 넣었어요"),
          busy || !userLocation,
        ),
        place(
          "캐릭터가 있는 곳",
          "정하지 않음 · 고르면 캐릭터 쪽 날씨도 알려요",
          room?.characterLocation,
          (p) => setRoom({ characterLocation: p }, p ? `캐릭터 위치: ${p.label || p.name}` : "캐릭터 위치를 지웠어요"),
          "캐릭터 위치 고르기",
        ),
        summary("character", room?.characterLocation),
      ),
      h(
        "p",
        { class: "hint" },
        "모델에는 날씨와 기온만 가요. 장소 이름이나 좌표는 보내지 않아요. AI 요청은 쓰지 않아요.",
      ),
      h("p", { class: "hint" }, "날씨 자료: Open-Meteo (CC BY 4.0)"),
    );
  }

  load();
  return {
    dispose: () => {
      alive = false;
    },
  };
}
