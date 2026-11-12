// ──────────────────────────────────────────────
// Mari Kit — user schedule (Convo)
//
// The persona's own weekly routine, ported from the "User Schedule Companion" personal extension. Instead of
// rewriting the browser's /api/generate requests, the server adds today's schedule and the current activity
// to Conversation turns through the prompt-context hook, so it works from the Engine screens and the shell.
//
// One profile per persona (chats without a persona share "default"). Blocks use the Engine's WeekSchedule
// shape: { time: "HH:MM-HH:MM", activity, status: online | idle | dnd | offline }.
// ──────────────────────────────────────────────

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const STATUSES = ["online", "idle", "dnd", "offline"];
const LABELS = { online: "online", idle: "away", dnd: "do not disturb", offline: "offline" };
const DOC_PREFIX = "mari-kit:schedule:";

export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  zone: "Asia/Seoul",
  instructions: "페르소나의 설정과 생활 습관에 맞게 월요일부터 일요일까지 일주일 일정을 생성하세요.",
  lifestyle: "",
  connectionId: "",
  mode: "independent", // or "linked": line up with the chat characters' schedules
});

const str = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function minutes(t, end = false) {
  if (end && t === "24:00") return 1440;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error(`Time must be HH:MM: ${t}`);
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
}
export const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "22:00-07:00" → [[1320,1440],[0,420]]. */
export function range(t) {
  const parts = String(t ?? "")
    .split("-")
    .map((x) => x.trim());
  if (parts.length !== 2) throw new Error(`Bad time range: ${t}`);
  const a = minutes(parts[0]);
  const b = minutes(parts[1], true);
  if (a === b) throw new Error(`Start and end are the same: ${t}`);
  return b > a
    ? [[a, b]]
    : [
        [a, 1440],
        [0, b],
      ].filter(([x, y]) => x < y);
}

/** Wall-clock day, date and minute in a time zone. */
export function wall(zone, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    day: parts.weekday,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function zoneOk(zone) {
  try {
    wall(zone);
    return true;
  } catch {
    return false;
  }
}

/** Blocks of one day as sorted segments; throws on bad input or overlaps (and gaps when `full`). */
export function validateDay(blocks, day, full = false) {
  if (!Array.isArray(blocks)) throw new Error(`${day}: no blocks`);
  const segs = [];
  for (const block of blocks) {
    if (!STATUSES.includes(block?.status) || !str(block?.activity)) throw new Error(`${day}: bad status or activity`);
    for (const [a, b] of range(block.time)) segs.push({ a, b, status: block.status, activity: str(block.activity) });
  }
  segs.sort((x, y) => x.a - y.a);
  let end = 0;
  for (const s of segs) {
    if (s.a < end) throw new Error(`${day}: overlapping times`);
    if (full && s.a !== end) throw new Error(`${day}: gap in the day`);
    end = s.b;
  }
  if (full && end !== 1440) throw new Error(`${day}: the day must cover 24 hours`);
  return segs.map(({ a, b, ...rest }) => ({ time: `${clock(a)}-${clock(b)}`, ...rest }));
}

/** Fills gaps with free time and trims overlaps (a later block yields to an earlier one). Never throws on times. */
export function repairDay(blocks) {
  const segs = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!STATUSES.includes(block?.status) || !str(block?.activity)) continue;
    try {
      for (const [a, b] of range(block.time)) segs.push({ a, b, status: block.status, activity: str(block.activity) });
    } catch {
      // A block with a broken time is dropped.
    }
  }
  segs.sort((x, y) => x.a - y.a || x.b - y.b);
  const out = [];
  let end = 0;
  for (const s of segs) {
    const a = Math.max(s.a, end);
    if (a > end) out.push({ a: end, b: a, status: "online", activity: "자유 시간" });
    if (s.b > a) out.push({ a, b: s.b, status: s.status, activity: s.activity });
    end = Math.max(end, s.b);
  }
  if (end < 1440) out.push({ a: end, b: 1440, status: "online", activity: "자유 시간" });
  return out.map(({ a, b, ...rest }) => ({ time: `${clock(a)}-${clock(b)}`, ...rest }));
}

export function emptyWeek() {
  return Object.fromEntries(DAYS.map((d) => [d, []]));
}

