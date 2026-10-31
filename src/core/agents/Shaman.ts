/**
 * ==========================================================
 * LÉLU
 * SHAMAN — the router between LÉLU CORE and the Executive Board
 *
 *   LÉLU CORE → SHAMAN → Executive Board → Executive Galaxies
 *             → Agent Universes → Agent Systems → Capabilities,
 *               Tools and Knowledge
 *
 * SHAMAN decides WHO does a piece of work and records WHY. It is not a
 * second agent system: it reads AgentStore, runs work through the one
 * AgentRunner, and writes its decision onto the same persisted task
 * record (AgentTask.executive / routeReason / delegatedBy). A reload
 * therefore keeps every routing decision with the task it produced, and
 * AgentStore's restart recovery ("running" → "interrupted") covers
 * routed work exactly like any other.
 *
 *   route()    — pick an agent for an objective, assigned or not
 *   dispatch() — route, check the delegator may assign there, run
 *   resume()   — continue interrupted/failed work; if its agent is no
 *                longer available, re-route within the same executive
 *
 * Every refusal is a returned reason — nothing is run, nothing is
 * pretended. Ownership comes from ExecutiveOwnership (stable template
 * identity, never the per-install UUID).
 * ==========================================================
 */

import AgentStore from "./AgentStore";
import AgentRunner, { type AgentRunResult } from "./AgentRunner";
import AgentEventBus from "../agent/AgentEvents";
import { executiveOf, isExecutiveId } from "./ExecutiveOwnership";
import type { LeluAgent, DelegatorId } from "./AgentTypes";
import type { ExecutiveId } from "../executive/ExecutiveBoard";

/** Delegators with authority over the whole board. */
const BOARD_WIDE: ReadonlySet<string> = new Set(["user", "lelu", "shaman"]);

/**
 * Words that place an UNASSIGNED objective under an executive when no
 * agent's own description matches it. Checked in this order: security
 * first, so "fix the credential leak" goes to Ma'at, not Engineering.
 */
const EXECUTIVE_SIGNALS: ReadonlyArray<[ExecutiveId, RegExp]> = [
  ["maat", /\b(secur\w*|secret\w*|credential\w*|privacy|private key|permission\w*|vulnerab\w*|inject\w*|attack\w*|threat\w*|auth\w*)\b/i],
  ["forge", /\b(new agent|create (an? )?agent|agent template|specialist agent|spawn (an? )?agent)\b/i],
  ["caretaker", /\b(health\w*|wellness|medical|medicine|sleep|nutrition|diet|exercise|routine\w*|travel\w*|biolog\w*)\b/i],
  ["architect", /\b(architect\w*|refactor\w*|dependenc\w*|subsystem\w*|research\w*|investigat\w*|analy[sz]\w*|study)\b/i],
  ["engineering", /\b(code|coding|implement\w*|build\w*|bug\w*|fix\w*|test\w*|deploy\w*|compile\w*|render\w*|video|script\w*|debug\w*)\b/i],
];

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "about", "what", "your", "please",
  "can", "you", "make", "need", "want", "have", "will", "should", "could", "agent",
]);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

export interface RouteRequest {
  objective: string;
  /** An explicit assignment. Absent → SHAMAN chooses. */
  agentId?: string;
  /** Who is asking: "user", "lelu", an executive id, or an agent id. */
  delegatedBy?: DelegatorId;
  /** Restrict the choice to one executive's galaxy. */
  executive?: ExecutiveId;
  /** Agents that must not be chosen (e.g. the one that just became unavailable). */
  exclude?: readonly string[];
}

export type RouteDecision =
  | { ok: true; agentId: string; agentName: string; executive: ExecutiveId; routeReason: string }
  | { ok: false; reason: string };

export interface DispatchRequest extends RouteRequest {
  projectId?: string;
  /** The cognitive turn this work belongs to. */
  parentTaskId?: string;
}

