/**
 * LÉLU RUNTIME CONTINUITY — VERIFICATION
 *
 * LÉLU already HAS a continuous cognitive runtime: `LeluRuntime` holds
 * the authoritative state and owns the 60s `CognitiveLoop`
 * (observe → understand → learn → reason → plan, bounded by
 * AutonomyGate). This script does not test that the loop exists — it
 * tests the thing that actually determines whether LÉLU is continuous
 * rather than episodic:
 *
 *   Does her state SURVIVE, and does it reflect what really happened?
 *
 * Three specific failures this pins down, each of which makes her
 * restart as a blank assistant or makes the UI show something that is
 * not true:
 *
 *   1. GOAL CONTINUITY — `loadGoals()` restored the goals array but
 *      nothing ever restored `activeGoal`, so the current goal and its
 *      step position were lost on every reload.
 *
 *   2. HONEST SNAPSHOTS — `notify()` (the push every UI subscriber
 *      receives) hardcoded `memoryCount: 0`, `providerNames: []`,
 *      `activeProvider: null`, while `getSnapshot()` computed them for
 *      real. Subscribers were shown invented state.
 *
 *   3. CHAT REACHES THE RUNTIME — a chat turn emits `task_started` /
 *      `task_completed` on the ONE event bus, but `observeEvent` only
 *      handled tool events, so a user message never registered in
 *      runtime state at all.
 *
 * Run: bun run scripts/verify-runtime-continuity.ts
 */

// ---------------------------------------------------------------
// Shims: window/localStorage for KvStore, timers for the loop.
// ---------------------------------------------------------------
const databases = new Map<string, Map<string, Map<string, unknown>>>();

