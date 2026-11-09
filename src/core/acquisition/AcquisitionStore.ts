/**
 * ==========================================================
 * LÉLU — ACQUISITION STORE
 *
 * The durable record of what LÉLU has acquired, assigned and
 * registered. The server remains the authority on a repository's
 * files and versions; this store mirrors the returned metadata
 * for context, and keeps assignments, pipeline runs and
 * registered capabilities across reloads.
 *
 * Bounded on purpose: the newest 40 runs, 60 acquisitions and 100
 * assignments are kept. Older ones are dropped from the local
 * mirror, never from the runtime.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import type {
  AcquisitionAssignment,
  AcquisitionRecord,
  CapabilityRecord,
  PipelineEvent,
  PipelineRun,
  PipelineStage,
} from "./AcquisitionTypes";
import { MAX_PIPELINE_EVENTS } from "./AcquisitionTypes";

const RECORDS_KEY = "lelu.acquisition.records.v1";
const ASSIGNMENTS_KEY = "lelu.acquisition.assignments.v1";
const RUNS_KEY = "lelu.acquisition.runs.v1";
const CAPABILITIES_KEY = "lelu.acquisition.capabilities.v1";

const MAX_RECORDS = 60;
const MAX_ASSIGNMENTS = 100;
const MAX_RUNS = 40;
const MAX_CAPABILITIES = 80;

export default class AcquisitionStore {
  private static instance: AcquisitionStore | null = null;

  static getInstance(): AcquisitionStore {
    if (!AcquisitionStore.instance) {
      AcquisitionStore.instance = new AcquisitionStore();
    }
    return AcquisitionStore.instance;
  }

  /** Test-only: drop the singleton. */
  static resetForTests(): void {
    AcquisitionStore.instance = null;
  }

  private read<T>(key: string): T[] {
    try {
      const stored = KvStore.getInstance().get<T[]>(key);
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  }

  private write<T>(key: string, value: T[], limit: number): void {
    try {
      KvStore.getInstance().set(key, value.slice(0, limit));
    } catch {
      /* local persistence is best-effort; the server stays authoritative */
    }
  }

  /* ------------------------- acquisitions ------------------------- */

  acquisitions(): AcquisitionRecord[] {
    return this.read<AcquisitionRecord>(RECORDS_KEY);
  }

  getAcquisition(id: string): AcquisitionRecord | null {
    return this.acquisitions().find((record) => record.id === id) ?? null;
  }

  saveAcquisition(record: AcquisitionRecord): void {
    const next = [record, ...this.acquisitions().filter((existing) => existing.id !== record.id)];
    this.write(RECORDS_KEY, next, MAX_RECORDS);
  }

  removeAcquisition(id: string): void {
    this.write(RECORDS_KEY, this.acquisitions().filter((record) => record.id !== id), MAX_RECORDS);
  }

  /* -------------------------- assignments ------------------------- */

  assignments(): AcquisitionAssignment[] {
    return this.read<AcquisitionAssignment>(ASSIGNMENTS_KEY);
  }

  getAssignment(id: string): AcquisitionAssignment | null {
    return this.assignments().find((assignment) => assignment.id === id) ?? null;
  }

  saveAssignment(assignment: AcquisitionAssignment): void {
    const next = [
      { ...assignment, updatedAt: Date.now() },
      ...this.assignments().filter((existing) => existing.id !== assignment.id),
    ];
    this.write(ASSIGNMENTS_KEY, next, MAX_ASSIGNMENTS);
  }

  /** The assignment currently in flight, if any. */
  activeAssignment(): AcquisitionAssignment | null {
    return this.assignments().find((assignment) => assignment.status === "running" || assignment.status === "assigned") ?? null;
  }

  /* ----------------------------- runs ----------------------------- */

  runs(): PipelineRun[] {
    return this.read<PipelineRun>(RUNS_KEY);
  }

  getRun(id: string): PipelineRun | null {
    return this.runs().find((run) => run.id === id) ?? null;
  }

  createRun(input: { objective: string; assignmentId?: string | null }): PipelineRun {
    const run: PipelineRun = {
      id: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      objective: input.objective,
      stage: "discover",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      assignmentId: input.assignmentId ?? null,
      acquisitionId: null,
      events: [],
      capability: null,
      failure: null,
      complete: false,
    };
    this.saveRun(run);
    return run;
  }

  saveRun(run: PipelineRun): void {
    const next = [{ ...run, updatedAt: Date.now() }, ...this.runs().filter((existing) => existing.id !== run.id)];
    this.write(RUNS_KEY, next, MAX_RUNS);
  }

  /** Append a real stage outcome to a run. */
  recordStage(
    runId: string,
    stage: PipelineStage,
    ok: boolean,
    detail: string,
    patch: Partial<PipelineRun> = {},
  ): PipelineRun | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const event: PipelineEvent = { stage, at: Date.now(), ok, detail };
    const updated: PipelineRun = {
      ...run,
      ...patch,
      stage,
      events: [...run.events, event].slice(-MAX_PIPELINE_EVENTS),
      failure: ok ? (patch.failure ?? null) : detail,
      updatedAt: Date.now(),
    };
    this.saveRun(updated);
    return updated;
  }

  /* -------------------------- capabilities ------------------------ */

  capabilities(): CapabilityRecord[] {
    return this.read<CapabilityRecord>(CAPABILITIES_KEY);
  }

  getCapability(id: string): CapabilityRecord | null {
    return this.capabilities().find((capability) => capability.id === id) ?? null;
  }

  saveCapability(record: CapabilityRecord): void {
    const next = [record, ...this.capabilities().filter((existing) => existing.id !== record.id)];
    this.write(CAPABILITIES_KEY, next, MAX_CAPABILITIES);
  }

  /** Everything a capability needs to be re-checked after a reload. */
  capabilityReport(): string {
    const capabilities = this.capabilities();
    if (capabilities.length === 0) return "No acquired capability has been registered yet.";
    return capabilities
      .map(
        (capability) =>
          `${capability.name} (${capability.id}) — from ${capability.source.identifier}, ` +
          `${capability.license.spdx}, tools: ${capability.registeredTools.join(", ") || "none"}`,
      )
      .join("\n");
  }
}