export interface DispatchResult extends AgentRunResult {
  route: RouteDecision;
}

function runnable(agent: LeluAgent): boolean {
  return agent.enabled && agent.status !== "archived";
}

export default class Shaman {
  private static instance: Shaman | null = null;

  public static getInstance(): Shaman {
    if (!Shaman.instance) Shaman.instance = new Shaman();
    return Shaman.instance;
  }

  private get store(): AgentStore {
    return AgentStore.getInstance();
  }

  /** The executive whose galaxy an objective belongs to, by its wording; null when nothing signals one. */
  public classify(objective: string): ExecutiveId | null {
    for (const [executive, signal] of EXECUTIVE_SIGNALS) {
      if (signal.test(objective)) return executive;
    }
    return null;
  }

  /**
   * May `delegatedBy` assign work into `executive`'s galaxy?
   *   user / lelu / shaman  → anywhere (LÉLU CORE and its router)
   *   forge                 → anywhere (delegation is Agent Forge's domain)
   *   another executive     → its own galaxy only
   *   an agent              → its own executive's galaxy only (peers)
   */
  public canAssign(delegatedBy: DelegatorId | undefined, executive: ExecutiveId): { ok: true } | { ok: false; reason: string } {
    const who = delegatedBy ?? "user";
    if (BOARD_WIDE.has(who) || who === "forge") return { ok: true };
    if (isExecutiveId(who)) {
      return who === executive
        ? { ok: true }
        : { ok: false, reason: `Executive "${who}" may assign only within its own galaxy, not to "${executive}".` };
    }
    const agent = this.store.get(who);
    if (!agent) return { ok: false, reason: `Unknown delegator "${who}" — not a user, executive or agent.` };
    const own = executiveOf(agent);
    return own === executive
      ? { ok: true }
      : { ok: false, reason: `Agent "${agent.name}" (${own}) may assign only within ${own}, not to "${executive}".` };
  }

  /** Choose the agent for an objective. Deterministic for the same roster and objective. */
  public route(request: RouteRequest): RouteDecision {
    const objective = request.objective.trim();
    if (!objective) return { ok: false, reason: "No objective to route." };
    const exclude = new Set(request.exclude ?? []);

    if (request.agentId) {
      const agent = this.store.get(request.agentId);
      if (!agent) return { ok: false, reason: `No agent with id "${request.agentId}".` };
      if (!runnable(agent)) {
        return { ok: false, reason: `Agent "${agent.name}" is ${agent.status === "archived" ? "archived" : "disabled"} and cannot take work.` };
      }
      const executive = executiveOf(agent);
      return {
        ok: true,
        agentId: agent.id,
        agentName: agent.name,
        executive,
        routeReason: `assigned to ${agent.name} by ${request.delegatedBy ?? "user"}; owned by ${executive}`,
      };
    }

    const candidates = this.store
      .runnable()
      .filter((agent) => !exclude.has(agent.id))
      .filter((agent) => !request.executive || executiveOf(agent) === request.executive);
    if (candidates.length === 0) {
      return {
        ok: false,
        reason: request.executive
          ? `No available agent in the ${request.executive} galaxy.`
          : "No enabled agent is available to take work.",
      };
    }

    // 1. The agent whose own description best matches the objective.
    const wanted = words(objective);
    let best: { agent: LeluAgent; score: number; matched: string[] } | null = null;
    for (const agent of candidates) {
      const profile = words([agent.name, agent.role, agent.description, ...agent.capabilities].join(" "));
      const matched = [...wanted].filter((word) => profile.has(word));
      if (matched.length > 0 && (!best || matched.length > best.score)) {
        best = { agent, score: matched.length, matched };
      }
    }
    if (best) {
      const executive = executiveOf(best.agent);
      return {
        ok: true,
        agentId: best.agent.id,
        agentName: best.agent.name,
        executive,
        routeReason: `matched ${best.agent.name} on "${best.matched.slice(0, 4).join(", ")}"; owned by ${executive}`,
      };
    }

    // 2. The executive the objective's wording points to, then LÉLU's own galaxy.
    const signalled = request.executive ?? this.classify(objective);
    for (const executive of signalled ? [signalled, "lelu" as const] : ["lelu" as const]) {
      const agent = candidates.find((candidate) => executiveOf(candidate) === executive);
      if (agent) {
        return {
          ok: true,
          agentId: agent.id,
          agentName: agent.name,
          executive,
          routeReason:
            executive === signalled
              ? `objective reads as ${executive} work; ${agent.name} is that galaxy's first available agent`
              : `${signalled ? `no available agent under ${signalled}; ` : "no agent or executive matched; "}LÉLU's galaxy takes it (${agent.name})`,
        };
      }
    }

    // 3. Anyone available, said plainly.
    const agent = candidates[0];
    const executive = executiveOf(agent);
    return {
      ok: true,
      agentId: agent.id,
      agentName: agent.name,
      executive,
      routeReason: `no match for the objective; ${agent.name} (${executive}) is the first available agent`,
    };
  }

