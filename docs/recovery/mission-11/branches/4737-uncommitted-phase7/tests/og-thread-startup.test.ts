/**
 * ==========================================================
 * LÉLU — OG THREAD STARTUP
 *
 * CATEGORY: unit. Reads the real source tree for the wiring, and exercises
 * the real rules module for the behaviour.
 *
 * The bug this pins: the OG Core chat panel rendered
 *
 *   ChatPanelWrap → createConversation() → getMessages() → ChatInner
 *
 * with every step as a gate, so a Supabase insert or read that was slow,
 * rejected or unreachable left the panel on "opening a thread…" forever and
 * the chat runtime — AIService, memory recall, every provider — was never
 * mounted. LÉLU appeared to be thinking about opening a thread she would
 * never open.
 *
 * The rule under test: opening a thread is a LOCAL operation. History is a
 * decoration applied afterwards, inside a deadline, and never the condition
 * for the input box existing.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  HISTORY_DEADLINE_MS,
  deriveThreadTitle,
  mergeRemoteMessages,
  mintThreadId,
  readThreadSnapshot,
  threadSnapshotKey,
  withinDeadline,
  writeThreadSnapshot,
} from "../src/og/lib/thread-startup";

/** Source with comments removed: these guards are about code, not prose. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const wrapSource = code("src/og/components/core/panels/ChatPanelWrap.tsx");
const panelSource = code("src/og/components/universe/ChatPanel.tsx");

function fakeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    entries: () => [...store.entries()],
  };
}

const userTurn = (id: string, text: string) => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});
const assistantTurn = (id: string, text: string) => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text }],
});

test("a thread id is minted locally, in the canonical conversation shape", () => {
  const id = mintThreadId(1_700_000_000_000, () => 0.5);
  // The shape `createConversation` already produces: the local id is handed to
  // the remote insert, so the two must not disagree.
  assert.match(id, /^conv-\d+-[a-z0-9]+$/);
  assert.equal(id, mintThreadId(1_700_000_000_000, () => 0.5));
  assert.notEqual(mintThreadId(), mintThreadId());
});

test("the local snapshot round-trips, and a corrupt one degrades to nothing", () => {
  const storage = fakeStorage();
  const messages = [userTurn("u1", "hello"), assistantTurn("a1", "hello back")];

  assert.equal(readThreadSnapshot("t1", storage), null, "an unopened thread has no snapshot");

  writeThreadSnapshot("t1", messages, storage);
  assert.equal(threadSnapshotKey("t1"), "lelu:thread:t1");
  assert.deepEqual(readThreadSnapshot("t1", storage), messages);

  storage.setItem("lelu:thread:t2", "{ not json");
  assert.equal(readThreadSnapshot("t2", storage), null);

  // No storage at all (SSR, private mode, a device with storage disabled) is
  // not an error: the thread simply starts empty.
  assert.equal(readThreadSnapshot("t1", undefined), null);
  assert.doesNotThrow(() => writeThreadSnapshot("t1", messages, undefined));
});

test("late history is merged into the live thread, never over it", () => {
  const remote = [userTurn("u1", "what were we building?"), assistantTurn("a1", "a horizon")];
  const local = [
    userTurn("u1", "what were we building?"),
    assistantTurn("a1", "a horizon"),
    userTurn("u2", "and the roof?"),
    assistantTurn("a2", ""), // the in-flight turn, no text yet
  ];

  const merged = mergeRemoteMessages(remote, local);
  assert.deepEqual(
    merged.map((m) => m.id),
    ["u1", "a1", "u2", "a2"],
    "server history first, then anything this session has that the server does not",
  );

  // A persisted round trip reuses the UI message ids, so reconciling must not
  // duplicate the transcript.
  assert.equal(mergeRemoteMessages(remote, remote).length, 2);

  // No history yet: the snapshot IS the thread.
  assert.deepEqual(mergeRemoteMessages([], local), local);
});

test("a slow history read gives up without claiming the thread is empty", async () => {
  const fast = await withinDeadline(Promise.resolve(["row"]), 50);
  assert.deepEqual(fast, ["row"]);

  // null is "no answer inside the budget" — deliberately distinct from [].
  const hanging = await withinDeadline(new Promise<string[]>(() => {}), 20);
  assert.equal(hanging, null);

  // A rejection is the caller's to handle; it is not converted into "empty".
  await assert.rejects(
    withinDeadline(Promise.reject(new Error("Invalid API key")), 50),
    /Invalid API key/,
  );
});

test("the deadline is bounded, so a hung request cannot pin a thread", () => {
  assert.ok(HISTORY_DEADLINE_MS > 0 && HISTORY_DEADLINE_MS <= 15_000);
});

test("a thread title comes from the first thing the user said", () => {
  assert.equal(deriveThreadTitle([]), "A new horizon");
  assert.equal(
    deriveThreadTitle([assistantTurn("a1", "hello"), userTurn("u1", "  what   were we building? ")]),
    "what were we building?",
  );
  const long = deriveThreadTitle([userTurn("u1", "x".repeat(200))]);
  assert.ok(long.length <= 60, `title should be trimmed, got ${long.length} chars`);
  assert.ok(long.endsWith("…"));
});

test("opening the OG chat cannot wait for the network", () => {
  // The exact shape of the bug: a state that stays undefined until a remote
  // insert resolves, rendered as a placeholder instead of the chat.
  assert.ok(
    !/opening a thread/i.test(wrapSource),
    "the panel must not show a placeholder while a thread is being created remotely",
  );
  assert.ok(
    /mintThreadId/.test(wrapSource),
    "the thread id must be minted locally",
  );
  assert.ok(
    /<ChatPanel/.test(wrapSource) && !/if \(!threadId\)/.test(wrapSource),
    "ChatPanel must render unconditionally — no gate on the thread id existing",
  );

  // The second gate: ChatPanel rendered a placeholder until getMessages()
  // resolved. It must not have a null-initialised transcript any more.
  assert.ok(
    !/initialMessages === null/.test(panelSource),
    "ChatPanel must not block rendering on the transcript request",
  );
  assert.ok(
    /useState<UIMessage\[\]>\(\s*\(\) => readThreadSnapshot/.test(panelSource),
    "the transcript must be seeded synchronously from the local snapshot",
  );
  assert.ok(
    /withinDeadline\(/.test(panelSource),
    "remote history must be read inside a deadline",
  );
  assert.ok(
    /setMessages\(\(prev\) => mergeRemoteMessages/.test(panelSource),
    "late history must reconcile into the live thread",
  );
});

test("the OG chat still uses the ONE canonical brain and transcript store", () => {
  // §4: no second chat engine. The turn must go through the compat useChat
  // (which calls AIService), not a new endpoint or a provider SDK here.
  assert.ok(/from "@og\/compat\/chat"/.test(panelSource), "turns go through the compat useChat");
  assert.ok(
    !/(openai|anthropic|@anthropic-ai)/i.test(panelSource),
    "the panel must not call a provider directly",
  );
  assert.ok(
    /appendMessages/.test(panelSource) && /ensureConversation/.test(panelSource),
    "turns are stored through the canonical conversation functions",
  );
  // A memory write path anywhere in this file would be a second memory system.
  assert.ok(!/MemoryStore|persistMemories/.test(panelSource));
});
