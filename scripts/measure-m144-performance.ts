/**
 * Mission 14.4 — local continuity performance measurements.
 * Deterministic Node process with a browser-storage shim. No network.
 */
import fs from "node:fs";
import { performance } from "node:perf_hooks";

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
  clear: () => memory.clear(),
  get length() { return memory.size; },
  key: (index: number) => [...memory.keys()][index] ?? null,
};
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).localStorage = storage;
(globalThis as Record<string, unknown>).sessionStorage = storage;

const [projectModule, engineModule, storeModule, transportModule] = await Promise.all([
  import("../src/core/projects/ProjectStore"),
  import("../src/core/sync/ContinuityEngine"),
  import("../src/core/sync/ContinuityStore"),
  import("../src/core/sync/SimulatedTransport"),
]);
const ProjectStore = projectModule.default;
const ContinuityEngine = engineModule.default;
const ContinuityStore = storeModule.default;
const SimulatedTransport = transportModule.default;

ContinuityEngine.resetForTests();
ContinuityStore.reset();
const transport = new SimulatedTransport();
const engine = ContinuityEngine.getInstance();
engine.start({ transport, autoProcess: false });

async function drain(): Promise<void> {
  for (let index = 0; index < 30 && engine.pending().length > 0; index += 1) {
    const before = engine.pending().length;
    await engine.processOutbox();
    if (engine.pending().length >= before) break;
  }
}
await drain();

const readTimes: number[] = [];
for (let index = 0; index < 1000; index += 1) {
  const started = performance.now();
  ProjectStore.getInstance().list();
  readTimes.push(performance.now() - started);
}

const writeTimes: number[] = [];
const created: string[] = [];
for (let index = 0; index < 40; index += 1) {
  const started = performance.now();
  const project = ProjectStore.getInstance().create({ name: `M144 perf ${index}` });
  writeTimes.push(performance.now() - started);
  created.push(project.id);
}

const syncStart = performance.now();
await engine.processOutbox();
const syncMs = performance.now() - syncStart;

const conflict = created[0];
const local = ProjectStore.getInstance().get(conflict)!;
transport.seed("projects", [{
  id: conflict,
  updatedAt: local.updatedAt + 10_000,
  data: { ...local, name: "perf cloud edit", updatedAt: local.updatedAt + 10_000 },
}]);
ProjectStore.getInstance().update(conflict, { name: "perf local edit" });
const conflictStart = performance.now();
await engine.synchronize();
const conflictMs = performance.now() - conflictStart;

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return {
    count: sorted.length,
    median: Number(at(0.5).toFixed(3)),
    p95: Number(at(0.95).toFixed(3)),
    max: Number((sorted[sorted.length - 1] ?? 0).toFixed(3)),
  };
};

const output = {
  mission: "M14.4",
  evidenceClass: ["DETERMINISTIC", "LOCAL"],
  realCloud: false,
  environment: "Node + in-memory localStorage shim, 2026-11-16",
  localReadMs: stats(readTimes),
  localWriteMs: stats(writeTimes),
  outboxInsert: "included in localWriteMs; signal + hash + durable outbox append",
  syncProcessingMs: Number(syncMs.toFixed(3)),
  conflictDetectionMs: Number(conflictMs.toFixed(3)),
  pendingAfterWrites: engine.pending().length,
  note: "The production browser cold boot measured separately: 1874 ms (M14.4 sidecar check) and 3038 ms (M14.3 harness with model turn).",
};
fs.mkdirSync("artifacts/m144", { recursive: true });
fs.writeFileSync("artifacts/m144/performance.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
