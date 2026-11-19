/**
 * ==========================================================
 * LÉLU 2.2.1 — MEMORY SOVEREIGNTY HARDENING
 *
 * M22 closed the memory store. These tests cover the pathways
 * that were still unscoped: the project registry, agent
 * context, the legacy shared window, cognitive state, and
 * deletion. They are adversarial by construction — every one
 * tries to make one scope's content appear in another.
 *
 * No model is called. Live provider evidence is in
 * MISSION-22.1/provider-validation.json and cross-user
 * execution in cross-user-validation.json.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

/* ------------------------- browser shims (Node) ------------------------- */
const databases = new Map<string, Map<string, Map<string, unknown>>>();
class ShimRequest {
  result: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
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

import Brain from "../src/brain/Brain";
import ProjectStore from "../src/core/projects/ProjectStore";
import {
  decideProject,
  isProjectVisible,
  projectLabel,
  type ProjectAccess,
} from "../src/core/projects/ProjectSovereignty";
import { resolveTurnHistory } from "../src/core/memory/SharedWindowAdapter";
import {
  authorize,
  currentSessionId,
  SOVEREIGNTY_POLICY,
  type MemoryScopeContext,
} from "../src/core/memory/MemorySovereignty";
import AgentStore from "../src/core/agents/AgentStore";

const USER_A = "user-a";
const USER_B = "user-b";

/**
 * A fresh identity per test. The store persists across tests in this process
 * (that is the point of it), so isolation is proved by ownership rather than
 * by an empty database — the same boundary production relies on.
 */
let userSeq = 0;
function uniqueUser(): string {
  userSeq += 1;
  return `probe-user-${userSeq}-${Date.now().toString(36)}`;
}

function access(conversationId: string | null, userId = USER_A, sessionId = currentSessionId()): ProjectAccess {
  return { userId, conversationId, sessionId };
}

function scope(conversationId: string | null, prompt: string, userId = USER_A): MemoryScopeContext {
  return { userId, conversationId, sessionId: currentSessionId(), prompt };
}

async function learnIn(
  brain: Brain,
  text: string,
  conversationId: string,
  options: { userId?: string; scope?: "current-conversation" | "persistent-user" | "session" } = {},
) {
  return brain.learn(text, "Noted.", "conversation", [], {
    source: "lelu-chat",
    originSeed: {
      userId: options.userId ?? USER_A,
      conversationId,
      sessionId: currentSessionId(),
      conversationTitle: conversationId,
      sourceType: "user-said",
      ...(options.scope ? { scope: options.scope } : {}),
    },
  });
}

function projectWithItem(
  origin: Parameters<ProjectStore["create"]>[1],
  name = `Project ${Math.random().toString(36).slice(2, 8)}`,
) {
  const store = ProjectStore.getInstance();
  const project = store.create({ name, description: "real work" }, origin);
  store.addItem(project.id, { kind: "note", title: "Direction", text: "rose gold signature" });
  return project;
}

/* ============================================================
 * GROUP H — PROJECT REGISTRY ISOLATION (WP01)
 * ============================================================ */

test("H: a conversation-local project is invisible outside its conversation", () => {
  const project = projectWithItem({ conversationId: "chat-a", sessionId: currentSessionId(), scope: "conversation-local" });

  const inChat = decideProject(project, access("chat-a"));
  const elsewhere = decideProject(project, access("chat-b"));

  assert.equal(inChat.decision, "INJECT");
  assert.equal(elsewhere.decision, "REJECT", "conversation-local work must not follow her into another chat");
  assert.equal(isProjectVisible(project, access("chat-b")), false);
  assert.equal(ProjectStore.getInstance().contextFor(project.id, access("chat-b")), "");
  ProjectStore.getInstance().remove(project.id);
});

test("H: a durable project started elsewhere is injected with its origin stated", () => {
  const project = projectWithItem({
    conversationId: "chat-a",
    conversationTitle: "Aurelia studio",
    sessionId: currentSessionId(),
    scope: "user-persistent",
  });

  const decision = decideProject(project, access("chat-b"));
  assert.equal(decision.decision, "INJECT_WITH_LABEL");
  assert.match(projectLabel(project, "chat-b"), /Aurelia studio/);
  assert.equal(projectLabel(project, "chat-a"), "", "no label inside its own conversation");
  ProjectStore.getInstance().remove(project.id);
});

test("H: another user's project is refused, contents and all", () => {
  const project = projectWithItem({ conversationId: "chat-a", scope: "user-persistent" });
  const owned = ProjectStore.getInstance().update(project.id, { ownerId: USER_A })!;

  const asB = access("chat-b", USER_B);
  assert.equal(decideProject(owned, asB).decision, "REJECT");
  assert.equal(isProjectVisible(owned, asB), false);
  assert.equal(ProjectStore.getInstance().contextFor(project.id, asB), "");
  ProjectStore.getInstance().remove(project.id);
});

test("H: session-local projects do not survive the session", () => {
  const project = projectWithItem({ conversationId: "chat-a", sessionId: "session-one", scope: "session-local" });
  assert.equal(decideProject(project, access("chat-a", USER_A, "session-two")).decision, "REJECT");
  assert.equal(decideProject(project, access("chat-a", USER_A, "session-one")).decision, "INJECT");
  ProjectStore.getInstance().remove(project.id);
});

test("H: a project written before 2.2.1 keeps working, unowned and unlabelled", () => {
  const store = ProjectStore.getInstance();
  const project = store.create({ name: "Legacy project", description: "existing user work" });
  store.addItem(project.id, { kind: "note", title: "old note", text: "still here" });

  assert.equal(project.ownerId, null);
  assert.equal(decideProject(project, access("chat-b")).decision, "INJECT");
  assert.equal(projectLabel(project, "chat-b"), "");
  store.remove(project.id);
});

/* ============================================================
 * GROUP I — AGENT MEMORY SOVEREIGNTY (WP02)
 * ============================================================ */

test("I: an agent run's scope is persisted with its task", () => {
  const store = AgentStore.getInstance();
  const agent = store.runnable()[0];
  assert.ok(agent, "the install has a runnable agent");

  const task = store.recordTask(agent.id, {
    label: "scope probe",
    status: "complete",
    scope: { userId: USER_A, conversationId: "chat-a", sessionId: currentSessionId() },
  });

  const stored = store.get(agent.id)?.tasks.find((t) => t.id === task.id);
  assert.equal(stored?.scope?.conversationId, "chat-a");
  assert.equal(stored?.scope?.userId, USER_A);
});

test("I: a delegated agent request carries the conversation id", async () => {
  const { default: AIService } = await import("../src/core/AIService");
  const ai = AIService.getInstance() as any;
  const saved = { initialized: ai.initialized, memory: ai.memory, runtime: ai.runtime };

  const requests: any[] = [];
  const learned: any[] = [];
  ai.initialized = true;
  ai.memory = {
    enrich: async (request: any) => {
      requests.push(request);
      return { request, memories: [] };
    },
    learn: async (...args: any[]) => {
      learned.push(args);
    },
    scopeFor: () => ({ userId: USER_A }),
  };
  ai.runtime = {
    process: async () => ({ text: "done", provider: "test", model: "test", processingTime: 1 }),
  };

  try {
    const agent = {
      id: "agent-test",
      name: "Probe",
      role: "probe",
      description: "",
      instructions: "",
      personality: "",
      capabilities: [],
      tools: [],
      memoryAccess: "read-write",
      knowledge: [],
      provider: null,
      fallbackProvider: null,
      projectId: null,
      permissions: { canWriteMemory: true },
      enabled: true,
      status: "active",
      tasks: [],
      executions: [],
    };

    await ai.delegate(agent, "probe the archive", undefined, {
      userId: USER_A,
      conversationId: "chat-a",
      sessionId: currentSessionId(),
    });

    assert.equal(requests[0]?.conversationId, "chat-a", "memory recall ran inside the conversation");
    assert.equal(learned[0]?.[3], "chat-a", "the agent's write was attributed to that conversation");
    assert.deepEqual(learned[0]?.[4], { sourceType: "agent-reported" }, "an agent's report is not the user's words");
  } finally {
    Object.assign(ai, saved);
  }
});

/* ============================================================
 * GROUP J — LEGACY SHARED-WINDOW ADAPTER (WP03)
 * ============================================================ */

const turn = (text: string) => [{ role: "user" as const, content: text }];

test("J: a known conversation reads only its own turns", () => {
  const history = resolveTurnHistory({
    conversationId: "chat-a",
    perChatTurns: turn("A's line"),
    storeHasChats: true,
    sharedWindow: () => turn("b's line"),
  });
  assert.equal(history.source, "conversation");
  assert.equal(history.turns[0].content, "A's line");
});

test("J: an unknown conversation id gets no history at all", () => {
  const history = resolveTurnHistory({
    conversationId: "chat-ghost",
    perChatTurns: null,
    storeHasChats: true,
    sharedWindow: () => turn("someone else's line"),
  });
  assert.equal(history.source, "none");
  assert.deepEqual(history.turns, []);
});

test("J: a missing conversation id never reads the shared window when chats exist", () => {
  const history = resolveTurnHistory({
    conversationId: undefined,
    perChatTurns: null,
    storeHasChats: true,
    sharedWindow: () => turn("the last chat's line"),
  });
  assert.equal(history.source, "none");
  assert.deepEqual(history.turns, []);
  assert.match(history.reason, /not using another chat's window/);
});

test("J: the shared window is reachable only as an explicit first-run bootstrap", () => {
  const history = resolveTurnHistory({
    conversationId: undefined,
    perChatTurns: null,
    storeHasChats: false,
    sharedWindow: () => turn("bootstrap"),
  });
  assert.equal(history.source, "shared-legacy");
  assert.equal(history.reason.includes("explicit legacy bootstrap"), true);
});

/* ============================================================
 * GROUP K — COGNITIVE STATE & DELETION (WP06, WP07)
 * ============================================================ */

test("K: deleting a memory removes its cognitive observation too", async () => {
  const brain = new Brain();
  const user = uniqueUser();
  const learned = await learnIn(brain, "My storage unit key is on the blue card in the studio.", "chat-a", { userId: user });
  assert.ok(learned, "a durable memory was written");

  const before = (brain.cognitiveState("chat-a").nodes as Array<{ label?: string }>).some((node) =>
    (node.label ?? "").includes("blue card"),
  );
  assert.equal(before, true, "the observation exists while the memory does");

  const result = await brain.forgetMemory(learned!.id);
  assert.equal(result.removed, true);

  const recalled = await brain.recall("storage unit key blue card", "cognition", scope("chat-a", "storage unit key blue card", user));
  assert.equal(recalled.length, 0, "a deleted memory is gone from the store");

  const after = (brain.cognitiveState("chat-a").nodes as Array<{ label?: string }>).some((node) =>
    (node.label ?? "").includes("blue card"),
  );
  assert.equal(after, false, "and gone from the cognitive graph");
});

test("K: deleting a conversation purges its session material, keeps durable facts", async () => {
  const brain = new Brain();
  const user = uniqueUser();
  // Session material: the chat's working state, not a fact about the user.
  await learnIn(brain, "My scratch note for chat A is that the draft needs a colder purple.", "chat-a", {
    userId: user,
    scope: "session",
  });
  // A durable fact: this is the user's identity and must survive.
  await learnIn(brain, "My jewellery brand is called Aurelia and the signature is rose gold.", "chat-a", {
    userId: user,
    scope: "persistent-user",
  });

  const purged = await brain.forgetConversation("chat-a");
  assert.ok(purged.memories >= 1, "the chat's session memory was removed");
  assert.equal(purged.nodes >= 1, true, "its observations were removed");

  const scratch = await brain.recall("colder purple draft", "cognition", scope("chat-a", "colder purple draft", user));
  assert.equal(scratch.length, 0, "session material does not survive its conversation");

  const fact = await brain.recall("Aurelia rose gold jewellery brand", "cognition", scope("chat-b", "Aurelia brand", user));
  assert.equal(fact.length, 1, "a persistent fact outlives the chat it was learned in — LÉLU does not forget the user");
  assert.equal(
    (fact[0].context as any)?.origin?.originatingConversationId,
    "chat-a",
    "and keeps saying where it came from, even though that chat is gone",
  );
});

test("K: state() refuses unattributed observations and other conversations' nodes", async () => {
  const brain = new Brain();
  await learnIn(brain, "A private note about the Tampa commission.", "chat-a");
  (brain as any).cognitionRuntime.observe("an observation with no conversation", undefined);

  const labels = (conversationId: string) =>
    (brain.cognitiveState(conversationId).nodes as Array<{ label?: string }>).map((node) => node.label ?? "");

  assert.equal(labels("chat-b").some((label) => label.includes("Tampa")), false);
  assert.equal(labels("chat-a").some((label) => label.includes("no conversation")), false);
  assert.equal(labels("chat-a").some((label) => label.includes("Tampa")), true);
});

/* ============================================================
 * GROUP L — CROSS-USER & CONCURRENCY (WP04)
 * ============================================================ */

test("L: two users' memories never mix, even in the same conversation id", async () => {
  const brain = new Brain();
  const a = uniqueUser();
  const b = uniqueUser();
  await learnIn(brain, "My father died last month and I have been sleeping badly.", "chat-shared", { userId: a });
  await learnIn(brain, "My quarterly review is on Thursday and I am ready.", "chat-b", { userId: b });

  const forB = await brain.recall("father died sleeping badly", "cognition", scope("chat-shared", "father died", b));
  assert.deepEqual(forB, [], "user B cannot retrieve user A's loss");

  const forA = await brain.recall("quarterly review Thursday", "cognition", scope("chat-b", "quarterly review", a));
  assert.deepEqual(forA, [], "and user A cannot retrieve user B's work");

  const ownA = await brain.recall("father died sleeping badly", "cognition", scope("chat-shared", "father died", a));
  assert.equal(ownA.some((memory) => memory.response.includes("father died")), true);
});

test("L: concurrent writes from two users stay separated", async () => {
  const brain = new Brain();
  const a = uniqueUser();
  const b = uniqueUser();
  await Promise.all([
    learnIn(brain, "My studio is called Aurelia and I work in rose gold.", "chat-a", { userId: a }),
    learnIn(brain, "My lab is called Helix and I work in enzymes.", "chat-b", { userId: b }),
    learnIn(brain, "My allergy is penicillin, remember that.", "chat-a", { userId: a }),
  ]);

  const recallB = await brain.recall("studio rose gold lab enzymes", "cognition", scope("chat-b", "studio lab", b));
  const { allowed } = authorize(recallB, scope("chat-b", "studio lab", b));

  assert.ok(allowed.length >= 1, "user B retrieves their own work");
  assert.equal(allowed.every((memory) => memory.response.includes("Helix")), true, "only user B's memory is eligible");
  assert.equal(recallB.some((memory) => /Aurelia|penicillin/i.test(memory.response)), false, "user A's records are not even candidates");
});

test("L: another user's matching memory is never handed on to a synthesiser or provider", async () => {
  const brain = new Brain();
  const a = uniqueUser();
  const b = uniqueUser();
  await learnIn(brain, "My roof leak cannot be fixed until the storm passes.", "chat-a", { userId: a });

  const forB = scope("chat-b", "Can you fix the roof leak?", b);
  const recalled = await brain.recall("Can you fix the roof leak?", "cognition", forB);
  const { allowed, decisions } = authorize(recalled, forB);

  assert.deepEqual(recalled, [], "ownership is enforced before ranking, so there is nothing to authorize");
  assert.deepEqual(allowed, []);
  assert.equal(decisions.length, 0);
});

test("L: policy version remains the M22 contract", () => {
  assert.equal(SOVEREIGNTY_POLICY.version.startsWith("1."), true);
});
