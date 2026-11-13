import assert from "node:assert/strict";

const { data, messageWindow } = await import("../../custom-modules/mari-kit/shell/lib/data.js");
const { api, chatWriteCount, touchedChats } = await import("../../custom-modules/mari-kit/shell/lib/api.js");

const calls = [];
let fetchHandler = async () => response([]);
globalThis.fetch = async (input, init = {}) => {
  const call = { url: String(input), method: init.method || "GET", body: init.body };
  calls.push(call);
  return fetchHandler(call);
};

function response(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

function parsed(call) {
  return new URL(call.url, "https://mari.test");
}

function message(id) {
  return { id, role: "assistant", content: id, createdAt: `2026-01-01T00:00:${id.slice(1)}.000Z` };
}

// Message API and window reads all opt out of prompt-cache extras, while preserving older pages on tail refresh.
{
  const chatId = "chat / one";
  const rows = [message("m4"), message("m5"), message("m6"), message("m7")];
  const olderRows = [message("m2"), message("m3")];
  const tailRows = Array.from({ length: 8 }, (_, i) => message(`m${i + 4}`));
  fetchHandler = async (call) => {
    const url = parsed(call);
    if (url.pathname.endsWith("/messages") && url.searchParams.get("before")) return response(olderRows);
    if (url.pathname.endsWith("/messages") && url.searchParams.get("limit") === "8") return response(tailRows);
    if (url.pathname.endsWith("/messages") && url.searchParams.get("limit") === "4") return response(rows);
    return response([]);
  };
  calls.length = 0;

  await data.messages(chatId, 17);
  let url = parsed(calls.at(-1));
  assert.equal(url.pathname, "/api/chats/chat%20%2F%20one/messages");
  assert.equal(url.searchParams.get("includePromptCache"), "false");
  assert.equal(url.searchParams.get("limit"), "17");
  await data.messages(chatId);
  url = parsed(calls.at(-1));
  assert.equal(url.searchParams.get("includePromptCache"), "false");
  assert.equal(url.searchParams.has("limit"), false);

  const win = messageWindow(chatId, 2);
  await win.reload();
  url = parsed(calls.at(-1));
  assert.equal(url.searchParams.get("limit"), "4");
  assert.equal(url.searchParams.get("includePromptCache"), "false");
  assert.deepEqual(
    win.list.map((row) => row.id),
    ["m4", "m5", "m6", "m7"],
  );
  assert.equal(win.more, true);

  await win.older();
  url = parsed(calls.at(-1));
  assert.equal(url.searchParams.get("limit"), "2");
  assert.equal(url.searchParams.get("includePromptCache"), "false");
  assert.equal(url.searchParams.get("before"), `${rows[0].createdAt}|${encodeURIComponent(rows[0].id)}`);
  assert.deepEqual(
    win.list.map((row) => row.id),
    ["m2", "m3", "m4", "m5", "m6", "m7"],
  );

  await win.reload(true);
  url = parsed(calls.at(-1));
  assert.equal(url.searchParams.get("limit"), "8");
  assert.equal(url.searchParams.get("includePromptCache"), "false");
  assert.equal(url.searchParams.has("before"), false);
  assert.deepEqual(
    win.list.map((row) => row.id),
    ["m2", "m3", ...tailRows.map((row) => row.id)],
    "tail refresh replaces the visible tail without dropping previously loaded older pages",
  );
}

// A forced RP preview is shared with the next list read; a later chat write gets one forced refresh then a cache hit.
{
  const chat = { id: "preview-one", lastMessageAt: "same-at" };
  let previewCalls = 0;
  fetchHandler = async (call) => {
    if (parsed(call).pathname.endsWith("/mari-kit/shell/previews")) {
      previewCalls++;
      return response({ [chat.id]: { at: "same-at", line: `line-${previewCalls}`, assistant: "reply" } });
    }
    return response({ ok: true });
  };
  touchedChats.delete(chat.id);
  calls.length = 0;

  const rp = await data.previews([chat], true);
  let url = parsed(calls.at(-1));
  assert.equal(url.pathname, "/api/mari-kit/shell/previews");
  assert.equal(url.searchParams.get("ids"), chat.id, "RP force fetch stays limited to one chat id");
  assert.equal(url.searchParams.get("fresh"), chat.id);
  assert.equal(rp.get(chat.id).line, "line-1");
  assert.equal(touchedChats.has(chat.id), false);
  const list = await data.previews([chat]);
  assert.equal(list.get(chat.id).line, "line-1");
  assert.equal(previewCalls, 1, "the list reuses the RP preview response");

  await api.post(`/chats/${chat.id}/messages`, { chatId: chat.id, content: "new reply" });
  assert.equal(touchedChats.has(chat.id), true, "a chat message write invalidates its preview");
  const refreshed = await data.previews([chat], true);
  assert.equal(refreshed.get(chat.id).line, "line-2");
  assert.equal(touchedChats.has(chat.id), false);
  const afterWrite = await data.previews([chat]);
  assert.equal(afterWrite.get(chat.id).line, "line-2");
  assert.equal(previewCalls, 2, "write plus forced refresh still produces one preview fetch");
}

// An older in-flight response can be returned to its own caller but cannot overwrite a post-write fresh cache.
{
  const chat = { id: "preview-race", lastMessageAt: "new-at" };
  const a = deferred();
  const b = deferred();
  let previewCalls = 0;
  fetchHandler = (call) => {
    if (parsed(call).pathname.endsWith("/mari-kit/shell/previews")) {
      previewCalls++;
      return previewCalls === 1 ? a.promise : b.promise;
    }
    return Promise.resolve(response({ ok: true }));
  };
  touchedChats.delete(chat.id);
  calls.length = 0;

  const staleFetch = data.previews([chat], true);
  assert.equal(previewCalls, 1);
  await api.post(`/chats/${chat.id}/messages`, { chatId: chat.id, content: "newer reply" });
  assert.equal(touchedChats.has(chat.id), true);
  const freshFetch = data.previews([chat]);
  assert.equal(previewCalls, 2, "the write invalidation starts a concurrent fresh preview fetch");

  b.resolve(response({ [chat.id]: { at: "new-at", line: "new", assistant: "new response" } }));
  const fresh = await freshFetch;
  assert.equal(fresh.get(chat.id).line, "new");
  a.resolve(response({ [chat.id]: { at: "old-at", line: "old", assistant: "stale response" } }));
  const stale = await staleFetch;
  assert.equal(stale.get(chat.id).line, "old", "the in-flight caller can still receive its own response");

  const list = await data.previews([chat]);
  assert.equal(list.get(chat.id).line, "new", "the old response cannot replace the fresh cache");
  assert.equal(previewCalls, 2, "the list uses the fresh cache without another request");
}

// An out-of-date request that settles before the post-write refresh must leave the invalidation in place.
{
  const chat = { id: "preview-touch", lastMessageAt: "new-at" };
  const pending = deferred();
  let previewCalls = 0;
  fetchHandler = (call) => {
    if (parsed(call).pathname.endsWith("/mari-kit/shell/previews")) {
      previewCalls++;
      return previewCalls === 1
        ? pending.promise
        : Promise.resolve(response({ [chat.id]: { at: "new-at", line: "new", assistant: "fresh" } }));
    }
    return Promise.resolve(response({ ok: true }));
  };
  touchedChats.delete(chat.id);

  const staleFetch = data.previews([chat], true);
  await api.post(`/chats/${chat.id}/messages`, { chatId: chat.id, content: "newer reply" });
  pending.resolve(response({ [chat.id]: { at: "old-at", line: "old", assistant: "stale" } }));
  await staleFetch;
  assert.equal(touchedChats.has(chat.id), true, "a response racing with a write does not consume the touch marker");
  const refreshed = await data.previews([chat]);
  assert.equal(refreshed.get(chat.id).line, "new");
  assert.equal(previewCalls, 2, "the next preview performs the required forced refresh");
  assert.equal(touchedChats.has(chat.id), false);
}

assert.ok(chatWriteCount() >= 3, "the fixture exercised real API-layer chat-write invalidation");
console.info("Mari Kit data-transfer regression passed.");
