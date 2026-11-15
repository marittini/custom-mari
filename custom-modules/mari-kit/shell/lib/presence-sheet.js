// The Convo status sheet: what the Engine's Conversation Presence card shows, for each character in the chat —
// status and activity, following the schedule or set by hand, last contact, change the status (saved on the
// character card like the Engine), back to the schedule, reply now while a reply waits, the next blocks and the
// week view. At the bottom, the user's own status and schedule line (Mari Kit 내 일정) and this room's weather.

import { h, setChildren } from "./h.js";
import { api } from "./api.js";
import { sheet, toast, avatar } from "./ui.js";
import { ACTIVITY_MAX, MY_STATUSES, myStatus, setMyStatus } from "./my-status.js";
import {
  STATUSES,
  STATUS_KO,
  DAY_KO,
  agoLabel,
  presenceLine,
  presenceOf,
  rangeLabel,
  timeZoneOf,
  upcomingBlocks,
  wallClock,
} from "./presence.js";

const dot = (status) => h("span", { class: `sdot ${status}` });

/** Saves a manual status on the character card (the Engine's saveOverride; null goes back to the schedule). */
export function saveOverride(characterId, override) {
  return api.patch(`/characters/${encodeURIComponent(characterId)}`, {
    data: { extensions: { conversationStatusOverride: override } },
    skipVersionSnapshot: true,
  });
}

/**
 * chat, index (id → { name, avatar }), fresh: GET /conversation/status/:chatId's statuses (or null), me: Mari Kit's
 * schedule state for the user, go, changed().
 */
