/**
 * ==========================================================
 * LÉLU — A TOKEN IS NOT A SAVE
 *
 * CATEGORY: integration. The real MultiChatStore and the real
 * KvStore, with the storage backends instrumented so the
 * assertions are about actual writes rather than about intent.
 *
 * Measured before this: GenesisBridge upserts the assistant
 * message on every SSE delta, upsertMessage called persist(),
 * and persist() JSON.stringify'd the WHOLE workspace to three
 * backends. One short turn in a real browser did 384
 * Storage.setItem calls and wrote 670KB, and every read parsed
 * the whole blob back again. On a 422KB payload one such save
 * measured 17.8ms — stringify 1.9, localStorage 4.6,
 * sessionStorage 3.4, window.name 7.9.
 *
 * The fix must not trade durability for speed, so these pin
 * both halves: writes are coalesced, AND a completed turn is on
 * disk.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/** Instrumented storage, installed before the stores are imported. */
const writes: Array<{ backend: string; key: string; bytes: number }> = [];

function makeStorage(backend: string) {
  const data: Record<string, string> = {};
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      writes.push({ backend, key, bytes: value.length });
      data[key] = value;
    },
    removeItem: (key: string) => { delete data[key]; },
    clear: () => { for (const k of Object.keys(data)) delete data[k]; },
    get length() { return Object.keys(data).length; },
    key: (i: number) => Object.keys(data)[i] ?? null,
  };
}

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
(globalThis as Record<string, unknown>).localStorage = makeStorage("local");
(globalThis as Record<string, unknown>).sessionStorage = makeStorage("session");

import MultiChatStore from "../src/core/multichat/MultiChatStore";

const chats = MultiChatStore.getInstance();
const WORKSPACE_KEY = "lelu.multichat.workspace.v1";

/**
 * SAVES of the conversation payload, not setItem calls.
 *
 * One KvStore.set writes the same string to localStorage AND
 * sessionStorage, so counting raw setItem calls doubles every number —
 * the first run of this file failed "flush did not write: 2 !== 1" for
 * exactly that reason. Counting one backend counts saves.
 */
function workspaceWrites() {
  return writes.filter(
    (write) => write.backend === "local" && write.key.includes("multichat.workspace"),
  );
}

