/**
 * LÉLU self-development + engineering sandbox verification.
 *
 * Exercises the REAL ImprovementQueue → SelfDevelopmentLoop →
 * SandboxRuntime (isolated Worker) → EngineeringResolver stack in
 * Node, with:
 *   - an in-memory IndexedDB shim (for Brain/PatternMemory)
 *   - an in-memory window/localStorage shim (for the KvStore-backed
 *     stores: ImprovementQueue, SandboxFS, VersionHistory, AutonomyGate)
 *   - NO AI API keys (every provider is honestly unavailable)
 *
 * What this proves:
 *   A. The sandbox worker actually executes real JS and a real test
 *      harness — a deliberately failing assertion is reported as a
 *      real failure, not rubber-stamped.
 *   B. SelfDevelopmentLoop.develop() refuses to reach "Ready" while a
 *      real bug is still present, and only reaches it once a real fix
 *      passes the real sandboxed tests — "implemented" is never
 *      confused with "verified".
 *   C. integrate() only accepts a Ready candidate, and refuses a
 *      second integration of the same proposal.
 *   D. applyCandidate() (the production-write step) is hard-gated
 *      behind autonomy level 5 and stays refused at the default level.
 *   E. EngineeringResolver actually creates a real, trackable
 *      ImprovementQueue entry when the user explicitly asks to log
 *      one — and does NOT fabricate one for an ordinary diagnostic
 *      question.
 *
 * Run: bun run scripts/verify-selfdev.ts
 */

// ---------------------------------------------------------------
// Minimal in-memory IndexedDB shim (same as verify-cognition.ts).
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
    if (!db.has(storeName)) {
      db.set(storeName, new Map());
    }
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
  close(): void {
    /* no-op */
  }
}

// @ts-expect-error — global shim for Node
globalThis.indexedDB = {
  open(name: string, _version?: number): ShimRequest {
    if (!databases.has(name)) {
      databases.set(name, new Map());
    }
    const req = new ShimRequest();
    const db = new ShimDatabase(name);
    req.result = db;
    queueMicrotask(() => {
      if (!db.objectStoreNames.contains("memories")) {
        req.onupgradeneeded?.();
      }
      req.onsuccess?.();
    });
    return req;
  },
};

// ---------------------------------------------------------------
// Minimal in-memory window/localStorage shim, for the KvStore-backed
// stores this pipeline actually uses (ImprovementQueue, SandboxFS,
// VersionHistory, AutonomyGate).
// ---------------------------------------------------------------
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
};

import AIService from "../src/core/AIService";
import ImprovementQueue from "../src/core/selfdev/ImprovementQueue";
import SelfDevelopmentLoop from "../src/core/selfdev/SelfDevelopmentLoop";
import LeluRuntime from "../src/core/runtime/LeluRuntime";
import SandboxFS from "../src/core/engineering/SandboxFS";
import AutonomyGate from "../src/core/cognition/AutonomyGate";
import AgentEventBus from "../src/core/agent/AgentEvents";

