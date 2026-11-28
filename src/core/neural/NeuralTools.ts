/**
 * neural.show: LÉLU puts her Neural Map in the conversation (inside Cosmos, beside the chat), with the
 * parts a message names highlighted. Also used for contextual surfacing (surfaceNeuralContext), which
 * runs on each turn and only acts on real, exact matches against the canonical map (see mentions.ts).
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import type { AspectId } from "./multiverse/MultiverseTypes";
import { aspectFor, resolveMentions, shouldSurface, type Mention } from "./mentions";

export const NEURAL_TOOLS: ToolDefinition[] = [
  {
    id: "neural.show",
    name: "Show the Neural Map",
    description:
      "Show your Neural Map beside the conversation: V1 knowledge, V2 cognitive architecture, V3 agent society. Pass `about` (text naming parts of you: a subsystem, function, agent or executive) to highlight them; only exact matches on real map nodes are highlighted, each with its evidence.",
    category: "Neural Map",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    executionRoute: "NeuralTools.neural.show",
  },
];

async function show(conversationId: string, aspect: AspectId, mentions: Mention[], by: "lelu" | "user" = "lelu"): Promise<string> {
  const T = await import("../thread/ThreadObjects");
  const ids = mentions.filter((m) => m.aspect === aspect).map((m) => m.nodeId);
  const map = { aspect, view: "force-directed", dim: "2d" as const, highlight: ids, selected: ids[0] ?? null };
  const title = `${aspect.toUpperCase()} · ${[...new Map(mentions.filter((m) => m.aspect === aspect).map((m) => [m.label.toLowerCase(), m.label])).values()].slice(0, 3).join(", ") || (aspect === "v1" ? "Knowledge" : aspect === "v2" ? "Cognitive architecture" : "Agent society")}`;
  const { object, existing } = T.summon({ conversationId, kind: "neural-map", by, title, map });
  if (existing) T.update(object.id, { title, map });
  return object.id;
}

const line = (m: Mention) => `- ${m.label} (${m.aspect.toUpperCase()} ${m.kind}; evidence: ${m.evidence}; matched: ${m.match}; source: ${m.source.authority})`;

export const NEURAL_EXECUTORS: Array<{ id: string; parameters: Record<string, unknown>; run: (args: Record<string, unknown>, context?: { request?: { conversationId?: string | null; prompt?: string } }) => Promise<ToolExecutionResult> }> = [
  {
    id: "neural.show",
    parameters: { type: "object", properties: { aspect: { type: "string", enum: ["v1", "v2", "v3"] }, about: { type: "string" } }, required: [] },
    run: async (args, context) => {
      const about = String(args.about ?? args.query ?? context?.request?.prompt ?? "");
      const mentions = resolveMentions(about);
      const aspect = (["v1", "v2", "v3"].includes(String(args.aspect)) ? String(args.aspect) : aspectFor(mentions)) as AspectId;
      let conversationId = context?.request?.conversationId ?? null;
      if (!conversationId) {
        const MC = (await import("../multichat/MultiChatStore")).default.getInstance() as unknown as { getActiveId(): string | null };
        conversationId = MC.getActiveId();
      }
      if (!conversationId) return { ok: false, content: "No conversation is open to show the map in." };
      await show(conversationId, aspect, mentions);
      const on = mentions.filter((m) => m.aspect === aspect);
      return {
        ok: true,
        content: on.length
          ? `The ${aspect.toUpperCase()} map is beside the chat with ${on.length} part(s) highlighted:\n${on.map(line).join("\n")}`
          : `The ${aspect.toUpperCase()} map is beside the chat. Nothing in the request named a node on it exactly, so nothing is highlighted.`,
        data: { aspect, highlighted: on.map((m) => m.nodeId) },
      };
    },
  },
];

/**
 * Contextual surfacing, once per turn: when a message is clearly about mapped parts of her, the map
 * appears beside the conversation with them highlighted. It never switches the layout or takes focus.
 * Returns what it did, for the turn's trace.
 */
export async function surfaceNeuralContext(conversationId: string | null | undefined, text: string): Promise<{ surfaced: boolean; mentions: Mention[] }> {
  if (!conversationId || !text.trim()) return { surfaced: false, mentions: [] };
  const mentions = resolveMentions(text);
  if (!shouldSurface(text, mentions)) return { surfaced: false, mentions };
  await show(conversationId, aspectFor(mentions), mentions);
  return { surfaced: true, mentions };
}

export function registerNeuralTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of NEURAL_TOOLS) registry.register(tool);
}
