/**
 * ==========================================================
 * LÉLU — SESSION 3C: DEVELOPMENT PIPELINE
 *
 * Understand → Research → Architect → Generate → Build → Integrate →
 * Test → Debug → Preview → Approve → Deploy → Maintain.
 *
 * A stage is recorded only with the evidence that stage is supposed to
 * produce, and the pipeline refuses to move past a missing stage. That is
 * the difference between "LÉLU says she tested it" and a record holding
 * the exit code of the test process.
 *
 * Deploy of a production environment additionally requires a live human
 * approval from StudioApprovals; the pipeline cannot grant one.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import StudioApprovals from "./StudioApprovals";
import {
  STUDIO_PHASES,
  type StudioEvidence,
  type StudioPhase,
  type StudioPipelineState,
  type StudioStageRecord,
} from "./StudioTypes";

export interface PipelineStorePort {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
}

const kvPort: PipelineStorePort = {
  get<T>(key: string): T | null {
    return KvStore.getInstance().get<T>(key) ?? null;
  },
  set(key: string, value: unknown): void {
    KvStore.getInstance().set(key, value);
  },
};

const KEY = "lelu.studio.pipeline.v1";

/** What each stage must be able to show. */
export const STAGE_EVIDENCE: Record<StudioPhase, string[]> = {
  understand: ["requirements"],
  research: ["findings"],
  architect: ["decisions"],
  generate: ["files"],
  build: ["exitCode"],
  integrate: ["connections"],
  test: ["exitCode"],
  debug: ["outcome"],
  approve: ["approvalId"],
  preview: ["url"],
  deploy: ["deploymentId"],
  maintain: ["plan"],
};

export type AdvanceResult =
  | { ok: true; stage: StudioStageRecord; state: StudioPipelineState }
  | { ok: false; error: string; state: StudioPipelineState };

function emptyState(projectId: string): StudioPipelineState {
  return { projectId, stages: [], blockedBy: null, updatedAt: Date.now() };
}

export default class StudioPipeline {
  private static instance: StudioPipeline | null = null;
  private states: Record<string, StudioPipelineState>;

  constructor(
    private readonly store: PipelineStorePort = kvPort,
    private readonly approvals: StudioApprovals = StudioApprovals.getInstance(),
  ) {
    const stored = this.store.get<Record<string, StudioPipelineState>>(KEY);
    this.states = stored && typeof stored === "object" ? stored : {};
  }

  public static getInstance(): StudioPipeline {
    if (!StudioPipeline.instance) StudioPipeline.instance = new StudioPipeline();
    return StudioPipeline.instance;
  }

  public static resetForTests(store: PipelineStorePort = kvPort): StudioPipeline {
    StudioPipeline.instance = new StudioPipeline(store, StudioApprovals.resetForTests());
    return StudioPipeline.instance;
  }

  private persist(): void {
    try {
      this.store.set(KEY, this.states);
    } catch {
      /* best effort, same as every other store here */
    }
  }

  public state(projectId: string): StudioPipelineState {
    return this.states[projectId] ?? emptyState(projectId);
  }

  /** The latest record for a phase, or null. */
  public latest(projectId: string, phase: StudioPhase): StudioStageRecord | null {
    const stages = this.state(projectId).stages.filter((stage) => stage.phase === phase);
    return stages.at(-1) ?? null;
  }

  public completed(projectId: string): StudioPhase[] {
    const done = new Set<StudioPhase>();
    for (const stage of this.state(projectId).stages) {
      if (stage.ok) done.add(stage.phase);
    }
    return STUDIO_PHASES.filter((phase) => done.has(phase));
  }

  /**
   * Record a stage. Evidence must be real and complete for the stage, and
   * the preceding stage must have passed — except Debug, which exists
   * precisely to loop back from a failed build or test.
   */
  public advance(input: {
    projectId: string;
    phase: StudioPhase;
    evidence: StudioEvidence;
    note?: string;
    ok?: boolean;
  }): AdvanceResult {
    const state = this.state(input.projectId);
    const required = STAGE_EVIDENCE[input.phase];
    const missing = required.filter((key) => {
      const value = input.evidence[key];
      return value === undefined || value === null || value === "";
    });
    if (missing.length > 0) {
      return {
        ok: false,
        error: `${input.phase} needs real evidence: ${missing.join(", ")}.`,
        state,
      };
    }

    const index = STUDIO_PHASES.indexOf(input.phase);
    if (input.phase !== "understand" && input.phase !== "debug") {
      const previous = STUDIO_PHASES[index - 1];
      const previousRecord = this.latest(input.projectId, previous);
      if (!previousRecord || !previousRecord.ok) {
        return {
          ok: false,
          error:
            `${input.phase} cannot be recorded before ${previous} has passed. ` +
            `Complete ${previous} first.`,
          state,
        };
      }
    }

    if (input.phase === "deploy") {
      const environment = String(input.evidence.environment ?? "preview");
      const action = environment === "production" ? "production-deploy" : null;
      if (action && !this.approvals.authorizationFor(input.projectId, action)) {
        const blocked: StudioPipelineState = {
          ...state,
          blockedBy: "production-deploy",
          updatedAt: Date.now(),
        };
        this.states = { ...this.states, [input.projectId]: blocked };
        this.persist();
        return {
          ok: false,
          error:
            "A production deployment needs a live human approval. Ask for one; LÉLU cannot grant it.",
          state: blocked,
        };
      }
    }

    const stage: StudioStageRecord = {
      phase: input.phase,
      at: Date.now(),
      ok: input.ok !== false,
      evidence: { ...input.evidence },
      note: input.note,
    };
    const next: StudioPipelineState = {
      ...state,
      stages: [...state.stages, stage].slice(-80),
      blockedBy: null,
      updatedAt: Date.now(),
    };
    this.states = { ...this.states, [input.projectId]: next };
    this.persist();
    return { ok: true, stage, state: next };
  }

  /** Request a protected action; the approval decision belongs to a person. */
  public requestProtected(
    projectId: string,
    action: string,
    reason: string,
    scope: string[] = [],
  ) {
    const approval = this.approvals.request({ projectId, action, reason, scope });
    this.states = {
      ...this.states,
      [projectId]: { ...this.state(projectId), blockedBy: approval.action, updatedAt: Date.now() },
    };
    this.persist();
    return approval;
  }

  /** The next stage that can be attempted, or "maintain" when complete. */
  public next(projectId: string): StudioPhase {
    for (const phase of STUDIO_PHASES) {
      const record = this.latest(projectId, phase);
      if (!record || !record.ok) return phase;
    }
    return "maintain";
  }

  public describe(projectId: string): string {
    const state = this.state(projectId);
    if (state.stages.length === 0) {
      return `No development workflow has started for ${projectId}. Start at understand.`;
    }
    const done = new Set(state.stages.filter((stage) => stage.ok).map((stage) => stage.phase));
    const progress = STUDIO_PHASES.map((phase) => `${phase}${done.has(phase) ? " ✓" : ""}`).join(" → ");
    return (
      `Workflow: ${progress}. Next: ${this.next(projectId)}.` +
      (state.blockedBy ? ` Blocked on human approval for ${state.blockedBy}.` : "")
    );
  }
}
