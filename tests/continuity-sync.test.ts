/**
 * Mission 14.4 — local-first continuity acceptance (deterministic).
 *
 * No Supabase project, account or credential is used. The transport is
 * explicitly `simulated`; these tests prove the contract and the failure
 * handling, not real cloud acceptance.
 */

import assert from "node:assert/strict";
import test from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const key of Object.keys(store)) delete store[key]; },
    get length() { return Object.keys(store).length; },
    key: () => null,
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function drain(engine: { processOutbox: () => Promise<unknown>; pending: () => unknown[] }): Promise<void> {
  for (let index = 0; index < 20 && engine.pending().length > 0; index += 1) {
    const before = engine.pending().length;
    await engine.processOutbox();
    if (engine.pending().length >= before) break;
  }
}

async function modules() {
  const [projectModule, chatModule, graphModule, spatialModule, engineModule, storeModule, transportModule, kvModule] =
    await Promise.all([
      import("../src/core/projects/ProjectStore"),
      import("../src/core/multichat/MultiChatStore"),
      import("../src/core/cognition/KnowledgeGraph"),
      import("../src/core/cosmos/SpatialObjects"),
      import("../src/core/sync/ContinuityEngine"),
      import("../src/core/sync/ContinuityStore"),
      import("../src/core/sync/SimulatedTransport"),
      import("../src/core/storage/KvStore"),
    ]);
  return {
    ProjectStore: projectModule.default,
    MultiChatStore: chatModule.default,
    KnowledgeGraph: graphModule.default,
    SpatialObjects: spatialModule.default,
    ContinuityEngine: engineModule.default,
    ContinuityStore: storeModule.default,
    SimulatedTransport: transportModule.default,
    KvStore: kvModule.default,
  };
}

test.beforeEach(async () => {
  const { ContinuityEngine, ContinuityStore } = await modules();
  ContinuityEngine.resetForTests();
  ContinuityStore.reset();
});

test("offline local write is durable and the outbox survives a reload", async () => {
  const { ProjectStore, ContinuityEngine, SimulatedTransport } = await modules();
  const transport = new SimulatedTransport();
  transport.availabilityMode = "authentication_required";
  const first = ContinuityEngine.getInstance();
  first.start({ transport, autoProcess: false });

  const project = ProjectStore.getInstance().create({ name: "Offline continuity" });
  const status = await first.processOutbox();
  assert.equal(status.pending > 0, true, "the local write created pending work");
  assert.equal(status.lastError?.includes("authenticated"), true, "auth loss is reported, not hidden");
  assert.ok(first.pending().some((operation) => operation.recordId === project.id), "the project is in the outbox");

  // Reload: a new engine instance reads the same durable sidecar.
  first.stop();
  ContinuityEngine.resetForTests();
  const second = ContinuityEngine.getInstance();
  second.start({ transport, autoProcess: false });
  assert.ok(second.pending().some((operation) => operation.recordId === project.id), "pending work survived reload");
  assert.equal(ProjectStore.getInstance().get(project.id)?.name, "Offline continuity", "local record survived too");
});

test("a stale acknowledgement cannot mark a newer local revision synchronized", async () => {
  const { ProjectStore, ContinuityEngine, SimulatedTransport } = await modules();
  const transport = new SimulatedTransport();
  const engine = ContinuityEngine.getInstance();
  engine.start({ transport, autoProcess: false });
  await engine.processOutbox(); // establish a clean cloud baseline

  const project = ProjectStore.getInstance().create({ name: "Revision one" });
  let release!: () => void;
  const originalPush = transport.push.bind(transport);
  let deferred = false;
  transport.push = async (operation) => {
    if (!deferred) {
      deferred = true;
      return new Promise((resolve) => {
        release = () => resolve(originalPush(operation));
      });
    }
    return originalPush(operation);
  };

  const run = engine.processOutbox();
  await tick();
  ProjectStore.getInstance().update(project.id, { name: "Revision two" });
  release();
  await run;

  const record = engine.evidence().records.find((item: any) => item.id === project.id) as any;
  assert.equal(record.localRevision, 2, "the local revision advanced");
  assert.equal(record.state, "pending_upload", "the stale ack did not mark revision 2 synced");
  assert.ok(engine.pending().some((operation) => operation.recordId === project.id && operation.localRevision === 2), "revision 2 remains queued");

  await engine.processOutbox();
  const synced = engine.evidence().records.find((item: any) => item.id === project.id) as any;
  assert.equal(synced.state, "synced");
  assert.equal((transport.cloudRecords("projects").find((item) => item.id === project.id)?.data as any).name, "Revision two");
});