export function normalizeProfile(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const c = src.config && typeof src.config === "object" ? src.config : {};
  const config = {
    enabled: c.enabled === true,
    zone: zoneOk(str(c.zone, 80)) ? str(c.zone, 80) : DEFAULT_CONFIG.zone,
    instructions: str(c.instructions, 4000) || DEFAULT_CONFIG.instructions,
    lifestyle: str(c.lifestyle, 4000),
    connectionId: str(c.connectionId, 200),
    mode: c.mode === "linked" ? "linked" : "independent",
  };
  const days = emptyWeek();
  for (const d of DAYS) {
    try {
      days[d] = validateDay(src.days?.[d] ?? [], d);
    } catch {
      days[d] = repairDay(src.days?.[d]);
    }
  }
  const o = src.override;
  const override =
    o && STATUSES.includes(o.status) && str(o.activity)
      ? {
          status: o.status,
          activity: str(o.activity, 120),
          expiresAt: Number.isFinite(Date.parse(o.expiresAt)) ? o.expiresAt : null,
        }
      : null;
  const windows = Array.isArray(src.windows)
    ? src.windows.filter(
        (w) =>
          Array.isArray(w?.days) &&
          Number.isFinite(w.a) &&
          Number.isFinite(w.b) &&
          ["idle", "dnd", "offline"].includes(w.status),
      )
    : [];
  const summary =
    src.summary && typeof src.summary === "object" && str(src.summary.text, 2000)
      ? { text: str(src.summary.text, 2000), at: str(src.summary.at, 40) || null }
      : null;
  return { config, days, override, windows, summary, updatedAt: str(src.updatedAt, 40) || null };
}

export function activeOverride(profile, date = new Date()) {
  const o = profile.override;
  if (!o) return null;
  if (o.expiresAt && Date.parse(o.expiresAt) <= date.getTime()) return null;
  return o;
}

/** The planned block now, plus when it ends and what comes next. */
export function currentBlock(profile, date = new Date()) {
  const now = wall(profile.config.zone, date);
  const blocks = profile.days[now.day] || [];
  for (const block of blocks) {
    for (const [a, b] of range(block.time)) {
      if (now.minute >= a && now.minute < b) {
        const i = blocks.indexOf(block);
        return { now, block, until: clock(b), next: blocks[i + 1] || null };
      }
    }
  }
  return { now, block: null, until: null, next: null };
}

/** What the user is doing now: an unexpired override wins over the plan. */
export function nowState(profile, date = new Date()) {
  const o = activeOverride(profile, date);
  const cur = currentBlock(profile, date);
  if (o) return { source: "override", status: o.status, activity: o.activity, expiresAt: o.expiresAt, next: cur.next };
  if (!cur.block) return null;
  return { source: "plan", status: cur.block.status, activity: cur.block.activity, until: cur.until, next: cur.next };
}

/** The prompt text for a Conversation turn. Empty when the schedule is off or has nothing for today. */
/** "HH:MM" of an instant in the profile's zone. */
export function zoneClock(zone, iso) {
  return clock(wall(zone, new Date(iso)).minute);
}

export function scheduleContext(profile, date = new Date(), name = "the user") {
  if (!profile.config.enabled) return "";
  const now = wall(profile.config.zone, date);
  const blocks = profile.days[now.day];
  if (!blocks?.length) return "";
  const state = nowState(profile, date);
  const lines = [
    `<user_schedule date="${now.date}" day="${now.day}" time="${clock(now.minute)}" zone="${profile.config.zone}">`,
    `This is ${name}'s own fictional routine, not your character's.`,
    `${name}'s plan today: ${blocks.map((b) => `${b.time} ${b.activity}`).join(", ")}`,
  ];
  if (state)
    lines.push(
      state.source === "override"
        ? `Right now ${name} is: ${state.activity} (${LABELS[state.status]}${state.expiresAt ? `, until ${zoneClock(profile.config.zone, state.expiresAt)}` : ", until they say otherwise"}). This replaces the plan for now; the saved plan is unchanged.`
        : `Right now ${name} is: ${state.activity} (${LABELS[state.status]}, until ${state.until}).`,
    );
  lines.push(
    `These are plans, not proof they happened. Use them naturally when it fits; do not recite the schedule or write ${name}'s actions for them.`,
    "</user_schedule>",
  );
  return lines.join("\n");
}

