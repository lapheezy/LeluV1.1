/**
 * ==========================================================
 * LÉLU
 * OBJECTIVE LEARNING — outcomes that change later behaviour
 *
 * Cycle records are a log. A log becomes learning only when a
 * later, unrelated objective can retrieve it and act differently
 * because of it. That is what this adds:
 *
 *   experience → outcome analysis → lesson → confidence
 *     → durable persistence → retrieval → influence
 *
 * It creates NO storage of its own. Lessons are written through
 * the existing Brain (AIService.consolidate -> rememberKnowledge),
 * which is the same long-term memory chat uses and which already
 * persists to IndexedDB and mirrors to Supabase when configured.
 * Retrieval is AIService.recall — the same path.
 *
 * Confidence is measured, not asserted: a lesson repeated across
 * objectives is trusted more than one seen once, and a lesson
 * contradicted by a later outcome loses standing.
 * ==========================================================
 */

import AIService from "../AIService";
import KvStore from "../storage/KvStore";
import { emitCognition } from "../agent/AgentEvents";
import type { AgentObjective, CognitionCycleRecord } from "./AgentObjectives";

/** A durable lesson, indexed for retrieval and confidence tracking. */
export interface Lesson {
  id: string;
  /** Short key describing the situation this applies to. */
  topic: string;
  /** What was learned, in a form usable as guidance. */
  lesson: string;
  /** "worked" lessons are strategies; "failed" are warnings. */
  kind: "worked" | "failed";
  /** How many independent objectives produced this lesson. */
  observations: number;
  /** 0-1, derived from observations and contradictions. */
  confidence: number;
  contradictions: number;
  firstSeenAt: number;
  lastSeenAt: number;
  /** Objectives that contributed, for provenance. */
  objectiveIds: string[];
  /**
   * Whether the long-term write really succeeded.
   *
   * Recorded rather than assumed: without IndexedDB (or with Supabase
   * absent) the durable write is refused, and a lesson that lives only
   * in the local index must not be reported as durably stored.
   */
  persistedDurably: boolean;
}

const INDEX_KEY = "lelu.objective.lessons.v1";
const MAX_LESSONS = 200;

/** Confidence from evidence, never from assertion. */
function confidenceFor(observations: number, contradictions: number): number {
  const support = Math.min(observations, 6) / 6;
  const penalty = Math.min(contradictions, 3) / 4;
  return Math.max(0, Math.min(1, support - penalty));
}

/** A stable topic key from an objective, for matching later work. */
export function topicOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 6)
    .join(" ");
}

export default class ObjectiveLearning {
  private static instance: ObjectiveLearning | null = null;

  private readonly kv = KvStore.getInstance();

  private constructor() {}

  public static getInstance(): ObjectiveLearning {
    if (!ObjectiveLearning.instance) {
      ObjectiveLearning.instance = new ObjectiveLearning();
    }
    return ObjectiveLearning.instance;
  }

  public lessons(): Lesson[] {
    return this.kv.get<Lesson[]>(INDEX_KEY) ?? [];
  }

  /**
   * Analyse a finished objective and extract what it teaches.
   *
   * Reads the REAL cycle records: which tools actually ran, which
   * failed, and how the objective ended. A yielded objective teaches
   * something different from a completed one, and both are worth
   * keeping — the failure is often the more useful lesson.
   */
  public async extract(
    objective: AgentObjective,
    cycles: CognitionCycleRecord[],
  ): Promise<Lesson[]> {
    const topic = topicOf(objective.objective);
    if (!topic) return [];

    const executed = cycles.flatMap((cycle) => cycle.executed);
    const succeeded = [...new Set(executed.filter((e) => e.ok).map((e) => e.tool))];
    const failed = [...new Set(executed.filter((e) => !e.ok).map((e) => e.tool))];

    const drafted: Array<{ lesson: string; kind: Lesson["kind"] }> = [];

    if (objective.state === "completed" && succeeded.length > 0) {
      drafted.push({
        kind: "worked",
        lesson:
          `For work like "${objective.objective.slice(0, 120)}", these tools produced the result: ` +
          `${succeeded.join(", ")} (completed in ${objective.cyclesRun} cycle(s)).`,
      });
    }

    if (failed.length > 0) {
      // Lead with the concrete tool and the concrete instruction. An
      // earlier version buried the tool name at the end of a sentence
      // about the objective, and a lesson that has to be decoded before
      // it can be used is not much of a lesson.
      drafted.push({
        kind: "failed",
        lesson:
          `DO NOT USE ${failed.join(", ")} for work like "${objective.objective.slice(0, 100)}" — ` +
          `${failed.length === 1 ? "it" : "they"} failed here every time ` +
          `(${objective.state === "completed" ? "the objective still finished by another route" : objective.yieldReason ?? "no result"}). ` +
          `Use a different tool, or say BLOCKED and explain, instead of trying ` +
          `${failed.length === 1 ? "it" : "them"} again.`,
      });
    }

    if (objective.state === "yielded" && objective.yieldReason) {
      drafted.push({
        kind: "failed",
        lesson:
          `Work like "${objective.objective.slice(0, 120)}" stopped without completing ` +
          `(${objective.yieldReason})${objective.conclusion ? `: ${objective.conclusion.slice(0, 200)}` : ""}. ` +
          `Plan for that constraint next time.`,
      });
    }

    if (drafted.length === 0) return [];

    const existing = this.lessons();
    const updated: Lesson[] = [];

    for (const draft of drafted) {
      const match = existing.find(
        (lesson) => lesson.topic === topic && lesson.kind === draft.kind,
      );

      if (match) {
        // Seen again: more evidence, unless this outcome contradicts it.
        const contradicts =
          (match.kind === "worked" && objective.state !== "completed") ||
          (match.kind === "failed" && objective.state === "completed");
        match.observations += contradicts ? 0 : 1;
        match.contradictions += contradicts ? 1 : 0;
        match.confidence = confidenceFor(match.observations, match.contradictions);
        match.lastSeenAt = Date.now();
        match.lesson = draft.lesson;
        if (!match.objectiveIds.includes(objective.id)) match.objectiveIds.push(objective.id);
        updated.push(match);
      } else {
        const lesson: Lesson = {
          id: crypto.randomUUID(),
          topic,
          lesson: draft.lesson,
          kind: draft.kind,
          observations: 1,
          contradictions: 0,
          confidence: confidenceFor(1, 0),
          firstSeenAt: Date.now(),
          lastSeenAt: Date.now(),
          objectiveIds: [objective.id],
          persistedDurably: false,
        };
        existing.push(lesson);
        updated.push(lesson);
      }
    }

    this.kv.set(
      INDEX_KEY,
      existing.sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, MAX_LESSONS),
    );

