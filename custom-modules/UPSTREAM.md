# Upstream issue drafts (Pasta-Devs/Marinara-Engine)

Drafted from the Engine edits that were made in this repository (WORK.md M-7). For the owner to file upstream.

## 1. Capability-package agents with `execution: "feature"` are resolved into the LLM agent pipeline and Retry Failed Agents

**What happens:** `resolveAgentPipelineAgents` (`packages/server/src/services/generation/agent-resolution.ts`) and
`resolveRetryAgents` (`packages/server/src/routes/generate/retry-agents-route.ts`) filter out host-managed, retired and
runtime-disabled agents, but not `execution: "feature"`. A package agent declaring `execution: "feature"` (no pipeline
prompt; it supplies its own runtime and prompt context) is still resolved and run as a generic LLM agent (configured
agents and the per-chat built-in fallback), and reappears in "Retry Failed Agents".

**Steps to reproduce:** 1) Install a capability package whose agent definition has `"execution": "feature"` and an
empty `defaultPromptTemplate`. 2) Enable that agent on a chat. 3) Send a message with debug logging on.

**Expected:** Feature agents never enter the LLM agent pipeline or retry resolution; their package hooks (e.g. prompt
context) still run.

**Proposed fix:** Add `BUILT_IN_AGENTS.find(a => a.id === config.type)?.execution !== "feature"` to the
configured-agent filter and `agent.execution !== "feature"` to the built-in fallback filter in both files (5 lines).

## 2. Translation can alter or drop `<audio_character>`/`<audio_persona>` wrappers and bracketed delivery cues

**What happens:** `translateText` (`packages/server/src/services/translation.service.ts`) sends message text to the
provider unmodified. With speaker wrappers such as `<audio_character id="…">「[low, amused] …」</audio_character>`, the
translator may translate, reorder or remove tags, ids and English cues; the result is saved and per-speaker voice
playback breaks.

**Steps to reproduce:** Translate `<audio_character id="c1">[sighs] You came back.</audio_character>` to another
language with any provider.

**Expected:** Wrappers, ids and cues are preserved exactly; if the provider breaks them, the request fails instead of
saving a broken translation.

**Proposed fix:** Replace those fragments with unique placeholder tokens before translating, tell AI providers to copy
the tokens, restore afterwards, and return 422 if token count/order/content changed (~50 lines in
`translation.service.ts`; covers manual and automatic translation, both use `translateText`).

## 3. `activeGenerations` entry can leak when generation setup throws after registration

**What happens:** In `packages/server/src/routes/generate.routes.ts`, `executeGeneration` sets
`activeGenerations.set(chatId, record)` and relies on later code to release it. If setup throws after registration but
before that cleanup, the record stays: `GET /api/generate/status/:chatId` reports an active generation indefinitely
and a new generation for that chat can be rejected.

**Steps to reproduce:** Make generation fail after the registry entry is created (e.g. a provider/connection error
during setup), then call `GET /api/generate/status/<chatId>`.

**Expected:** The entry is released whenever the invocation that created it ends, without removing a newer run's entry.

**Proposed fix:** Pass an `onRegistered(abortController)` callback into `executeGeneration`; in `runGeneration`, wrap
`runWithRoomGeneration` in try/finally and delete `activeGenerations[chatId]` only if its `abortController` is the one
this invocation registered (~20 lines).

## 4. Option to omit `extra.cachedPrompt` from `GET /api/chats/:id/messages`

**What happens:** The message list returns each message's `extra`, which can contain the full cached prompt used to
generate it. In long chats this dominates the response size for clients that never read it.

**Steps to reproduce:** Open a chat with a few hundred generated messages; `GET /api/chats/<id>/messages?limit=50`;
compare the size with and without `extra.cachedPrompt`.

**Expected:** A client can opt out of the cached prompt; default unchanged.

**Proposed fix:** Accept `includePromptCache=false` and pass it to `withoutPromptOnlyExtra(rows, { includePromptCache })`,
which then also deletes `extra.cachedPrompt` (~40 lines in `packages/server/src/routes/chats.routes.ts`).
