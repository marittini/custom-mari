// The user's own status in Convo (the Engine's userStatusManual / userActivity: online, away, do not disturb,
// invisible, plus a short "what I'm doing"). Kept in Mari's prefs and copied into the Engine's synced UI settings
// (/app-settings/ui), so the Engine's own screen shows the same. "일정대로" (follow) lets Mari Kit's 내 일정 decide,
// as before.

import { api } from "./api.js";
import { prefs, setPrefs } from "./prefs.js";

export const MY_STATUSES = [
  { id: "active", label: "온라인", dot: "online", hint: "평소대로" },
  { id: "idle", label: "자리 비움", dot: "idle", hint: "먼저 말 거는 간격이 엔진 규칙대로 달라져요" },
  { id: "dnd", label: "방해 금지", dot: "dnd", hint: "캐릭터가 먼저 말 걸지 않아요" },
  { id: "invisible", label: "숨김", dot: "offline", hint: "캐릭터에게 내 상태와 할 일을 알리지 않아요" },
];
const IDS = new Set(MY_STATUSES.map((s) => s.id));
export const ACTIVITY_MAX = 120;

/** { follow, status, activity }: follow = 내 일정 decides (the default until a status is chosen). */
export function myStatus() {
  const v = prefs().myStatus;
  return v && typeof v === "object" && !v.follow && IDS.has(v.status)
    ? { follow: false, status: v.status, activity: String(v.activity || "").slice(0, ACTIVITY_MAX) }
    : { follow: true, status: "active", activity: "" };
}

/** Saves the choice; copies it into the Engine's UI settings (best effort: Mari works without it). */
export async function setMyStatus(next) {
  const value = next.follow
    ? { follow: true }
    : {
        follow: false,
        status: IDS.has(next.status) ? next.status : "active",
        activity: String(next.activity || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, ACTIVITY_MAX),
      };
  setPrefs({ myStatus: value });
  try {
    const res = await api.get("/app-settings/ui");
    const current = typeof res?.value === "string" ? JSON.parse(res.value || "{}") : res?.value || {};
    const merged = {
      ...current,
      userStatusManual: value.follow ? "active" : value.status,
      userActivity: value.follow ? "" : value.activity,
      __updatedAt: Date.now(),
    };
    await api.put("/app-settings/ui", { value: JSON.stringify(merged) });
  } catch {}
  return myStatus();
}

/**
 * The generate request's userStatus / userActivity: the chosen status, or (following the schedule) what 내 일정
 * says now. scheduleNow: { status, activity } from Mari Kit's schedule, or null.
 */
export function presenceFields(scheduleNow, label = {}) {
  const mine = myStatus();
  if (!mine.follow) return { userStatus: mine.status, userActivity: mine.status === "invisible" ? "" : mine.activity };
  if (!scheduleNow) return {};
  return {
    userStatus: scheduleNow.status === "online" ? "active" : scheduleNow.status === "dnd" ? "dnd" : "idle",
    userActivity: `${label[scheduleNow.status] || ""}; 설정상 현재 일정: ${scheduleNow.activity}`.slice(
      0,
      ACTIVITY_MAX,
    ),
  };
}
