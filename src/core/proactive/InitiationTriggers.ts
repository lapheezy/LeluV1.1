/**
 * ==========================================================
 * LÉLU — WHEN LÉLU SPEAKS FIRST
 *
 * Integration brief §12: preserve the OG behaviour where LÉLU
 * could initiate, and do NOT fake it with placeholder
 * notifications. Every UI status must represent real system
 * state — no "Reading…", "Memory updated…", "Agent working…"
 * unless that operation is actually occurring.
 *
 * v1.1 already has the machinery: ProactiveCore owns the user's
 * consent and category settings, NotificationProvider delivers.
 * What was missing is the wiring — nothing told either of them
 * when real work finished, so LÉLU had no honest reason to
 * speak and therefore never did.
 *
 * THE RULE, ENFORCED IN CODE RATHER THAN INTENDED
 * -----------------------------------------------
 * announce() takes EVIDENCE, not a message. Every event type
 * requires an identifier for the work that produced it — a task
 * id, an agent run, a source that was actually read. A caller
 * who wants to announce something that did not happen has
 * nothing to pass, which is the point: the type system is where
 * "no fake states" is enforced, because a lint rule or a code
 * review is not.
 *
 * Consent is checked before delivery, every time. §12 lists
 * "user explicitly enabled proactive behavior" among the
 * legitimate reasons to initiate, which means the others are
 * only legitimate when that is also true.
 * ==========================================================
 */

import NotificationProvider from "../notifications/NotificationProvider";
import ProactiveCore from "./ProactiveCore";

/**
 * Something that actually happened.
 *
 * Each variant carries proof of the work. There is no "custom message"
 * variant, deliberately — that would be the hole through which every fake
 * status eventually arrives.
 */
export type InitiationEvent =
  | { kind: "agent-finished"; agentName: string; task: string; taskId: string; summary: string }
  | { kind: "research-finished"; query: string; sourceCount: number; taskId: string }
  | { kind: "ingestion-finished"; attribution: string; memoriesKept: number }
  | { kind: "authorization-needed"; url: string; reason: string; requestId: string }
  | { kind: "project-changed"; projectId: string; projectName: string; change: string };

export interface InitiationOutcome {
  delivered: boolean;
  /** Why not, when it was not. Surfaced so silence is never a mystery. */
  suppressedBecause?: "disabled" | "no-substance";
  title?: string;
  body?: string;
}

/** Turn evidence into words. Never invents a claim the event does not support. */
function describe(event: InitiationEvent): { title: string; body: string } | null {
  switch (event.kind) {
    case "agent-finished": {
      if (!event.summary.trim()) return null;
      return {
        title: `${event.agentName} finished`,
        body: `${event.task} — ${event.summary.slice(0, 180)}`,
      };
    }
    case "research-finished": {
      // Zero sources is not a finding worth interrupting for.
      if (event.sourceCount <= 0) return null;
      return {
        title: "Research finished",
        body: `${event.sourceCount} source${event.sourceCount === 1 ? "" : "s"} for "${event.query}".`,
      };
    }
    case "ingestion-finished": {
      if (event.memoriesKept <= 0) return null;
      return {
        title: "I read that",
        body: `Kept ${event.memoriesKept} thing${event.memoriesKept === 1 ? "" : "s"} from ${event.attribution}.`,
      };
    }
    case "authorization-needed":
      return {
        title: "I need you to sign in",
        body: `${event.reason} — ${event.url}`,
      };
    case "project-changed":
      return {
        title: event.projectName,
        body: event.change,
      };
  }
}

/**
 * Let LÉLU speak, if there is something real to say and the user wants it.
 *
 * Returns what happened rather than throwing, because a notification failing
 * must never take down the work that succeeded.
 */
export function announce(event: InitiationEvent): InitiationOutcome {
  const described = describe(event);
  if (!described) {
    return { delivered: false, suppressedBecause: "no-substance" };
  }

  let enabled = false;
  try {
    enabled = ProactiveCore.getInstance().getSettings().enabled;
  } catch {
    enabled = false;
  }

  // An authorization request is the one case that is a direct answer to
  // something the user just asked LÉLU to do, so it is not "proactive" in the
  // sense the setting governs — it is her replying. Everything else waits for
  // consent.
  if (!enabled && event.kind !== "authorization-needed") {
    return { delivered: false, suppressedBecause: "disabled", ...described };
  }

  try {
    NotificationProvider.getInstance().notify({
      title: described.title,
      body: described.body,
    });
  } catch (error) {
    console.warn("[InitiationTriggers] could not deliver:", error);
    return { delivered: false, suppressedBecause: "no-substance", ...described };
  }

  return { delivered: true, ...described };
}

export default announce;
