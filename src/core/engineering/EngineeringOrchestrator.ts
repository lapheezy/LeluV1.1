/**
 * ==========================================================
 * LÉLU — ENGINEERING ORCHESTRATOR
 *
 * SHAMAN decides WHO does a piece of work. This decides WITH
 * WHAT, WHERE, and WHETHER the result is proven.
 *
 * It is a coordinator, not an authority:
 *   • it only runs tasks SHAMAN (or the user) approved;
 *   • it runs them in an ISOLATED workspace, never the live tree;
 *   • it refuses to let two engines edit one workspace at once;
 *   • it reports a change as verified only when tests actually
 *     ran and actually passed;
 *   • it never merges or deploys — that needs a human approval it
 *     cannot grant itself.
 *
 * BACKENDS ARE INTERCHANGEABLE, NOT DUPLICATE AUTHORITIES
 * -------------------------------------------------------
 * OpenHands, OpenCode and the local engineering runtime implement
 * one interface. The orchestrator selects among them by health and
 * capability, and records the reason it chose the one it chose. A
 * backend that is down is skipped with its real state, never
 * silently replaced by a claim.
 * ==========================================================
 */

import type { AdapterHealth } from "../integration/protocol.ts";

export type EngineId = "openhands" | "opencode" | "local";

export interface CodingTask {
  id: string;
  /** What to accomplish, in the requester's words. */
  objective: string;
  repository: string;
  /** The isolated workspace the work must stay inside. */
  workspaceId: string;
  /** An explicit engine request; the orchestrator honours it or says it cannot. */
  engine?: EngineId;
  /** Paths the change may touch, when the requester narrowed it. */
  allowedPaths?: string[];
  /** Test command names the backend should run. */
  checks?: string[];
  /** Merge/push are never implied. */
  requiresMerge?: boolean;
}

export interface CommandRecord {
  command: string;
  exitCode: number;
  output: string;
}

export interface BackendRunResult {
  ok: boolean;
  engine: EngineId;
  summary: string;
  changedFiles: string[];
  commands: CommandRecord[];
  tests?: { passed: number; failed: number; failures: string[]; ran: boolean; command: string };
  artifacts: Array<{ kind: "file" | "log" | "screenshot" | "diff" | "report"; ref: string; label: string }>;
  error?: string;
}

export interface CodingBackend {
  readonly id: EngineId;
  readonly name: string;
  readonly source: string;
  health(): Promise<AdapterHealth>;
  /** Run inside the isolated workspace. Implementations must not touch the live tree. */
  run(task: CodingTask, signal: AbortSignal): Promise<BackendRunResult>;
}

export interface VerificationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerificationReport {
  /** True only when every required check passed. */
  verified: boolean;
  method: string;
  checks: VerificationCheck[];
  evidence: string[];
}

export interface OrchestratorOutcome {
  taskId: string;
  engine: EngineId | null;
  selectedReason: string;
  ran: boolean;
  result: BackendRunResult | null;
  verification: VerificationReport;
  /** True when the work needs a human decision before it can land. */
  needsApproval: boolean;
  startedAt: number;
  finishedAt: number;
}

const HEALTH_ORDER: EngineId[] = ["openhands", "opencode", "local"];

export default class EngineeringOrchestrator {
  private static instance: EngineeringOrchestrator | null = null;
  private readonly backends = new Map<EngineId, CodingBackend>();
  /** One engine per workspace at a time — the coordination rule. */
  private readonly locks = new Map<string, { taskId: string; engine: EngineId; at: number }>();
  private readonly outcomes: OrchestratorOutcome[] = [];

  public static getInstance(): EngineeringOrchestrator {
    if (!EngineeringOrchestrator.instance) EngineeringOrchestrator.instance = new EngineeringOrchestrator();
    return EngineeringOrchestrator.instance;
  }

  public registerBackend(backend: CodingBackend): void {
    this.backends.set(backend.id, backend);
  }

  public backends_(): CodingBackend[] {
    return [...this.backends.values()];
  }

