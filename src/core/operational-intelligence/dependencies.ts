/**
 * ==========================================================
 * LÉLU — DEPENDENCY INTELLIGENCE
 *
 * Why a capability is unavailable, expressed as edges rather
 * than prose. "OpenHands does not work" is not actionable;
 * "openhands.execute requires engineering.workspace.runtime,
 * which is BLOCKED because the engineering API is not mounted"
 * is.
 *
 * There is no second graph database here: the graph is derived
 * from the snapshot on every build, and the relationship layer
 * (RelationshipStore) stays the authority for authorization
 * tuples. This is analysis, not storage.
 * ==========================================================
 */

import type {
  CapabilityStatus,
  DependencyStatus,
  OperationalSnapshot,
  OperationalState,
} from "./types.ts";

export interface RequirementEdge {
  /** The capability that cannot work without the requirement. */
  dependentCapability: string;
  /** The capability (or fact-shaped capability) it needs. */
  requiredCapability: string;
  reason: string;
}

const SATISFIED_STATES: readonly OperationalState[] = ["AVAILABLE", "VERIFIED", "COMPLETED", "AUTHORIZED"];

export function isSatisfied(state: OperationalState): boolean {
  return SATISFIED_STATES.includes(state);
}

/**
 * The declared requirements, in one readable table.
 *
 * These are facts about the architecture, not observations: the
 * observed half (is the engine installed? is the runtime mounted?)
 * comes from the collector. Keeping the two apart is what stops a
 * discovered binary from being mistaken for an authorized engine.
 */
export const REQUIREMENTS: readonly RequirementEdge[] = [
  // Engineering execution
  { dependentCapability: "engineering.openhands.execute", requiredCapability: "engineering.openhands.runtime", reason: "OpenHands must answer before a task can be dispatched to it" },
  { dependentCapability: "engineering.openhands.execute", requiredCapability: "engineering.workspace.runtime", reason: "no isolated workspace, no place to run the task" },
  { dependentCapability: "engineering.openhands.execute", requiredCapability: "security.policy.opa", reason: "every capability call is authorized by the policy gate" },
  { dependentCapability: "engineering.openhands.execute", requiredCapability: "security.scanner.gitleaks", reason: "a code change must be able to be scanned before it is trusted" },
  { dependentCapability: "engineering.opencode.execute", requiredCapability: "engineering.opencode.runtime", reason: "OpenCode must answer before a task can be dispatched to it" },
  { dependentCapability: "engineering.opencode.execute", requiredCapability: "engineering.workspace.runtime", reason: "no isolated workspace, no place to run the task" },
  { dependentCapability: "engineering.opencode.execute", requiredCapability: "security.policy.opa", reason: "every capability call is authorized by the policy gate" },
  { dependentCapability: "engineering.local.execute", requiredCapability: "engineering.workspace.runtime", reason: "the whitelisted runtime is what actually runs commands" },
  { dependentCapability: "engineering.local.execute", requiredCapability: "security.policy.opa", reason: "command execution is an EXECUTE action governed by policy" },

  // Voice
  { dependentCapability: "voice.recognition.transcribe", requiredCapability: "voice.whisper.service", reason: "recognition needs a Whisper endpoint" },
  { dependentCapability: "voice.synthesis.speak", requiredCapability: "voice.kokoro.service", reason: "synthesis needs a Kokoro endpoint" },
  { dependentCapability: "voice.recognition.transcribe", requiredCapability: "voice.audio.input", reason: "without an input device there is nothing to transcribe" },
  { dependentCapability: "voice.synthesis.speak", requiredCapability: "voice.audio.output", reason: "without an output device audio cannot be heard" },

  // Cross-studio
  { dependentCapability: "intelligence.plan.activate", requiredCapability: "security.policy.opa", reason: "a plan that cannot be authorized cannot be executed" },
  { dependentCapability: "intelligence.plan.activate", requiredCapability: "security.audit.trail", reason: "an unauditable plan is not allowed to run" },
];

export interface DependencyGraph {
  nodes: string[];
  edges: RequirementEdge[];
  statuses: DependencyStatus[];
  /** Missing requirements grouped by the capability they block. */
  blockersFor: (capabilityId: string) => DependencyStatus[];
  /** Whether the capability can run right now, and why not. */
  readinessOf: (capabilityId: string) => { ready: boolean; reason: string };
  /** Every cycle found, as capability id paths. */
  cycles: string[][];
  /** Requirement-first ordering of the capabilities we know about. */
  order: string[];
  /** How many capabilities become blocked if this one is unavailable. */
  impactOf: (capabilityId: string) => number;
}

