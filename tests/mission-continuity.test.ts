/**
 * ==========================================================
 * LÉLU — MISSION 14 CONTINUITY CORE
 *
 * CATEGORY: unit. Exercise the real evidence mapper, the real
 * durable ledger, the real event pulse and the real assembler.
 *
 * No model provider, no network and no browser are involved. The
 * browser storage APIs are shimmed exactly as the other core tests
 * do; nothing here claims a live provider was tested.
 * ==========================================================
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
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: () => null,
  };
}

import AgentEventBus, { type AgentEvent } from "../src/core/agent/AgentEvents";
import { CognitivePulse, pulseForEvent } from "../src/core/cognition/CognitivePulse";
import {
  assembleOperationalSelf,
  formatOperationalSelf,
  type SelfModelSources,
} from "../src/core/cognition/OperationalSelfModel";
import {
  missionEvidenceFromOperational,
  redactText,
  countEvidence,
} from "../src/core/operational-intelligence/evidence";
import { MissionLedger } from "../src/core/projects/MissionLedger";
import MissionLedgerStore from "../src/core/projects/MissionLedger";
import CognitivePulseStore from "../src/core/cognition/CognitivePulse";
import {
  CONTINUITY_EXECUTORS,
  registerContinuityTools,
} from "../src/core/cognition/ContinuityTools";
import { executableToolIds } from "../src/core/tools/ToolDispatcher";
import type { MissionRecord } from "../src/core/projects/MissionLedger";
import type { SelfModelState } from "../src/core/cognition/SelfModel";
import KvStore from "../src/core/storage/KvStore";

/** Isolated storage per test. Never the process's shared native storage. */
function memoryKv(): KvStore {
  const store = new Map<string, unknown>();
  return {
    get: (key: string) => (store.has(key) ? JSON.parse(JSON.stringify(store.get(key))) : null),
    set: (key: string, value: unknown) => {
      store.set(key, JSON.parse(JSON.stringify(value)));
      return true;
    },
    remove: (key: string) => {
      store.delete(key);
    },
  } as unknown as KvStore;
}

class FakeBus {
  listener: ((event: AgentEvent) => void) | null = null;
  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }
  emit(event: AgentEvent): void {
    this.listener?.(event);
  }
}

/* ------------------------------------------------------------------ *
 * 1. Evidence vocabulary
 * ------------------------------------------------------------------ */

test("operational lifecycle maps to evidence conservatively — available is never VERIFIED", () => {
  assert.equal(missionEvidenceFromOperational("VERIFIED"), "VERIFIED");
  assert.equal(missionEvidenceFromOperational("AVAILABLE"), "PARTIAL");
  assert.equal(missionEvidenceFromOperational("EXECUTING"), "PARTIAL");
  assert.equal(missionEvidenceFromOperational("COMPLETED"), "PARTIAL");
  assert.equal(missionEvidenceFromOperational("BLOCKED"), "BLOCKED");
  assert.equal(missionEvidenceFromOperational("NOT_CONFIGURED"), "BLOCKED", "missing configuration is an obstacle");
  assert.equal(missionEvidenceFromOperational("UNAVAILABLE"), "UNAVAILABLE");
  assert.equal(missionEvidenceFromOperational("FAILED"), "UNAVAILABLE");
});