export function presenceSheet({ chat, index, fresh, me, go, changed }) {
  const chatId = chat.id;
  const box = h("div", { class: "psheet" });
  const s = sheet(box, { label: "상태와 일정" });
  let statuses = fresh;
  let editing = null; // character id whose status chips are open
  let weather = null; // { on, enabled, line } once read (Mari Kit weather for this room)

  async function refresh() {
    try {
      statuses = (await api.get(`/conversation/status/${encodeURIComponent(chatId)}`)).statuses || {};
    } catch {}
    await changed?.();
    if (box.isConnected) draw();
  }

  async function setStatus(id, status, activity) {
    try {
      await saveOverride(id, {
        status,
        activity: activity?.trim() ? activity.trim() : null,
        createdAt: new Date().toISOString(),
        expiresAt: null,
      });
      editing = null;
      toast(`${index.get(id)?.name || "캐릭터"} · ${STATUS_KO[status]}(으)로 바꿨어요`);
      await refresh();
    } catch (error) {
      toast(`바꾸지 못했어요: ${error.message}`);
    }
  }
  async function backToSchedule(id) {
    try {
      await saveOverride(id, null);
      toast("일정대로 돌아갔어요");
      await refresh();
    } catch (error) {
      toast(`되돌리지 못했어요: ${error.message}`);
    }
  }
  // Only offered once the Engine said this character has no schedule (nothing to overwrite), by the work rule.
  async function makeSchedule(id) {
    const { regenerateSchedules } = await import("./work.js");
    await regenerateSchedules({
      chatId,
      ids: [id],
      names: [index.get(id)?.name || "캐릭터"],
      timeZone: timeZoneOf(meta()) || Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
      fresh: true,
    });
    await refresh();
  }
  const meta = () => {
    try {
      return typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : chat.metadata || {};
    } catch {
      return {};
    }
  };

  function person(id) {
    const c = index.get(id);
    const name = c?.name || "캐릭터";
    const now = new Date();
    const f = statuses?.[id] || null;
    const p = presenceOf(meta(), id, now, f) || { status: "online", activity: "", until: "", override: null };
    const schedule = f ? f.schedule : p.schedule;
    const wall = wallClock(now, timeZoneOf(meta()));
    const next = schedule ? upcomingBlocks(schedule, wall, 4) : [];
    const activity = h("input", {
      class: "inp",
      value: p.override ? p.override.activity || "" : "",
      placeholder: p.activity || "지금 하는 일 (비워도 돼요)",
      maxlength: 120,
      "aria-label": `${name}이(가) 지금 하는 일`,
    });
    return h(
      "section",
      { class: "pcard" },
      h(
        "div",
        { class: "pcard-hd" },
        avatar(c?.avatar, name[0] || "·", 40),
        h(
          "div",
          { class: "pcard-name" },
          h("b", null, name),
          h("span", { class: "hint" }, p.override ? "직접 바꾼 상태" : schedule ? "일정대로" : "일정 없음"),
        ),
        f?.lastContact ? h("span", { class: "hint pcard-ago" }, `마지막 연락 ${agoLabel(f.lastContact, now)}`) : null,
      ),
      h("div", { class: "pcard-now" }, dot(p.status), h("span", null, presenceLine(p))),
      // 상태 바꾸기: the Engine's manual status menu and activity box.
      editing === id
        ? h(
            "div",
            { class: "pcard-edit" },
            h(
              "div",
              { class: "chips", role: "radiogroup", "aria-label": `${name} 상태` },
              STATUSES.map((st) =>
                h(
                  "button",
                  {
                    type: "button",
                    class: st === p.status ? "chip on" : "chip",
                    role: "radio",
                    "aria-checked": st === p.status ? "true" : "false",
                    onClick: () => setStatus(id, st, activity.value),
                  },
                  dot(st),
                  STATUS_KO[st],
                ),
              ),
            ),
            activity,
            h(
              "p",
              { class: "hint", style: { margin: "0" } },
              "상태를 누르면 저장돼요. 이 캐릭터의 다른 채팅에도 같이 적용돼요.",
            ),
          )
        : null,
      h(
        "div",
        { class: "pcard-acts" },
        h(
          "button",
          { type: "button", class: "pill", onClick: () => ((editing = editing === id ? null : id), draw()) },
          editing === id ? "접기" : "상태 바꾸기",
        ),
        p.override
          ? h("button", { type: "button", class: "pill", onClick: () => backToSchedule(id) }, "일정대로 되돌리기")
          : null,
        schedule
          ? h(
              "button",
              {
                type: "button",
                class: "pill",
                onClick: () => (s.close(), go(`char-schedule/${encodeURIComponent(chatId)}/${encodeURIComponent(id)}`)),
              },
              "주간 일정 ›",
            )
          : // Until the Engine's answer is here the slot stays empty, so a tap never lands on the other button.
            statuses
            ? h("button", { type: "button", class: "pill", onClick: () => makeSchedule(id) }, "일정 만들기")
            : null,
      ),
      next.length
        ? h(
            "div",
            { class: "pcard-next" },
            h("span", { class: "label" }, "다음 일정"),
            next.map((b) =>
              h(
                "div",
                { class: "blk" },
                h(
                  "span",
                  { class: "blk-t" },
                  `${b.offset === 0 ? "오늘" : b.offset === 1 ? "내일" : `${DAY_KO[b.day]}요일`} ${rangeLabel(b.block.time)}`,
                ),
                dot(b.block.status),
                h("span", { class: "blk-a" }, b.block.activity || STATUS_KO[b.block.status]),
              ),
            ),
          )
        : schedule
          ? h("p", { class: "hint", style: { margin: "0" } }, "다가오는 일정이 없어요")
          : null,
    );
  }

  // 나: the user's own status (the Engine's userStatusManual) and what they are doing; 일정대로 lets 내 일정 decide.
  function mine() {
    const cur = myStatus();
    const scheduled = me?.profile?.config?.enabled && me?.now;
    const save = async (next) => {
      await setMyStatus(next);
      toast(next.follow ? "내 일정대로 해요" : "내 상태를 바꿨어요");
      draw();
    };
    const activity = h("input", {
      class: "inp",
      value: cur.follow ? "" : cur.activity,
      maxlength: ACTIVITY_MAX,
      placeholder: "지금 하는 일 (예: 시험 공부 중)",
      "aria-label": "내가 지금 하는 일",
      disabled: cur.follow || cur.status === "invisible",
      onChange: (e) => save({ follow: false, status: cur.status, activity: e.target.value }),
    });
    const hint = cur.follow
      ? scheduled
        ? `내 일정대로: ${me.now.activity}`
        : "고르기 전에는 온라인으로 보여요"
      : MY_STATUSES.find((x) => x.id === cur.status)?.hint || "";
    return h(
      "section",
      { class: "pcard" },
      h("div", { class: "pcard-name" }, h("b", null, "나"), h("span", { class: "hint" }, hint)),
      h(
        "div",
        { class: "chips", role: "radiogroup", "aria-label": "내 상태" },
        scheduled
          ? h(
              "button",
              {
                type: "button",
                class: cur.follow ? "chip on" : "chip",
                role: "radio",
                "aria-checked": cur.follow ? "true" : "false",
                onClick: () => save({ follow: true }),
              },
              "일정대로",
            )
          : null,
        MY_STATUSES.map((st) => {
          const on = !cur.follow && cur.status === st.id;
          return h(
            "button",
            {
              type: "button",
              class: on ? "chip on" : "chip",
              role: "radio",
              "aria-checked": on ? "true" : "false",
              onClick: () => save({ follow: false, status: st.id, activity: cur.follow ? "" : cur.activity }),
            },
            dot(st.dot),
            st.label,
          );
        }),
      ),
      activity,
    );
  }

  function draw() {
    const ids = chat.characterIds || [];
    const n = me?.now;
    setChildren(
      box,
      h("b", { class: "psheet-title" }, ids.length > 1 ? "모두의 상태와 일정" : "상태와 일정"),
      ids.map(person),
      mine(),
      h(
        "div",
        { class: "list", style: { marginTop: "4px" } },
        me
          ? h(
              "button",
              {
                type: "button",
                class: "r",
                onClick: () => (
                  s.close(),
                  go(`schedule/${encodeURIComponent(me.key)}/now/${encodeURIComponent(chatId)}`)
                ),
              },
              h("span", { class: "ic" }, n ? dot(n.status) : null),
              h("span", null, n ? `내 일정 · ${n.activity}` : "내 일정 만들기"),
              h("span", { class: "val" }, "›"),
            )
          : null,
        weather
          ? h(
              "button",
              {
                type: "button",
                class: "r",
                onClick: () => (s.close(), go(`weather/${encodeURIComponent(chatId)}`)),
              },
              h("span", { class: "ic" }),
              h(
                "span",
                null,
                weather.on && weather.enabled ? `날씨 · ${weather.line || "넣는 중"}` : "날씨 · 이 방에 넣지 않음",
              ),
              h("span", { class: "val" }, "›"),
            )
          : null,
        h(
          "button",
          {
            type: "button",
            class: "r",
            onClick: () => (s.close(), go(`chat-settings/${encodeURIComponent(chatId)}/convo`)),
          },
          h("span", { class: "ic" }),
          h("span", null, "먼저 말 걸기 · 일정 설정"),
          h("span", { class: "val" }, "›"),
        ),
      ),
    );
  }

  // The weather row: read when the sheet opens (the place's weather is cached on the server for 15 minutes).
  async function loadWeather() {
    try {
      const [wx, settings] = await Promise.all([
        api.get(`/mari-kit/weather/${encodeURIComponent(chatId)}`),
        api.get("/mari-kit/settings"),
      ]);
      const now = String(wx?.summaries?.user || "").split("\n")[1] || "";
      weather = { on: settings?.features?.weather === true, enabled: wx?.room?.enabled === true, line: now };
      if (box.isConnected) draw();
    } catch {}
  }

  draw();
  if (!statuses) refresh();
  if (chat.mode === "conversation") loadWeather();
  return s;
}