class ShimRequest {
  result: unknown = null;
  error: Error | null = null;
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
    req.result = [...this.rows.values()].map((v) => structuredClone(v));
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
  open(name: string, _version?: number): ShimRequest {
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
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
}

const storage = new FakeStorage();
const globalAny = globalThis as Record<string, unknown>;
globalAny.window = {
  localStorage: storage,
  sessionStorage: new FakeStorage(),
  // The runtime owns real timers; keep them real so `start()` is exercised,
  // but every interval is cleared in the finally block below.
  setInterval: (...args: unknown[]) => (setInterval as never)(...(args as [])),
  clearInterval: (id: unknown) => clearInterval(id as ReturnType<typeof setInterval>),
  setTimeout: (...args: unknown[]) => (setTimeout as never)(...(args as [])),
  clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
};
globalAny.localStorage = storage;

import LeluRuntime from "../src/core/runtime/LeluRuntime";
import AIService from "../src/core/AIService";
import AgentEventBus from "../src/core/agent/AgentEvents";

let failures = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * A restart, honestly simulated: drop the singleton so a brand-new
 * instance runs its real constructor against the SAME KvStore that the
 * previous instance persisted to. This is exactly what a page reload
 * does — nothing is carried over in memory.
 */
function restart(): LeluRuntime {
  (LeluRuntime as unknown as { instance: LeluRuntime | null }).instance = null;
  return LeluRuntime.getInstance();
}

async function main(): Promise<void> {
  const runtime = LeluRuntime.getInstance();

  console.log("== 1. GOAL CONTINUITY across a restart ==");
  const goal = runtime.setGoal("Repair memory architecture", 1, [
    "Audit retrieval",
    "Trace chat → memory route",
    "Verify persistence",
  ]);
  runtime.advanceGoal(goal.id);

  const beforeSnapshot = await runtime.getSnapshot();
  assert(
    beforeSnapshot.activeGoal?.id === goal.id,
    "a goal is active before the restart",
    JSON.stringify(beforeSnapshot.activeGoal?.description),
  );
  assert(
    beforeSnapshot.activeGoal?.currentStep === 1,
    "and it has advanced to step 1 of its plan",
    `currentStep=${beforeSnapshot.activeGoal?.currentStep}`,
  );

  const revived = restart();
  const afterSnapshot = await revived.getSnapshot();

  assert(
    afterSnapshot.activeGoal !== null,
    "THE ACTIVE GOAL SURVIVES THE RESTART (it was silently dropped before)",
    "activeGoal came back null — LÉLU restarted with no current goal",
  );
  assert(
    afterSnapshot.activeGoal?.id === goal.id,
    "it is the SAME goal, not a new one",
    `${afterSnapshot.activeGoal?.id} vs ${goal.id}`,
  );
  assert(
    afterSnapshot.activeGoal?.currentStep === 1,
    "and its step position survived, so the NEXT ACTION is still known",
    `currentStep=${afterSnapshot.activeGoal?.currentStep}`,
  );
  assert(
    revived.nextAction() === "Trace chat → memory route",
    "the runtime can name the next action from the restored goal",
    String(revived.nextAction()),
  );

  console.log("\n== 2. A completed goal does NOT come back as active ==");
  {
    revived.completeGoal(goal.id);
    const done = restart();
    const doneSnapshot = await done.getSnapshot();
    assert(
      doneSnapshot.activeGoal === null,
      "after completion, the restart restores NO active goal",
      JSON.stringify(doneSnapshot.activeGoal?.description),
    );
    // Re-open a goal for the remaining sections.
    done.setGoal("Continue the integration audit", 1, ["Trace events", "Verify UI sync"]);
  }

  console.log("\n== 3. The snapshot pushed to the UI is REAL, not invented ==");
  {
    const live = LeluRuntime.getInstance();
    await live.initialize();

    let pushed: Awaited<ReturnType<LeluRuntime["getSnapshot"]>> | null = null;
    const unsubscribe = live.subscribe((snapshot) => {
      pushed = snapshot;
    });
    live.recordActivity("probe");
    unsubscribe();

    const computed = await live.getSnapshot();

    assert(pushed !== null, "subscribers receive a snapshot when state changes");
    assert(
      pushed!.providerNames.length === computed.providerNames.length,
      "the PUSHED snapshot reports the same providers as the computed one (it hardcoded [] before)",
      `pushed=${pushed!.providerNames.length} computed=${computed.providerNames.length}`,
    );
    assert(
      pushed!.memoryCount === computed.memoryCount,
      "and the same memory count (it hardcoded 0 before)",
      `pushed=${pushed!.memoryCount} computed=${computed.memoryCount}`,
    );
    assert(
      pushed!.activeGoal?.id === computed.activeGoal?.id,
      "and the same active goal",
    );
    live.shutdown();
  }

  console.log("\n== 4. A CHAT TURN registers in runtime state ==");
  {
    const live = LeluRuntime.getInstance();
    await live.initialize();
    const before = (await live.getSnapshot()).recentActivity.length;

    // Exactly what AIService.chat() emits for a real user turn — the ONE
    // event bus, not a test-only hook.
    const events = AgentEventBus.getInstance();
    const taskId = String(Date.now());
    events.emit({ type: "task_started", taskId, label: "What is my test identifier?" });
    events.emit({ type: "task_completed", taskId, label: "What is my test identifier?" });

    const after = await live.getSnapshot();
    assert(
      after.recentActivity.length > before,
      "the runtime OBSERVED the chat turn (it ignored task_* events before)",
      `${before} → ${after.recentActivity.length} activity entries`,
    );
    assert(
      after.recentActivity.some((entry) => entry.includes("What is my test identifier?")),
      "and recorded what was actually asked",
      after.recentActivity.slice(0, 3).join(" | "),
    );

    console.log("\n== 5. A failed turn is recorded as a failure, not silence ==");
    events.emit({
      type: "task_failed",
      taskId: String(Date.now()),
      label: "a request that failed",
      error: "simulated provider outage",
    });
    const failed = await live.getSnapshot();
    assert(
      failed.recentActivity.some((entry) => entry.includes("simulated provider outage")),
      "the failure reason reached runtime state",
      failed.recentActivity.slice(0, 3).join(" | "),
    );
    live.shutdown();
  }

  console.log("\n== 6. A REAL chat turn — the whole path, nothing synthetic ==");
  {
    // Sections 4-5 emitted the bus events directly. This drives the
    // actual production entry point instead: GenesisChat's call, through
    // cognition, memory and the provider chain, and asserts the runtime
    // observed it. If AIService ever stops emitting on the ONE bus, or
    // the runtime stops listening, this fails and the synthetic tests
    // above would not have caught it.
    const live = LeluRuntime.getInstance();
    await live.initialize();
    const before = (await live.getSnapshot()).recentActivity.length;

    const ai = AIService.getInstance();
    await ai.initialize();
    const PROMPT = "My favourite constellation is Cassiopeia.";
    await ai.chat(PROMPT);

    const after = await live.getSnapshot();
    assert(
      after.recentActivity.length > before,
      "a real AIService.chat() turn reached the runtime's state",
      `${before} → ${after.recentActivity.length}`,
    );
    assert(
      after.recentActivity.some((entry) => entry.includes("Cassiopeia")),
      "and the runtime knows what was actually said",
      after.recentActivity.slice(0, 4).join(" | "),
    );
    assert(
      after.memoryCount > 0,
      "the snapshot's memory count is a REAL measurement (it was hardcoded 0 in the push)",
      `memoryCount=${after.memoryCount}`,
    );
    assert(
      after.statsMeasuredAt > 0,
      "and it is marked as genuinely measured rather than defaulted",
    );
    live.shutdown();
  }

  console.log("\n== 7. Recent activity survives a restart too ==");
  {
    const revivedAgain = restart();
    const snapshot = await revivedAgain.getSnapshot();
    assert(
      snapshot.recentActivity.some((entry) => entry.includes("What is my test identifier?")),
      "what LÉLU did before the restart is still part of her state",
      `${snapshot.recentActivity.length} entries`,
    );
  }

  console.log(`\n${failures === 0 ? "ALL RUNTIME CONTINUITY CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
