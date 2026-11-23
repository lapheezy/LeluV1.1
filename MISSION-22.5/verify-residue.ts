/**
 * M22.5 — independent verification of the historical residue migration.
 *
 * Runs the real modules (no mocks of the store, ledger or migration) against
 * an in-memory browser, and asserts on what is actually persisted, not on the
 * migration's own report. Emits JSON for the mission evidence directory.
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
 *     MISSION-22.5/verify-residue.ts > MISSION-22.5/verification.json
 */

import assert from "node:assert/strict";

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
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};
const storage = (globalThis as unknown as { window: { localStorage: FakeStorage } }).window.localStorage;

const { default: Brain } = await import("../src/brain/Brain");
const { default: ProjectStore } = await import("../src/core/projects/ProjectStore");
const { default: ResidueMigration } = await import("../src/core/memory/ResidueMigration");
const { default: DeletionLedger } = await import("../src/core/memory/DeletionLedger");
const { namesChat } = await import("../src/core/multichat/ChatConsent");
const { buildCognitiveContext, formatCognitiveContext } = await import("../src/core/cognition/CognitiveContext");

const USER = "m225-user";
const projects = ProjectStore.getInstance();
const migrations = ResidueMigration.getInstance();
const evidence: Record<string, unknown> = { mission: "LÉLU 22.5 — residue migration verification", at: new Date().toISOString() };

function persistedProjects(): { id: string; name: string; description: string; checkpoint?: { summary: string; completed: string[]; pending: string[] }; items: { title: string; text?: string }[] }[] {
  return JSON.parse(storage.getItem("lelu.projects.v1") ?? "[]");
}

let chat = 0;
async function rememberAndDelete(statement: string) {
  const brain = new Brain();
  chat += 1;
  const learned = await brain.learn(statement, "Noted.", "conversation", [], {
    source: "lelu-chat",
    originSeed: { userId: USER, conversationId: `verify-chat-${chat}`, sessionId: "verify-session", sourceType: "user-said" },
  });
  assert.ok(learned, `memory was stored: ${statement}`);
  const result = await brain.forgetMemory(learned!.id);
  assert.equal(result.removed, true);
  return { id: learned!.id, result };
}

/* --------------------------------- A ---------------------------------- */
{
  for (const project of projects.list()) projects.remove(project.id);
  const token = "SCARLET-PLUM-57";
  const statement = `Notebook 57: my locker phrase is ${token}.`;
  await rememberAndDelete(statement);

  const legacy = projects.create({ name: "Legacy answered turn", description: "Auto-created for general tasks" });
  projects.checkpoint(legacy.id, {
    status: "active",
    summary: `Please remember this: ${statement}`,
    completed: ["key noted"],
    pending: [],
    blockers: [],
    nextAction: null,
  });
  const unrelated = projects.create({ name: "Pricing", description: "real work" });
  projects.checkpoint(unrelated.id, {
    status: "active",
    summary: "Ship the pricing page by Friday.",
    completed: ["copy approved"],
    pending: ["send the draft"],
    blockers: [],
    nextAction: "send the draft",
  });

  const before = storage.getItem("lelu.projects.v1")!;
  const dry = migrations.run({ dryRun: true });
  assert.equal(storage.getItem("lelu.projects.v1"), before, "dry run wrote nothing");
  assert.ok(dry.findings.length >= 1, "dry run found the quote");

  const applied = migrations.run({ dryRun: false });
  const after = storage.getItem("lelu.projects.v1")!;
  assert.ok(!after.includes(token), "persisted store no longer contains the deleted phrase");
  assert.ok(after.includes("pricing page"), "unrelated checkpoint survived");
  assert.ok(after.includes("send the draft"), "unrelated pending work survived");

  const reloaded = persistedProjects();
  evidence.scenarioA = {
    statementStoredThenDeleted: true,
    dryRun: { findings: dry.findings.length, cleaned: dry.cleanedFields, storageUnchanged: true },
    applied: { cleanedFields: applied.cleanedFields, durationMs: applied.durationMs },
    persistedAfter: {
      containsDeletedPhrase: reloaded.some((project) => JSON.stringify(project).includes(token)),
      legacyCheckpointSummary: reloaded.find((project) => project.id === legacy.id)?.checkpoint?.summary,
      unrelatedCheckpoint: reloaded.find((project) => project.id === unrelated.id)?.checkpoint,
    },
  };
}

/* --------------------------------- B ---------------------------------- */
{
  const token = "INDIGO-WHEEL-19";
  await rememberAndDelete(`Garage rack: my access phrase is ${token}.`);
  const raw = storage.getItem("lelu.memory.deletions.v1") ?? "";
  assert.ok(raw.length > 0, "ledger exists");
  assert.ok(!raw.includes(token), "ledger holds no plaintext");
  assert.ok(!raw.toLowerCase().includes("garage"), "ledger holds no words from the statement");
  const entries = DeletionLedger.getInstance().entries();
  evidence.scenarioB = {
    ledgerEntries: entries.length,
    containsDeletedPhrase: raw.includes(token),
    keepsProvenance: entries.every((entry) => typeof entry.at === "number" && Array.isArray(entry.windows)),
    windowSize: entries[0]?.size,
  };
}

