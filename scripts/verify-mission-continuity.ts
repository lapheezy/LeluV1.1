/**
 * Mission 14 — continuity core verification.
 *
 * Runs the REAL modules against an isolated in-memory store and writes
 * machine-readable evidence. No provider, network or browser is used.
 *
 * Run: npx tsx scripts/verify-mission-continuity.ts
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}

import type { AgentEvent } from "../src/core/agent/AgentEvents";
import { CognitivePulse } from "../src/core/cognition/CognitivePulse";
import { OperationalSelfModel } from "../src/core/cognition/OperationalSelfModel";
import {
  CONTINUITY_EXECUTORS,
  registerContinuityTools,
} from "../src/core/cognition/ContinuityTools";
import { MissionLedger } from "../src/core/projects/MissionLedger";
import { missionEvidenceFromOperational } from "../src/core/operational-intelligence/evidence";
import { executableToolIds } from "../src/core/tools/ToolDispatcher";
import type KvStore from "../src/core/storage/KvStore";

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
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

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  /* 1. Tools register through the one dispatcher. */
  const registration = registerContinuityTools();
  const executable = executableToolIds();
  check(
    "continuity tools register through ToolDispatcher",
    registration.failed.length === 0 && registration.registered.length === 5,
    `registered=${registration.registered.join(",")} failed=${JSON.stringify(registration.failed)}`,
  );
  check(
    "all continuity tools are executable",
    registration.registered.every((id) => executable.includes(id)),
    registration.registered.filter((id) => !executable.includes(id)).join(",") || "all present",
  );

  /* 2. Durable ledger: create, block, clear, next action, reload. */
  const kv = memoryKv();
  const ledger = new MissionLedger({ kv });
  const created = ledger.create({
    title: "Mission 14 — cognitive continuity",
    objective: "Evidence-labelled self-model, durable mission ledger and bounded cognitive pulse.",
    owner: "lelu",
    repository: "lapheezy/LeluV1.1",
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    commit: git(["rev-parse", "--short", "HEAD"]),
    files: ["src/core/cognition/OperationalSelfModel.ts"],
    nextSafeAction: "run the focused continuity tests",
  });
  const id = created.mission?.id ?? "";
  ledger.addFile(id, "src/core/projects/MissionLedger.ts");
  ledger.addDecision(id, "reuse AgentEventBus instead of adding a bus");
  ledger.addBlocker(id, "provider health has not been live-probed", "REPORTED");
  ledger.clearBlocker(id, undefined, "labelled PARTIAL by the self-model instead of claimed as working");
  ledger.setNextAction(id, "review the report and run the signed-in acceptance pass");
  const reloaded = new MissionLedger({ kv });
  const restored = reloaded.get(id);
  check(
    "workstream survives reconstruction with files, decisions and next action",
    !!restored &&
      restored.files.length === 2 &&
      restored.decisions.length === 1 &&
      restored.nextSafeAction === "review the report and run the signed-in acceptance pass",
    restored ? `${restored.status} ${restored.evidence} durability=${restored.durability}` : "missing",
  );
  check(
    "resume brief carries the next safe action",
    reloaded.resumeBrief().includes("next safe action: review the report and run the signed-in acceptance pass"),
    reloaded.resumeBrief().split("\n")[0] ?? "",
  );

  const refusing = { get: () => null, set: () => false, remove: () => {} } as unknown as KvStore;
  const memoryOnly = new MissionLedger({ kv: refusing }).create({ title: "Refused write" });
  check(
    "a refused write is reported as memory-only",
    memoryOnly.durability === "memory-only" && memoryOnly.mission?.durability === "memory-only",
    memoryOnly.durability,
  );

  /* 3. Pulse: real event reduction, dedupe, bounded digest. */
  const bus = new FakeBus();
  let now = 1_000;
  const pulse = new CognitivePulse({ bus, kv: memoryKv(), now: () => now, dedupeWindowMs: 20_000 });
  pulse.start();
  bus.emit({ type: "tool_failed", taskId: "verify", tool: "cosmos.workspace", error: "not permitted" });
  bus.emit({ type: "tool_failed", taskId: "verify", tool: "cosmos.workspace", error: "not permitted" });
  now += 25_000;
  bus.emit({ type: "provider_status", taskId: "verify", provider: "openrouter", status: "failed" });
  check(
    "the pulse records failures, dedupes inside the window and ignores repetition after it",
    pulse.recent().length === 2,
    pulse.recent().map((entry) => entry.summary).join(" | "),
  );
  check("the pulse digest is populated", pulse.digest(5).includes("COGNITIVE PULSE"), pulse.summary().total + " entries");

  /* 4. Evidence-labelled self-model over real sources. */
  const model = new OperationalSelfModel({ missions: () => ledger.list(), pulse: () => pulse.recent(20) });
  const snapshot = model.snapshot();
  const countSum = Object.values(snapshot.counts).reduce((sum, value) => sum + value, 0);
  check("every self-model claim carries exactly one evidence label", countSum === snapshot.claims.length, `${countSum}/${snapshot.claims.length}`);
  const skills = snapshot.claims.find((claim) => claim.id === "skills.registry");
  check("skills are reported UNAVAILABLE rather than invented", skills?.state === "UNAVAILABLE", skills?.statement ?? "missing");
  const aiChat = snapshot.claims.find((claim) => claim.id === "capability.ai-chat");
  check(
    "a declared but unproven capability is not VERIFIED",
    aiChat?.state === "PARTIAL",
    aiChat ? `${aiChat.state}: ${aiChat.statement}` : "missing",
  );
  check(
    "operational lifecycle maps conservatively",
    missionEvidenceFromOperational("AVAILABLE") === "PARTIAL" && missionEvidenceFromOperational("NOT_CONFIGURED") === "BLOCKED",
    "AVAILABLE→PARTIAL, NOT_CONFIGURED→BLOCKED",
  );

  const report = model.report();
  check("the report is prompt-safe and labelled", report.includes("OPERATIONAL SELF") && report.includes("[PARTIAL]"), report.split("\n")[1] ?? "");

  /* 5. Persist evidence. */
  const outDir = path.join(process.cwd(), "docs", "acceptance", "mission-14");
  mkdirSync(outDir, { recursive: true });
  const evidence = {
    generatedAt: new Date().toISOString(),
    repository: "lapheezy/LeluV1.1",
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    commit: git(["rev-parse", "HEAD"]),
    worktree: process.cwd(),
    checks,
    passed: checks.every((entry) => entry.ok),
    registration,
    ledger: {
      id,
      status: restored?.status ?? null,
      evidence: restored?.evidence ?? null,
      durability: restored?.durability ?? null,
      nextSafeAction: restored?.nextSafeAction ?? null,
      resumeBrief: reloaded.resumeBrief(),
    },
    pulse: { summary: pulse.summary(), digest: pulse.digest(6) },
    selfModel: {
      counts: snapshot.counts,
      claims: snapshot.claims.map((claim) => ({ id: claim.id, state: claim.state, source: claim.source })),
      unreadableSources: snapshot.sourceFailures,
      report,
    },
  };
  const outFile = path.join(outDir, "continuity-evidence.json");
  writeFileSync(outFile, JSON.stringify(evidence, null, 2));

  console.log(report);
  console.log("\n--- CHECKS ---");
  for (const entry of checks) console.log(`${entry.ok ? "PASS" : "FAIL"}  ${entry.name} — ${entry.detail}`);
  console.log(`\nEvidence written to ${path.relative(process.cwd(), outFile)}`);
  if (!evidence.passed) process.exitCode = 1;
}

void main();