    // DURABLE: written through the EXISTING long-term memory, so a
    // lesson survives beyond this objective, this index and this
    // process — and is reachable by ordinary recall, not only by this
    // module. A rejected write is reported, never assumed.
    for (const lesson of updated) {
      emitCognition("lesson-extracted", `[${lesson.kind}] ${lesson.lesson}`, {
        objectiveId: objective.id,
        data: { lessonId: lesson.id, topic: lesson.topic, confidence: lesson.confidence },
      });

      const stored = await AIService.getInstance().consolidate(
        "system",
        `LESSON (${lesson.kind}, confidence ${lesson.confidence.toFixed(2)}): ${lesson.lesson}`,
        ["lesson", lesson.kind, ...lesson.topic.split(" ").slice(0, 4)],
      );
      lesson.persistedDurably = stored === true;

      if (stored) {
        // Only emitted for a write that really landed in long-term
        // memory. A refusal below is a different fact and says so.
        emitCognition("lesson-persisted", `Written to long-term memory: ${lesson.lesson.slice(0, 200)}`, {
          objectiveId: objective.id,
          data: { lessonId: lesson.id, store: "long-term" },
        });
      } else {
        console.warn("[ObjectiveLearning] long-term write refused; lesson kept in the local index only");
        emitCognition(
          "lesson-persist-refused",
          `NOT durably stored (long-term memory refused the write); kept in the local index only: ${lesson.lesson.slice(0, 160)}`,
          { objectiveId: objective.id, data: { lessonId: lesson.id, store: "local-index-only" } },
        );
      }
    }

    // Re-save so the durability flag reflects what really happened.
    this.kv.set(
      INDEX_KEY,
      existing.sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, MAX_LESSONS),
    );

    return updated;
  }

  /**
   * Prior learning relevant to a new objective.
   *
   * Matched on shared topic words, ordered by confidence. This is what
   * makes a later objective behave differently: it is injected into the
   * planning prompt before the first cycle reasons about anything.
   */
  public relevantTo(objectiveText: string, limit = 4): Lesson[] {
    const words = new Set(topicOf(objectiveText).split(" ").filter(Boolean));
    if (words.size === 0) return [];
    return this.lessons()
      .map((lesson) => {
        const overlap = lesson.topic.split(" ").filter((word) => words.has(word)).length;
        return { lesson, overlap };
      })
      .filter((entry) => entry.overlap > 0)
      .sort((a, b) =>
        b.overlap - a.overlap || b.lesson.confidence - a.lesson.confidence,
      )
      .slice(0, limit)
      .map((entry) => entry.lesson);
  }

  /** Prior learning as guidance text, or "" when there is none. */
  public guidanceFor(objectiveText: string): string {
    const relevant = this.relevantTo(objectiveText);
    if (relevant.length === 0) return "";
    const lines = relevant.map(
      (lesson) =>
        `- [${lesson.kind}, confidence ${lesson.confidence.toFixed(2)}, seen ${lesson.observations}x] ${lesson.lesson}`,
    );
    return (
      "WHAT YOU LEARNED FROM EARLIER WORK LIKE THIS (use it; do not repeat what failed):\n" +
      lines.join("\n")
    );
  }
}