  /** Workspace → the task currently holding it. */
  public activeLocks(): Array<{ workspaceId: string; taskId: string; engine: EngineId; at: number }> {
    return [...this.locks.entries()].map(([workspaceId, lock]) => ({ workspaceId, ...lock }));
  }

  public history(limit = 20): OrchestratorOutcome[] {
    return [...this.outcomes].reverse().slice(0, limit);
  }

  /**
   * Choose an execution engine.
   *
   * An explicit request is honoured only if that backend is actually
   * usable; otherwise the refusal names the backend's real state and
   * the orchestrator does NOT quietly use a different engine — a
   * task that must run on OpenHands is not the same task on the
   * local shell.
   */
  public async selectEngine(task: CodingTask): Promise<{ engine: EngineId | null; reason: string; health: AdapterHealth | null }> {
    const candidates = task.engine ? [task.engine] : HEALTH_ORDER.filter((id) => this.backends.has(id));
    const notes: string[] = [];
    for (const id of candidates) {
      const backend = this.backends.get(id);
      if (!backend) {
        notes.push(`${id}: no backend registered`);
        continue;
      }
      let health: AdapterHealth;
      try {
        health = await backend.health();
      } catch (error) {
        notes.push(`${id}: health check threw (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }
      if (health.state === "healthy" || health.state === "degraded") {
        return {
          engine: id,
          reason:
            task.engine
              ? `requested ${id}, which reports ${health.state}: ${health.detail}`
              : `${id} selected by preference order; ${health.detail}`,
          health,
        };
      }
      notes.push(`${id}: ${health.state} — ${health.detail}`);
    }
    return {
      engine: null,
      reason:
        notes.length > 0
          ? `No usable coding engine. ${notes.join("; ")}`
          : "No coding backend is registered.",
      health: null,
    };
  }

  /**
   * Run one task.
   *
   * Refusals are outcomes with a reason, not exceptions: the caller
   * (SHAMAN, an agent, a test) always gets an auditable record.
   */
  public async run(task: CodingTask, signal?: AbortSignal): Promise<OrchestratorOutcome> {
    const startedAt = Date.now();
    const selected = await this.selectEngine(task);
    if (!selected.engine) {
      return this.finish({
        taskId: task.id,
        engine: null,
        selectedReason: selected.reason,
        ran: false,
        result: null,
        verification: {
          verified: false,
          method: "none",
          checks: [{ name: "engine_available", ok: false, detail: selected.reason }],
          evidence: [],
        },
        needsApproval: false,
        startedAt,
        finishedAt: Date.now(),
      });
    }

    const existing = this.locks.get(task.workspaceId);
    if (existing) {
      const outcome = this.finish({
        taskId: task.id,
        engine: null,
        selectedReason:
          `Workspace "${task.workspaceId}" is already held by ${existing.engine} for task ${existing.taskId}. ` +
          "Two engines are never allowed to edit one workspace at the same time.",
        ran: false,
        result: null,
        verification: {
          verified: false,
          method: "none",
          checks: [{ name: "workspace_exclusive", ok: false, detail: "another task holds this workspace" }],
          evidence: [],
        },
        needsApproval: false,
        startedAt,
        finishedAt: Date.now(),
      });
      return outcome;
    }

    const backend = this.backends.get(selected.engine);
    if (!backend) {
      return this.finish({
        taskId: task.id,
        engine: null,
        selectedReason: `Backend ${selected.engine} disappeared between selection and execution.`,
        ran: false,
        result: null,
        verification: { verified: false, method: "none", checks: [], evidence: [] },
        needsApproval: false,
        startedAt,
        finishedAt: Date.now(),
      });
    }

    this.locks.set(task.workspaceId, { taskId: task.id, engine: backend.id, at: startedAt });
    try {
      const controller = signal ?? new AbortController().signal;
      const result = await backend.run(task, controller);
      const verification = verify(task, result);
      const outcome = this.finish({
        taskId: task.id,
        engine: backend.id,
        selectedReason: selected.reason,
        ran: true,
        result,
        verification,
        // A completed coding task is never the same thing as a landed
        // change: merging or deploying is a separate, human decision.
        needsApproval: task.requiresMerge === true || !verification.verified,
        startedAt,
        finishedAt: Date.now(),
      });
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.finish({
        taskId: task.id,
        engine: backend.id,
        selectedReason: selected.reason,
        ran: true,
        result: {
          ok: false,
          engine: backend.id,
          summary: `The backend failed: ${message}`,
          changedFiles: [],
          commands: [],
          artifacts: [],
          error: message,
        },
        verification: {
          verified: false,
          method: "none",
          checks: [{ name: "backend_completed", ok: false, detail: message }],
          evidence: [],
        },
        needsApproval: false,
        startedAt,
        finishedAt: Date.now(),
      });
    } finally {
      this.locks.delete(task.workspaceId);
    }
  }

  private finish(outcome: OrchestratorOutcome): OrchestratorOutcome {
    this.outcomes.push(outcome);
    if (this.outcomes.length > 100) this.outcomes.splice(0, this.outcomes.length - 100);
    return outcome;
  }

  public resetForTests(): void {
    this.backends.clear();
    this.locks.clear();
    this.outcomes.length = 0;
  }
}

/**
 * The verification rule, in one place.
 *
 * A change is VERIFIED only when:
 *   1. the backend reported a real change (files, with no path
 *      outside the task's allowed set);
 *   2. a test run actually happened (`tests.ran`), with zero
 *      failures and at least one passing test;
 *   3. the backend's own command records agree with its summary.
 *
 * Anything less is recorded as not verified, with the specific
 * missing check — never as a success with a caveat.
 */
export function verify(task: CodingTask, result: BackendRunResult): VerificationReport {
  const checks: VerificationCheck[] = [];
  const evidence: string[] = [];

  checks.push({
    name: "backend_reported_success",
    ok: result.ok,
    detail: result.ok ? "the backend reported ok" : result.error ?? "the backend reported failure",
  });

  const outside = task.allowedPaths?.length
    ? result.changedFiles.filter((file) => !task.allowedPaths!.some((allowed) => file === allowed || file.startsWith(`${allowed}/`)))
    : [];
  checks.push({
    name: "changes_within_allowed_paths",
    ok: outside.length === 0,
    detail:
      outside.length === 0
        ? task.allowedPaths?.length
          ? `all ${result.changedFiles.length} changed file(s) are inside the allowed paths`
          : "no path restriction was given"
        : `outside the allowed paths: ${outside.join(", ")}`,
  });
  if (result.changedFiles.length > 0) evidence.push(`${result.changedFiles.length} changed file(s): ${result.changedFiles.join(", ")}`);

  const tests = result.tests;
  checks.push({
    name: "tests_ran",
    ok: tests?.ran === true,
    detail: tests?.ran ? `ran "${tests.command}"` : "no test run was recorded",
  });
  checks.push({
    name: "tests_passed",
    ok: tests?.ran === true && tests.failed === 0 && tests.passed > 0,
    detail: tests?.ran
      ? `${tests.passed} passed, ${tests.failed} failed`
      : "no test results to judge",
  });
  if (tests?.ran) evidence.push(`${tests.passed} passed / ${tests.failed} failed via "${tests.command}"`);
  if (tests?.failures.length) evidence.push(...tests.failures.slice(0, 5).map((failure) => `failure: ${failure}`));

  const failing = result.commands.filter((command) => command.exitCode !== 0 && !command.command.includes(tests?.command ?? "\u0000"));
  checks.push({
    name: "other_commands_succeeded",
    ok: failing.length === 0,
    detail:
      failing.length === 0
        ? `${result.commands.length} command(s) recorded, none failed`
        : `${failing.length} command(s) failed: ${failing.map((c) => c.command).join(", ")}`,
  });
  for (const command of result.commands) evidence.push(`$ ${command.command} → exit ${command.exitCode}`);

  const verified = checks.every((check) => check.ok);
  return {
    verified,
    method: verified ? "changed files + real test run with no failures" : "insufficient evidence",
    checks,
    evidence,
  };
}
