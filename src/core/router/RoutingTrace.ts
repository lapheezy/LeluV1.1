/**
 * ==========================================================
 * LÉLU — ROUTING TRACE
 *
 * One turn, one record: which stage looked at the request, in
 * what order, which one claimed it, what it answered with, and
 * which stage ultimately owned the reply.
 *
 * WHY THIS EXISTS
 * ---------------
 * A live turn was answered by the provider while the operational
 * intelligence stage had already returned 200 from the explain
 * endpoint. Nothing in the codebase could say whether the stage
 * never ran, ran and declined, or ran and was replaced. Guessing
 * between those three produced the wrong fix twice.
 *
 * The trace is cheap, bounded and read-only: it records what the
 * router already computed. It never changes routing, never calls
 * a provider, and holds no message content beyond the prompt's
 * first 160 characters.
 *
 * Every record is attached to the RouterContext object for the
 * turn (so concurrent conversations cannot mix), and the most
 * recent records are also published at
 * `globalThis.__LELU_ROUTING_TRACE__` for live acceptance runs.
 * ==========================================================
 */

import type RouterContext from "./RouterContext";
import type { AIResponse } from "../../providers/AIProvider";

export interface StageRecord {
  stage: string;
  /** Did the stage claim the turn? */
  handled: boolean;
  durationMs: number;
  provider?: string;
  model?: string;
  detail?: string;
}

export interface TurnTrace {
  id: string;
  prompt: string;
  intent?: string;
  startedAt: number;
  finishedAt?: number;
  stages: StageRecord[];
  /** Who produced the reply that was returned. */
  owner?: string;
  provider?: string;
  model?: string;
  notes: Array<{ at: number; stage: string; detail: string; ok?: boolean }>;
}

const MAX_TURNS = 40;
const turns: TurnTrace[] = [];
const byContext = new WeakMap<object, TurnTrace>();

function publish(): void {
  const view = routingSnapshot();
  try {
    (globalThis as unknown as { __LELU_ROUTING_TRACE__?: unknown }).__LELU_ROUTING_TRACE__ = view;
  } catch {
    // A read-only global (or a non-browser host) is not an error:
    // the module-level ring buffer is the source of truth.
  }
}

export function beginRoutingTrace(context: RouterContext, prompt: string): TurnTrace {
  const trace: TurnTrace = {
    id: `route-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    prompt: prompt.slice(0, 160),
    intent: context.intent,
    startedAt: Date.now(),
    stages: [],
    notes: [],
  };
  byContext.set(context as unknown as object, trace);
  turns.push(trace);
  if (turns.length > MAX_TURNS) turns.splice(0, turns.length - MAX_TURNS);
  publish();
  return trace;
}

/** Record a stage that was actually executed, and whether it claimed the turn. */
export function noteStage(
  context: RouterContext,
  stage: string,
  handled: boolean,
  extra: { provider?: string; model?: string; durationMs?: number; detail?: string } = {},
): void {
  const trace = byContext.get(context as unknown as object);
  if (!trace) return;
  trace.stages.push({
    stage,
    handled,
    durationMs: extra.durationMs ?? 0,
    ...(extra.provider ? { provider: extra.provider } : {}),
    ...(extra.model ? { model: extra.model } : {}),
    ...(extra.detail ? { detail: extra.detail } : {}),
  });
  publish();
}

/** A detail a stage learned mid-flight: a fetch URL, a status, a refusal. */
export function note(context: RouterContext, stage: string, detail: string, ok?: boolean): void {
  const trace = byContext.get(context as unknown as object);
  if (!trace) return;
  trace.notes.push({ at: Date.now(), stage, detail: detail.slice(0, 240), ...(ok === undefined ? {} : { ok }) });
  publish();
}

/** Close the turn with the response it actually returned. */
export function finishRoutingTrace(context: RouterContext, response: AIResponse): void {
  const trace = byContext.get(context as unknown as object);
  if (!trace) return;
  trace.finishedAt = Date.now();
  trace.owner = String(response.metadata?.source ?? response.provider ?? "unknown");
  trace.provider = response.provider;
  trace.model = response.model;
  trace.notes.push({
    at: trace.finishedAt,
    stage: "final",
    detail: `owner=${trace.owner} provider=${response.provider} model=${response.model} chars=${response.text?.length ?? 0}`,
    ok: true,
  });
  publish();
}

/** The last N turns, newest last — exactly what the router saw. */
export function routingSnapshot(limit = MAX_TURNS): TurnTrace[] {
  return turns.slice(-limit).map((trace) => ({
    ...trace,
    stages: [...trace.stages],
    notes: [...trace.notes],
  }));
}

/** The stage that claimed the turn, or null when every stage declined. */
export function claimingStage(trace: TurnTrace): string | null {
  return trace.stages.find((stage) => stage.handled)?.stage ?? null;
}

/** Test-only: drop everything recorded so far. */
export function resetRoutingTraceForTests(): void {
  turns.length = 0;
  publish();
}
