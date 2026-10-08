/**
 * ==========================================================
 * LÉLU
 * WORKSPACE RUNTIME — real command execution on LÉLU's own
 * codebase, through the engineering runtime
 * (POST /api/engineer/command — served by the Vite dev server,
 * the standalone runtime server `server.ts`, and the Deno
 * production entry `main.ts`; the endpoint contract is the
 * same everywhere).
 *
 * This is the one place where LÉLU can run actual toolchain
 * commands (typecheck / tests / environment inspection) against
 * her own repository. It is intentionally WHITELISTED — the
 * client names an operation and the server maps it to an exact
 * command; callers are expected to gate access through the
 * autonomy gate (running these commands is a level-3+
 * "execute approved" action).
 *
 * The runtime is probed once and the state is reported honestly:
 * `server` (standalone/Deno runtime) or `dev` (Vite server) when
 * reachable, `unavailable` when the deployment serves static
 * files only — the caller sees exactly which runtime is active.
 * ==========================================================
 */

import AutonomyGate from "../cognition/AutonomyGate";
import SourceAccess from "../selfdev/SourceAccess";

export type WorkspaceOperation = "typecheck" | "test" | "build" | "inspect";

export interface WorkspaceCommandResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  available: boolean;
  note?: string;
}

export interface EngineeringRuntimeState {
  /** Which runtime is serving the engineering API right now. */
  runtime: "dev" | "server" | "unavailable";
  available: boolean;
  operations: string[];
  tokenRequired: boolean;
  workspace?: string;
  /** When the probe last succeeded. */
  checkedAt: number;
  error?: string;
}

/** Whitelisted operations — the server maps these to exact commands. */
const OPERATIONS: WorkspaceOperation[] = ["typecheck", "test", "build", "inspect"];

/** Autonomy level required for each operation (level 3 = execute approved). */
const REQUIRED_LEVEL: Record<WorkspaceOperation, number> = {
  typecheck: 3,
  test: 3,
  build: 3,
  inspect: 2,
};

export default class WorkspaceRuntime {
  private static instance: WorkspaceRuntime | null = null;

  private runtimeState: EngineeringRuntimeState = {
    runtime: "unavailable",
    available: false,
    operations: [],
    tokenRequired: false,
    checkedAt: 0,
    error: "Not probed yet.",
  };
  private probing: Promise<EngineeringRuntimeState> | null = null;

  private constructor() {}

  public static getInstance(): WorkspaceRuntime {
    if (!WorkspaceRuntime.instance) {
      WorkspaceRuntime.instance = new WorkspaceRuntime();
    }
    return WorkspaceRuntime.instance;
  }

  /** Whitelisted operations the engineering runtime accepts. */
  public operations(): WorkspaceOperation[] {
    return [...OPERATIONS];
  }

  /** Which operation the configured autonomy level currently permits. */
  public allowed(operation: WorkspaceOperation): boolean {
    return AutonomyGate.getInstance().can(REQUIRED_LEVEL[operation]);
  }

  public requiredLevel(operation: WorkspaceOperation): number {
    return REQUIRED_LEVEL[operation];
  }

  /**
   * Probe the engineering runtime once (cached). The result tells the
   * UI which runtime is actually serving the app: Vite dev server,
   * standalone/Deno server, or none (static-only deployment).
   */
  public async probe(): Promise<EngineeringRuntimeState> {
    if (this.probing) return this.probing;
    this.probing = (async () => {
      // One probe implementation, shared with self-inspection: SourceAccess
      // carries the configured runtime base URL and access token, so a
      // deployed front-end pointed at a real development runtime reports
      // that runtime here too instead of always saying "static-only".
      const status = await SourceAccess.getInstance().status(true);
      this.runtimeState = status.reachable
        ? {
            runtime: status.runtime === "node-server" || status.runtime === "deno" ? "server" : "dev",
            available: true,
            operations: status.operations,
            tokenRequired: status.tokenRequired,
            workspace: status.workspace,
            checkedAt: status.checkedAt,
          }
        : {
            runtime: "unavailable",
            available: false,
            operations: [],
            tokenRequired: false,
            checkedAt: status.checkedAt,
            error: status.error ?? "Engineering runtime not reachable.",
          };
      return this.runtimeState;
    })();
    try {
      return await this.probing;
    } finally {
      this.probing = null;
    }
  }

  /** Last known engineering runtime state (probe first if needed). */
  public getRuntimeState(): EngineeringRuntimeState {
    return this.runtimeState;
  }

  /** Run a whitelisted workspace command through the engineering runtime. */
  public async run(operation: WorkspaceOperation): Promise<WorkspaceCommandResult> {
    const started = Date.now();
    const gate = AutonomyGate.getInstance();

    // Autonomy constrains EXECUTION. Running a real toolchain command
    // against the workspace is an action, so it stays gated here.
    if (!gate.can(REQUIRED_LEVEL[operation])) {
      return {
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: `Blocked by the autonomy gate: this operation needs level ${REQUIRED_LEVEL[operation]} (${gate.describe(REQUIRED_LEVEL[operation])}).`,
        durationMs: Date.now() - started,
        available: true,
      };
    }

    const outcome = await SourceAccess.getInstance().command(operation);
    if (outcome.origin !== "development-runtime" || outcome.error) {
      return this.failed(operation, started, outcome.error ?? "no development runtime");
    }
    return {
      ok: outcome.ok,
      exitCode: outcome.ok ? 0 : 1,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      durationMs: outcome.durationMs || Date.now() - started,
      available: true,
    };
  }

  private failed(operation: WorkspaceOperation, started: number, reason: string): WorkspaceCommandResult {
    return {
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: `Workspace runtime unavailable (${operation}): ${reason}.`,
      durationMs: Date.now() - started,
      available: false,
      note: `Engineering runtime not reachable from this deployment (static-only serving has no /api/engineer). Point VITE_LELU_ENGINEER_URL at a real development runtime (and allowlist this origin with LELU_ENGINEER_ALLOWED_ORIGINS) to enable it. The in-browser sandbox runtime remains available offline.`,
    };
  }
}
