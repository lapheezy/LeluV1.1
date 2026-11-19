/**
 * ==========================================================
 * LÉLU 2.2.2 — GLOBAL COGNITIVE CONTEXT ELIMINATION
 *
 * M22.1 left two carriers: workspace observation labels and the
 * agent cognitive snapshot. Both are tested here against the
 * same rule the memory store already obeys: a name may be
 * discoverable, content is not.
 *
 * No model is called.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

/* ------------------------- browser shims (Node) ------------------------- */
const databases = new Map<string, Map<string, Map<string, unknown>>>();
class ShimRequest {
  result: unknown = null;
  onsuccess: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  settle(): void {
    queueMicrotask(() => this.onsuccess?.());
  }
}
class ShimObjectStore {
  constructor(private readonly rows: Map<string, unknown>) {}
  put(value: unknown): void {
    const record = value as { id: string };
    this.rows.set(record.id, structuredClone(value));
  }
  delete(id: string): void {
    this.rows.delete(id);
  }
  clear(): void {
    this.rows.clear();
  }
  get(id: string): ShimRequest {
    const req = new ShimRequest();
    req.result = this.rows.has(id) ? structuredClone(this.rows.get(id)) : null;
    req.settle();
    return req;
  }
  getAll(): ShimRequest {
    const req = new ShimRequest();
    req.result = [...this.rows.values()].map((value) => structuredClone(value));
    req.settle();
    return req;
  }
}
class ShimTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly stores: Map<string, ShimObjectStore>;
  constructor(db: ShimDatabase, storeName: string) {
    this.stores = new Map([[storeName, new ShimObjectStore(db.store(storeName))]]);
    queueMicrotask(() => this.oncomplete?.());
  }
  objectStore(name: string): ShimObjectStore {
    return this.stores.get(name)!;
  }
}
class ShimDatabase {
  onversionchange: (() => void) | null = null;
  constructor(private readonly name: string) {}
  store(storeName: string): Map<string, unknown> {
    const db = databases.get(this.name)!;
    if (!db.has(storeName)) db.set(storeName, new Map());
    return db.get(storeName)!;
  }
  get objectStoreNames() {
    return { contains: (name: string) => databases.get(this.name)!.has(name) };
  }
  createObjectStore(storeName: string): void {
    databases.get(this.name)!.set(storeName, new Map());
  }
  transaction(storeName: string): ShimTransaction {
    return new ShimTransaction(this, storeName);
  }
  close(): void {}
}
// @ts-expect-error — global shim for Node
globalThis.indexedDB = {
  open(name: string): ShimRequest {
    if (!databases.has(name)) databases.set(name, new Map());
    const req = new ShimRequest();
    const db = new ShimDatabase(name);
    req.result = db;
    queueMicrotask(() => {
      if (!db.objectStoreNames.contains("memories")) req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
};
class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
}
// @ts-expect-error — global shim for Node
globalThis.window = {
  localStorage: new FakeStorage(),
  sessionStorage: new FakeStorage(),
  name: "",
  location: { origin: "http://localhost:3000" },
};

import CognitiveCore from "../src/core/cognition/CognitiveCore";
import WorkspaceManager, { isObservationVisible } from "../src/core/cognition/WorkspaceManager";
import {
  authorizeContextSections,
  type ContextSection,
} from "../src/core/cognition/ContextAuthorization";
import { buildCognitiveContext, formatCognitiveContext } from "../src/core/cognition/CognitiveContext";
import ProjectStore from "../src/core/projects/ProjectStore";
import { currentSessionId, type MemoryScopeContext } from "../src/core/memory/MemorySovereignty";
import Brain from "../src/brain/Brain";

const USER_A = "ctx-user-a";
const USER_B = "ctx-user-b";

let seq = 0;
const uniqueUser = () => `ctx-user-${(seq += 1)}-${Date.now().toString(36)}`;

function scope(conversationId: string | null, userId = USER_A, prompt = "status"): MemoryScopeContext {
  return { userId, conversationId, sessionId: currentSessionId(), prompt };
}

function project(name: string, options: { ownerId?: string | null; conversationId?: string | null; scope?: any } = {}) {
  const store = ProjectStore.getInstance();
  const created = store.create(
    { name, description: `${name} description` },
    {
      ownerId: options.ownerId ?? USER_A,
      conversationId: options.conversationId ?? "chat-a",
      conversationTitle: "Studio",
      sessionId: currentSessionId(),
      scope: options.scope ?? "user-persistent",
    },
  );
  store.addItem(created.id, { kind: "note", title: "note", text: `${name} private note` });
  return created;
}

/* ============================================================
 * GROUP W — WORKSPACE OBSERVATION SOVEREIGNTY
 * ============================================================ */

test("W: an observation is readable only in the conversation that made it", () => {
  const workspaces = new WorkspaceManager();
  workspaces.create("core", "Lélu Core");
  workspaces.add("core", "My father died last month.", {
    conversationId: "chat-a",
    userId: USER_A,
    scope: "conversation-local",
  });

  assert.deepEqual(workspaces.itemsFor("core", scope("chat-a")), ["My father died last month."]);
  assert.deepEqual(workspaces.itemsFor("core", scope("chat-b")), [], "another chat may not read it");
  assert.deepEqual(workspaces.itemsFor("core", scope(null)), [], "no identity, no content");
});

test("W: workspace names and counts are listable without their content", () => {
  const workspaces = new WorkspaceManager();
  workspaces.create("core", "Lélu Core");
  workspaces.add("core", "A private observation about the Tampa commission.", {
    conversationId: "chat-a",
    scope: "conversation-local",
  });

  const listed = workspaces.all();
  assert.equal(listed[0].name, "Lélu Core");
  assert.equal(listed[0].observationCount, 1);
  const serialized = JSON.stringify(listed);
  assert.equal(serialized.includes("Tampa"), false, "listing workspaces must never serialize observation text");
});

test("W: another user's observation is refused even in the same conversation id", () => {
  const workspaces = new WorkspaceManager();
  workspaces.create("core", "Core");
  workspaces.add("core", "A note that belongs to A.", {
    conversationId: "chat-a",
    userId: USER_A,
    scope: "conversation-local",
  });
  assert.deepEqual(workspaces.itemsFor("core", scope("chat-a", USER_B)), []);
});

test("W: session observations do not survive the session", () => {
  const workspaces = new WorkspaceManager();
  workspaces.create("core", "Core");
  const observation = workspaces.add("core", "Temporary scratch note.", {
    conversationId: null,
    scope: "session-local",
  })!;
  assert.equal(isObservationVisible(observation, { userId: null, conversationId: null, sessionId: "other-session" }), false);
  assert.equal(isObservationVisible(observation, { userId: null, conversationId: null, sessionId: currentSessionId() }), true);
});

test("W: an unattributed observation is never shown as a conversation's context", () => {
  const workspaces = new WorkspaceManager();
  workspaces.create("core", "Core");
  workspaces.add("core", "An old note with no origin.");
  assert.deepEqual(workspaces.itemsFor("core", scope("chat-a")), [], "session-bound by default, never a chat's");
});

test("W: deleting a memory or a conversation removes its observations", async () => {
  const brain = new Brain();
  const learned = await brain.learn(
    "My vault code is written on the green card.",
    "Noted.",
    "conversation",
    [],
    {
      source: "lelu-chat",
      originSeed: { userId: USER_A, conversationId: "chat-a", sessionId: currentSessionId(), sourceType: "user-said" },
    },
  );
  assert.ok(learned);
  const before = (brain as any).cognition.state("chat-a");
  assert.equal(before.workspaces.every((workspace: any) => typeof workspace.name === "string"), true);

  await brain.forgetMemory(learned!.id);
  const itemsAfter = (brain as any).cognition.workspaceItems("core", scope("chat-a"));
  assert.equal(itemsAfter.some((text: string) => text.includes("green card")), false, "the observation went with the memory");

  await brain.forgetConversation("chat-a");
  assert.deepEqual((brain as any).cognition.workspaceItems("core", scope("chat-a")), []);
});

test("W: deleting one observation leaves the rest of the workspace intact", () => {
  const manager = new WorkspaceManager();
  manager.create("core", "Lélu Core");
  const kept = manager.add("core", "Kept observation", {
    conversationId: "chat-a",
    userId: USER_A,
    scope: "conversation-local",
    sourceType: "user-said",
  })!;
  const removed = manager.add("core", "Removed observation", {
    conversationId: "chat-a",
    userId: USER_A,
    scope: "conversation-local",
    sourceType: "user-said",
  })!;

  assert.equal(manager.forgetObservation(removed.id), 1);
  assert.deepEqual(manager.itemsFor("core", scope("chat-a")), ["Kept observation"]);
  assert.ok(kept.id);
  assert.equal(manager.forgetObservation(removed.id), 0, "already gone");
});

test("W: a superseded observation cannot be quoted as current fact", () => {
  const manager = new WorkspaceManager();
  manager.create("core", "Lélu Core");
  const original = manager.add("core", "The commission is silver", {
    conversationId: "chat-a",
    userId: USER_A,
    scope: "conversation-local",
    sourceType: "user-said",
  })!;

  const replacement = manager.supersede(original.id, "The commission is platinum", { confidence: 0.9 })!;
  const items = manager.itemsFor("core", scope("chat-a"));
  assert.deepEqual(items, ["The commission is platinum"]);
  assert.equal(items.some((text) => /silver/i.test(text)), false);
  assert.equal(replacement.origin.scope, "conversation-local", "provenance carried over");
});

test("W: state() exposes workspaces without their text", () => {
  const core = new CognitiveCore();
  core.initialize();
  core.observe("A sensitive observation about the Lisbon move.", "chat-a");
  const state = core.state("chat-a");
  assert.equal(JSON.stringify(state.workspaces).includes("Lisbon"), false, "state() must not carry observation text");
  assert.ok((state.workspaces as any[]).some((workspace) => workspace.name));
  assert.ok(core.workspaceItems("core", scope("chat-a")).some((text) => text.includes("Lisbon")));
});

/* ============================================================
 * GROUP X — AGENT COGNITIVE SNAPSHOT
 * ============================================================ */

test("X: the snapshot carries only projects this scope may see", () => {
  const user = uniqueUser();
  const mine = project(`Visible ${user}`, { ownerId: user, conversationId: "chat-a" });
  const other = project(`Hidden ${user}`, { ownerId: uniqueUser(), conversationId: "chat-a" });
  const local = project(`Local ${user}`, { ownerId: user, conversationId: "chat-a", scope: "conversation-local" });

  const snapshot = buildCognitiveContext({ userId: user, conversationId: "chat-b", sessionId: currentSessionId() });
  const names = snapshot.projects.map((entry) => entry.name);

  assert.ok(names.includes(mine.name));
  assert.equal(names.includes(other.name), false, "another user's project is not in the snapshot");
  assert.equal(names.includes(local.name), false, "a conversation-local project is not in another chat's snapshot");
  assert.equal(snapshot.checkpoints.some((checkpoint) => checkpoint.projectName === other.name), false);

  for (const id of [mine.id, other.id, local.id]) ProjectStore.getInstance().remove(id);
});

test("X: a durable project from another chat is labelled in the snapshot text", () => {
  const user = uniqueUser();
  const created = project(`Labelled ${user}`, { ownerId: user, conversationId: "chat-a" });
  const snapshot = buildCognitiveContext({ userId: user, conversationId: "chat-b", sessionId: currentSessionId() });
  const text = formatCognitiveContext(snapshot);
  assert.match(text, /\[started in the chat/i);
  ProjectStore.getInstance().remove(created.id);
});

test("X: a snapshot with no identity carries no conversation-derived projects", () => {
  const user = uniqueUser();
  const created = project(`Anonymous ${user}`, { ownerId: user, conversationId: "chat-a" });
  const snapshot = buildCognitiveContext();
  assert.equal(snapshot.contextScope.conversationId, null);
  assert.equal(snapshot.projects.some((entry) => entry.name === created.name), false);
  ProjectStore.getInstance().remove(created.id);
});

test("X: two concurrent snapshots do not share project content", async () => {
  const userA = uniqueUser();
  const userB = uniqueUser();
  const a = project(`Concurrent A ${userA}`, { ownerId: userA, conversationId: "chat-a" });
  const b = project(`Concurrent B ${userB}`, { ownerId: userB, conversationId: "chat-b" });

  const [snapA, snapB] = await Promise.all([
    Promise.resolve(buildCognitiveContext({ userId: userA, conversationId: "chat-a", sessionId: currentSessionId() })),
    Promise.resolve(buildCognitiveContext({ userId: userB, conversationId: "chat-b", sessionId: currentSessionId() })),
  ]);

  assert.equal(snapA.projects.some((entry) => entry.name === b.name), false);
  assert.equal(snapB.projects.some((entry) => entry.name === a.name), false);
  for (const id of [a.id, b.id]) ProjectStore.getInstance().remove(id);
});

/* ============================================================
 * GROUP Y — UNIVERSAL CONTEXT AUTHORIZATION
 * ============================================================ */

const access = { userId: USER_A, conversationId: "chat-a", sessionId: currentSessionId() };

test("Y: this conversation's sections are retrieved", () => {
  const sections: ContextSection[] = [
    {
      id: "memory",
      kind: "memory",
      text: "current memory",
      provenance: { userId: USER_A, conversationId: "chat-a", sessionId: currentSessionId(), scope: "current-conversation" },
    },
    { id: "self", kind: "operational", text: "capabilities" },
  ];
  const result = authorizeContextSections(sections, access);
  assert.equal(result.allowed.length, 2);
  assert.equal(result.counts.RETRIEVE, 2);
});

test("Y: another user's section is rejected and never reaches the payload", () => {
  const result = authorizeContextSections(
    [
      { id: "theirs", kind: "memory", text: "their loss", provenance: { userId: USER_B, conversationId: "chat-a", scope: "current-conversation" } },
    ],
    access,
  );
  assert.deepEqual(result.allowed, []);
  assert.equal(result.decisions[0].decision, "REJECT");
  assert.match(result.decisions[0].reason, /another user/);
});

test("Y: foreign material without a label is deferred, with a label it is retrieved with context", () => {
  const unlabelled = authorizeContextSections(
    [{ id: "old", kind: "memory", text: "old fact", provenance: { userId: USER_A, conversationId: "chat-z", scope: "historical" } }],
    access,
  );
  assert.equal(unlabelled.allowed.length, 0);
  assert.equal(unlabelled.decisions[0].decision, "DEFER");

  const labelled = authorizeContextSections(
    [{ id: "old", kind: "memory", text: "[earlier conversation] old fact", labelled: true, provenance: { userId: USER_A, conversationId: "chat-z", scope: "historical" } }],
    access,
  );
  assert.equal(labelled.allowed.length, 1);
  assert.equal(labelled.decisions[0].decision, "RETRIEVE_WITH_CONTEXT");
});

test("Y: an inference from elsewhere is not injected as fact", () => {
  const result = authorizeContextSections(
    [{ id: "guess", kind: "agent", text: "probably Lisbon", provenance: { userId: USER_A, conversationId: "chat-z", scope: "derived" } }],
    access,
  );
  assert.equal(result.allowed.length, 0);
  assert.equal(result.decisions[0].decision, "DEFER");
});

test("Y: session material from another session is rejected", () => {
  const result = authorizeContextSections(
    [{ id: "temp", kind: "session", text: "scratch", provenance: { userId: USER_A, conversationId: "chat-a", sessionId: "other", scope: "session" } }],
    access,
  );
  assert.deepEqual(result.allowed, []);
  assert.match(result.decisions[0].reason, /another session/);
});

test("Y: every decision keeps its provenance for the payload record", () => {
  const result = authorizeContextSections(
    [{ id: "old", kind: "memory", text: "old", provenance: { userId: USER_A, conversationId: "chat-z", scope: "historical", conversationTitle: "Metals" } }],
    access,
  );
  assert.equal(result.decisions[0].relation, "other-conversation");
  assert.equal(result.decisions[0].scope, "historical");
  assert.equal(typeof result.decisions[0].labelled, "boolean");
});
