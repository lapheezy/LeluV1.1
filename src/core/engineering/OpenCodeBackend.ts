/**
 * ==========================================================
 * LÉLU — OPENCODE CODING BACKEND
 *
 * Registers OpenCode with the EXISTING EngineeringOrchestrator as
 * one of its interchangeable engines (`openhands | opencode | local`).
 * It is a thin transport: all server contact, credential handling
 * and the refusal when `OPENCODE_BASE_URL` is unset live in
 * `plugins/integration/opencode.ts`.
 *
 * The backend deliberately reports `not_configured` rather than
 * pretending to be usable, so `selectEngine` skips it with the real
 * reason and never silently substitutes the local shell.
 * ==========================================================
 */

import type { AdapterHealth } from "../integration/protocol.ts";
import type { BackendRunResult, CodingBackend, CodingTask } from "./EngineeringOrchestrator.ts";

const HEALTH_PATH = "/api/integration/opencode/health";
const RUN_PATH = "/api/integration/opencode/run";

interface HealthBody {
  state?: AdapterHealth["state"];
  detail?: string;
  contacted?: boolean;
  latencyMs?: number;
  error?: string;
}

interface RunBody {
  ok?: boolean;
  summary?: string;
  detail?: string;
  error?: string;
  changedFiles?: string[];
  commands?: Array<{ command: string; exitCode: number; output: string }>;
  artifacts?: Array<{ kind: "log" | "report"; ref: string; label: string }>;
}

export default class OpenCodeBackend implements CodingBackend {
  public readonly id = "opencode" as const;
  public readonly name = "OpenCode";
  public readonly source = "https://github.com/anomalyco/opencode";

  public async health(): Promise<AdapterHealth> {
    const checkedAt = Date.now();
    try {
      const response = await fetch(HEALTH_PATH, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(7_000),
      });
      const body = (await response.json().catch(() => ({}))) as HealthBody;
      if (!response.ok) {
        return {
          state: "unavailable",
          detail: body.error ?? `OpenCode health probe failed with HTTP ${response.status}.`,
          checkedAt,
          contacted: false,
        };
      }
      return {
        state: body.state ?? "unavailable",
        detail: body.detail ?? "the probe returned no detail",
        checkedAt,
        ...(typeof body.latencyMs === "number" ? { latencyMs: body.latencyMs } : {}),
        contacted: body.contacted === true,
      };
    } catch (error) {
      return {
        state: "unavailable",
        detail: `OpenCode health probe could not reach this server: ${error instanceof Error ? error.message : String(error)}`,
        checkedAt,
        contacted: false,
      };
    }
  }

  public async run(task: CodingTask, signal: AbortSignal): Promise<BackendRunResult> {
    const response = await fetch(RUN_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        objective: task.objective,
        workspace: task.workspaceId,
        checks: task.checks ?? [],
        allowedPaths: task.allowedPaths ?? [],
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(150_000)]),
    });
    const body = (await response.json().catch(() => ({}))) as RunBody;

    if (!response.ok) {
      const detail = body.detail ?? body.error ?? `OpenCode refused the task with HTTP ${response.status}.`;
      return {
        ok: false,
        engine: "opencode",
        summary: detail,
        changedFiles: [],
        commands: [],
        artifacts: [],
        error: detail,
      };
    }

    return {
      ok: body.ok === true,
      engine: "opencode",
      summary: body.summary ?? "OpenCode returned no summary.",
      changedFiles: Array.isArray(body.changedFiles) ? body.changedFiles : [],
      commands: Array.isArray(body.commands) ? body.commands : [],
      artifacts: Array.isArray(body.artifacts) ? body.artifacts : [],
      ...(body.ok === true ? {} : { error: body.detail ?? body.error ?? "OpenCode did not report success." }),
    };
  }
}