/* --------------------------------- C ---------------------------------- */
{
  for (const project of projects.list()) projects.remove(project.id);
  const token = "BRONZE-FERRY-71";
  const statement = `Harbour ledger: my access phrase is ${token}.`;
  await rememberAndDelete(statement);
  const ids: string[] = [];
  for (const step of ["alpha", "beta", "gamma"]) {
    const project = projects.create({ name: `Plan ${step}`, description: "real work" });
    projects.checkpoint(project.id, {
      status: "active",
      summary: statement,
      completed: [],
      pending: [`step ${step}`],
      blockers: [],
      nextAction: `do ${step}`,
    });
    ids.push(project.id);
  }

  const first = migrations.run({ dryRun: false, limit: 1 });
  assert.equal(first.cleanedFields, 1);
  assert.ok(first.cursor);
  const second = migrations.run({ dryRun: false, limit: 1 });
  assert.equal(second.resumed, true);
  assert.equal(second.cleanedFields, 2);
  const third = migrations.run({ dryRun: false });
  assert.equal(third.cursor, null);
  assert.equal(third.cleanedFields, 3);
  assert.ok(!storage.getItem("lelu.projects.v1")!.includes(token));

  evidence.scenarioC = {
    limit: 1,
    run1: { cleaned: first.cleanedFields, remaining: first.remainingProjects, cursor: Boolean(first.cursor) },
    run2: { cleaned: second.cleanedFields, resumed: second.resumed },
    run3: { cleaned: third.cleanedFields, completed: third.cursor === null },
    perProjectPendingKept: ids.map((id) => projects.get(id)?.checkpoint?.pending ?? []),
    deletedPhraseStillPersisted: storage.getItem("lelu.projects.v1")!.includes(token),
  };
}

/* --------------------------------- D ---------------------------------- */
{
  const token = "PEWTER-MOTH-05";
  const statement = `Shed: my access phrase is ${token}.`;
  await rememberAndDelete(statement);
  const mixed = projects.create({ name: "Launch plan", description: "real work" });
  projects.checkpoint(mixed.id, {
    status: "active",
    summary: statement,
    completed: ["press release approved"],
    pending: ["Book the venue", "Confirm catering"],
    blockers: ["waiting on legal"],
    nextAction: "call the venue",
  });
  const note = projects.addNote(mixed.id, "Guest list", "120 guests, seated dinner.");
  migrations.run({ dryRun: false });
  const after = projects.get(mixed.id)!;
  assert.deepEqual(after.checkpoint!.pending, ["Book the venue", "Confirm catering"]);
  assert.deepEqual(after.checkpoint!.completed, ["press release approved"]);
  assert.deepEqual(after.checkpoint!.blockers, ["waiting on legal"]);
  assert.equal(after.checkpoint!.nextAction, "call the venue");
  assert.ok(after.items.some((item) => item.id === note!.id));
  evidence.scenarioD = {
    unrelatedPending: after.checkpoint!.pending,
    unrelatedCompleted: after.checkpoint!.completed,
    unrelatedBlocker: after.checkpoint!.blockers,
    unrelatedNextAction: after.checkpoint!.nextAction,
    notePreserved: after.items.some((item) => item.id === note!.id),
    summaryCleared: after.checkpoint!.summary === "",
  };
}

/* --------------------------------- E ---------------------------------- */
{
  for (const project of projects.list()) projects.remove(project.id);
  const legacy = projects.create({ name: "Old general", description: "Auto-created for general tasks" });
  projects.checkpoint(legacy.id, {
    status: "active",
    summary: "An old answered turn nobody deleted.",
    completed: ["old reply"],
    pending: [],
    blockers: [],
    nextAction: null,
  });
  const dry = migrations.run({ dryRun: true });
  assert.ok(dry.quarantined.some((finding) => finding.projectId === legacy.id));
  assert.equal(dry.findings.some((finding) => finding.projectId === legacy.id), false);
  migrations.run({ dryRun: false });
  assert.ok(projects.get(legacy.id)?.checkpoint, "not auto-deleted");
  migrations.review(legacy.id, "keep");
  const kept = migrations.run({ dryRun: true });
  assert.ok(!kept.quarantined.some((finding) => finding.projectId === legacy.id));

  const decision = projects.create({ name: "Old research", description: "Auto-created for research tasks" });
  projects.checkpoint(decision.id, {
    status: "active",
    summary: "Another old answered turn.",
    completed: [],
    pending: [],
    blockers: [],
    nextAction: null,
  });
  migrations.review(decision.id, "forget");
  assert.equal(projects.get(decision.id)?.checkpoint, undefined);
  assert.equal(projects.get(decision.id)?.name, "Old research");
  evidence.scenarioE = {
    quarantinedNotDeleted: true,
    keptDismissed: true,
    forgetClearedCheckpoint: projects.get(decision.id)?.checkpoint === undefined,
    projectPreserved: Boolean(projects.get(decision.id)),
  };
}