  /** Route, check authority, and run through the one AgentRunner. */
  public async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const route = this.route(request);
    if (!route.ok) return this.refuse(request.objective, route, route.reason);

    const allowed = this.canAssign(request.delegatedBy, route.executive);
    if (!allowed.ok) return this.refuse(request.objective, route, allowed.reason);

    const result = await AgentRunner.getInstance().run(route.agentId, request.objective, request.projectId, request.parentTaskId, {
      delegatedBy: request.delegatedBy ?? "user",
      executive: route.executive,
      routeReason: route.routeReason,
    });
    return { ...result, route };
  }

  /**
   * Continue an interrupted or failed task. Its own agent takes it when it
   * still can; otherwise another agent of the SAME executive does, and the
   * reason says so. Ownership (delegatedBy, executive) carries over.
   */
  public async resume(agentId: string, taskId: string): Promise<DispatchResult> {
    const original = this.store.get(agentId)?.tasks.find((task) => task.id === taskId);
    const agent = this.store.get(agentId);
    if (!agent || !original) {
      const route: RouteDecision = { ok: false, reason: "No such task to resume." };
      return { ok: false, error: route.reason, taskId, route };
    }
    const executive = isExecutiveId(original.executive) ? original.executive : executiveOf(agent);

    if (runnable(agent)) {
      const route: RouteDecision = {
        ok: true,
        agentId: agent.id,
        agentName: agent.name,
        executive,
        routeReason: `resumed by its own agent, ${agent.name}`,
      };
      return { ...(await AgentRunner.getInstance().resume(agentId, taskId, { routeReason: route.routeReason })), route };
    }

    const route = this.route({
      objective: original.label,
      executive,
      exclude: [agent.id],
      delegatedBy: original.delegatedBy,
    });
    if (!route.ok) {
      return { ok: false, error: `${agent.name} is unavailable and ${route.reason.charAt(0).toLowerCase()}${route.reason.slice(1)}`, taskId, route };
    }
    const rerouted: RouteDecision = {
      ...route,
      routeReason: `${agent.name} is unavailable; re-routed within ${executive} to ${route.agentName}`,
    };
    const result = await AgentRunner.getInstance().resume(agentId, taskId, {
      toAgentId: route.agentId,
      routeReason: rerouted.routeReason,
    });
    return { ...result, route: rerouted };
  }

  private refuse(objective: string, route: RouteDecision, reason: string): DispatchResult {
    const taskId = `shaman-${Date.now()}`;
    // A routing failure is an event too — never a silent drop.
    AgentEventBus.getInstance().emit({ type: "task_failed", taskId, label: `SHAMAN: ${objective.slice(0, 80)}`, error: reason });
    return { ok: false, error: reason, taskId, route };
  }
}