function reset() {
  chats.flush();
  writes.length = 0;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ *
 * COALESCING
 * ------------------------------------------------------------------ */

/**
 * ONE test for everything that counts writes.
 *
 * `writes` is one array and node:test runs top-level tests concurrently,
 * so as separate cases they counted each other's saves — the first run
 * of this file failed "flush did not write: 2 !== 1" because a
 * neighbouring test's coalesced timer landed inside this one's window.
 */
test("streaming writes are coalesced, and a finished turn is durable", async (t) => {
  await t.test("a stream of forty deltas does not write forty times", async () => {
  const conversation = chats.create("Streaming");
  chats.addMessage(conversation.id, {
    id: "user-1", role: "user", text: "ask", timestamp: Date.now(), source: "local",
  });
  reset();

  // Exactly what GenesisBridge does on each SSE delta: upsert the same
  // message id with more text.
  const id = "assistant-1";
  for (let i = 1; i <= 40; i += 1) {
    chats.upsertMessage(conversation.id, {
      id, role: "assistant", text: "word ".repeat(i), timestamp: Date.now(), source: "ai",
    });
  }

  const during = workspaceWrites().length;
  assert.ok(
    during <= 2,
    `forty deltas produced ${during} workspace write(s); this is the per-token persistence the fix removes`,
  );

  // And the UI has the live text immediately — nothing about reading is
  // deferred, only the serialisation.
  assert.equal(
    chats.get(conversation.id)?.messages.find((m) => m.id === id)?.text,
    "word ".repeat(40),
    "the in-memory state is not live during streaming",
  );
  });

  await t.test("the deltas do land, on their own, without anyone flushing", async () => {
  const conversation = chats.create("Coalesced");
  reset();
  chats.upsertMessage(conversation.id, {
    id: "a", role: "assistant", text: "partial", timestamp: Date.now(), source: "ai",
  });
  assert.equal(workspaceWrites().length, 0, "the write was not deferred at all");

  // The coalescing window is 250ms.
  await sleep(400);
  assert.ok(workspaceWrites().length >= 1, "a coalesced write never landed");
  });

  await t.test("a finished turn is durable immediately, not in 250ms", () => {
  const conversation = chats.create("Flushed");
  reset();
  chats.upsertMessage(conversation.id, {
    id: "final", role: "assistant", text: "the complete reply", timestamp: Date.now(), source: "ai",
  });
  assert.equal(workspaceWrites().length, 0);

  // This is what GenesisChat's finally does when a turn completes —
  // including when it completed by failing.
  chats.flush();

  assert.equal(workspaceWrites().length, 1, "flush did not write");
  const raw = globalThis.localStorage.getItem(WORKSPACE_KEY);
  assert.ok(raw, "nothing was persisted");
  assert.match(raw, /the complete reply/, "the completed reply is not in the persisted state");
  });

  await t.test("flushing twice writes once; flushing with nothing pending writes nothing", () => {
  const conversation = chats.create("Idempotent");
  reset();
  chats.upsertMessage(conversation.id, {
    id: "x", role: "assistant", text: "once", timestamp: Date.now(), source: "ai",
  });
  chats.flush();
  const after = workspaceWrites().length;
  chats.flush();
  chats.flush();
  assert.equal(workspaceWrites().length, after, "flush is not idempotent");
  });

  await t.test("a message is never duplicated by the upsert path", () => {
  const conversation = chats.create("No duplicates");
  for (let i = 1; i <= 25; i += 1) {
    chats.upsertMessage(conversation.id, {
      id: "same-id", role: "assistant", text: `v${i}`, timestamp: Date.now(), source: "ai",
    });
  }
  chats.flush();
  const messages = chats.get(conversation.id)?.messages ?? [];
  assert.equal(messages.length, 1, `the stream produced ${messages.length} messages instead of one`);
  assert.equal(messages[0].text, "v25", "the final text is not the last delta");
  });

  await t.test("coalescing does not leak between conversations", () => {
  const a = chats.create("A");
  const b = chats.create("B");
  chats.upsertMessage(a.id, { id: "a1", role: "assistant", text: "in A", timestamp: Date.now(), source: "ai" });
  chats.upsertMessage(b.id, { id: "b1", role: "assistant", text: "in B", timestamp: Date.now(), source: "ai" });
  chats.flush();

  assert.equal(chats.get(a.id)?.messages.length, 1);
  assert.equal(chats.get(b.id)?.messages.length, 1);
  assert.equal(chats.get(a.id)?.messages[0].text, "in A");
  assert.equal(chats.get(b.id)?.messages[0].text, "in B");
  });
});

/* ------------------------------------------------------------------ *
 * window.name
 * ------------------------------------------------------------------ */

test("window.name is never written", () => {
  (globalThis as Record<string, unknown>).name = "";
  const conversation = chats.create("No window.name");
  chats.upsertMessage(conversation.id, {
    id: "w", role: "assistant", text: "x".repeat(500), timestamp: Date.now(), source: "ai",
  });
  chats.flush();
  assert.equal(
    String((globalThis as { name?: string }).name ?? ""),
    "",
    "window.name is still being written as a persistence backend",
  );
});

test("a value left only in window.name is migrated, not discarded", async () => {
  const { default: KvStore } = await import("../src/core/storage/KvStore");
  const kv = KvStore.getInstance();
  // Exactly the shape the old backend wrote, double prefix and all: it
  // was handed the ALREADY-prefixed key and prefixed it again, which is
  // why keys like "lelu.lelu.world.lifecycle.v2" exist in the wild.
  // Migration has to read what was actually written, not what should
  // have been.
  (globalThis as Record<string, unknown>).name = `lelu.lelu.legacy.probe=${JSON.stringify({ kept: true })}`;

  const read = kv.get<{ kept: boolean }>("legacy.probe");
  assert.deepEqual(read, { kept: true }, "a value only in window.name was lost");

  // And it is now in a real backend, so this was the last read from there.
  assert.ok(
    globalThis.localStorage.getItem("lelu.legacy.probe"),
    "the legacy value was read but never migrated",
  );
  (globalThis as Record<string, unknown>).name = "";
});

test("window.name is not in the write path at all", () => {
  // Comments discuss window.name at length on purpose; only code counts.
  const source = readFileSync("src/core/storage/KvStore.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const backends = source.slice(source.indexOf("const backends"), source.indexOf("const legacyWindowNameBackend"));
  assert.ok(
    !/window\.name/.test(backends),
    "window.name is still one of the write backends",
  );
  assert.match(source, /legacyWindowNameBackend/, "the migration path is missing");
});

/* ------------------------------------------------------------------ *
 * THE SCENE
 * ------------------------------------------------------------------ */

test("scene consumers read the stable context, so a token cannot re-render them", () => {
  const sceneFiles = [
    "src/app/scene/genesis/environment/Cosmos.tsx",
    "src/app/scene/genesis/environment/stars/StarField.tsx",
    "src/app/scene/genesis/environment/AuroraCosmos.tsx",
    "src/app/scene/genesis/systems/CoreAtmosphere.tsx",
    "src/app/scene/genesis/EngineTick.tsx",
    // The compositor these four sit under. It read engineRuntime from
    // useGenesis(), so it re-rendered on every state change and took
    // all four with it — measured at 12 re-renders each per message,
    // with everything else already at zero.
    "src/app/scene/genesis/render/GenesisRenderer.tsx",
  ];
  for (const file of sceneFiles) {
    const source = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.match(source, /useGenesisScene\(/, `${file} does not use the stable scene context`);
    assert.ok(
      !/useGenesis\(\)/.test(source),
      `${file} still subscribes to the monolithic Genesis context, so chat state re-renders it`,
    );
  }
});

test("the scene subtree is memoised, so a parent re-render stops at it", () => {
  // The stable context stops a token re-rendering these through
  // CONTEXT. It does not stop their PARENT re-rendering them:
  // GenesisWorkspaceRouter calls useGenesis(), so it rebuilds every
  // child element beneath it on each state change. Both halves are
  // needed, and the ledger measured 48 scene renders per message with
  // only the context half in place.
  const scene = readFileSync("src/app/scene/genesis/GenesisScene.tsx", "utf8");
  assert.match(
    scene,
    /const GenesisV1Workspace = memo\(/,
    "the v1 scene is not memoised, so the router re-renders the whole cosmos",
  );

  const tick = readFileSync("src/app/scene/genesis/EngineTick.tsx", "utf8");
  assert.match(
    tick,
    /export default memo\(/,
    "EngineTick is not memoised, so the router re-renders the simulation heartbeat",
  );
});

test("the render ledger counts both contexts and costs nothing in production", () => {
  // The instrument the claim rests on. If it only counted one side,
  // "scene renders: 0" would be unfalsifiable — a broken counter and a
  // fixed cascade look identical.
  const source = readFileSync("src/app/scene/genesis/useGenesisScene.ts", "utf8");
  assert.match(source, /if \(!import\.meta\.env\.DEV\) return;/, "the ledger would ship to production");
  assert.match(source, /countRender\("scene", who\)/, "scene renders are not counted");

  const core = readFileSync("src/app/scene/genesis/GenesisCore.tsx", "utf8");
  assert.match(core, /countRender\("chat"\)/, "chat renders are not counted, so there is nothing to compare against");
});

test("the scene context value is memoised with no dependencies, so its identity never changes", () => {
  const source = readFileSync("src/app/scene/genesis/GenesisCore.tsx", "utf8");
  const start = source.indexOf("const sceneValue = useMemo<GenesisSceneValue>");
  assert.ok(start > 0, "the scene context value is not built");
  const block = source.slice(start, start + 900);
  // An empty dependency array is the whole point: a value that is
  // rebuilt is a value that re-renders its consumers.
  assert.match(block, /\[\],\s*\)/, "the scene context value has dependencies and will be rebuilt");
  assert.match(block, /getLiveState/, "frame-loop consumers have no way to read live state on demand");
});

test("EngineTick samples state in its frame loop rather than from a render", () => {
  const source = readFileSync("src/app/scene/genesis/EngineTick.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.match(source, /signalsRef\.current = sampleSignals\(\);/, "signals are not sampled in the loop");
  assert.ok(
    !/uiState\.messages\s*\]/.test(source),
    "the engine loop still re-runs on every message change",
  );
});