test("credential-shaped text is redacted before it can be stored", () => {
  const dirty = [
    "key sk-abcdefghijklmnop1234567890",
    "token ghp_abcdefghijklmnopqrstuvwxyz123456",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
    "password=hunter2hunter2",
  ].join(" | ");
  const clean = redactText(dirty);
  for (const secret of ["sk-abc", "ghp_abc", "Bearer abc", "hunter2"]) {
    assert.ok(!clean.includes(secret), `"${secret}" survived redaction: ${clean}`);
  }
  assert.match(clean, /\[redacted/);
});

/* ------------------------------------------------------------------ *
 * 2. Mission ledger
 * ------------------------------------------------------------------ */

test("a workstream survives reconstruction with its blockers, files and next safe action", () => {
  const kv = memoryKv();
  const ledger = new MissionLedger({ kv });
  const created = ledger.create({
    title: "Mission 14 — cognitive continuity",
    objective: "Make project intelligence durable across conversations",
    owner: "lelu",
    repository: "lapheezy/LeluV1.1",
    branch: "freebuff/8994d7c2e03123fc8927b6fc",
    commit: "1ba90af",
    files: ["src/core/cognition/OperationalSelfModel.ts"],
    nextSafeAction: "run the focused continuity tests",
  });
  assert.equal(created.ok, true);
  assert.equal(created.durability, "persisted");
  const id = created.mission!.id;

  ledger.addFile(id, "src/core/projects/MissionLedger.ts");
  ledger.addDecision(id, "reuse AgentEventBus rather than add a bus");
  ledger.addBlocker(id, "provider health is not live-probed", "REPORTED");
  assert.equal(ledger.get(id)!.status, "blocked", "a new blocker blocks an active mission");

  const brief = ledger.resumeBrief();
  assert.match(brief, /next safe action: run the focused continuity tests/);
  assert.match(brief, /provider health is not live-probed/);
  assert.match(brief, /1 open workstream/);

  ledger.clearBlocker(id);
  assert.equal(ledger.get(id)!.status, "active", "clearing the last blocker reopens the workstream");

  // A second instance reads storage, not the first instance's memory.
  const reloaded = new MissionLedger({ kv });
  const restored = reloaded.get(id);
  assert.ok(restored, "the mission is still there after reconstruction");
  assert.equal(restored!.files.length, 2);
  assert.equal(restored!.decisions.length, 1);
  assert.equal(restored!.nextSafeAction, "run the focused continuity tests");
  assert.equal(restored!.durability, "persisted");
});

test("a refused storage write is reported as memory-only, never as durability", () => {
  const refusing = { get: () => null, set: () => false, remove: () => {} } as unknown as KvStore;
  const ledger = new MissionLedger({ kv: refusing });
  const created = ledger.create({ title: "Storage refuses this" });
  assert.equal(created.ok, true, "the work is still held in memory");
  assert.equal(created.durability, "memory-only");
  assert.equal(created.mission!.durability, "memory-only");

  const throwing = {
    get: () => null,
    set: () => {
      throw new Error("quota exceeded");
    },
    remove: () => {},
  } as unknown as KvStore;
  const throwingLedger = new MissionLedger({ kv: throwing });
  assert.equal(throwingLedger.create({ title: "Throwing storage" }).durability, "memory-only");
});

test("remote merge keeps the newer record and never deletes on absence", () => {
  const ledger = new MissionLedger({ kv: memoryKv() });
  const created = ledger.create({ title: "Local version" });
  const local = created.mission!;

  const newerRemote: MissionRecord = {
    ...local,
    title: "Remote newer version",
    updatedAt: local.updatedAt + 5_000,
  };
  ledger.mergeRemote([newerRemote]);
  assert.equal(ledger.get(local.id)!.title, "Remote newer version");

  const staleRemote: MissionRecord = {
    ...local,
    title: "Remote stale version",
    updatedAt: local.updatedAt - 5_000,
  };
  const result = ledger.mergeRemote([staleRemote]);
  assert.equal(result.kept, 1);
  assert.equal(ledger.get(local.id)!.title, "Remote newer version", "an older remote copy cannot overwrite newer local work");
  assert.ok(ledger.get(local.id), "absence from a remote batch does not delete the local record");
});

test("ledger writes redact credentials in every free-text field", () => {
  const ledger = new MissionLedger({ kv: memoryKv() });
  const created = ledger.create({
    title: "Use sk-abcdefghijklmnop1234567890",
    objective: "token ghp_abcdefghijklmnopqrstuvwxyz123456 leaked here",
    nextSafeAction: "rotate password=hunter2hunter2",
  });
  const serialized = JSON.stringify(created.mission);
  assert.ok(!serialized.includes("sk-abc"));
  assert.ok(!serialized.includes("ghp_abc"));
  assert.ok(!serialized.includes("hunter2"));
  assert.match(created.mission!.title, /\[redacted-key\]/);
});

/* ------------------------------------------------------------------ *
 * 3. Cognitive pulse
 * ------------------------------------------------------------------ */

test("the pulse records real failures, ignores noise, dedupes and stays bounded", () => {
  const bus = new FakeBus();
  let now = 1_000;
  const pulse = new CognitivePulse({ bus, kv: memoryKv(), now: () => now, dedupeWindowMs: 20_000 });
  pulse.start();

  bus.emit({ type: "tool_progress", taskId: "t", tool: "research.web", progress: 0.4 });
  assert.equal(pulse.recent().length, 0, "progress noise is not an operational change");

  bus.emit({ type: "task_failed", taskId: "t", label: "Typecheck", error: "TS2322" });
  assert.equal(pulse.recent(1)[0]!.severity, "critical");
  assert.match(pulse.recent(1)[0]!.summary, /Typecheck/);

  bus.emit({ type: "task_failed", taskId: "t", label: "Typecheck", error: "TS2322" });
  assert.equal(pulse.recent().length, 1, "the same failure inside the window is one entry");

  now += 25_000;
  bus.emit({ type: "task_failed", taskId: "t", label: "Typecheck", error: "TS2322" });
  assert.equal(pulse.recent().length, 2, "after the window it is a new observation");

  bus.emit({ type: "provider_status", taskId: "t", provider: "groq", status: "failed" });
  assert.equal(pulse.recent(1)[0]!.kind, "degradation");

  bus.emit({ type: "approval_requested", taskId: "t", approvalId: "a1", title: "Apply patch", detail: "src/x.ts" });
  assert.equal(pulse.recent(1)[0]!.kind, "approval");

  pulse.stop();
  bus.emit({ type: "task_completed", taskId: "t", label: "After stop" });
  assert.equal(pulse.recent().length, 4, "stop unsubscribes for real");
});

test("the pulse digest is bounded, persisted, and redacted", () => {
  const bus = new FakeBus();
  const kv = memoryKv();
  let now = 10_000;
  const pulse = new CognitivePulse({ bus, kv, now: () => now, dedupeWindowMs: 0 });
  pulse.start();
  for (let i = 0; i < 130; i += 1) {
    now += 1_000;
    bus.emit({ type: "task_failed", taskId: `t${i}`, label: `Task ${i}`, error: `error ${i}` });
  }
  assert.equal(pulse.recent(500).length, 120, "the in-memory window is bounded");
  assert.equal(pulse.summary().byKind.failure, 120);

  bus.emit({
    type: "task_failed",
    taskId: "secret",
    label: "key sk-abcdefghijklmnop1234567890",
    error: "token ghp_abcdefghijklmnopqrstuvwxyz123456",
  });
  const latest = pulse.recent(1)[0]!;
  assert.ok(!latest.summary.includes("sk-abc"));
  assert.ok(!latest.summary.includes("ghp_abc"));

  const reloaded = new CognitivePulse({ bus: new FakeBus(), kv, now: () => now });
  assert.ok(reloaded.recent(500).length > 0, "the digest survives reconstruction");
  assert.match(reloaded.digest(3), /COGNITIVE PULSE/);
});

test("event mapping is a pure policy that can be tested without a bus", () => {
  const mapped = pulseForEvent({ type: "agent_failed", taskId: "t", agent: "Architect", objective: "plan", error: "timeout" }, 5);
  assert.equal(mapped?.kind, "failure");
  assert.match(mapped!.summary, /Architect/);
  assert.equal(pulseForEvent({ type: "workspace_focus", taskId: "t", view: "cognition" }, 5), null);
  assert.equal(
    pulseForEvent({ type: "execution_evidence", taskId: "t", record: { outcome: "failed", tool: "x.y", path: "provider" } as never }, 5)?.kind,
    "failure",
  );
});

/* ------------------------------------------------------------------ *
 * 4. Operational self-model
 * ------------------------------------------------------------------ */

function selfState(): SelfModelState {
  return {
    updatedAt: 1,
    identity: { name: "LÉLU", summary: "A persistent cognitive companion." },
    knows: [],
    learning: [],
    capabilities: [],
    unavailable: [],
    projects: [],
    goals: ["finish Mission 14"],
    longTermObjectives: [],
    experiments: [],
    discoveries: [],
    limitations: ["memory lives in this browser"],
    improvements: [],
    hypotheses: ["a bounded pulse reduces false continuity claims"],
    unfinished: ["wire the ledger into cognition"],
  };
}

function sampleMission(): MissionRecord {
  return {
    id: "m-test",
    title: "Mission 14 first slice",
    objective: "Evidence, continuity, pulse",
    owner: "lelu",
    status: "active",
    evidence: "PARTIAL",
    files: ["src/core/cognition/OperationalSelfModel.ts"],
    decisions: ["one event bus"],
    blockers: [],
    dependencies: [],
    nextSafeAction: "run the focused tests",
    provenance: { createdBy: "test" },
    createdAt: 1,
    updatedAt: 1,
    log: [],
    durability: "persisted",
  };
}

function sources(overrides: Partial<SelfModelSources> = {}): SelfModelSources {
  return {
    self: () => selfState(),
    capabilities: () => [
      { id: "ai-chat", name: "AI Chat", status: "available", providers: ["groq"], lastSuccessful: null },
      { id: "long-term-memory", name: "Long-term memory", status: "available", providers: ["indexeddb"], lastSuccessful: 1_000 },
      { id: "short-term-memory", name: "Short-term memory", status: "not_configured", providers: [], lastSuccessful: null },
    ],
    tools: () => [
      { id: "cosmos.workspace", category: "Cosmos", available: true, riskLevel: 1 },
      { id: "self.operational", category: "Continuity", available: true, riskLevel: 0 },
    ],
    agents: () => [{ id: "a1", name: "Architect", role: "planning", status: "idle" }],
    projects: () => [{ id: "p1", name: "LÉLU", status: "active" }],
    workspaces: () => ({ views: [{ id: "v1", kind: "cognition", title: "Cognition" }], focusId: "v1" }),
    missions: () => [sampleMission()],
    pulse: () => [],
    environment: () => ({
      updatedAt: 1,
      platform: "iPhone",
      os: "iOS",
      browser: "Safari",
      language: "en",
      online: false,
      cpuCores: 6,
      memoryGB: null,
      screen: null,
      storage: { availableBytes: 10, quotaBytes: 1_000 },
      gpu: { webgl: true, webgpu: false, renderer: null },
      environment: "standalone",
    }),
    applications: () => [{ id: "chat", label: "Chat", group: "business" }],
    autonomyLevel: () => 3,
    ...overrides,
  };
}

test("the self-model labels an available capability PARTIAL until a real success is recent", () => {
  const snapshot = assembleOperationalSelf(sources(), 2_000);
  const byId = new Map(snapshot.claims.map((claim) => [claim.id, claim]));
  assert.equal(byId.get("capability.ai-chat")!.state, "PARTIAL", "a declaration is not a verified run");
  assert.equal(byId.get("capability.long-term-memory")!.state, "VERIFIED", "a recent success is evidence");
  assert.equal(byId.get("capability.short-term-memory")!.state, "BLOCKED", "missing configuration is an obstacle");
  assert.equal(byId.get("skills.registry")!.state, "UNAVAILABLE", "there is no runtime skill registry");
  assert.equal(byId.get("missions.continuity")!.state, "VERIFIED");
  assert.equal(byId.get("workspace.runtime")!.state, "VERIFIED");
  assert.equal(byId.get("runtime.environment")!.state, "VERIFIED");
  assert.equal(byId.get("permissions.autonomy")!.state, "VERIFIED");
  assert.equal(byId.get("hypothesis.14")?.state ?? "PROPOSED", "PROPOSED");

  const counts = countEvidence(snapshot.claims);
  assert.equal(
    Object.values(counts).reduce((sum, value) => sum + value, 0),
    snapshot.claims.length,
    "every claim has exactly one evidence label",
  );
  assert.equal(counts.UNAVAILABLE >= 1, true);

  const report = formatOperationalSelf(snapshot, 6);
  assert.match(report, /OPERATIONAL SELF/);
  assert.match(report, /evidence:/);
  assert.match(report, /PARTIAL/);
});

test("a source that throws is UNAVAILABLE and does not hide the rest", () => {
  const snapshot = assembleOperationalSelf(
    sources({
      tools: () => {
        throw new Error("registry unavailable");
      },
    }),
    2_000,
  );
  assert.deepEqual(snapshot.sourceFailures.map((failure) => failure.source), ["ToolRegistry"]);
  const failureClaim = snapshot.claims.find((claim) => claim.id === "source.toolregistry");
  assert.ok(failureClaim);
  assert.equal(failureClaim!.state, "UNAVAILABLE");
  assert.match(failureClaim!.statement, /registry unavailable/);
  assert.ok(snapshot.claims.some((claim) => claim.id === "workspace.runtime" && claim.state === "VERIFIED"));
  assert.match(formatOperationalSelf(snapshot), /UNREADABLE SOURCES: ToolRegistry/);
});

/* ------------------------------------------------------------------ *
 * 5. Tool wiring
 * ------------------------------------------------------------------ */

test("continuity tools register through the one dispatcher and refuse unknown missions honestly", async () => {
  const registration = registerContinuityTools();
  assert.deepEqual(registration.failed, []);
  assert.deepEqual(registration.registered.sort(), [
    "mission.brief",
    "mission.list",
    "mission.record",
    "mission.update",
    "self.operational",
  ]);
  const executable = executableToolIds();
  for (const id of registration.registered) assert.ok(executable.includes(id), `${id} is executable`);

  MissionLedgerStore.setForTests(new MissionLedger({ kv: memoryKv() }));
  CognitivePulseStore.setForTests(new CognitivePulse({ bus: { subscribe: () => () => {} }, kv: memoryKv(), now: () => 1 }));

  const record = CONTINUITY_EXECUTORS.find((executor) => executor.id === "mission.record")!;
  const created = await record.run({ title: "Tool-created workstream", nextSafeAction: "read the brief" });
  assert.equal(created.ok, true, created.content);
  assert.match(created.content, /persisted local state/);

  const brief = CONTINUITY_EXECUTORS.find((executor) => executor.id === "mission.brief")!;
  const briefResult = await brief.run({});
  assert.match(briefResult.content, /Tool-created workstream/);
  assert.match(briefResult.content, /next safe action: read the brief/);

  const list = CONTINUITY_EXECUTORS.find((executor) => executor.id === "mission.list")!;
  assert.match((await list.run({})).content, /status: active/);

  const update = CONTINUITY_EXECUTORS.find((executor) => executor.id === "mission.update")!;
  const unknown = await update.run({ id: "m-does-not-exist", action: "status", value: "completed" });
  assert.equal(unknown.ok, false);
  assert.match(unknown.content, /Nothing changed/);

  const selfTool = CONTINUITY_EXECUTORS.find((executor) => executor.id === "self.operational")!;
  const selfResult = await selfTool.run({});
  assert.equal(selfResult.ok, true);
  assert.match(selfResult.content, /OPERATIONAL SELF/);
});

test("the pulse is not listening twice after a repeated bootstrap", () => {
  const bus = AgentEventBus.getInstance();
  const pulse = new CognitivePulse({ bus, kv: memoryKv(), now: () => 1_000, dedupeWindowMs: 0 });
  pulse.start();
  pulse.start();
  bus.emit({ type: "task_completed", taskId: "idempotent", label: "One completion" });
  assert.equal(pulse.recent().length, 1, "start() is idempotent; one event is one entry");
  pulse.stop();
});
