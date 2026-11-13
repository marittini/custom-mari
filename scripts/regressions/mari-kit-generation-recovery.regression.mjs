import assert from "node:assert/strict";
import { stopGeneration, watchGeneration } from "../../custom-modules/mari-kit/shell/lib/generation.js";

class TestDocument extends EventTarget {
  hidden = false;
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

const flush = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

const originalDocument = globalThis.document;
const originalFetch = globalThis.fetch;
globalThis.document = new TestDocument();

try {
  {
    document.hidden = true;
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return response({ active: true });
    };
    const watcher = watchGeneration("background-chat");
    await flush();
    await watcher.check();
    assert.equal(requests, 0, "a hidden page does not fetch generation status");
    document.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    assert.equal(requests, 1, "returning to the page immediately recovers status");
    document.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await watcher.check();
    assert.equal(requests, 1, "backgrounding an active recovery stops further reads");
    watcher.dispose();
    document.hidden = false;
  }
  {
    const states = [
      { active: true, translating: false },
      { active: false, translating: true },
      { active: false, translating: false },
    ];
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return response(states.shift());
    };
    let settled = 0;
    const observed = [];
    const watcher = watchGeneration("chat / one", {
      onState: (state) => observed.push(state),
      onSettled: () => settled++,
    });
    await flush(); // Initial status check.
    await watcher.check(); // Translation keeps the generation pending.
    assert.equal(settled, 0);
    await watcher.check(); // The translation has finished.
    assert.equal(settled, 1, "pending generation settles once after translation completes");
    assert.deepEqual(observed, [
      { active: true, translating: false },
      { active: false, translating: true },
      { active: false, translating: false },
    ]);
    assert.equal(requests[0].url, "/api/generate/status/chat%20%2F%20one");
    watcher.dispose();
  }

  {
    let attached = false;
    let fetches = 0;
    let updates = 0;
    globalThis.fetch = async () => {
      fetches++;
      return response({ active: true, translating: false });
    };
    const watcher = watchGeneration("attached-chat", {
      isAttached: () => attached,
      onState: () => updates++,
    });
    await flush();
    attached = true;
    await watcher.check();
    assert.equal(fetches, 1, "an attached chat skips a redundant status request");
    assert.equal(updates, 1, "an attached chat does not overwrite its state from polling");
    watcher.dispose();
  }

  {
    const pending = deferred();
    globalThis.fetch = () => pending.promise;
    let states = 0;
    let settled = 0;
    const watcher = watchGeneration("disposed-chat", {
      onState: () => states++,
      onSettled: () => settled++,
    });
    await flush();
    watcher.dispose();
    pending.resolve(response({ active: false, translating: false }));
    await flush();
    assert.equal(states, 0, "a response arriving after dispose is ignored");
    assert.equal(settled, 0, "a disposed watcher does not invoke settlement callbacks");
  }

  {
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return response({ ok: true });
    };
    await stopGeneration("chat-42");
    assert.equal(request.url, "/api/generate/abort");
    assert.equal(request.options.method, "POST");
    assert.deepEqual(JSON.parse(request.options.body), { chatId: "chat-42" });
  }
} finally {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalFetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = originalFetch;
}

console.log("Mari Kit generation recovery regression passed.");