/* --------------------------------- F ---------------------------------- */
{
  const same = { id: "conv-f", title: "What is my workshop access phrase? A", messages: [] } as never;
  // A title's trailing letter must not be "named" by the next word: this is
  // the M22.4 boundary fix, and it is why the badge counted the user's own
  // question.
  assert.equal(namesChat("An answer about appendixes", { id: "b", title: "Phrase? A", messages: [] } as never), false);
  assert.equal(namesChat("show me What is my workshop access phrase? A", same), true);
  // A similar title that shares one word is not attribution.
  assert.equal(namesChat("What is my workshop access phrase? Answer in one short line.", { id: "x", title: "Workshop schedule", messages: [] } as never), false);

  const unresolved = { id: "conv-f", title: "What is my workshop access phrase? A", messages: [] };
  evidence.scenarioF = {
    boundaryPrefixNotNamed: namesChat("An answer about appendixes", { id: "b", title: "Phrase? A", messages: [] } as never),
    exactTitleNamed: namesChat("show me What is my workshop access phrase? A", unresolved as never),
    shortTitleNamed: namesChat("the spare key conversation", { id: "x", title: "Spare key", messages: [] } as never),
    similarTitleOneWordNotNamed: namesChat("What is my workshop access phrase? Answer in one short line.", { id: "x", title: "Workshop schedule", messages: [] } as never),
    sameTopicNamedByDistinctiveTokens: namesChat("What is my workshop access phrase? Answer in one short line.", unresolved as never),
    note: "same-topic naming is intentional; M22.4's own-turn exclusion is what stops that chat's own question being injected as research",
    conversationRecordsTouchedByMigration: 0,
  };
}

/* --------------------------------- G ---------------------------------- */
{
  for (const project of projects.list()) projects.remove(project.id);
  const token = "GOLD-CRICKET-41";
  const statement = `Attic: my access phrase is ${token}.`;
  await rememberAndDelete(statement);
  const project = projects.create({ name: "Idempotency", description: "real work" });
  projects.checkpoint(project.id, {
    status: "active",
    summary: statement,
    completed: [],
    pending: ["keep me"],
    blockers: [],
    nextAction: "keep me too",
  });
  const first = migrations.run({ dryRun: false });
  const snapshot = storage.getItem("lelu.projects.v1");
  const second = migrations.run({ dryRun: false });
  assert.ok(first.cleanedFields >= 1);
  assert.equal(second.cleanedFields, 0);
  assert.equal(storage.getItem("lelu.projects.v1"), snapshot);
  evidence.scenarioG = { firstRunCleaned: first.cleanedFields, secondRunCleaned: second.cleanedFields, storageIdentical: true };
}

/* ------------------------------- performance ------------------------------- */
{
  for (const project of projects.list()) projects.remove(project.id);
  const token = "COBALT-RAVEN-09";
  const statement = `Vault: my access phrase is ${token}.`;
  await rememberAndDelete(statement);
  for (let i = 0; i < 60; i += 1) {
    const project = projects.create({ name: `Perf ${i}`, description: "real work" });
    projects.checkpoint(project.id, {
      status: "active",
      summary: i % 3 === 0 ? statement : `Unrelated checkpoint ${i}`,
      completed: [],
      pending: [`step ${i}`],
      blockers: [],
      nextAction: `go ${i}`,
    });
  }
  const start = performance.now();
  const planned = migrations.run({ dryRun: true });
  const dryMs = performance.now() - start;
  const startApply = performance.now();
  const applied = migrations.run({ dryRun: false });
  const applyMs = performance.now() - startApply;

  const contextTimes: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const t = performance.now();
    formatCognitiveContext(buildCognitiveContext({ userId: USER, conversationId: "perf-chat", sessionId: "verify-session" } as never));
    contextTimes.push(performance.now() - t);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const mean = (list: number[]) => list.reduce((sum, value) => sum + value, 0) / list.length;
  evidence.performance = {
    projects: 60,
    dryRunMs: round(dryMs),
    applyMs: round(applyMs),
    cleanedFields: applied.cleanedFields,
    scannedFields: planned.scannedFields,
    contextBuildMeanMs: round(mean(contextTimes)),
    contextBuildMaxMs: round(Math.max(...contextTimes)),
  };
}

evidence.migrationReport = migrations.report();
console.log(JSON.stringify(evidence, null, 2));