let failures = 0;
function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`);
  }
}

async function main(): Promise<void> {
  const ai = AIService.getInstance();
  await ai.initialize();

  console.log("== A/B/C — SelfDevelopmentLoop: never confuse implemented with verified ==");
  const queue = ImprovementQueue.getInstance();
  const loop = SelfDevelopmentLoop.getInstance();

  const proposal = queue.add({
    title: "Fix: add() returns wrong sum",
    kind: "Bug",
    problem: "add(a,b) is implemented as a - b",
    observation: "manual test",
    evidence: "math.js",
    proposedSolution: "fix the operator",
    expectedBenefit: "correct sums",
    dependencies: [],
    risk: "low",
    requiredTools: ["sandbox"],
    requiredAgents: [],
    complexity: "low",
    version: "1.0",
    testPlan: "run sandbox tests",
  });

  const fs = SandboxFS.getInstance();
  fs.write("math.js", "function add(a,b){return a-b;}\nmodule.exports = { add };");
  fs.write(
    "test/math.test.js",
    `const { add } = require("../math.js");
     describe("add", () => { it("adds", () => { assertEqual(add(2,3), 5); }); });`,
  );
  queue.setStatus(proposal.id, "Approved");

  const runtime = LeluRuntime.getInstance();
  const failRun = await loop.develop(proposal.id, { runWorkspaceTypecheck: false });
  const goalAfterFailure = runtime.getGoals().find((goal) =>
    goal.description.includes(proposal.title),
  );
  assert(failRun.success === false, "develop() reports failure while the real bug is still present");
  assert(failRun.finalStatus === "Testing", 'proposal stays in "Testing" — never marked Ready on a failing test');
  assert(queue.get(proposal.id)?.status === "Testing", "queue status matches the real outcome");

  const fixRun = await loop.develop(proposal.id, {
    edits: [{ path: "math.js", content: "function add(a,b){return a+b;}\nmodule.exports = { add };" }],
    runWorkspaceTypecheck: false,
  });
  assert(fixRun.success === true, "develop() reports success once the real fix is applied");
  assert(fixRun.finalStatus === "Ready", 'proposal reaches "Ready" only after the real sandboxed test passes');
  assert((fixRun.testResult?.tests.filter((t) => t.passed).length ?? 0) >= 1, "a real test actually ran and passed");
  assert(Boolean(fixRun.candidateSnapshotId), "a real candidate snapshot was created");

  console.log("\n== self-development IS a goal pipeline, with REAL verification evidence ==");
  // Before this, develop() ran entirely outside the goal system: no goal
  // recorded what it was trying to achieve, and its verification results
  // — which come from actually running the compiler and the test suite —
  // went nowhere the rest of LÉLU could see.
  assert(
    goalAfterFailure !== undefined,
    "the development run opened a real runtime goal",
    runtime.getGoals().map((goal) => goal.description).join(" | "),
  );
  assert(
    (goalAfterFailure?.steps.length ?? 0) >= 5,
    "with the real pipeline as its plan (snapshot → edit → syntax → test → typecheck → …)",
    JSON.stringify(goalAfterFailure?.steps),
  );

  const failedOutcomes = goalAfterFailure?.outcomes.filter((o) => o.status === "failed") ?? [];
  assert(
    failedOutcomes.length > 0,
    "the FAILING run recorded a failed outcome against the goal",
    JSON.stringify(goalAfterFailure?.outcomes.map((o) => `${o.action}:${o.status}`)),
  );
  assert(
    failedOutcomes.some((outcome) => outcome.action === "test"),
    "and it was the TEST step that failed — the real one, not a placeholder",
    JSON.stringify(failedOutcomes.map((o) => o.action)),
  );
  assert(
    Boolean(goalAfterFailure?.blockedReason),
    "the goal is BLOCKED with the real reason, rather than advancing past work that did not hold",
    String(goalAfterFailure?.blockedReason),
  );

  const verified = goalAfterFailure?.outcomes.filter((o) => o.status === "verified") ?? [];
  assert(
    verified.some((outcome) => outcome.action === "snapshot" || outcome.action === "edit"),
    "steps that genuinely succeeded are recorded as verified",
    JSON.stringify(verified.map((o) => o.action)),
  );

  // The successful run: a second goal, completed, with the passing test
  // as evidence.
  const goals = runtime.getGoals().filter((goal) => goal.description.includes(proposal.title));
  const completed = goals.find((goal) => goal.status === "completed");
  assert(
    completed !== undefined,
    "the SUCCESSFUL run completed its goal",
    goals.map((goal) => `${goal.status}`).join(", "),
  );
  assert(
    (completed?.outcomes.filter((o) => o.status === "verified").length ?? 0) >= 3,
    "with several genuinely verified steps behind it",
    JSON.stringify(completed?.outcomes.map((o) => `${o.action}:${o.status}`)),
  );
  assert(
    completed?.outcomes.some(
      (outcome) => outcome.action === "test" && outcome.status === "verified",
    ) === true,
    "including the test step — verified because a real test suite actually ran and passed",
    JSON.stringify(completed?.outcomes.filter((o) => o.action === "test")),
  );
  assert(
    completed?.outcomes.every((outcome) => outcome.detail.trim().length > 0) === true,
    "every outcome carries real evidence text, never an empty claim",
  );

  console.log("\n== live visibility — the SAME event bus GenesisExecutionTimeline renders from ==");
  // GenesisExecutionTimeline (mounted persistently in the chat surface,
  // per GenesisInterface.tsx) subscribes to AgentEventBus and renders
  // "LÉLU is doing X" live as events arrive. develop() must emit through
  // that same bus — otherwise the sandbox loop runs correctly but
  // invisibly, which is indistinguishable from "nothing is happening".
  const bus = AgentEventBus.getInstance();
  const events = bus.recent(60).filter((e) => e.taskId === proposal.id);
  assert(events.some((e) => e.type === "task_started"), "a task_started event was emitted for this proposal");
  assert(
    events.some((e) => e.type === "file_changed" && e.path === "math.js"),
    "a file_changed event fired for the real edit (math.js) — this is what 'she's editing a file' visibility is",
  );
  assert(
    events.some((e) => e.type === "tool_started" && e.tool === "dev.test") &&
      events.some((e) => e.type === "tool_result" && e.tool === "dev.test"),
    "tool_started + tool_result fired for the real test run",
  );
  assert(
    events.some((e) => e.type === "tool_failed" && e.tool === "dev.test"),
    "the FIRST (failing) develop() attempt left a real tool_failed for the test step — visible failure, not silence",
  );
  assert(
    events.some((e) => e.type === "task_completed" && e.label.includes("Ready")),
    "a task_completed event marked the candidate Ready",
  );

  const integrateRun = loop.integrate(proposal.id);
  assert(integrateRun.success === true, "integrate() accepts a Ready candidate");
  assert(queue.get(proposal.id)?.status === "Integrated", "queue reflects the real Integrated status");
  const eventsAfterIntegrate = bus.recent(60).filter((e) => e.taskId === proposal.id);
  assert(
    eventsAfterIntegrate.some((e) => e.type === "task_completed" && e.label.includes("Integrated")),
    "integrate() also emitted a live task_completed event",
  );

  const doubleIntegrate = loop.integrate(proposal.id);
  assert(doubleIntegrate.success === false, "integrate() refuses a second integration of the same proposal");

  console.log("\n== D — production writes stay hard-gated behind autonomy L5 ==");
  assert(AutonomyGate.getInstance().getLevel() < 5, "default autonomy level is below the production-write gate");
  const proposal2 = queue.add({
    title: "Second proposal for the apply-gate check",
    kind: "Bug",
    problem: "n/a",
    observation: "n/a",
    evidence: "n/a",
    proposedSolution: "n/a",
    expectedBenefit: "n/a",
    dependencies: [],
    risk: "low",
    requiredTools: [],
    requiredAgents: [],
    complexity: "low",
    version: "1.0",
    testPlan: "n/a",
  });
  queue.setStatus(proposal2.id, "Ready");
  const applyRun = await loop.applyCandidate(proposal2.id, { approved: true });
  assert(applyRun.success === false, "applyCandidate() refuses production writes below autonomy L5, even with approved:true");

  console.log("\n== E — EngineeringResolver: real queue entries, never fabricated ones ==");
  const before = queue.list().length;
  const explicit = await ai.chat("Please log this as a bug so you track it: the export button does nothing on Safari.");
  const afterExplicit = queue.list().length;
  assert(afterExplicit === before + 1, "an explicit 'log this as a bug' request creates exactly one real queue entry");
  assert(
    typeof explicit.metadata?.proposalId === "string" && queue.get(explicit.metadata.proposalId as string) !== undefined,
    "the response references a proposal id that actually exists in the queue",
  );

  const diagnosticOnly = await ai.chat("Why might the GitHub Models provider be failing right now?");
  const afterDiagnostic = queue.list().length;
  assert(afterDiagnostic === afterExplicit, "an ordinary diagnostic question does NOT create a queue entry");
  assert(!diagnosticOnly.text.includes("Logged it as a real improvement proposal"), "diagnostic response is not the proposal-logged confirmation");

  console.log(`\n${failures === 0 ? "ALL SELF-DEV CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