/** Real-life presence windows only change statuses (online → idle/dnd), never activities. */
export function applyWindows(days, windows, onlyDays = DAYS) {
  const out = { ...days };
  for (const day of onlyDays) {
    const rules = windows.filter((w) => w.days.includes(day));
    if (!rules.length) continue;
    const next = [];
    for (const block of days[day] || []) {
      for (const [a, b] of range(block.time)) {
        const edges = [...new Set([a, b, ...rules.flatMap((r) => [r.a, r.b]).filter((m) => m > a && m < b)])].sort(
          (x, y) => x - y,
        );
        for (let i = 0; i < edges.length - 1; i += 1) {
          const cover = rules.filter((r) => edges[i] >= r.a && edges[i + 1] <= r.b);
          let status = block.status;
          if (status === "online" && cover.length) status = cover.some((r) => r.status === "dnd") ? "dnd" : "idle";
          next.push({ ...block, time: `${clock(edges[i])}-${clock(edges[i + 1])}`, status });
        }
      }
    }
    out[day] = next;
  }
  return out;
}

export function windowsFrom(parsed) {
  if (!Array.isArray(parsed?.windows)) throw new Error("The model did not return windows.");
  return parsed.windows.flatMap((w) => {
    if (!Array.isArray(w?.days) || !w.days.length || w.days.some((d) => !DAYS.includes(d))) return [];
    if (!["idle", "offline", "dnd"].includes(w.status)) return [];
    try {
      return range(w.time).map(([a, b]) => ({ days: [...new Set(w.days)], a, b, status: w.status }));
    } catch {
      return [];
    }
  });
}

export const WINDOWS_PROMPT = (lifestyle) =>
  `Extract REAL HUMAN unavailable hours only from the following real-life routine. Return JSON {"windows":[{"days":["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],"time":"12:00-13:00","status":"idle"}]}. These are presence constraints, NOT fictional activities. Use offline for sleeping; idle for real meals, work and other unavailable times; dnd only when explicitly asked not to be contacted. Infer a reasonable duration (a meal is usually one hour) when only a start time is given. Cross-midnight ranges stay HH:MM-HH:MM. Use all seven English weekdays for daily habits. No online windows. Real-life routine:\n${lifestyle}`;

