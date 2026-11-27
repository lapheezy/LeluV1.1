/**
 * ==========================================================
 * LÉLU — NEURAL MAP MULTIVERSE: THE SHARED GRAPH CONTRACT
 *
 * One Neural Map, three aspects:
 *   v1  the canonical knowledge index (NeuralMapIndex, unchanged)
 *   v2  her cognitive architecture (src/core subsystems + real imports)
 *   v3  her agent society (ExecutiveBoard + AgentStore, persisted)
 *
 * Each aspect is DERIVED from the authority that already owns it into
 * this one graph shape; the shared layouts, saved views and selection
 * work on that shape alone, so no aspect gets its own map or registry.
 *
 * Every node and edge carries `evidence`: whether it is measured,
 * declared by its authority, inferred (e.g. from static imports),
 * classified editorially, proposed, or unknown. Views show it; nothing
 * here invents activity.
 * ==========================================================
 */

export type AspectId = "v1" | "v2" | "v3";

export type Evidence =
  /** Measured from the running system or its source (counts, timings). */
  | "measured"
  /** Stated by the owning authority (a record, a registry entry). */
  | "declared"
  /** Derived from structure, e.g. a static import — wiring, not activity. */
  | "inferred"
  /** An editorial grouping made by whoever wrote the classifier. */
  | "classified"
  /** Something proposed and not yet real. */
  | "proposed"
  | "unknown";

export interface MvNode {
  id: string;
  label: string;
  /** Kind within the aspect (entity type, subsystem, function, executive, agent…). */
  kind: string;
  /** The cluster it belongs to (layouts group by it). */
  group: string;
  evidence: Evidence;
  /** Relative size, e.g. lines of code, task count. >= 0. */
  weight?: number;
  /** A real timestamp when the authority has one (createdAt, updatedAt). */
  time?: number;
  /** Where to go back to the source of truth. */
  source: { authority: string; id: string };
  facts: Record<string, string | number | boolean>;
}

export interface MvEdge {
  id: string;
  from: string;
  to: string;
  kind: string;
  evidence: Evidence;
  /** Edge strength when measured (import count, task count). */
  weight?: number;
}

export interface MvGraph {
  aspect: AspectId;
  nodes: MvNode[];
  edges: MvEdge[];
  /** What this aspect could not show, stated rather than hidden. */
  gaps: string[];
}

export const ASPECTS: Record<AspectId, { label: string; title: string; blurb: string }> = {
  v1: { label: "V1", title: "Canonical Knowledge Map", blurb: "Everything that exists, indexed over its own authorities." },
  v2: { label: "V2", title: "Cognitive Architecture", blurb: "Her subsystems as the code contains and wires them." },
  v3: { label: "V3", title: "Agent Society", blurb: "Her executives and persistent agents, with their real work." },
};