export function buildDependencyGraph(
  capabilities: CapabilityStatus[],
  edges: readonly RequirementEdge[] = REQUIREMENTS,
): DependencyGraph {
  const byId = new Map(capabilities.map((capability) => [capability.capabilityId, capability]));
  const statuses: DependencyStatus[] = edges.map((edge) => {
    const required = byId.get(edge.requiredCapability);
    const state: OperationalState = required ? required.state : "NOT_CONFIGURED";
    const satisfied = required ? isSatisfied(required.state) : false;
    return {
      dependencyId: `${edge.dependentCapability}→${edge.requiredCapability}`,
      dependentCapability: edge.dependentCapability,
      requiredCapability: edge.requiredCapability,
      satisfied,
      state,
      blockingReason: satisfied
        ? null
        : `${edge.reason} (${edge.requiredCapability} is ${state}${required ? "" : " — not reported by any studio"})`,
      evidence: required?.evidence ?? [],
    };
  });

  const nodes = [...new Set([...edges.map((edge) => edge.dependentCapability), ...edges.map((edge) => edge.requiredCapability), ...capabilities.map((capability) => capability.capabilityId)])];

  const cycles = findCycles(nodes, edges);
  const order = topologicalOrder(nodes, edges);

  const impactOf = (capabilityId: string): number => {
    let count = 0;
    for (const edge of edges) {
      if (edge.requiredCapability !== capabilityId) continue;
      count += 1;
      for (const further of edges) {
        if (further.requiredCapability === edge.dependentCapability) count += 1;
      }
    }
    return count;
  };

  return {
    nodes,
    edges: [...edges],
    statuses,
    blockersFor: (capabilityId) => statuses.filter((status) => status.dependentCapability === capabilityId && !status.satisfied),
    readinessOf: (capabilityId) => {
      const blockers = statuses.filter((status) => status.dependentCapability === capabilityId && !status.satisfied);
      if (blockers.length === 0) return { ready: true, reason: "every declared requirement is satisfied" };
      return { ready: false, reason: blockers.map((blocker) => blocker.blockingReason).join("; ") };
    },
    cycles,
    order,
    impactOf,
  };
}

/** Depth-first cycle detection over the requirement edges. */
export function findCycles(nodes: string[], edges: readonly RequirementEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node, []);
  for (const edge of edges) {
    const list = adjacency.get(edge.dependentCapability) ?? [];
    list.push(edge.requiredCapability);
    adjacency.set(edge.dependentCapability, list);
  }

  const found: string[][] = [];
  const state = new Map<string, "white" | "grey" | "black">();
  for (const node of nodes) state.set(node, "white");

  const visit = (node: string, path: string[]): void => {
    state.set(node, "grey");
    for (const next of adjacency.get(node) ?? []) {
      const color = state.get(next) ?? "white";
      if (color === "grey") {
        const start = path.indexOf(next);
        found.push([...(start >= 0 ? path.slice(start) : path), next]);
      } else if (color === "white") {
        visit(next, [...path, next]);
      }
    }
    state.set(node, "black");
  };

  for (const node of nodes) {
    if ((state.get(node) ?? "white") === "white") visit(node, [node]);
  }
  return found;
}

/** Requirements first. A cycle does not hang the sort: it is reported instead. */
export function topologicalOrder(nodes: string[], edges: readonly RequirementEdge[]): string[] {
  const remaining = new Set(nodes);
  const satisfied = new Set<string>();
  const ordered: string[] = [];
  const incoming = (node: string): string[] =>
    edges.filter((edge) => edge.dependentCapability === node).map((edge) => edge.requiredCapability);

  let progressed = true;
  while (remaining.size > 0 && progressed) {
    progressed = false;
    for (const node of [...remaining]) {
      const needs = incoming(node).filter((requirement) => nodes.includes(requirement));
      if (needs.every((requirement) => satisfied.has(requirement))) {
        ordered.push(node);
        satisfied.add(node);
        remaining.delete(node);
        progressed = true;
      }
    }
  }
  // Anything left is in (or behind) a cycle; append it so the caller
  // still sees every node rather than silently losing them.
  ordered.push(...remaining);
  return ordered;
}

/** The readiness questions an operator actually asks. */
export function explainCapability(
  snapshot: OperationalSnapshot,
  capabilityId: string,
): {
  capabilityId: string;
  state: OperationalState | "NOT_REPORTED";
  blockingReasons: string[];
  blockers: Array<{ required: string; state: OperationalState; reason: string }>;
} {
  const capability = snapshot.capabilities.find((item) => item.capabilityId === capabilityId);
  const blockers = snapshot.dependencies
    .filter((dependency) => dependency.dependentCapability === capabilityId)
    .map((dependency) => ({
      required: dependency.requiredCapability,
      state: dependency.state,
      reason: dependency.blockingReason ?? "satisfied",
    }));
  return {
    capabilityId,
    state: capability?.state ?? "NOT_REPORTED",
    blockingReasons: capability?.blockingReasons ?? (capability ? [] : ["no studio reported this capability"]),
    blockers,
  };
}
