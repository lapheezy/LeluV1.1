/**
 * ==========================================================
 * LÉLU 2.2.5 — HISTORICAL MEMORY RESIDUE
 *
 * M22.4 removed residue at deletion time and stopped new
 * checkpoints being written for answered turns. It could not
 * repair copies written by the old build before that purge
 * existed. M22.5 records a deletion ledger (fingerprints, never
 * text) and migrates provable residue, while quarantining what it
 * cannot prove.
 *
 * These tests use the real stores with an in-memory browser, and
 * inspect what is actually persisted rather than trusting a
 * returned count.
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
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};

const storage = (globalThis as unknown as { window: { localStorage: FakeStorage } }).window.localStorage;
const USER = "residue-user";

async function modules() {
  const [{ default: Brain }, { default: ProjectStore }, { default: ResidueMigration }, { default: DeletionLedger }] =
    await Promise.all([
      import("../src/brain/Brain"),
      import("../src/core/projects/ProjectStore"),
      import("../src/core/memory/ResidueMigration"),
      import("../src/core/memory/DeletionLedger"),
    ]);
  return { Brain, ProjectStore, ResidueMigration, DeletionLedger };
}

let chatCounter = 0;

async function rememberAndDelete(prefix: string, token: string) {
  const { Brain } = await modules();
  const brain = new Brain();
  const statement = `${prefix}: my access phrase is ${token}.`;
  chatCounter += 1;
  const learned = await brain.learn(statement, "Noted.", "conversation", [], {
    source: "lelu-chat",
    originSeed: { userId: USER, conversationId: `chat-residue-${chatCounter}`, sessionId: "residue-session", sourceType: "user-said" },
  });
  assert.ok(learned, "the memory was stored");
  await brain.forgetMemory(learned!.id);
  return { statement, id: learned!.id };
}

test("A: a legacy checkpoint quoting a deleted memory is found, cleaned, and gone from the persisted store", async () => {
  const { ProjectStore, ResidueMigration } = await modules();
  const token = "MAGENTA-THIMBLE-91";
  const { statement } = await rememberAndDelete("Studio locker", token);

  // The build that wrote this ran before the purge existed: the checkpoint
  // appeared while the memory was already gone, so nothing cleaned it.
  const projects = ProjectStore.getInstance();
  const legacy = projects.create({ name: "Legacy checkpoint", description: "Auto-created for research tasks" });
  projects.checkpoint(legacy.id, {
    status: "active",
    summary: `Please remember this: ${statement}`,
    completed: ["key noted"],
    pending: [],
    blockers: [],
    nextAction: null,
  });

  const dry = ResidueMigration.getInstance().run({ dryRun: true });
  assert.ok(dry.findings.some((finding) => finding.projectId === legacy.id), "the dry run finds it");
  assert.ok(storage.getItem("lelu.projects.v1")!.includes(token), "a dry run changes nothing");

  const applied = ResidueMigration.getInstance().run({ dryRun: false });
  assert.ok(applied.cleanedFields >= 1, "the provable quote was removed");
  const persisted = storage.getItem("lelu.projects.v1")!;
  assert.ok(!persisted.includes(token), "the persisted project store no longer holds the deleted statement");
  assert.equal(projects.get(legacy.id)?.checkpoint?.summary, "", "the quoting summary is gone; the checkpoint keeps only unrelated text");

  // Restart/reload: the store is the only carrier, and the value is gone.
  const reloaded = JSON.parse(persisted) as { id: string; checkpoint?: { summary: string } }[];
  assert.ok(!reloaded.some((project) => project.checkpoint?.summary.includes(token)));
});

test("B: the ledger proves deletions without keeping the deleted text", async () => {
  const { DeletionLedger } = await modules();
  const token = "VIOLET-ANCHOR-12";
  await rememberAndDelete("Harbour gate", token);

  const raw = storage.getItem("lelu.memory.deletions.v1")!;
  assert.ok(raw, "a tombstone was recorded");
  assert.ok(!raw.includes(token), "no readable copy of the deleted memory is stored in the ledger");
  assert.ok(!raw.toLowerCase().includes("harbour gate"), "not even the rest of the statement is kept");
  const entries = DeletionLedger.getInstance().entries();
  assert.ok(entries.length >= 1);
  assert.ok(entries.every((entry) => entry.windows.length > 0 && entry.size >= 4));
  assert.ok(entries.every((entry) => entry.conversationId === null || !entry.conversationId.includes(token)), "scope provenance never embeds the statement");
  assert.ok(entries.some((entry) => entry.conversationId !== null), "provenance is kept for audit");
});

test("C: an interrupted migration resumes without redoing or damaging completed work", async () => {
  const { ProjectStore, ResidueMigration } = await modules();
  const projects = ProjectStore.getInstance();
  for (const project of projects.list()) projects.remove(project.id);
  const token = "UMBER-KITE-33";
  const { statement } = await rememberAndDelete("Copper bay", token);

  const ids: string[] = [];
  for (const suffix of ["one", "two", "three"]) {
    const project = projects.create({ name: `Batch ${suffix}`, description: "real work" });
    projects.checkpoint(project.id, {
      status: "active",
      summary: statement,
      completed: [],
      pending: [`step ${suffix}`],
      blockers: [],
      nextAction: `do ${suffix}`,
    });
    ids.push(project.id);
  }

  const first = ResidueMigration.getInstance().run({ dryRun: false, limit: 1 });
  assert.ok(first.cursor, "the run stopped early and left a cursor");
  assert.equal(first.cleanedFields, 1);
  assert.equal(first.remainingProjects >= 1, true);
  const remainingText = storage.getItem("lelu.projects.v1")!;
  assert.ok(remainingText.includes(token), "projects beyond the batch still hold their copy");

  const second = ResidueMigration.getInstance().run({ dryRun: false, limit: 1 });
  assert.equal(second.resumed, true, "the second call says it resumed");
  assert.equal(second.cleanedFields, 2, "it continued the count instead of restarting it");

  const third = ResidueMigration.getInstance().run({ dryRun: false });
  assert.equal(third.cursor, null);
  assert.equal(third.cleanedFields, 3);
  assert.ok(!storage.getItem("lelu.projects.v1")!.includes(token), "all three copies are gone");

  // Each project keeps its own pending step: only the quoted summary left.
  for (const id of ids) {
    const project = projects.get(id)!;
    assert.ok(project.checkpoint, "the checkpoint itself is still meaningful");
    assert.equal(project.checkpoint!.summary, "");
    assert.ok(project.checkpoint!.pending.length === 1 && project.checkpoint!.pending[0].startsWith("step"));
    assert.ok(project.checkpoint!.nextAction?.startsWith("do"));
  }
});

test("D: unrelated project facts survive a migration untouched", async () => {
  const { ProjectStore, ResidueMigration } = await modules();
  const token = "SAFFRON-LADDER-08";
  const { statement } = await rememberAndDelete("Cedar shelf", token);
  const projects = ProjectStore.getInstance();

  const mixed = projects.create({ name: "Release plan", description: "real work" });
  projects.checkpoint(mixed.id, {
    status: "active",
    summary: statement,
    completed: ["pricing copy approved"],
    pending: ["Ship the pricing page by Friday.", "Call the printer"],
    blockers: ["waiting on legal"],
    nextAction: "send the draft",
  });
  const note = projects.addNote(mixed.id, "Venue", "The launch venue is confirmed for Thursday.");
  const other = projects.create({ name: "Unrelated", description: "real work" });
  projects.checkpoint(other.id, {
    status: "active",
    summary: "Tampa news digest every morning.",
    completed: [],
    pending: ["check sources"],
    blockers: [],
    nextAction: "run the digest",
  });

  ResidueMigration.getInstance().run({ dryRun: false });

  const after = projects.get(mixed.id)!;
  assert.equal(after.checkpoint!.summary, "");
  assert.deepEqual(after.checkpoint!.pending, ["Ship the pricing page by Friday.", "Call the printer"]);
  assert.deepEqual(after.checkpoint!.completed, ["pricing copy approved"]);
  assert.deepEqual(after.checkpoint!.blockers, ["waiting on legal"]);
  assert.equal(after.checkpoint!.nextAction, "send the draft");
  assert.ok(projects.get(mixed.id)!.items.some((item) => item.id === note!.id), "the note is untouched");
  assert.match(projects.get(other.id)!.checkpoint!.summary, /Tampa news/);
  assert.deepEqual(projects.get(other.id)!.checkpoint!.pending, ["check sources"]);
});

test("E: a legacy checkpoint with no tombstone is quarantined, never deleted by the migration", async () => {
  const { ProjectStore, ResidueMigration } = await modules();
  const projects = ProjectStore.getInstance();
  const unknown = projects.create({ name: "Old general", description: "Auto-created for general tasks" });
  projects.checkpoint(unknown.id, {
    status: "active",
    summary: "Old turn text nobody deleted explicitly.",
    completed: ["old reply"],
    pending: [],
    blockers: [],
    nextAction: null,
  });

  const dry = ResidueMigration.getInstance().run({ dryRun: true });
  assert.ok(dry.quarantined.some((finding) => finding.projectId === unknown.id), "it is reported for review");
  assert.equal(dry.findings.some((finding) => finding.projectId === unknown.id), false, "it is not treated as provable");

  ResidueMigration.getInstance().run({ dryRun: false });
  assert.match(projects.get(unknown.id)!.checkpoint!.summary, /Old turn text/, "the migration did not guess and delete");

  // Explicit review is the only way it goes.
  ResidueMigration.getInstance().review(unknown.id, "keep");
  const kept = ResidueMigration.getInstance().run({ dryRun: true });
  assert.equal(kept.quarantined.some((finding) => finding.projectId === unknown.id), false, "kept means it stops being reported");
  assert.match(projects.get(unknown.id)!.checkpoint!.summary, /Old turn text/);

  const decision = projects.create({ name: "Old research", description: "Auto-created for research tasks" });
  projects.checkpoint(decision.id, {
    status: "active",
    summary: "Another legacy turn.",
    completed: [],
    pending: [],
    blockers: [],
    nextAction: null,
  });
  ResidueMigration.getInstance().review(decision.id, "forget");
  assert.equal(projects.get(decision.id)?.checkpoint, undefined, "forget cleared only the checkpoint");
  assert.equal(projects.get(decision.id)?.name, "Old research", "the project itself is preserved");
});

test("F: deletion, migration and recall racing leave nothing behind", async () => {
  const { Brain } = await modules();
  const { ProjectStore, ResidueMigration } = await modules();
  const token = "ONYX-SPROUT-64";
  const brain = new Brain();
  const statement = `Please remember this: my greenhouse access phrase is ${token}.`;
  const learned = await brain.learn(statement, "Noted.", "conversation", [], {
    source: "lelu-chat",
    originSeed: { userId: USER, conversationId: "chat-race", sessionId: "residue-session", sourceType: "user-said" },
  });
  assert.ok(learned);

  // The legacy writer copies the turn, then deletion and migration run at once.
  const projects = ProjectStore.getInstance();
  const race = projects.create({ name: "Race checkpoint", description: "Auto-created for general tasks" });
  projects.checkpoint(race.id, {
    status: "active",
    summary: statement,
    completed: [],
    pending: [],
    blockers: [],
    nextAction: null,
  });

  await Promise.all([
    brain.forgetMemory(learned!.id),
    Promise.resolve().then(() => ResidueMigration.getInstance().run({ dryRun: false })),
    brain.recallAll(),
  ]);

  const persisted = storage.getItem("lelu.projects.v1")!;
  assert.ok(!persisted.includes(token), "no stale copy survived the race");
  const memories = await brain.recallAll();
  assert.equal(memories.some((memory) => memory.prompt.includes(token)), false, "the record is gone");
});

test("G: running the migration twice changes nothing the second time", async () => {
  const { ProjectStore, ResidueMigration } = await modules();
  const token = "AZURE-POCKET-25";
  const { statement } = await rememberAndDelete("River dock", token);
  const projects = ProjectStore.getInstance();
  const project = projects.create({ name: "Twice cleaned", description: "real work" });
  projects.checkpoint(project.id, {
    status: "active",
    summary: statement,
    completed: [],
    pending: ["keep this step"],
    blockers: [],
    nextAction: "keep this action",
  });

  const first = ResidueMigration.getInstance().run({ dryRun: false });
  const snapshot = storage.getItem("lelu.projects.v1");
  const second = ResidueMigration.getInstance().run({ dryRun: false });
  assert.ok(first.cleanedFields >= 1);
  assert.equal(second.cleanedFields, 0, "nothing was left to clean");
  assert.equal(second.findings.length, 0);
  assert.equal(storage.getItem("lelu.projects.v1"), snapshot, "the second run did not touch storage");
});

test("H: statements too short to identify are never fingerprinted into a blanket matcher", async () => {
  const { fingerprintStatement } = await import("../src/core/memory/DeletionLedger");
  assert.deepEqual(fingerprintStatement("").windows, []);
  assert.deepEqual(fingerprintStatement("ok").windows, []);
  assert.deepEqual(fingerprintStatement("my key").windows, [], "2 tokens identify nothing");
  assert.deepEqual(fingerprintStatement("my key is").windows, [], "3 tokens are still too generic");
  const real = fingerprintStatement("my spare key is under the blue pot");
  assert.ok(real.windows.length > 0);
  assert.equal(real.size, 6);
  assert.ok(real.tokens >= 8);
});