test("a lost acknowledgement is retried without duplicating the cloud record", async () => {
  const { ProjectStore, ContinuityEngine, SimulatedTransport } = await modules();
  const transport = new SimulatedTransport();
  const engine = ContinuityEngine.getInstance();
  engine.start({ transport, autoProcess: false });
  await engine.processOutbox();

  const project = ProjectStore.getInstance().create({ name: "Exactly once" });
  transport.loseNextAcknowledgement = true;
  const first = await engine.processOutbox();
  assert.equal(first.lastError?.includes("acknowledgement"), true, "the lost ack is reported");
  assert.ok(engine.pending().some((operation) => operation.recordId === project.id), "the operation remains pending");

  await new Promise((resolve) => setTimeout(resolve, 280));
  await engine.processOutbox();
  const remote = transport.cloudRecords("projects").filter((item) => item.id === project.id);
  assert.equal(remote.length, 1, "the retry did not duplicate the record");
  assert.equal(engine.conflicts().length, 0);
});

test("concurrent local and cloud edits create a visible conflict and keep both versions", async () => {
  const { ProjectStore, ContinuityEngine, SimulatedTransport } = await modules();
  const transport = new SimulatedTransport();
  const engine = ContinuityEngine.getInstance();
  engine.start({ transport, autoProcess: false });
  await engine.processOutbox();

  const project = ProjectStore.getInstance().create({ name: "Shared project" });
  await engine.processOutbox();
  const localBefore = ProjectStore.getInstance().get(project.id);
  assert.ok(localBefore);

  // Another device writes a newer cloud revision.
  const cloudProject = { ...localBefore!, name: "Cloud edit", updatedAt: Date.now() + 5_000 };
  transport.seed("projects", [{ id: project.id, updatedAt: cloudProject.updatedAt, data: cloudProject }]);

  ProjectStore.getInstance().update(project.id, { name: "Local edit" });
  await engine.synchronize();

  const conflicts = engine.conflicts();
  const conflict = conflicts.find((item) => item.recordId === project.id);
  assert.ok(conflict, "the concurrent edit is a conflict, not a silent overwrite");
  assert.equal((conflict!.local?.data as any).name, "Local edit");
  assert.equal((conflict!.cloud?.data as any).name, "Cloud edit");
  assert.equal(ProjectStore.getInstance().get(project.id)?.name, "Local edit", "local data remains usable");

  const resolved = engine.resolveConflict(engine.conflicts(true), conflict!.id, "keep_local");
  assert.equal(resolved.ok, true);
  await engine.processOutbox();
  assert.equal((transport.cloudRecords("projects").find((item) => item.id === project.id)?.data as any).name, "Local edit");
  assert.equal(engine.conflicts().length, 0);
});

test("append-only messages merge without losing either side", async () => {
  const { ContinuityEngine, SimulatedTransport, MultiChatStore } = await modules();
  const transport = new SimulatedTransport();
  const engine = ContinuityEngine.getInstance();
  engine.start({ transport, autoProcess: false });
  await engine.processOutbox();

  const conversation = MultiChatStore.getInstance().getActive();
  assert.ok(conversation);
  MultiChatStore.getInstance().addMessage(conversation!.id, {
    id: "local-message",
    role: "user",
    text: "local",
    timestamp: Date.now(),
    source: "local",
  });
  const local = MultiChatStore.getInstance().get(conversation!.id)!;
  const cloud = {
    ...local,
    updatedAt: Date.now() + 2_000,
    messages: [
      ...local.messages,
      { id: "cloud-message", role: "assistant" as const, text: "cloud", timestamp: Date.now() + 1, source: "ai" as const },
    ],
  };
  transport.seed("conversations", [{ id: cloud.id, updatedAt: cloud.updatedAt, data: cloud }]);
  await engine.synchronize();
  const conflict = engine.conflicts().find((item) => item.recordId === conversation!.id);
  assert.ok(conflict, "the conversation conflict is visible");

  const resolved = engine.resolveConflict(engine.conflicts(true), conflict!.id, "merge");
  assert.equal(resolved.ok, true);
  const merged = MultiChatStore.getInstance().get(conversation!.id)!;
  assert.ok(merged.messages.some((message) => message.id === "local-message"));
  assert.ok(merged.messages.some((message) => message.id === "cloud-message"));
});

