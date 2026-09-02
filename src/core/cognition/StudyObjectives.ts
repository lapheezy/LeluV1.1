/**
 * ==========================================================
 * LÉLU
 * STUDY OBJECTIVES — the WORK BUFFER, not the cognition
 *
 * This ledger holds the questions LÉLU is currently carrying.
 * It is deliberately a buffer and nothing more: an empty ledger
 * means "nothing queued right now", NEVER "thinking is finished".
 * SelfStudyEngine refills it from the persistent project mission
 * and from whatever the last investigation revealed.
 *
 * Every objective records where it came from, so the trail from
 * mission → gap → investigation → learning → next question stays
 * auditable instead of being an opaque queue of prompts.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

/** Where an objective came from — the provenance of a question. */
export type StudyOrigin =
  /** Derived directly from the persistent project mission. */
  | "mission"
  /** An untrusted entry in the KnowledgeLibrary. */
  | "knowledge-gap"
  /** Something LÉLU's own self-model marks unfinished/hypothetical. */
  | "self-model"
  /** A subsystem or capability she cannot yet describe from evidence. */
  | "architecture"
  /** A question CREATED BY the result of a previous investigation. */
  | "discovery"
  /** New evidence disagrees with something she already believed. */
  | "contradiction"
  /** A previous investigation produced no usable evidence. */
  | "unresolved"
  /** Something she once verified that may have drifted since. */
  | "revalidation";

/** Which kind of investigation answers this question. */
export type StudyDomain =
  | "architecture"
  | "source"
  | "research"
  | "memory"
  | "testing"
  | "runtime"
  | "capability";

export type StudyStatus = "open" | "investigating" | "answered" | "unresolved";

export interface StudyObjective {
  id: string;
  /** The actual question, in LÉLU's own words. */
  question: string;
  /** Why this question exists and what would answer it. */
  detail: string;
  origin: StudyOrigin;
  domain: StudyDomain;
  /**
   * 0-100, recomputed every cycle from real state. It is derived from
   * `basePriority` plus the current adjustments — never accumulated onto
   * itself, or a question that lost once could only ever keep sinking.
   */
  priority: number;
  /** The intrinsic importance this objective was created with. */
  basePriority: number;
  status: StudyStatus;
  /** Cycle that created it — proves cycle N came from cycle N-1. */
  createdInCycle: number;
  /** The objective whose learning revealed this one. */
  parentId?: string;
  /** KnowledgeLibrary entry this objective is trying to settle. */
  knowledgeId?: string;
  /** Concrete target: a file path, subsystem id, capability id, … */
  target?: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  /** Short record of what the last attempt actually found. */
  lastEvidence?: string;
}

export type StudyObjectiveInput = Omit<
  StudyObjective,
  "id" | "status" | "attempts" | "createdAt" | "updatedAt" | "basePriority"
>;

const KEY = "lelu.selfstudy.objectives.v1";
/** Answered/unresolved objectives kept for provenance and dedupe. */
const HISTORY_CAP = 400;

/** Stable dedupe key: the same question is never carried twice. */
export function objectiveKey(question: string, target?: string): string {
  return `${question.trim().toLowerCase().replace(/\s+/g, " ")}::${(target ?? "").toLowerCase()}`;
}

export default class StudyObjectives {
  private static instance: StudyObjectives | null = null;

  private objectives: StudyObjective[];
  private readonly listeners = new Set<(objectives: StudyObjective[]) => void>();

  private constructor() {
    this.objectives = KvStore.getInstance().get<StudyObjective[]>(KEY) ?? [];
  }

  public static getInstance(): StudyObjectives {
    if (!StudyObjectives.instance) {
      StudyObjectives.instance = new StudyObjectives();
    }
    return StudyObjectives.instance;
  }

  private persist(): void {
    // Keep every open objective; cap only the resolved history.
    const open = this.objectives.filter((item) => item.status === "open" || item.status === "investigating");
    const resolved = this.objectives
      .filter((item) => item.status === "answered" || item.status === "unresolved")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, HISTORY_CAP);
    this.objectives = [...open, ...resolved];

    try {
      KvStore.getInstance().set(KEY, this.objectives);
    } catch {
      // Persistence is best-effort — losing the buffer must never stop
      // cognition, because the mission can always regenerate it.
    }
    for (const listener of this.listeners) {
      try {
        listener(this.list());
      } catch {
        /* a broken listener never stops cognition */
      }
    }
  }

  public subscribe(listener: (objectives: StudyObjective[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.list());
    return () => this.listeners.delete(listener);
  }

  public list(): StudyObjective[] {
    return [...this.objectives];
  }

  public get(id: string): StudyObjective | undefined {
    return this.objectives.find((item) => item.id === id);
  }

  /** Objectives still waiting to be investigated — the live buffer. */
  public open(): StudyObjective[] {
    return this.objectives
      .filter((item) => item.status === "open")
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
  }

  public resolved(): StudyObjective[] {
    return this.objectives.filter(
      (item) => item.status === "answered" || item.status === "unresolved",
    );
  }

  /** Has this exact question ever been carried (open OR resolved)? */
  public knows(question: string, target?: string): boolean {
    const key = objectiveKey(question, target);
    return this.objectives.some((item) => objectiveKey(item.question, item.target) === key);
  }

  /**
   * Add an objective unless the identical question is already carried.
   * Returns the stored objective, or null when it was a duplicate.
   */
  public add(input: StudyObjectiveInput): StudyObjective | null {
    if (this.knows(input.question, input.target)) {
      return null;
    }
    const created: StudyObjective = {
      ...input,
      basePriority: input.priority,
      id: crypto.randomUUID(),
      status: "open",
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.objectives = [created, ...this.objectives];
    this.persist();
    return created;
  }

  public update(id: string, patch: Partial<Omit<StudyObjective, "id">>): void {
    this.objectives = this.objectives.map((item) =>
      item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item,
    );
    this.persist();
  }

  /** Re-open a previously resolved question — evidence went stale. */
  public reopen(id: string, reason: string): void {
    this.update(id, { status: "open", lastEvidence: reason });
  }

  /** Counts by status, for the cognition report. */
  public counts(): { open: number; investigating: number; answered: number; unresolved: number } {
    const counts = { open: 0, investigating: 0, answered: 0, unresolved: 0 };
    for (const item of this.objectives) {
      counts[item.status] += 1;
    }
    return counts;
  }

  /** How many objectives a given cycle created — the continuity proof. */
  public createdInCycle(cycle: number): StudyObjective[] {
    return this.objectives.filter((item) => item.createdInCycle === cycle);
  }

  /** Test/maintenance helper: drop everything and start clean. */
  public clear(): void {
    this.objectives = [];
    this.persist();
  }
}
