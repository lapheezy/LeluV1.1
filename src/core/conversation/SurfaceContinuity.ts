/**
 * ==========================================================
 * LÉLU — CROSS-SURFACE CONTINUITY (WP18.13)
 *
 * One conversation can move between voice, chat and the browser
 * surface. What must survive that move is the THREAD: what is being
 * worked on, what was last decided, which objective is still open.
 *
 * It already half-existed: VoiceEngine and the browser panel both call
 * AIService.chat() with the active conversationId, so the transcript
 * was shared. What was missing was the WORKING state — so a spoken turn
 * could start a thought that the chat surface then restarted, because
 * the only thing it could see was message history.
 *
 * This records per-conversation touches by surface and produces a
 * short briefing for a turn arriving on a different surface. It is
 * deliberately tiny and bounded: it is a bookmark, not a second
 * conversation store. The transcript remains MultiChatStore's.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import type { Surface } from "./types";
import { shorten } from "./text";

export interface SurfaceTouch {
  surface: Surface;
  at: number;
  conversationId: string;
}

export interface ContinuityThread {
  conversationId: string;
  topic: string;
  /** Most recent decision or conclusion, verbatim from the record. */
  lastDecision: string;
  lastQuestion: string;
  openObjectiveIds: string[];
  surfaces: Partial<Record<Surface, SurfaceTouch>>;
  updatedAt: number;
}

interface Persisted {
  version: 1;
  threads: Record<string, ContinuityThread>;
}

const KEY = "lelu.wp18.threads.v1";
const MAX_THREADS = 40;

export interface ContinuityBriefing {
  text: string;
  /** Surfaces this thread has been active in, newest first. */
  crossedSurfaces: Surface[];
  /** The surface that last touched this thread, if it was a different one. */
  previousSurface: Surface | null;
  idleMs: number;
  thread: ContinuityThread;
}

export default class SurfaceContinuity {
  private static instance: SurfaceContinuity | null = null;

  private readonly kv = KvStore.getInstance();
  private state: Persisted;

  private constructor() {
    const stored = this.kv.get<Partial<Persisted>>(KEY);
    this.state = {
      version: 1,
      threads:
        stored?.version === 1 && stored.threads && typeof stored.threads === "object"
          ? (stored.threads as Record<string, ContinuityThread>)
          : {},
    };
  }

  public static getInstance(): SurfaceContinuity {
    if (!SurfaceContinuity.instance) {
      SurfaceContinuity.instance = new SurfaceContinuity();
    }
    return SurfaceContinuity.instance;
  }

  public static resetForTests(): void {
    SurfaceContinuity.instance = null;
  }

  private persist(): void {
    const ids = Object.keys(this.state.threads);
    if (ids.length > MAX_THREADS) {
      const oldest = ids
        .sort((a, b) => (this.state.threads[a]?.updatedAt ?? 0) - (this.state.threads[b]?.updatedAt ?? 0))
        .slice(0, ids.length - MAX_THREADS);
      for (const id of oldest) delete this.state.threads[id];
    }
    try {
      this.kv.set(KEY, this.state);
    } catch {
      // best-effort
    }
  }

  private ensure(conversationId: string, at: number): ContinuityThread {
    const existing = this.state.threads[conversationId];
    if (existing) return existing;
    const thread: ContinuityThread = {
      conversationId,
      topic: "",
      lastDecision: "",
      lastQuestion: "",
      openObjectiveIds: [],
      surfaces: {},
      updatedAt: at,
    };
    this.state.threads[conversationId] = thread;
    return thread;
  }

  /**
   * Record that a surface is active in this conversation.
   *
   * Returns the thread BEFORE the touch, which is what a continuity
   * briefing needs: where she was last, not where she is now.
   */
  public touch(
    surface: Surface,
    conversationId: string,
    patch: { topic?: string; lastDecision?: string; lastQuestion?: string; at?: number } = {},
  ): ContinuityThread | null {
    const at = patch.at ?? Date.now();
    const previous = this.state.threads[conversationId] ? { ...this.state.threads[conversationId]! } : null;
    const thread = this.ensure(conversationId, at);
    if (patch.topic?.trim()) thread.topic = shorten(patch.topic.trim(), 160);
    if (patch.lastDecision?.trim()) thread.lastDecision = shorten(patch.lastDecision.trim(), 240);
    if (patch.lastQuestion?.trim()) thread.lastQuestion = shorten(patch.lastQuestion.trim(), 200);
    thread.surfaces[surface] = { surface, at, conversationId };
    thread.updatedAt = at;
    this.persist();
    return previous;
  }

  public setOpenObjectives(conversationId: string, objectiveIds: string[], at = Date.now()): void {
    const thread = this.ensure(conversationId, at);
    thread.openObjectiveIds = [...new Set(objectiveIds)].slice(0, 8);
    thread.updatedAt = at;
    this.persist();
  }

  public thread(conversationId: string): ContinuityThread | null {
    return this.state.threads[conversationId] ?? null;
  }

  /**
   * What a turn arriving on `surface` needs to know to continue rather
   * than restart. Null when this is the first surface (nothing to carry)
   * or the thread has no content worth carrying.
   */
  public briefingFor(
    surface: Surface,
    conversationId: string,
    now = Date.now(),
  ): ContinuityBriefing | null {
    const thread = this.state.threads[conversationId];
    if (!thread) return null;

    const touches = Object.values(thread.surfaces).filter(
      (touch): touch is SurfaceTouch => Boolean(touch),
    );
    if (touches.length === 0) return null;
    const previous = touches
      .filter((touch) => touch.surface !== surface)
      .sort((a, b) => b.at - a.at)[0] ?? null;
    const lastAny = touches.sort((a, b) => b.at - a.at)[0]!;
    const idleMs = Math.max(0, now - lastAny.at);

    const carried = thread.topic || thread.lastDecision || thread.openObjectiveIds.length > 0;
    if (!carried) return null;
    // Same surface, a moment ago: nothing has been lost, so say nothing.
    if (!previous && idleMs < 30_000) return null;

    const parts: string[] = ["[Thread continuity — continue this thread, do not restart it]"];
    if (thread.topic) parts.push(`Topic: “${thread.topic}”.`);
    if (previous) {
      parts.push(
        `It was last active in ${previous.surface} ${relativeTime(idleMs)} ago; this turn arrived in ${surface}.`,
      );
    } else if (idleMs > 30_000) {
      parts.push(`It was last active ${relativeTime(idleMs)} ago.`);
    }
    if (thread.lastDecision) parts.push(`Last recorded decision: “${thread.lastDecision}”.`);
    if (thread.lastQuestion) parts.push(`Still open: “${thread.lastQuestion}”.`);
    if (thread.openObjectiveIds.length > 0) {
      parts.push(`${thread.openObjectiveIds.length} objective(s) remain linked to this thread.`);
    }
    parts.push("Do not ask the user to repeat what is already here.");

    return {
      text: parts.join(" "),
      crossedSurfaces: touches.sort((a, b) => b.at - a.at).map((touch) => touch.surface),
      previousSurface: previous?.surface ?? null,
      idleMs,
      thread,
    };
  }

  public reset(): void {
    this.state = { version: 1, threads: {} };
    this.persist();
  }
}

function relativeTime(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}
