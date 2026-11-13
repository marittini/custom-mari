// ──────────────────────────────────────────────
// Mari Kit — 사연 라디오
//
// A character hosts a late-night radio show. The user may send an anonymous story (사연); with none, the DJ
// reads a post from the "사연 게시판" written by a character from the rooms the user linked. Ported from the
// 말랑 사연 라디오 add-on, made server-side: an episode is written by the server, so closing the screen does
// not stop it, and every episode is kept with its number, a bookmark and its script.
//
// Storage: one settings document, one index (episode numbers, titles, bookmarks) and one document per
// episode script, so the shelf never loads every script.
// ──────────────────────────────────────────────

import { randomUUID } from "node:crypto";

const PKG = "mari-kit";
const SETTINGS_ID = "mari-kit:radio:settings";
const INDEX_ID = "mari-kit:radio:index";
const EP_PREFIX = "mari-kit:radio:ep:";
const STALE_MS = 10 * 60 * 1000; // a job the server lost (restart) shows as failed after this

const str = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export const DEFAULT_GUIDE =
  "심야 라디오 DJ로 진행하세요. 청취자에게 존댓말을 쓰고 한국어로만 말해요. 사연을 소개하고 읽은 뒤 DJ답게 공감하고 짧게 이야기를 나눠요. 노래는 제목만 소개하고 틀지 않아요. 라디오는 익명이라 DJ는 보낸 사람이 누군지 모릅니다.";

export function normalizeRadioSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const presets = (Array.isArray(s.presets) ? s.presets : [])
    .map((p) => ({ id: str(p?.id, 60) || randomUUID(), name: str(p?.name, 60), guide: str(p?.guide, 4000) }))
    .filter((p) => p.name && p.guide)
    .slice(0, 40);
  return {
    connectionId: str(s.connectionId, 200),
    zone: s.zone === "device" ? "device" : "Asia/Seoul",
    deviceZone: str(s.deviceZone, 80),
    radioName: str(s.radioName, 40),
    rooms: (Array.isArray(s.rooms) ? s.rooms : [])
      .map((id) => str(id, 200))
      .filter(Boolean)
      .slice(0, 20),
    notify: s.notify !== false,
    djId: str(s.djId, 200),
    // 둘이 진행: a second host who talks with the DJ ("" = the DJ alone).
    coDjId: str(s.coDjId, 200) !== str(s.djId, 200) ? str(s.coDjId, 200) : "",
    guide: str(s.guide, 4000) || DEFAULT_GUIDE,
    presets,
  };
}

function normalizeIndex(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const items = (Array.isArray(s.items) ? s.items : []).filter(
    (it) => typeof it?.id === "string" && Number.isFinite(it.no),
  );
  return { next: Number.isFinite(s.next) ? s.next : items.reduce((n, it) => Math.max(n, it.no + 1), 1), items };
}

/** "밤 11:24" style label and date in the listener's zone. */
export function airTime(zone, date = new Date()) {
  let parts;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        weekday: "long",
        month: "long",
        day: "numeric",
      })
        .formatToParts(date)
        .map((p) => [p.type, p.value]),
    );
  } catch {
    return airTime("Asia/Seoul", date);
  }
  const hour = Number(parts.hour);
  const part = hour < 5 ? "새벽" : hour < 12 ? "아침" : hour < 17 ? "오후" : hour < 21 ? "저녁" : "밤";
  return {
    label: `${part} ${hour % 12 || 12}:${parts.minute}`,
    when: `${parts.weekday}, ${parts.month} ${parts.day}, ${parts.hour}:${parts.minute}`,
  };
}

export function anonymousName(seed = Math.random()) {
  return `010-****-${String(Math.floor(seed * 100)).padStart(2, "0")}`;
}

const cardOf = (record) => {
  const data = typeof record?.data === "string" ? JSON.parse(record.data || "{}") : (record?.data ?? {});
  return data && typeof data === "object" ? data : {};
};
const brief = (card) =>
  [card.description, card.personality, card.scenario]
    .filter((x) => typeof x === "string" && x.trim())
    .join("\n")
    .slice(0, 2500);

