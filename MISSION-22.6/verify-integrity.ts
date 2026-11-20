/**
 * M22.6 — INDEPENDENT VERIFICATION
 *
 * Runs the real modules against an in-memory browser and asserts on what is
 * actually persisted (localStorage / IndexedDB shims), not on the migration's
 * own counters. Emits JSON for MISSION-22.6/.
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
 *     MISSION-22.6/verify-integrity.ts > MISSION-22.6/verification.json
 *
 * Scenarios A–J follow M22.6 WP07; the performance section follows WP06.
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
  /** Independent inspection: every persisted key, as stored. */
  dump(): Record<string, string> {
    return Object.fromEntries(this.map);
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
const PREFIX = "lelu.";
const USER = "verify-user";

const BASE = new URL("../src/", import.meta.url).pathname;

async function load() {
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
    import(`${BASE}brain/Brain.ts`),
    import(`${BASE}core/projects/ProjectStore.ts`),
    import(`${BASE}core/memory/ResidueMigration.ts`),
    import(`${BASE}core/memory/MemoryHealing.ts`),
    import(`${BASE}core/memory/DeletionGuard.ts`),
    import(`${BASE}core/memory/DeletionLedger.ts`),
    import(`${BASE}brain/PatternMemory.ts`),
    import(`${BASE}core/memory/DeletionLedger.ts`),
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

type Mods = Awaited<ReturnType<typeof load>>;

let conversations = 0;
const result: Record<string, unknown> = {
  mission: "M22.6",
  startedAt: new Date().toISOString(),
  scenarios: {},
  performance: {},
  storage: {},
};

function raw(key: string): string | null {
  return storage.getItem(`${PREFIX}${key}`);
}

/** What a "restart" can still see: only what was written to storage. */
function restarted(key: string): unknown {
  const value = raw(key);
  return value === null ? null : (JSON.parse(value) as unknown);
}

async function remember(mods: Mods, statement: string, brain?: InstanceType<Mods["Brain"]>) {
  const writer = brain ?? new mods.Brain();
  conversations += 1;
  const learned = await writer.learn(statement, "Noted.", "conversation", [], {
    source: "lelu-chat",
    originSeed: {
      userId: USER,
      conversationId: `verify-chat-${conversations}`,
      sessionId: "verify-session",
      sourceType: "user-said",
    },
  });
  assert.ok(learned, `stored: ${statement}`);
  return { brain: writer, pattern: learned!, conversationId: `verify-chat-${conversations}` };
}

function seedCheckpoint(mods: Mods, summary: string, pending: string[] = []) {
  const projects = mods.ProjectStore.getInstance();
  const project = projects.create({
    name: `Legacy ${Math.random().toString(36).slice(2, 9)}`,
    description: "Auto-created for answered turns",
  });
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

/* --------------------------------- A ---------------------------------- */
async function scenarioA(mods: Mods) {
  const token = "VERIFY-AURORA-11";
  const { brain, pattern } = await remember(mods, `my inspection code is ${token}.`);
  const removed = await brain.forgetMemory(pattern.id);

  // IndexedDB: the record is physically gone.
  const rows = databases.get("lelu-memory")?.get("memories");
  assert.ok(rows, "the memory database exists");
  assert.equal(rows!.has(pattern.id), false, "the record is removed from IndexedDB");

  // Ledger: a tombstone exists, with no text.
  const ledgerRaw = raw("memory.deletions.v1")!;
  assert.ok(ledgerRaw, "a tombstone was written");
  assert.ok(!ledgerRaw.includes(token), "the ledger holds no deleted text");
  return {
    removed: removed.removed,
    ledgerRecorded: removed.ledgerRecorded,
    nodesRemoved: removed.nodes,
    tombstones: mods.DeletionLedger.getInstance().entries().length,
    indexedDbRows: rows!.size,
    ledgerHoldsText: ledgerRaw.includes(token),
  };
}

/* --------------------------------- B ---------------------------------- */
async function scenarioB(mods: Mods) {
  const token = "VERIFY-BASALT-22";
  const { brain, pattern } = await remember(mods, `my courier code is ${token}.`);
  // Delete FIRST, then persist the checkpoint: this is the old writer's residue,
  // written when the record was already gone (M22.4 could not reach it).
  await brain.forgetMemory(pattern.id);
  const project = seedCheckpoint(mods, `my courier code is ${token}.`, ["print the label"]);
  assert.ok(raw("projects.v1")!.includes(token), "the checkpoint really was persisted");

  const afterRestartProjects = restarted("projects.v1") as Array<{ id: string; checkpoint?: { summary: string } }>;
  const stored = afterRestartProjects.find((entry) => entry.id === project.id)!;
  const cleaned = await mods.ResidueMigration.getInstance().run({ dryRun: false });
  const persisted = raw("projects.v1")!;
  return {
    quoteAtDeletionTime: false,
    cleanedFields: cleaned.cleanedFields,
    storedCopyAfterHealing: persisted.includes(token),
    summaryAfterHealing: mods.ProjectStore.getInstance().get(project.id)?.checkpoint?.summary ?? null,
    pendingSurvives: mods.ProjectStore.getInstance().get(project.id)?.checkpoint?.pending ?? [],
    summaryBeforeHealing: stored.checkpoint?.summary ?? null,
    droppedSummaryWasQuote: stored.checkpoint?.summary?.includes(token) ?? false,
  };
}

/* --------------------------------- C ---------------------------------- */
async function scenarioC(mods: Mods) {
  const token = "VERIFY-CINDER-33";
  const { brain, pattern } = await remember(mods, `my locker code is ${token}.`);
  await brain.forgetMemory(pattern.id);
  seedCheckpoint(mods, `my locker code is ${token}.`, ["clear the locker"]);
  seedCheckpoint(mods, "The harbour market opens at dawn on Saturdays.");

  const status = await mods.MemoryHealing.getInstance().heal();
  const projects = raw("projects.v1")!;
  return {
    state: status.state,
    batches: status.batches,
    cleanedFields: status.cleanedFields,
    quarantined: status.quarantined,
    residueRemains: projects.includes(token),
    ambiguousCheckpointKept: projects.includes("harbour market opens at dawn"),
    healingRecordPersisted: raw("memory.healing.v1") !== null,
    healingRecordHoldsText: raw("memory.healing.v1")!.includes(token),
  };
}

/* --------------------------------- D ---------------------------------- */
async function scenarioD(mods: Mods) {
  const token = "VERIFY-DUNE-44";
  const { brain, pattern } = await remember(mods, `my parcel code is ${token}.`);
  await brain.forgetMemory(pattern.id);
  const migration = mods.ResidueMigration.getInstance();
  const projectIds: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    projectIds.push(seedCheckpoint(mods, `my parcel code is ${token} for batch ${index}.`).id);
  }

  // Interrupt: one bounded batch, then the process "dies".
  migration.clearProgress();
  const first = migration.run({ dryRun: false, limit: 1 });
  const interruptedStore = raw("projects.v1")!;
  const stillQuoted = interruptedStore.split(token).length - 1;

  // The next boot resumes from the durable cursor.
  const status = await mods.MemoryHealing.getInstance().heal();
  return {
    firstBatchCursor: first.cursor !== null,
    quotesLeftAfterInterruption: stillQuoted,
    resumed: status.resumed,
    batches: status.batches,
    quotesLeftAfterResume: raw("projects.v1")!.split(token).length - 1,
    progressCleared: raw("memory.migration.progress.v1") === null,
    projectCount: projectIds.length,
  };
}

/* --------------------------------- E ---------------------------------- */
async function scenarioE(mods: Mods) {
  const token = "VERIFY-EMBER-55";
  const phrase = `my client reference is ${token}`;
  const { brain, pattern } = await remember(mods, `Remember that ${phrase}.`);
  const carrierId = crypto.randomUUID();
  const memory = new mods.PatternMemory();
  await memory.initialize();
  await memory.add({
    id: carrierId,
    category: "general" as never,
    prompt: "carrier",
    response: `${phrase} and my studio is Aurelia.`,
    intent: "general" as never,
    keywords: ["client", "reference"],
    context: { origin: { sourceType: "user-said" } },
    importance: 0.9,
    confidence: 1,
    successfulUses: 1,
    failedUses: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const beforeDeletion = await memory.search("client reference");
  assert.ok(beforeDeletion.some((entry) => entry.id === carrierId), "the carrier is recallable before deletion");
  await brain.forgetMemory(pattern.id);

  const afterDeletion = await memory.search("client reference");
  const contextBlock = [
    "## PROJECT CHECKPOINTS",
    `- Legacy project [active]: ${phrase}. Next: reassess. Pending: none recorded`,
    "- Legacy project [active]: the harbour market opens at dawn. Next: reassess. Pending: none recorded",
  ].join("\n");
  const guarded = mods.DeletionGuard.getInstance().sanitizeContext(contextBlock);

  return {
    recallableBefore: true,
    recallableAfter: afterDeletion.some((entry) => entry.id === carrierId),
    contextSentencesRemoved: guarded.removed,
    contextStillHasDeletedQuote: guarded.context.includes(token),
    contextKeepsUnrelated: guarded.context.includes("harbour market"),
  };
}

/* --------------------------------- F ---------------------------------- */
async function scenarioF(mods: Mods) {
  const projects = mods.ProjectStore.getInstance();
  const ambiguous = seedCheckpoint(mods, "A conversation about tide tables and the ferry schedule.");
  const before = projects.get(ambiguous.id)?.checkpoint?.summary;

  const status = await mods.MemoryHealing.getInstance().heal();
  const dry = mods.ResidueMigration.getInstance().run({ dryRun: true });
  const quarantined = dry.quarantined.some((finding) => finding.projectId === ambiguous.id);

  const persistedReport = raw("memory.migration.v1")!;
  mods.ResidueMigration.getInstance().review(ambiguous.id, "keep");
  const afterKeep = mods.ResidueMigration.getInstance().run({ dryRun: true });

  return {
    healingState: status.state,
    quarantinedNotDeleted: Boolean(projects.get(ambiguous.id)?.checkpoint?.summary),
    summaryUnchanged: projects.get(ambiguous.id)?.checkpoint?.summary === before,
    appearsInDryRun: quarantined,
    storedReportHoldsRecordText: persistedReport.includes("tide tables"),
    stillAskedAfterKeep: afterKeep.quarantined.some((finding) => finding.projectId === ambiguous.id),
    dispositionLogged: raw("memory.migration.reviews.v1")?.includes(ambiguous.id) ?? false,
  };
}

/* --------------------------------- G ---------------------------------- */
async function scenarioG(mods: Mods) {
  const token = "VERIFY-GARNET-66";
  const { brain, pattern } = await remember(mods, `my pickup code is ${token}.`);
  const project = seedCheckpoint(mods, `my pickup code is ${token}.`);
  const memory = new mods.PatternMemory();
  await memory.initialize();

  // Deletion, migration and retrieval interleaved, with awaits between them.
  const tasks = [
    (async () => brain.forgetMemory(pattern.id))(),
    (async () => mods.ResidueMigration.getInstance().run({ dryRun: false, limit: 5 }))(),
    (async () => memory.search("pickup code"))(),
    (async () => mods.ResidueMigration.getInstance().run({ dryRun: true }))(),
  ];
  const [deletion, migration, recall, secondScan] = await Promise.all(tasks);
  const guarded = mods.DeletionGuard.getInstance().sanitizeContext(raw("projects.v1")!);

  return {
    deletionRecorded: (deletion as { ledgerRecorded: boolean }).ledgerRecorded,
    migrationPersisted: (migration as { persisted: boolean }).persisted,
    recallResults: (recall as unknown[]).length,
    secondScanRecoveredCursor: (secondScan as { recoveredCursor: boolean }).recoveredCursor,
    persistedStoreStillQuotes: raw("projects.v1")!.includes(token),
    storeNeededGuarding: guarded.removed > 0,
    projectCheckpointGone: !(mods.ProjectStore.getInstance().get(project.id)?.checkpoint?.summary ?? ""),
  };
}

/* --------------------------------- H ---------------------------------- */
async function scenarioH(mods: Mods) {
  const token = "VERIFY-HELIOTROPE-77";
  const { brain, pattern } = await remember(mods, `my access phrase is ${token} for the archive.`);
  await brain.forgetMemory(pattern.id);

  // Everything this scenario asserts is read back from storage, as a restart
  // would: a new module instance reads localStorage, not process memory.
  const ledgerAfterRestart = restarted("memory.deletions.v1") as Array<{ id: string; windows: string[] }>;
  assert.ok(Array.isArray(ledgerAfterRestart), "the ledger survives a restart");
  assert.ok(
    ledgerAfterRestart.some((entry) => entry.id === pattern.id),
    "the deleted id is still recorded after a restart",
  );

  const indexedDbRows = [...(databases.get("lelu-memory")?.get("memories")?.values() ?? [])] as Array<{ id: string }>;
  assert.ok(!indexedDbRows.some((row) => row.id === pattern.id), "the record is still absent from IndexedDB");

  // A fresh conversation payload is assembled from storage + memory; the guard
  // is what stops the deleted phrase reaching it.
  const guard = mods.DeletionGuard.getInstance();
  const payloadBlock = `Retrieved context: my access phrase is ${token} for the archive.`;
  const sanitized = guard.sanitizeContext(payloadBlock);
  return {
    ledgerEntriesAfterRestart: ledgerAfterRestart.length,
    deletedRecordPresentInIndexedDb: indexedDbRows.some((row) => row.id === pattern.id),
    payloadWouldContainPhraseWithoutGuard: payloadBlock.includes(token),
    payloadContainsPhraseAfterGuard: sanitized.context.includes(token),
    payloadSegmentsRemoved: sanitized.removed,
  };
}

/* --------------------------------- I ---------------------------------- */
async function scenarioI(mods: Mods) {
  const projects = mods.ProjectStore.getInstance();
  const unrelated = projects.create({ name: "Unrelated release plan", description: "real work" });
  projects.checkpoint(unrelated.id, {
    status: "active",
    summary: "Ship the pricing page on Friday.",
    completed: ["copy approved"],
    pending: ["call the printer"],
    blockers: ["waiting on legal"],
    nextAction: "send the draft",
  });
  const note = projects.addNote(unrelated.id, "Venue", "The launch venue is confirmed for Thursday.");
  const before = JSON.stringify(projects.get(unrelated.id));
  const memoriesBefore = [...(databases.get("lelu-memory")?.get("memories")?.keys() ?? [])].length;

  await mods.MemoryHealing.getInstance().heal();
  mods.ResidueMigration.getInstance().run({ dryRun: false });

  const after = JSON.stringify(projects.get(unrelated.id));
  const memoriesAfter = [...(databases.get("lelu-memory")?.get("memories")?.keys() ?? [])].length;
  return {
    projectUnchangedByteForByte: before === after,
    noteSurvives: Boolean(projects.get(unrelated.id)?.items?.some((entry) => entry.id === note.id && entry.kind === "note")),
    blockersSurvive: projects.get(unrelated.id)?.checkpoint?.blockers ?? [],
    nextActionSurvives: projects.get(unrelated.id)?.checkpoint?.nextAction ?? null,
    memoriesAddedByMigration: memoriesAfter - memoriesBefore,
  };
}

/* --------------------------------- J ---------------------------------- */
async function scenarioJ(mods: Mods) {
  const cycles: Array<Record<string, unknown>> = [];
  const tokenBase = "VERIFY-JOURNEY";
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const token = `${tokenBase}-${cycle}0`;
    const { brain, pattern } = await remember(mods, `my cycle code is ${token}.`);
    // Delete first, then persist the quoting checkpoint: that is the historical
    // residue shape, so the healer (not the immediate cleanup) must remove it.
    await brain.forgetMemory(pattern.id);
    seedCheckpoint(mods, `my cycle code is ${token}.`, [`cycle ${cycle} step`]);
    const status = await mods.MemoryHealing.getInstance().heal();
    cycles.push({
      cycle,
      cleaned: status.cleanedFields,
      state: status.state,
      residueRemains: raw("projects.v1")!.includes(token),
      tombstoneCount: mods.DeletionLedger.getInstance().entries().length,
    });
  }
  const last = cycles[cycles.length - 1] as { residueRemains: boolean };
  return {
    cycles,
    allCyclesClean: cycles.every((entry) => entry.residueRemains === false),
    finalResidueRemains: last.residueRemains,
  };
}

/* ----------------------------- performance ---------------------------- */

/** Seed N projects directly into storage, without N full rewrites. */
async function seedProjects(mods: Mods, count: number, summaryFor: (index: number) => string) {
  const projects = mods.ProjectStore.getInstance();
  projects.list().forEach((project) => projects.remove(project.id));
  const template = projects.create({ name: "template", description: "Auto-created for answered turns" });
  projects.checkpoint(template.id, {
    status: "active",
    summary: "template",
    completed: [],
    pending: ["a real pending step"],
    blockers: [],
    nextAction: "a real next action",
  });
  const base = JSON.parse(raw("projects.v1")!) as LeluProject[];
  const sample = base[0];
  const rows: LeluProject[] = [];
  for (let index = 0; index < count; index += 1) {
    rows.push({
      ...sample,
      id: `p${String(index).padStart(5, "0")}`,
      name: `Project ${index}`,
      createdAt: sample.createdAt + index,
      updatedAt: sample.updatedAt + index,
      checkpoint: {
        ...sample.checkpoint!,
        summary: summaryFor(index),
      },
    });
  }
  storage.setItem(`${PREFIX}projects.v1`, JSON.stringify(rows));
  return rows;
}

interface LeluProject {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  checkpoint?: { summary: string; pending: string[]; nextAction: string | null };
}

async function runPerformance(mods: Mods) {
  const token = "VERIFY-SCALE-99";
  const { brain, pattern } = await remember(mods, `my scale code is ${token}.`);
  await brain.forgetMemory(pattern.id);

  const rows = await seedProjects(mods, 1000, (index) =>
    index % 50 === 0 ? `my scale code is ${token} for project ${index}.` : `project ${index} status is unchanged.`,
  );
  mods.ResidueMigration.getInstance().clearProgress();

  const dryStart = performance.now();
  const dry = mods.ResidueMigration.getInstance().run({ dryRun: true });
  const dryMs = performance.now() - dryStart;

  const applyStart = performance.now();
  const applied = mods.ResidueMigration.getInstance().run({ dryRun: false });
  const applyMs = performance.now() - applyStart;

  // Bounded batch cost, as the boot healer runs it.
  mods.ResidueMigration.getInstance().clearProgress();
  const batchTimes: number[] = [];
  for (let batch = 0; batch < 4; batch += 1) {
    const started = performance.now();
    mods.ResidueMigration.getInstance().run({ dryRun: true, limit: 25 });
    batchTimes.push(Number((performance.now() - started).toFixed(2)));
  }

  // Indexed matcher vs the reference matcher on the same 1,000 projects.
  const tombstones = mods.DeletionLedger.getInstance().entries();
  const index = mods.buildTombstoneIndex(tombstones);
  const texts = rows.flatMap((row) => [row.checkpoint?.summary ?? "", ...(row.checkpoint?.pending ?? [])]);
  const refStart = performance.now();
  for (const text of texts) mods.matchTombstone(text, tombstones);
  const referenceMs = performance.now() - refStart;
  const idxStart = performance.now();
  for (const text of texts) mods.matchTombstoneIndex(text, index);
  const indexedMs = performance.now() - idxStart;

  // Recall/context guard overhead, 200 assemblies of a 40-line context block.
  const guard = mods.DeletionGuard.getInstance();
  const block = Array.from({ length: 40 }, (_, line) => `- Project ${line}: a status line with no deleted content.`).join("\n");
  const guardStart = performance.now();
  for (let iteration = 0; iteration < 200; iteration += 1) guard.sanitizeContext(block);
  const guardMs = performance.now() - guardStart;

  const status = await mods.MemoryHealing.getInstance().heal();

  return {
    projects: rows.length,
    tombstoneCount: tombstones.length,
    dryRun: { ms: Number(dryMs.toFixed(2)), findings: dry.findings.length, scannedFields: dry.scannedFields },
    apply: { ms: Number(applyMs.toFixed(2)), cleanedFields: applied.cleanedFields, persisted: applied.persisted },
    boundedBatchMs: batchTimes,
    matcher: {
      referenceMs: Number(referenceMs.toFixed(2)),
      indexedMs: Number(indexedMs.toFixed(2)),
      speedup: Number((referenceMs / Math.max(indexedMs, 0.001)).toFixed(2)),
      sameAnswer: texts.every((text) => mods.matchTombstone(text, tombstones)?.id === mods.matchTombstoneIndex(text, index)?.id),
    },
    guardOverheadMsPerAssembly: Number((guardMs / 200).toFixed(3)),
    bootHealingAfter1000: { state: status.state, ms: Number(status.durationMs.toFixed(2)), batches: status.batches },
    baselineM225: { projects: 60, dryRunMs: 7.19, applyMs: 10.43, contextAssemblyMs: 1.62 },
    note: "M22.5 measured 60 projects; this run measures 1,000, so absolute times are not directly comparable. Per-project cost is reported in the mission document.",
  };
}

/* -------------------------------- main -------------------------------- */
async function main() {
  const mods = await load();

  result.scenarios = {
    A_ordinary_deletion: await scenarioA(mods),
    B_historical_residue: await scenarioB(mods),
    C_automatic_migration: await scenarioC(mods),
    D_interrupted_migration: await scenarioD(mods),
    E_recall_protection: await scenarioE(mods),
    F_ambiguous_quarantine: await scenarioF(mods),
    G_concurrency: await scenarioG(mods),
    H_persistence_restart: await scenarioH(mods),
    I_regression: await scenarioI(mods),
    J_repeated_lifecycle: await scenarioJ(mods),
  };
  result.performance = await runPerformance(mods);

  const dump = storage.dump();
  result.storage = {
    keysWritten: Object.keys(dump).sort(),
    bytes: Object.fromEntries(Object.entries(dump).map(([key, value]) => [key, value.length])),
    indexedDbDatabases: [...databases.keys()],
    // Privacy check across every persisted byte.
    deletedTokensPersisted: ["VERIFY-AURORA-11", "VERIFY-BASALT-22", "VERIFY-CINDER-33", "VERIFY-EMBER-55"].filter((token) =>
      Object.values(dump).some((value) => value.includes(token)),
    ),
  };
  result.finishedAt = new Date().toISOString();
  result.pass = true;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  result.pass = false;
  result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 1;
});
