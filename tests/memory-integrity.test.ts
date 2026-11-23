/**
 * ==========================================================
 * LÉLU 2.2.6 — MEMORY INTEGRITY & DELETION PROPAGATION
 *
 * M22.5 proved a deletion by fingerprinting it, but only when a
 * person opened the Memory panel. These tests cover what makes
 * forgetting automatic and system-wide:
 *
 *   - every deletion pathway records a tombstone (conversation
 *     deletion, reset, single memory);
 *   - recall, cognitive context and machine-written memory all
 *     consult the deletion guard, not just the panel;
 *   - boot-time healing cleans provable residue on its own, is
 *     idempotent, resumable, and recovers from a corrupt cursor;
 *   - a failed progress write is a failure, never a silent
 *     success;
 *   - quarantine decisions persist and keep no deleted text.
 *
 * The real stores run against an in-memory browser, and the
 * assertions read PERSISTED storage rather than returned counts.
 * ==========================================================
 */

import assert from "node:assert/strict";

import test from "node:test";

/* ------------------------- browser shims (Node) ------------------------- */
const databases = new Map<string, Map<string, Map<string, unknown>>>();
/** Keys whose write throws, to simulate quota exhaustion / a blocked store. */
const failing = new Set<string>();

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
    if (failing.has(key)) throw new Error("QuotaExceededError");
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

const windowShim = (globalThis as unknown as { window: { localStorage: FakeStorage } }).window;
const storage = windowShim.localStorage;
const USER = "integrity-user";
const PREFIX = "lelu.";

function read(key: string): string | null {
  return storage.getItem(`${PREFIX}${key}`);
}

async function modules() {
  const [
    { default: Brain },
    { default: ProjectStore },
    { default: ResidueMigration },
    { default: MemoryHealing },
    { default: DeletionGuard },
    { default: DeletionLedger },
    { default: PatternMemory },
    { buildTombstoneIndex, matchTombstoneIndex, matchTombstone, fingerprintStatement },
  ] = await Promise.all([
    import("../src/brain/Brain"),
    import("../src/core/projects/ProjectStore"),
    import("../src/core/memory/ResidueMigration"),
    import("../src/core/memory/MemoryHealing"),
    import("../src/core/memory/DeletionGuard"),
    import("../src/core/memory/DeletionLedger"),
    import("../src/brain/PatternMemory"),
    import("../src/core/memory/DeletionLedger"),
  ]);
  return {
    Brain,
    ProjectStore,
    ResidueMigration,
    MemoryHealing,
    DeletionGuard,
    DeletionLedger,
    PatternMemory,
    buildTombstoneIndex,
    matchTombstoneIndex,
    matchTombstone,
    fingerprintStatement,
  };
}

let conversations = 0;

/** Store one durable user memory and return it. */
async function remember(
  statement: string,
  sourceType = "user-said",
  reuse?: InstanceType<Awaited<ReturnType<typeof modules>>["Brain"]>,
) {
  const { Brain } = await modules();
  // One brain per test by default: PatternMemory keeps an in-process map, so
  // two instances see the same IndexedDB but not each other's new writes.
  const brain = reuse ?? new Brain();
  conversations += 1;
  const learned = await brain.learn(statement, "Noted.", "conversation", [], {
    source: "lelu-chat",
    originSeed: {
      userId: USER,
      conversationId: `chat-integrity-${conversations}`,
      sessionId: "integrity-session",
      sourceType,
    },
  });
  assert.ok(learned, `"${statement}" was stored`);
  return { brain, pattern: learned!, conversationId: `chat-integrity-${conversations}` };
}

function seedLegacyCheckpoint(projects: InstanceType<Awaited<ReturnType<typeof modules>>["ProjectStore"]>, summary: string, pending: string[] = []) {
  const project = projects.create({ name: `Legacy ${Date.now()}-${Math.random()}`, description: "Auto-created for answered turns" });
  projects.checkpoint(project.id, {
    status: "active",
    summary,
    completed: [],
    pending,
    blockers: [],
    nextAction: null,
  });
  return project;
}

/* ------------------------------- tests -------------------------------- */

test("A: deleting a conversation records a tombstone for every memory it removes", async () => {
  const token = "ONYX-HARBOUR-41";
  const { brain, conversationId } = await remember(`my warehouse gate code is ${token}.`);

  // keepPersistent:false is the bulk pathway that removes durable facts too —
  // the default deliberately keeps them when a chat is deleted.
  const result = await brain.forgetConversation(conversationId, { keepPersistent: false });
  assert.ok(result.memories >= 1, "the conversation's memory was removed");
  assert.ok(result.ledgerRecorded >= 1, "and it was fingerprinted before removal");

  const raw = read("memory.deletions.v1")!;
  assert.ok(raw, "a tombstone exists");
  assert.ok(!raw.includes(token), "the ledger never stores the deleted text");
  assert.ok(!raw.toLowerCase().includes("warehouse code"), "nor the rest of the statement");
});

