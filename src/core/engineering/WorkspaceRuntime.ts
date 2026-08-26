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

const DEFAULT_TIMEOUT_MS = 120_000;

interface EngineerResponse {
  ok: boolean;
  status?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

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
      try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 8_000);
        const response = await fetch("/api/engineer/status", {
          signal: controller.signal,
          cache: "no-store",
        });
        window.clearTimeout(timer);
        if (!response.ok) throw new Error(`status ${response.status}`);
        const payload = (await response.json()) as {
          runtime?: string;
          available?: boolean;
          operations?: string[];
          tokenRequired?: boolean;
          workspace?: string;
        };
        this.runtimeState = {
          runtime: payload.runtime === "node-server" || payload.runtime === "deno" ? "server" : "dev",
          available: payload.available !== false,
          operations: payload.operations ?? [],
          tokenRequired: payload.tokenRequired === true,
          workspace: payload.workspace,
          checkedAt: Date.now(),
        };
      } catch (error) {
        this.runtimeState = {
          runtime: "unavailable",
          available: false,
          operations: [],
          tokenRequired: false,
          checkedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        };
      }
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
    const started = performance.now();
    const gate = AutonomyGate.getInstance();

    if (!gate.can(REQUIRED_LEVEL[operation])) {
      return {
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: `Blocked by the autonomy gate: this operation needs level ${REQUIRED_LEVEL[operation]} (${gate.describe(REQUIRED_LEVEL[operation])}).`,
        durationMs: Math.round(performance.now() - started),
        available: true,
      };
    }

    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch("/api/engineer/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation, timeoutMs: DEFAULT_TIMEOUT_MS }),
        signal: controller.signal,
      });
      window.clearTimeout(timer);

      if (!response.ok) {
        return this.failed(operation, started, `Endpoint responded ${response.status}.`);
      }
      const payload = (await response.json()) as EngineerResponse;
      return {
        ok: payload.ok,
        exitCode: payload.ok ? 0 : (payload.status ?? 1),
        stdout: payload.stdout ?? "",
        stderr: payload.stderr ?? payload.error ?? "",
        durationMs: Math.round(performance.now() - started),
        available: true,
      };
    } catch (error) {
      return this.failed(
        operation,
        started,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private failed(operation: WorkspaceOperation, started: number, reason: string): WorkspaceCommandResult {
    return {
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: `Workspace runtime unavailable (${operation}): ${reason}.`,
      durationMs: Math.round(performance.now() - started),
      available: false,
      note: `Engineering runtime not reachable from this deployment (static-only serving has no /api/engineer). The in-browser sandbox runtime remains available offline.`,
    };
  }
}