test("KnowledgeGraph reconciliation is idempotent and preserves node identity", async () => {
  const { KnowledgeGraph } = await modules();
  const graph = new KnowledgeGraph();
  graph.addNode({ id: "n1", type: "concept", label: "One", data: { source: "test" }, createdAt: 1 });
  graph.connect("n1", "n1", "self");
  const envelope = KnowledgeGraph.readPersistedEnvelope();
  assert.ok(envelope);
  assert.equal(envelope!.nodes.length, 1);

  KnowledgeGraph.applyPersistedEnvelope(envelope!);
  KnowledgeGraph.applyPersistedEnvelope(envelope!);
  const after = KnowledgeGraph.readPersistedEnvelope()!;
  assert.equal(after.nodes.length, 1, "repeated reconciliation does not duplicate nodes");
  assert.equal(after.edges.length, 1, "repeated reconciliation does not duplicate edges");
});

test("a concurrent spatial transform becomes a resolvable conflict, not a duplicate object", async () => {
  const { SpatialObjects, ContinuityEngine, SimulatedTransport } = await modules();
  SpatialObjects.reset();
  const objects = SpatialObjects.getInstance();
  const placed = objects.place({
    kind: "document",
    title: "Spatial conflict",
    link: { kind: "document", id: "doc-conflict" },
    position: [1, 0, 0],
  });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;

  const transport = new SimulatedTransport();
  const engine = ContinuityEngine.getInstance();
  engine.start({ transport, autoProcess: false });
  await drain(engine);

  const cloudObject = { ...placed.object, position: [9, 9, 9] as [number, number, number], updatedAt: Date.now() + 5_000 };
  transport.seed("spatialObjects", [{ id: cloudObject.id, updatedAt: cloudObject.updatedAt, data: cloudObject }]);
  objects.move(placed.object.id, [5, 5, 5]);
  await engine.synchronize();

  const conflict = engine.conflicts().find((item) => item.recordId === placed.object.id);
  assert.ok(conflict, "the two transforms are a conflict");
  assert.deepEqual((conflict!.local?.data as any).position, [5, 5, 5]);
  assert.deepEqual((conflict!.cloud?.data as any).position, [9, 9, 9]);

  const resolved = engine.resolveConflict(engine.conflicts(true), conflict!.id, "keep_local");
  assert.equal(resolved.ok, true);
  await engine.processOutbox();
  const remote = transport.cloudRecords("spatialObjects").find((item) => item.id === placed.object.id);
  assert.deepEqual((remote?.data as any).position, [5, 5, 5]);
  assert.equal(objects.list().filter((item) => item.link.id === "doc-conflict").length, 1);
});

test("a spatial object created offline survives reload and remains unique after sync", async () => {
  const { SpatialObjects, ContinuityEngine, SimulatedTransport, KvStore } = await modules();
  SpatialObjects.reset();
  const objects = SpatialObjects.getInstance();
  const placed = objects.place({
    kind: "document",
    title: "Offline object",
    link: { kind: "document", id: "doc-offline" },
  });
  assert.equal(placed.ok, true);

  const transport = new SimulatedTransport();
  const engine = ContinuityEngine.getInstance();
  engine.start({ transport, autoProcess: false });
  await drain(engine);
  assert.equal(engine.pending().length, 0, "the object uploaded under its stable id");
  assert.equal(objects.list().length, 1, "placement is idempotent by record link");

  const persisted = KvStore.getInstance().get("lelu.cosmos.objects.v1");
  SpatialObjects.reset();
  KvStore.getInstance().set("lelu.cosmos.objects.v1", persisted);
  const reloaded = SpatialObjects.getInstance();
  reloaded.reload();
  assert.equal(reloaded.find({ kind: "document", id: "doc-offline" })?.title, "Offline object");
});