test("B: a full memory reset records what it deletes", async () => {
  const { DeletionLedger } = await modules();
  const token = "BRASS-LANTERN-07";
  const { brain } = await remember(`my spare key number is ${token}.`);

  const before = DeletionLedger.getInstance().entries().length;
  await brain.reset();
  const after = DeletionLedger.getInstance().entries().length;
  assert.ok(after > before, "reset leaves tombstones, not a silent wipe");
  assert.ok(!read("memory.deletions.v1")!.includes(token));
});

test("C: recall will not return a record that quotes a deleted memory", async () => {
  const { DeletionGuard, PatternMemory } = await modules();
  const phrase = "my workshop door code is TANGERINE-BOOT-52";
  const { brain: writer, pattern: source } = await remember(`Remember that ${phrase}.`);

  await writer.forgetMemory(source.id);
  assert.equal(DeletionGuard.getInstance().quotes(source.response), true, "the deletion is provable");

  // A second, user-stated record carrying the same words — the shape a
  // correction or a merge leaves behind.
  const memory = new PatternMemory();
  await memory.initialize();
  const carrier = {
    id: crypto.randomUUID(),
    category: "general" as const,
    prompt: "carrier",
    response: `${phrase} and my studio is Aurelia.`,
    intent: "general" as const,
    keywords: ["workshop", "door"],
    context: { origin: { sourceType: "user-said" } },
    importance: 0.9,
    confidence: 1,
    successfulUses: 1,
    failedUses: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const clean = {
    ...carrier,
    id: crypto.randomUUID(),
    response: "my workshop opening hours are nine to five",
    keywords: ["workshop", "hours"],
  };
  await memory.add(carrier);
  await memory.add(clean);

  const hits = await memory.search("workshop door code");
  assert.ok(!hits.some((entry) => entry.id === carrier.id), "the carrier is not a recall candidate");
  assert.ok(hits.some((entry) => entry.id === clean.id), "an unrelated record is still recallable");

  const stored = JSON.parse(read("memory.deletions.v1")!);
  assert.ok(!JSON.stringify(stored).includes("TANGERINE-BOOT-52"));
});

test("D: machine-written memory cannot reintroduce a deleted statement, a user's own can", async () => {
  const { Brain } = await modules();
  const phrase = "my vault phrase is COBALT-MARLIN-63";
  const { brain, pattern } = await remember(`Please keep ${phrase}.`);
  const forgetResult = await brain.forgetMemory(pattern.id);
  const { DeletionLedger: LedgerDbg, DeletionGuard: GuardDbg } = await modules();
  assert.ok(
    forgetResult.ledgerRecorded,
    `the deletion was recorded (entries=${LedgerDbg.getInstance().entries().length}, removed=${forgetResult.removed})`,
  );
  assert.equal(GuardDbg.getInstance().quotes(pattern.response), true, "the guard matches the deleted statement itself");

  // Background learning reading a stale copy.
  const brain2 = new Brain();
  conversations += 1;
  const machine = await brain2.learn(`Note that ${phrase}.`, "Filed.", "general", [], {
    source: "self-study",
    originSeed: { userId: USER, conversationId: "chat-self-study", sessionId: "s", sourceType: "self-study" },
  });
  // The engine still hands back what it built; what matters is that nothing was
  // stored and nothing can be recalled.
  assert.ok(machine, "the engine returned its candidate");
  assert.ok(
    !(await brain2.recallAll()).some((memory) => memory.response.includes("COBALT-MARLIN-63")),
    "the machine-written record was never stored",
  );

  // The user saying it again is their decision, not a leak.
  conversations += 1;
  const user = await brain2.learn(`I am telling you again: ${phrase}.`, "Noted.", "conversation", [], {
    source: "lelu-chat",
    originSeed: { userId: USER, conversationId: `chat-again-${conversations}`, sessionId: "s", sourceType: "user-said" },
  });
  assert.ok(user, "a user-stated record is still allowed");
  assert.ok(
    (await brain2.recallAll()).some((memory) => memory.response.includes("COBALT-MARLIN-63")),
    "and it is retrievable, because the user chose to say it",
  );
});

test("E: boot-time healing removes provable residue without the panel", async () => {
  const { ProjectStore, MemoryHealing, ResidueMigration } = await modules();
  const projects = ProjectStore.getInstance();
  const token = "SABLE-KETTLE-88";
  const { brain, pattern } = await remember(`my shipping code is ${token} for the depot.`);
  await brain.forgetMemory(pattern.id);

  const project = seedLegacyCheckpoint(projects, `my shipping code is ${token} for the depot.`, ["label the parcel"]);
  const ambiguous = seedLegacyCheckpoint(projects, "We discussed the weather and the harbour lights last night.");

  const status = await MemoryHealing.getInstance().heal();
  assert.equal(status.state, "complete");
  assert.ok(status.cleanedFields >= 1, "the provable quote was removed automatically");
  assert.ok(status.batches >= 1);

  const persistedProjects = read("projects.v1")!;
  assert.ok(!persistedProjects.includes(token), "the stored project no longer quotes the deleted memory");
  assert.ok(persistedProjects.includes("label the parcel"), "unrelated work state survives");
  assert.equal(projects.get(project.id)?.checkpoint?.pending?.[0], "label the parcel");
  assert.ok(projects.get(ambiguous.id)?.checkpoint?.summary, "the ambiguous checkpoint was NOT deleted");

  const healingStatus = read("memory.healing.v1")!;
  assert.ok(healingStatus.includes("\"complete\""), "the run is recorded in storage");
  assert.ok(!healingStatus.includes(token), "the healing record carries no deleted text");

  // Running again changes nothing and does not re-count.
  const again = await MemoryHealing.getInstance().heal();
  assert.equal(again.cleanedFields, 0);
  assert.equal(again.batches, 0);
  assert.equal(ResidueMigration.getInstance().run({ dryRun: true }).findings.length, 0);
});

test("F: a healer lease stops a second healer from running concurrently", async () => {
  const { MemoryHealing } = await modules();
  storage.setItem(
    `${PREFIX}memory.healing.lock.v1`,
    JSON.stringify({ owner: "another-tab", at: Date.now() }),
  );
  const status = await MemoryHealing.getInstance().heal();
  assert.equal(status.state, "skipped");
  assert.match(status.reason ?? "", /lease/);
  storage.removeItem(`${PREFIX}memory.healing.lock.v1`);
});

test("G: a corrupted cursor is discarded and the scan still cleans", async () => {
  const { ProjectStore, ResidueMigration } = await modules();
  const projects = ProjectStore.getInstance();
  const token = "FLAX-CINDER-19";
  const { brain, pattern } = await remember(`my badge number is ${token} for the east wing.`);
  await brain.forgetMemory(pattern.id);
  seedLegacyCheckpoint(projects, `my badge number is ${token} for the east wing.`);

  storage.setItem(
    `${PREFIX}memory.migration.progress.v1`,
    JSON.stringify({ cursor: 42, cleanedFields: -3, scannedProjects: "many" }),
  );

  const report = ResidueMigration.getInstance().run({ dryRun: false });
  assert.equal(report.recoveredCursor, true, "the invalid cursor was rejected");
  assert.ok(report.cleanedFields >= 1, "and the scan restarted instead of stalling");
  assert.ok(!read("projects.v1")!.includes(token));
});

test("H: a failed progress write is reported as a failure, not a clean migration", async () => {
  const { ProjectStore, ResidueMigration } = await modules();
  const projects = ProjectStore.getInstance();
  const token = "QUARTZ-NEEDLE-24";
  const { brain, pattern } = await remember(`my invoice reference is ${token} and it was paid.`);
  await brain.forgetMemory(pattern.id);

  // Two quoting projects, so a bounded run MUST persist a cursor.
  seedLegacyCheckpoint(projects, `my invoice reference is ${token} and it was paid.`, ["file the invoice"]);
  seedLegacyCheckpoint(projects, `my invoice reference is ${token} for the delivery.`, ["post the note"]);

  const before = read("memory.migration.v1");
  failing.add(`${PREFIX}memory.migration.progress.v1`);
  let thrown: unknown;
  try {
    ResidueMigration.getInstance().run({ dryRun: false, limit: 1 });
  } catch (caught) {
    thrown = caught;
  } finally {
    failing.clear();
  }

  assert.ok(thrown, "the caller is told the run was not recorded");
  assert.equal((thrown as Error).name, "ResidueStorageError");
  assert.equal(read("memory.migration.v1"), before, "no report claims a successful migration");
});

test("I: quarantine dispositions persist, stop re-asking, and keep no deleted text", async () => {
  const { ProjectStore, ResidueMigration } = await modules();
  const projects = ProjectStore.getInstance();
  const kept = seedLegacyCheckpoint(projects, "Notes about the winter market schedule and stall allocation.");
  const forgotten = seedLegacyCheckpoint(projects, "A chat about the ferry timetable and the tide.");

  const dry = ResidueMigration.getInstance().run({ dryRun: true });
  assert.ok(dry.quarantined.some((finding) => finding.projectId === kept.id));
  assert.ok(dry.quarantined.every((finding) => finding.preview.length > 0), "the live surface can show what is being decided about");

  ResidueMigration.getInstance().run({ dryRun: false });
  const persistedReport = read("memory.migration.v1")!;
  assert.ok(persistedReport.length > 0);
  assert.ok(!persistedReport.includes("winter market"), "the stored report holds no record text");

  ResidueMigration.getInstance().review(kept.id, "keep");
  ResidueMigration.getInstance().review(forgotten.id, "forget");

  const reviews = read("memory.migration.reviews.v1")!;
  assert.ok(reviews.includes(kept.id) && reviews.includes("keep"));
  assert.ok(reviews.includes(forgotten.id) && reviews.includes("forget"));
  assert.ok(!reviews.includes("winter market"), "the disposition log holds ids, not text");

  const after = ResidueMigration.getInstance().run({ dryRun: true });
  assert.ok(!after.quarantined.some((finding) => finding.projectId === kept.id), "a kept record is not asked about again");
  assert.equal(projects.get(forgotten.id)?.checkpoint, undefined, "forget cleared only that checkpoint");
  assert.ok(projects.get(forgotten.id), "the project itself survives");
  assert.ok(projects.get(kept.id)?.checkpoint?.summary, "keep left the checkpoint in place");
});

test("J: the indexed matcher agrees with the reference matcher", async () => {
  const { fingerprintStatement, buildTombstoneIndex, matchTombstoneIndex, matchTombstone } = await modules();
  const statements = [
    "my access phrase is COPPER-LANTERN-77 for the north gate",
    "the studio address changed to 14 Aurelia Row",
    "I prefer platinum over rose gold for the commission",
  ];
  const tombstones = statements.map((text, index) => {
    const print = fingerprintStatement(text);
    return { id: `t${index}`, at: index, conversationId: null, windows: print.windows, size: print.size, tokens: print.tokens };
  });
  const index = buildTombstoneIndex(tombstones);
  const samples = [
    ...statements,
    "A paragraph that says my access phrase is COPPER-LANTERN-77 for the north gate, in passing.",
    "nothing to do with any of it",
    "the studio address changed to 14 Aurelia Row yesterday",
  ];
  for (const sample of samples) {
    assert.equal(
      matchTombstoneIndex(sample, index)?.id,
      matchTombstone(sample, tombstones)?.id,
      `indexed and reference matchers agree on: ${sample}`,
    );
  }
});

test("K: the guard filters sentence-granularly and leaves clean text identical", async () => {
  const { DeletionGuard } = await modules();
  const guard = DeletionGuard.getInstance();
  const phrase = "my locker combination is AMBER-WIDGET-31";
  const { brain, pattern } = await remember(`Remember ${phrase}.`);
  await brain.forgetMemory(pattern.id);

  const dirty = `Project update. The client approved the steel finish. Remember ${phrase}. Ship on Friday.`;
  const cleaned = guard.scrub(dirty);
  assert.ok(cleaned.removed >= 1);
  assert.ok(!cleaned.text.includes("AMBER-WIDGET-31"), "the deleted sentence is gone");
  assert.ok(cleaned.text.includes("the steel finish"), "unrelated sentences survive");
  assert.ok(cleaned.text.includes("Ship on Friday"));

  const untouched = "A line with nothing deleted in it at all.";
  assert.equal(guard.scrub(untouched).text, untouched, "clean text is returned unchanged");
  assert.equal(guard.scrub(untouched).removed, 0);
});

test("L: a hydrated cloud copy cannot restore a deleted memory", async () => {
  const { PatternMemory } = await modules();
  const token = "DELTA-HARBOR-90";
  const { brain, pattern } = await remember(`my archive number is ${token}.`);
  await brain.forgetMemory(pattern.id);

  // Exactly what mergeRemote() does with a row another device still holds.
  const memory = new PatternMemory();
  await memory.initialize();
  await memory.add(pattern);

  const recalled = await memory.search("archive number");
  assert.ok(!recalled.some((entry) => entry.id === pattern.id), "the deleted id was not restored");
  assert.ok(!memory.getAll().some((entry) => entry.id === pattern.id));
});
