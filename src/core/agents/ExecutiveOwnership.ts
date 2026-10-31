/**
 * ==========================================================
 * LÉLU
 * EXECUTIVE OWNERSHIP — which executive owns which agent
 *
 * The hierarchy is LÉLU CORE → SHAMAN → Executive Board →
 * Executive Galaxies → Agent Universes. This module answers one
 * question for the whole of it: "which executive owns this agent?"
 * SHAMAN routes by it, AgentRunner records it on every task, and the
 * Cosmos draws each agent inside that executive's galaxy.
 *
 * WHY IT EXISTS
 * -------------
 * The Cosmos looked agents up as AGENT_TO_EXECUTIVE[agent.id], a table
 * keyed by TEMPLATE id ("designer", "builder", …). Agent ids are
 * per-install UUIDs (agentFromTemplate → crypto.randomUUID()), so the
 * lookup never matched and every agent fell through to the default
 * galaxy. Ownership is now resolved from a stable identity:
 *
 *   1. agent.executive — an explicit assignment (AgentStore.assignExecutive)
 *   2. agent.templateId — set at creation, backfilled by name for agents
 *      created before the field existed
 *   3. the template whose NAME matches (agents not yet backfilled)
 *   4. Agent Forge — the executive that owns agents with no template
 *      (user-created ones): it creates and evolves the workforce.
 *
 * Pure: no store, no runtime. Safe to import from anywhere.
 * ==========================================================
 */

import {
  AGENT_TEMPLATES,
  EXECUTIVE_AGENT_TEMPLATES,
  SCIENTIFIC_AGENT_TEMPLATES,
  type AgentTemplate,
} from "./AgentTemplates";
import type { LeluAgent } from "./AgentTypes";
import type { ExecutiveId } from "../executive/ExecutiveBoard";

export const EXECUTIVE_IDS: readonly ExecutiveId[] = ["lelu", "maat", "architect", "engineering", "forge", "caretaker"];

/** The executive that owns each template's agents. */
export const TEMPLATE_EXECUTIVE: Readonly<Record<string, ExecutiveId>> = {
  // Creative workforce — kept where the Cosmos already drew it.
  designer: "lelu",
  artist: "lelu",
  jewelry: "lelu",
  fashion: "lelu",
  renderer: "engineering",
  video: "engineering",
  builder: "engineering",
  engineer: "engineering",
  researcher: "architect",
  marketing: "caretaker",
  // The five reasoning agents SelfStudy delegates to.
  "dream-engineering": "lelu",
  "reality-engineering": "engineering",
  "life-engineering": "caretaker",
  "path-intelligence": "architect",
  "contingency-intelligence": "maat",
  // Scientific specialists — Caretaker's health intelligence, except the
  // one whose job is threat review.
  "holistic-health": "caretaker",
  biomedical: "caretaker",
  pharmacology: "caretaker",
  "clinical-literature": "caretaker",
  bioinformatics: "caretaker",
  "computational-biology": "caretaker",
  biotechnology: "caretaker",
  "bioengineering-architect": "caretaker",
  "research-critic": "caretaker",
  biosecurity: "maat",
};

/** Owner of an agent no template accounts for. */
export const DEFAULT_EXECUTIVE: ExecutiveId = "forge";

const ALL_TEMPLATES: readonly AgentTemplate[] = [
  ...AGENT_TEMPLATES,
  ...EXECUTIVE_AGENT_TEMPLATES,
  ...SCIENTIFIC_AGENT_TEMPLATES,
];

export function isExecutiveId(value: unknown): value is ExecutiveId {
  return typeof value === "string" && (EXECUTIVE_IDS as readonly string[]).includes(value);
}

/** The template an agent came from: its recorded templateId, else a name match. */
export function templateIdOf(agent: Pick<LeluAgent, "name"> & { templateId?: string }): string | null {
  if (agent.templateId && ALL_TEMPLATES.some((template) => template.id === agent.templateId)) {
    return agent.templateId;
  }
  const name = agent.name.trim().toLowerCase();
  return ALL_TEMPLATES.find((template) => template.name.toLowerCase() === name)?.id ?? null;
}

export type OwnershipBasis = "assigned" | "template" | "default";

export interface Ownership {
  executive: ExecutiveId;
  basis: OwnershipBasis;
}

/** Which executive owns this agent, and on what basis. Stable for a given agent. */
export function ownershipOf(agent: Pick<LeluAgent, "name"> & { templateId?: string; executive?: string }): Ownership {
  if (isExecutiveId(agent.executive)) return { executive: agent.executive, basis: "assigned" };
  const templateId = templateIdOf(agent);
  const fromTemplate = templateId ? TEMPLATE_EXECUTIVE[templateId] : undefined;
  if (fromTemplate) return { executive: fromTemplate, basis: "template" };
  return { executive: DEFAULT_EXECUTIVE, basis: "default" };
}

export function executiveOf(agent: Pick<LeluAgent, "name"> & { templateId?: string; executive?: string }): ExecutiveId {
  return ownershipOf(agent).executive;
}