export function generatePrompt({ day, action, persona, config, reference, existing, dayGuidance }) {
  return [
    `Generate the USER/PERSONA's fictional routine as Marinara Engine weekly schedule blocks. ${
      day
        ? `Return only JSON {"blocks":[{"time":"00:00-06:00","activity":"수면","status":"offline"}]} for ${day}.`
        : 'Return only JSON {"days":{"Monday":[{"time":"00:00-06:00","activity":"수면","status":"offline"}],"Tuesday":[],"Wednesday":[],"Thursday":[],"Friday":[],"Saturday":[],"Sunday":[]}} with ALL SEVEN DAYS.'
    } Each day covers 00:00-24:00 without gaps or overlaps. Status is online, idle, dnd or offline. Activities in Korean. Keep the persona's explicit meal, waking, sleeping and insomnia habits as fixed anchors; never infer them from real human availability. Action=${action}: rewrite makes a fresh routine; adjust keeps existing blocks except what the guidance asks to change.`,
    `Persona card: ${JSON.stringify(persona ?? null)}`,
    `Persona schedule instructions: ${config.instructions}`,
    reference
      ? `CHARACTER INTERACTION: make plausible chances to interact at the SAME clock times as the characters' activities (meals, breaks, outings, shared free time) when consistent with the persona's anchors. Do not copy incompatible habits. Character weekly schedules: ${JSON.stringify(reference)}`
      : "Invent this persona routine independently.",
    `Existing routine: ${JSON.stringify(existing ?? null)}`,
    day && dayGuidance ? `Day guidance: ${dayGuidance}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function personaKey(chat) {
  return str(chat?.personaId, 200) || "default";
}

export const scheduleFeature = {
  id: "schedule",
  ownChatSwitch: true,
  async promptContext(request, { runtime }) {
    if (request.mode !== "conversation") return null;
    const key = str(request.personaId, 200) || "default";
    const doc = await runtime.persistence.documents.getById("mari-kit", DOC_PREFIX + key);
    if (!doc) return null;
    let name = "the user";
    if (key !== "default") {
      const [persona] = await runtime.resources.listPersonas([key]);
      const data = typeof persona?.data === "string" ? JSON.parse(persona.data || "{}") : persona?.data;
      if (typeof data?.name === "string" && data.name.trim()) name = data.name.trim();
    }
    return scheduleContext(normalizeProfile(doc.data), new Date(), name) || null;
  },
  routes(app, { runtime, httpError }) {
    const docs = () => runtime.persistence.documents;
    const keyOf = (raw) => {
      const key = str(raw, 200);
      if (!key || /[^A-Za-z0-9_-]/.test(key)) throw httpError(400, "Bad persona key.");
      return key;
    };
    async function read(key) {
      const doc = await docs().getById("mari-kit", DOC_PREFIX + key);
      return { doc, profile: normalizeProfile(doc?.data) };
    }
    async function save(key, mutate) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { doc, profile } = await read(key);
        const next = normalizeProfile({
          ...(await mutate(structuredClone(profile))),
          updatedAt: new Date().toISOString(),
        });
        const now = new Date().toISOString();
        if (!doc) {
          try {
            await docs().create({
              id: DOC_PREFIX + key,
              packageId: "mari-kit",
              kind: "schedule",
              name: `Schedule ${key}`,
              description: "",
              data: next,
              createdAt: now,
              updatedAt: now,
            });
            return next;
          } catch {
            continue;
          }
        }
        const ok = await docs().update({
          id: DOC_PREFIX + key,
          packageId: "mari-kit",
          expectedRevision: doc.revision,
          name: doc.name,
          description: doc.description,
          data: next,
          updatedAt: now,
        });
        if (ok) return next;
      }
      throw httpError(409, "The schedule changed while saving. Try again.");
    }
    const view = (key, profile) => ({ key, profile, now: nowState(profile), today: wall(profile.config.zone).day });

    // Which profile a chat uses (its persona), with the state the Convo header shows.
    app.get("/schedule/chat/:chatId", async (request) => {
      const chat = await runtime.persistence.getChat(str(request.params.chatId, 200));
      if (!chat) throw httpError(404, "Chat not found.");
      const key = personaKey(chat);
      return view(key, (await read(key)).profile);
    });
    app.get("/schedule/:key", async (request) => {
      const key = keyOf(request.params.key);
      return view(key, (await read(key)).profile);
    });
    app.patch("/schedule/:key/config", async (request) => {
      const key = keyOf(request.params.key);
      const body = request.body && typeof request.body === "object" ? request.body : {};
      if (body.zone !== undefined && !zoneOk(str(body.zone, 80))) throw httpError(400, "Unknown time zone.");
      const profile = await save(key, (p) => {
        for (const k of Object.keys(DEFAULT_CONFIG)) if (body[k] !== undefined) p.config[k] = body[k];
        if (body.lifestyle !== undefined && str(body.lifestyle, 4000) !== p.config.lifestyle) p.windows = [];
        return p;
      });
      return view(key, profile);
    });
    app.put("/schedule/:key/day/:day", async (request) => {
      const key = keyOf(request.params.key);
      const day = str(request.params.day, 20);
      if (!DAYS.includes(day)) throw httpError(400, "Unknown day.");
      const blocks = request.body?.blocks;
      let checked;
      try {
        checked = request.body?.repair ? repairDay(blocks) : validateDay(blocks, day);
      } catch (error) {
        throw httpError(400, error.message);
      }
      const profile = await save(key, (p) => {
        p.days[day] = checked;
        return p;
      });
      return view(key, profile);
    });
    app.put("/schedule/:key/override", async (request) => {
      const key = keyOf(request.params.key);
      const body = request.body && typeof request.body === "object" ? request.body : {};
      if (!STATUSES.includes(body.status) || !str(body.activity))
        throw httpError(400, "status and activity are required.");
      const mins = Number(body.minutes);
      const at = Number.isFinite(Date.parse(body.until)) ? new Date(body.until).toISOString() : null;
      const expiresAt =
        at ??
        (Number.isFinite(mins) && mins > 0 ? new Date(Date.now() + Math.min(mins, 10080) * 60000).toISOString() : null);
      const profile = await save(key, (p) => {
        p.override = { status: body.status, activity: str(body.activity, 120), expiresAt };
        return p;
      });
      return view(key, profile);
    });
    app.delete("/schedule/:key/override", async (request) => {
      const key = keyOf(request.params.key);
      const profile = await save(key, (p) => {
        p.override = null;
        return p;
      });
      return view(key, profile);
    });
    // 일상 요약 (from the original extension): a short Korean paragraph about this persona's week, for the user to read.
    app.post("/schedule/:key/summary", async (request) => {
      const key = keyOf(request.params.key);
      const { profile } = await read(key);
      if (!DAYS.some((d) => profile.days[d]?.length)) throw httpError(400, "Make a schedule first.");
      const model = await runtime.languageModels.resolve(profile.config.connectionId || null);
      let result;
      try {
        result = await model.chatComplete(
          [
            {
              role: "system",
              content:
                'Summarize this persona\'s weekly routine in one concise Korean paragraph (2-3 sentences): when they are busy, free and easiest to reach. Do not infer real human behavior. Return JSON {"summary":"..."}.',
            },
            { role: "user", content: JSON.stringify(profile.days) },
          ],
          { temperature: 0.4, maxTokens: 600 },
        );
      } catch (error) {
        throw httpError(502, `The summary model call failed: ${error?.message ?? error}`);
      }
      let text = "";
      try {
        text = str(runtime.json.parseJsonish(String(result?.content ?? ""))?.summary, 2000);
      } catch {}
      if (!text) throw httpError(502, "The model did not return a summary.");
      const saved = await save(key, (p) => {
        p.summary = { text, at: new Date().toISOString() };
        return p;
      });
      return view(key, saved);
    });

    // AI: a whole week or one day. action "rewrite" | "adjust". Real-life windows are refreshed when needed.
    app.post("/schedule/:key/generate", async (request) => {
      const key = keyOf(request.params.key);
      const body = request.body && typeof request.body === "object" ? request.body : {};
      const day = body.day ? str(body.day, 20) : null;
      if (day && !DAYS.includes(day)) throw httpError(400, "Unknown day.");
      const action = body.action === "adjust" ? "adjust" : "rewrite";
      const chatId = str(body.chatId, 200);
      const { profile } = await read(key);
      const model = await runtime.languageModels.resolve(profile.config.connectionId || null);
      const ask = async (prompt) => {
        let result;
        try {
          result = await model.chatComplete(
            [
              { role: "system", content: prompt },
              { role: "user", content: "Return the requested complete JSON." },
            ],
            { temperature: 0.7, maxTokens: 12000 },
          );
        } catch (error) {
          throw httpError(502, `The schedule model call failed: ${error?.message ?? error}`);
        }
        try {
          return runtime.json.parseJsonish(typeof result?.content === "string" ? result.content : "");
        } catch {
          throw httpError(502, "The schedule model did not return JSON.");
        }
      };
      let reference = null;
      if (profile.config.mode === "linked" && chatId) {
        const chat = await runtime.persistence.getChat(chatId);
        const meta = typeof chat?.metadata === "string" ? JSON.parse(chat.metadata || "{}") : (chat?.metadata ?? {});
        const schedules =
          meta.characterSchedules && typeof meta.characterSchedules === "object" ? meta.characterSchedules : {};
        reference = Object.fromEntries(Object.entries(schedules).map(([id, s]) => [id, s?.days ?? s]));
        if (!Object.keys(reference).length) reference = null;
      }
      const persona = key === "default" ? null : ((await runtime.resources.listPersonas([key]))[0]?.data ?? null);
      const parsed = await ask(
        generatePrompt({
          day,
          action,
          persona,
          config: profile.config,
          reference,
          existing: profile.days,
          dayGuidance: str(body.guidance, 2000),
        }),
      );
      let windows = profile.windows;
      if (profile.config.lifestyle && !windows.length)
        windows = windowsFrom(await ask(WINDOWS_PROMPT(profile.config.lifestyle)));
      const next = await save(key, (p) => {
        const fresh = day
          ? { [day]: repairDay(parsed?.blocks ?? parsed?.days?.[day]) }
          : Object.fromEntries(DAYS.map((d) => [d, repairDay(parsed?.days?.[d])]));
        const merged = { ...p.days, ...fresh };
        p.days = windows.length ? applyWindows(merged, windows, day ? [day] : DAYS) : merged;
        p.windows = windows;
        return p;
      });
      return view(key, next);
    });
    app.get("/schedule/:key/export", async (request) => {
      const key = keyOf(request.params.key);
      return { format: "mari-kit-schedule", version: 1, profile: (await read(key)).profile };
    });
    app.post("/schedule/:key/import", async (request) => {
      const key = keyOf(request.params.key);
      if (request.body?.format !== "mari-kit-schedule" || !request.body?.profile)
        throw httpError(400, "Send a Mari Kit schedule export.");
      const incoming = normalizeProfile(request.body.profile);
      const profile = await save(key, () => incoming);
      return view(key, profile);
    });
  },
};
