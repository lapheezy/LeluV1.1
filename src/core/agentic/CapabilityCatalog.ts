/**
 * ==========================================================
 * LÉLU — CAPABILITY CATALOG
 *
 * One answer to "what can I do right now, and how well does it
 * work?", assembled from the systems that already know:
 *
 *   ToolRegistry      what each tool is, its risk and permissions
 *   ToolDispatcher    whether it has a real executor, its argument
 *                     schema, and whether it is permitted right now
 *   ApprovalGate      whether it needs a human decision per call
 *   ToolStats         how it has actually performed
 *   AgentStore        the specialist agents work can be delegated to
 *
 * Nothing here is a second registry. It is a read-side join, so a
 * tool registered at runtime (registerExecutor) shows up the
 * moment it exists, and a tool that loses its provider shows up
 * as unavailable with the reason.
 * ==========================================================
 */

import ToolRegistry from "../tools/ToolRegistry";
import { executableToolIds, executorParameters, toolPermitted } from "../tools/ToolDispatcher";
import AgentStore from "../agents/AgentStore";
import ApprovalGate from "./ApprovalGate";
import ToolStats from "./ToolStats";

export interface Capability {
  id: string;
  kind: "tool" | "agent";
  name: string;
  description: string;
  category: string;
  /** Has a real executor (tools) / is enabled (agents). */
  executable: boolean;
  /** Its dependency is present (provider key, runtime, connection). */
  available: boolean;
  /** Allowed at the current autonomy level without a per-call approval. */
  permitted: boolean;
  /** Each call needs a human decision first (ApprovalGate policy). */
  requiresApproval: boolean;
  riskLevel?: number;
  parameters?: Record<string, unknown>;
  /** Why it cannot be used right now, when it cannot. */
  blockedReason?: string;
  stats?: { runs: number; failed: number; refused: number; lastError?: string };
}

export function listCapabilities(): Capability[] {
  const registry = ToolRegistry.getInstance();
  const executable = new Set(executableToolIds());
  const approvals = ApprovalGate.getInstance();
  const stats = ToolStats.getInstance();

  const tools: Capability[] = registry.all().map((definition) => {
    const isExecutable = executable.has(definition.id);
    const permitted = isExecutable && toolPermitted(definition.id);
    const approval = approvals.requiresApproval(definition.id);
    const stat = stats.get(definition.id);
    let blockedReason: string | undefined;
    if (!isExecutable) blockedReason = "described in the registry but has no executor";
    else if (!definition.available) blockedReason = definition.dependency ? `needs ${definition.dependency}` : "its dependency is not available";
    else if (!permitted && !approval.required) blockedReason = "above the current autonomy level";
    return {
      id: definition.id,
      kind: "tool",
      name: definition.name,
      description: definition.description,
      category: definition.category,
      executable: isExecutable,
      available: definition.available,
      permitted,
      requiresApproval: approval.required,
      riskLevel: definition.riskLevel,
      ...(isExecutable ? { parameters: executorParameters(definition.id) } : {}),
      ...(blockedReason ? { blockedReason } : {}),
      ...(stat ? { stats: { runs: stat.runs, failed: stat.failed, refused: stat.refused, lastError: stat.lastError } } : {}),
    };
  });

  let agents: Capability[] = [];
  try {
    agents = AgentStore.getInstance()
      .runnable()
      .map((agent) => ({
        id: `agent:${agent.id}`,
        kind: "agent" as const,
        name: agent.name,
        description: `${agent.role || "specialist"} — ${agent.description}`.trim(),
        category: "Agents",
        executable: true,
        available: true,
        permitted: true,
        requiresApproval: false,
      }));
  } catch {
    agents = [];
  }

  return [...tools, ...agents];
}

/**
 * Capabilities a planner can actually use now: executable tools that are
 * permitted or approvable, and runnable agents.
 */
export function usableCapabilities(): Capability[] {
  return listCapabilities().filter(
    (capability) =>
      capability.executable &&
      capability.available &&
      (capability.permitted || capability.requiresApproval) &&
      !(capability.kind === "tool" && capability.blockedReason),
  );
}

/** Search by id, name, description or category. Words are ANDed. */
export function findCapabilities(query: string, capabilities = listCapabilities()): Capability[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return capabilities;
  return capabilities.filter((capability) => {
    const haystack = `${capability.id} ${capability.name} ${capability.description} ${capability.category}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Compact, model-readable listing. */
export function describeCapabilities(capabilities: Capability[]): string {
  if (capabilities.length === 0) return "No matching capabilities.";
  return capabilities
    .map((capability) => {
      const flags = [
        capability.kind,
        capability.permitted ? "ready" : capability.requiresApproval ? "needs approval per call" : "blocked",
        capability.blockedReason,
        capability.stats ? `${capability.stats.runs} runs, ${capability.stats.failed} failed` : undefined,
      ].filter(Boolean);
      return `- ${capability.id}: ${capability.description} [${flags.join("; ")}]`;
    })
    .join("\n");
}
