/**
 * Which parts of LÉLU a message names, resolved against the CANONICAL Neural Map authorities
 * (liveAspectGraph: V1 knowledge, V2 architecture, V3 agent society). Nothing is invented: a mention is a
 * whole-word match on a real node's label, and it carries that node's own evidence and source.
 *
 * Used by neural.show (explicit) and by contextual surfacing (v3 §5): the map appears beside a
 * conversation that is talking about mapped parts of her, with those nodes highlighted.
 */

import { liveAspectGraph } from "./multiverse/liveAspects";
import type { AspectId, MvNode } from "./multiverse/MultiverseTypes";

export interface Mention {
  aspect: AspectId;
  nodeId: string;
  label: string;
  kind: string;
  /** The node's own evidence label from its authority (measured, declared, inferred, classified…). */
  evidence: string;
  /** How the message matched it. Always an exact whole-word label match: never a guess. */
  match: "exact label";
  source: MvNode["source"];
}

/** Labels too generic to count as naming a part of her on their own. */
const GENERIC = new Set(["unclassified", "other", "misc", "general", "core", "system"]);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function resolveMentions(text: string, aspects: AspectId[] = ["v1", "v2", "v3"]): Mention[] {
  const t = norm(text);
  const out: Mention[] = [];
  for (const aspect of aspects) {
    let nodes: MvNode[] = [];
    try {
      nodes = liveAspectGraph(aspect).nodes;
    } catch {
      continue; // an authority that cannot answer here contributes nothing (not a guess)
    }
    for (const n of nodes) {
      // A conversation (or message) is not a part of her: V1 holds the current chat as a node titled with
      // the message itself, so "go back to the primary cosmos" matched its own conversation (measured).
      if (/^(conversation|message|chat)s?$/i.test(n.kind)) continue;
      const label = norm(n.label).trim();
      if (label.length < 4 || GENERIC.has(label)) continue;
      if (new RegExp(`(?<![\\p{L}\\d])${escape(label)}(?![\\p{L}\\d])`, "u").test(t)) {
        out.push({ aspect, nodeId: n.id, label: n.label, kind: n.kind, evidence: String(n.evidence), match: "exact label", source: n.source });
      }
    }
  }
  // Longer labels first ("Provider routing" before "Routing"); one entry per node.
  const seen = new Set<string>();
  return out.sort((a, b) => b.label.length - a.label.length).filter((m) => (seen.has(`${m.aspect}:${m.nodeId}`) ? false : (seen.add(`${m.aspect}:${m.nodeId}`), true)));
}

/** A message ABOUT her (not one that just uses an everyday word like "memory"). */
const SYSTEM_CUE = /\b(your|her|lélu'?s|lelu'?s|subsystems?|architecture|agents?|executives?|modules?|pipeline|neural map|map|cognitive|wiring|dependenc(?:y|ies))\b/i;

/** Should the map surface on its own for this message? Two distinct nodes, or one with a system cue. */
export function shouldSurface(text: string, mentions: Mention[]): boolean {
  if (!mentions.length) return false;
  // Distinct LABELS: one word can name two nodes (V2 has a "Memory" function and a "Memory" subsystem);
  // counting nodes made "I lost my memory" look like a message about two parts of her (caught by a test).
  const labels = new Set(mentions.map((m) => m.label.toLowerCase()));
  return labels.size >= 2 || SYSTEM_CUE.test(text);
}

/** The aspect most of the mentions belong to (the map that shows them). */
export function aspectFor(mentions: Mention[], fallback: AspectId = "v2"): AspectId {
  const count = new Map<AspectId, number>();
  for (const m of mentions) count.set(m.aspect, (count.get(m.aspect) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}