export function radioPrompt({ dj, co, guide, time, letter, sender, poster, roomNotes }) {
  return [
    co
      ? `You write one episode of a late-night radio show co-hosted by ${dj.name} (host 1) and ${co.name} (host 2). Keep each in their own character and voice; they talk with each other as well as to the listeners.`
      : `You write one episode of a late-night radio show hosted by ${dj.name}. Stay in ${dj.name}'s character and voice.`,
    co
      ? `Host 1 card (${dj.name}):\n${dj.brief || "(no card text)"}\n\nHost 2 card (${co.name}):\n${co.brief || "(no card text)"}`
      : `Host card:\n${dj.brief || "(no card text)"}`,
    `Show guide (follow it):\n${guide}`,
    `On air: ${time.when} (${time.label}).`,
    letter
      ? `Today's story was sent anonymously by a listener signed "${sender}". The host does not know who they are. Story:\n${letter}`
      : `No listener story today. The host picks a post from the show's story board. It was written anonymously by ${poster ? `${poster.name}, who does not reveal themselves (the host does not know it is them)` : "a listener"}. Invent that post in the writer's own voice and situation${roomNotes ? ", drawn from these recent events in their life" : ""}.`,
    roomNotes ? `Recent events (context only, never quote them as messages):\n${roomNotes}` : "",
    co
      ? 'Reply with JSON only: {"title":"short episode title in Korean","segments":[{"type":"dj","host":1,"text":"…"},{"type":"dj","host":2,"text":"…"},{"type":"letter","from":"signature","text":"the story as read on air"},{"type":"dj","host":2,"text":"…"}]}. 8 to 14 segments, the letter exactly once. Each dj segment is one host speaking ("host" 1 or 2); the two take turns like a real two-host show. Write them as spoken radio talk.'
      : 'Reply with JSON only: {"title":"short episode title in Korean","segments":[{"type":"dj","text":"…"},{"type":"letter","from":"signature","text":"the story as read on air"},{"type":"dj","text":"…"}]}. 4 to 8 segments, the letter exactly once. Write the dj segments as spoken radio talk.',
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseEpisode(parsed, { co = false } = {}) {
  const segments = (Array.isArray(parsed?.segments) ? parsed.segments : [])
    .map((s) => ({
      type: s?.type === "letter" ? "letter" : "dj",
      from: str(s?.from, 60),
      text: str(s?.text, 4000),
      // Two hosts: who says this line (1 the DJ, 2 the co-host).
      ...(co && s?.type !== "letter" ? { host: Number(s?.host) === 2 ? 2 : 1 } : {}),
    }))
    .filter((s) => s.text)
    .slice(0, 30);
  if (!segments.length) throw new Error("The model returned no script.");
  return { title: str(parsed?.title, 80) || "오늘의 사연", segments };
}

export const radioFeature = {
  id: "radio",
  routes(app, { runtime, httpError }) {
    const docs = () => runtime.persistence.documents;
    // A host is a character or one of the user's personas.
    async function hostRecord(id) {
      if (!id) return null;
      const [character] = await runtime.resources.listCharacters([id]).catch(() => []);
      if (character) return character;
      const [persona] = await runtime.resources.listPersonas([id]).catch(() => []);
      return persona ?? null;
    }
    async function upsert(id, kind, name, mutate) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const doc = await docs().getById(PKG, id);
        const data = await mutate(doc?.data ?? null);
        const now = new Date().toISOString();
        if (!doc) {
          try {
            await docs().create({
              id,
              packageId: PKG,
              kind,
              name,
              description: "",
              data,
              createdAt: now,
              updatedAt: now,
            });
            return data;
          } catch {
            continue;
          }
        }
        if (
          await docs().update({
            id,
            packageId: PKG,
            expectedRevision: doc.revision,
            name: doc.name,
            description: doc.description,
            data,
            updatedAt: now,
          })
        )
          return data;
      }
      throw httpError(409, "Radio data changed while saving. Try again.");
    }
    const readSettings = async () => normalizeRadioSettings((await docs().getById(PKG, SETTINGS_ID))?.data);
    const readIndex = async () => normalizeIndex((await docs().getById(PKG, INDEX_ID))?.data);
    const saveIndex = (mutate) =>
      upsert(INDEX_ID, "radio-index", "Radio episodes", async (d) => mutate(normalizeIndex(d)));
    const live = (it) =>
      it.status === "making" && Date.now() - Date.parse(it.createdAt) > STALE_MS
        ? { ...it, status: "failed", error: "서버가 다시 시작돼 끊겼어요" }
        : it;

    async function write(id, input) {
      const settings = input.settings;
      try {
        const djRec = await hostRecord(input.djId);
        if (!djRec) throw new Error("DJ character not found.");
        const djCard = cardOf(djRec);
        const dj = { name: str(djCard.name, 80) || "DJ", brief: brief(djCard) };
        let co = null;
        if (input.coDjId) {
          const coRec = await hostRecord(input.coDjId);
          if (coRec) co = { name: str(cardOf(coRec).name, 80) || "DJ", brief: brief(cardOf(coRec)) };
        }
        let poster = null;
        let roomNotes = "";
        if (!input.letter && settings.rooms.length) {
          const chatId = settings.rooms[Math.floor(Math.random() * settings.rooms.length)];
          const chat = await runtime.persistence.getChat(chatId);
          if (chat) {
            const chars = chat.characterIds?.length ? await runtime.resources.listCharacters(chat.characterIds) : [];
            const names = new Map(chars.map((c) => [c.id, str(cardOf(c).name, 80)]));
            const pool = chars.filter((c) => c.id !== input.djId && c.id !== input.coDjId);
            const pick = (pool.length ? pool : chars)[
              Math.floor(Math.random() * Math.max(1, (pool.length ? pool : chars).length))
            ];
            if (pick) poster = { name: names.get(pick.id) || "listener" };
            const records = (await runtime.persistence.listMessages(chatId)).slice(-16);
            roomNotes = records
              .filter((m) => m.role !== "system")
              .map(
                (m) =>
                  `${m.role === "user" ? "User" : names.get(m.characterId) || "Narrator"}: ${String(m.content ?? "")
                    .replace(/<[^>]+>/g, "")
                    .slice(0, 300)}`,
              )
              .join("\n");
          }
        } else if (!input.letter) {
          const all = await runtime.resources.listCharacters();
          const others = all.filter(
            (c) => c.id !== input.djId && c.id !== input.coDjId && c.id !== "__professor_mari__",
          );
          const pick = others[Math.floor(Math.random() * others.length)];
          if (pick) poster = { name: str(cardOf(pick).name, 80) || "listener" };
        }
        const zone = settings.zone === "device" && settings.deviceZone ? settings.deviceZone : "Asia/Seoul";
        const prompt = radioPrompt({
          dj,
          co,
          guide: settings.guide,
          time: airTime(zone),
          letter: input.letter,
          sender: input.sender,
          poster,
          roomNotes,
        });
        const model = await runtime.languageModels.resolve(settings.connectionId || null);
        const result = await model.chatComplete(
          [
            { role: "system", content: prompt },
            { role: "user", content: "On air." },
          ],
          { temperature: 0.9, maxTokens: 6000 },
        );
        const episode = parseEpisode(
          runtime.json.parseJsonish(typeof result?.content === "string" ? result.content : ""),
          { co: !!co },
        );
        await upsert(EP_PREFIX + id, "radio-episode", "Radio episode", async (d) => ({
          ...d,
          ...episode,
          status: "done",
        }));
        await saveIndex(
          (idx) => (
            (idx.items = idx.items.map((it) =>
              it.id === id ? { ...it, title: episode.title, status: "done", seen: false } : it,
            )),
            idx
          ),
        );
      } catch (error) {
        runtime.logger.warn?.(error, "[mari-kit] radio episode failed");
        const message = str(error?.message ?? String(error), 300);
        await upsert(EP_PREFIX + id, "radio-episode", "Radio episode", async (d) => ({
          ...d,
          status: "failed",
          error: message,
        })).catch(() => {});
        await saveIndex(
          (idx) => (
            (idx.items = idx.items.map((it) => (it.id === id ? { ...it, status: "failed", error: message } : it))),
            idx
          ),
        ).catch(() => {});
      }
    }

    app.get("/radio", async () => {
      const [settings, index] = await Promise.all([readSettings(), readIndex()]);
      return { settings, episodes: index.items.map(live).sort((a, b) => b.no - a.no) };
    });
    app.patch("/radio/settings", async (request) => {
      const b = request.body && typeof request.body === "object" ? request.body : {};
      const data = await upsert(SETTINGS_ID, "radio-settings", "Radio settings", async (d) => {
        const cur = normalizeRadioSettings(d);
        for (const k of [
          "connectionId",
          "zone",
          "deviceZone",
          "radioName",
          "rooms",
          "notify",
          "djId",
          "coDjId",
          "guide",
        ])
          if (b[k] !== undefined) cur[k] = b[k];
        return normalizeRadioSettings(cur);
      });
      return data;
    });
    app.post("/radio/presets", async (request) => {
      const name = str(request.body?.name, 60);
      const guide = str(request.body?.guide, 4000);
      if (!name || !guide) throw httpError(400, "name and guide are required.");
      return upsert(SETTINGS_ID, "radio-settings", "Radio settings", async (d) => {
        const cur = normalizeRadioSettings(d);
        cur.presets = [...cur.presets.filter((p) => p.name !== name), { id: randomUUID(), name, guide }];
        return normalizeRadioSettings(cur);
      });
    });
    app.delete("/radio/presets/:id", async (request) =>
      upsert(SETTINGS_ID, "radio-settings", "Radio settings", async (d) => {
        const cur = normalizeRadioSettings(d);
        cur.presets = cur.presets.filter((p) => p.id !== request.params.id);
        return cur;
      }),
    );
    // Starts an episode and answers at once; the script is written in the background.
    app.post("/radio/broadcast", async (request) => {
      const djId = str(request.body?.djId, 200);
      if (!djId) throw httpError(400, "Pick a DJ.");
      const settings = await readSettings();
      const letter = str(request.body?.letter, 4000);
      const sender = settings.radioName || anonymousName();
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      let no = 1;
      const djRec = await hostRecord(djId);
      if (!djRec) throw httpError(404, "DJ character not found.");
      const djName = str(cardOf(djRec).name, 80) || "DJ";
      const coId = str(request.body?.coDjId, 200);
      const coRec = coId && coId !== djId ? await hostRecord(coId) : null;
      const coDjId = coRec ? coId : "";
      const coDjName = coRec ? str(cardOf(coRec).name, 80) || "DJ" : "";
      await saveIndex((idx) => {
        no = idx.next;
        idx.next += 1;
        idx.items.push({
          id,
          no,
          title: "",
          djId,
          djName,
          ...(coDjId ? { coDjId, coDjName } : {}),
          createdAt,
          status: "making",
          starred: false,
          seen: true,
          letter: !!letter,
        });
        return idx;
      });
      await upsert(EP_PREFIX + id, "radio-episode", "Radio episode", async () => ({
        id,
        no,
        djId,
        djName,
        ...(coDjId ? { coDjId, coDjName } : {}),
        createdAt,
        letter,
        sender,
        status: "making",
      }));
      if (djId !== settings.djId || coDjId !== settings.coDjId)
        await upsert(SETTINGS_ID, "radio-settings", "Radio settings", async (d) =>
          normalizeRadioSettings({ ...normalizeRadioSettings(d), djId, coDjId }),
        ).catch(() => {});
      void write(id, { djId, coDjId, letter, sender, settings });
      return { id, no, status: "making" };
    });
    app.get("/radio/episode/:id", async (request) => {
      const doc = await docs().getById(PKG, EP_PREFIX + str(request.params.id, 80));
      if (!doc) throw httpError(404, "Episode not found.");
      const ep = live(doc.data);
      const index = await readIndex();
      return { ...ep, starred: !!index.items.find((it) => it.id === ep.id)?.starred };
    });
    app.post("/radio/episode/:id/seen", async (request) => {
      const id = str(request.params.id, 80);
      await saveIndex((idx) => ((idx.items = idx.items.map((it) => (it.id === id ? { ...it, seen: true } : it))), idx));
      return { ok: true };
    });
    // Bookmark, unbookmark or delete several at once.
    app.post("/radio/episodes", async (request) => {
      const ids = new Set((Array.isArray(request.body?.ids) ? request.body.ids : []).map((x) => str(x, 80)));
      const action = request.body?.action;
      if (!["star", "unstar", "delete"].includes(action))
        throw httpError(400, "action must be star, unstar or delete.");
      const index = await saveIndex((idx) => {
        if (action === "delete") idx.items = idx.items.filter((it) => !ids.has(it.id));
        else idx.items = idx.items.map((it) => (ids.has(it.id) ? { ...it, starred: action === "star" } : it));
        return idx;
      });
      if (action === "delete")
        for (const id of ids) {
          const doc = await docs().getById(PKG, EP_PREFIX + id);
          if (doc)
            await docs()
              .remove(PKG, doc.id, doc.revision)
              .catch(() => {});
        }
      return { episodes: index.items.map(live).sort((a, b) => b.no - a.no) };
    });
  },
};
