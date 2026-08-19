/**
 * ==========================================================
 * LÉLU
 * WORKSPACE RUNTIME — real command execution on LÉLU's own
 * codebase, through the EXISTING dev-server endpoint
 * (POST /api/engineer/command, defined in vite.config.ts).
 *
 * This is the one place where LÉLU can run actual toolchain
 * commands (typecheck / tests / environment inspection) against
 * her own repository. It is intentionally WHITELISTED — only a
 * small set of safe, deterministic commands is exposed, and callers
 * are expected to gate access through the autonomy gate (running
 * these commands is a level-3+ "execute approved" action).
 *
 * The endpoint only exists while the Vite dev/preview server is
 * running; the client probes for it and degrades gracefully
 * (unavailable → structured result, never a crash).
 * ==========================================================
 */

import AutonomyGate from "../cognition/AutonomyGate";

export type WorkspaceOperation = "typecheck" | "test" | "inspect";

export interface WorkspaceCommandResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  available: boolean;
  note?: string;
}

/** Whitelisted operations — only these exact commands may run. */
const COMMANDS: Record<WorkspaceOperation, string> = {
  typecheck: "bun tsc -b --noEmit",
  test: "bun test",
  inspect: "node --version && bun --version && pwd",
};

/** Autonomy level required for each operation (level 3 = execute approved). */
const REQUIRED_LEVEL: Record<WorkspaceOperation, number> = {
  typecheck: 3,
  test: 3,
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

  private constructor() {}

  public static getInstance(): WorkspaceRuntime {
    if (!WorkspaceRuntime.instance) {
      WorkspaceRuntime.instance = new WorkspaceRuntime();
    }
    return WorkspaceRuntime.instance;
  }

  /** Which operation the configured autonomy level currently permits. */
  public allowed(operation: WorkspaceOperation): boolean {
    return AutonomyGate.getInstance().can(REQUIRED_LEVEL[operation]);
  }

  public requiredLevel(operation: WorkspaceOperation): number {
    return REQUIRED_LEVEL[operation];
  }

  /** Run a whitelisted workspace command. */
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

    const command = COMMANDS[operation];
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch("/api/engineer/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command }),
        signal: controller.signal,
      });
      window.clearTimeout(timer);

      if (!response.ok) {
        return this.unavailable(operation, started, `Endpoint responded ${response.status}.`);
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
      return this.unavailable(
        operation,
        started,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private unavailable(operation: WorkspaceOperation, started: number, reason: string): WorkspaceCommandResult {
    return {
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: `Workspace runtime unavailable (${operation}): ${reason}. The dev-server /api/engineer endpoint only exists while the Vite server is running.`,
      durationMs: Math.round(performance.now() - started),
      available: false,
      note: "The isolated in-browser sandbox runtime remains available offline.",
    };
  }
}
