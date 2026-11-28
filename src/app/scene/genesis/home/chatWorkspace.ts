/**
 * Opening the chat workspace and the Neural Map INSIDE the Cosmos: one implementation for the core chat
 * box's "+" tab and the dial, so they always do the same thing.
 *  - The chat workspace is the active conversation's Thread, in a chat window the Chat Universe floats
 *    over the live Cosmos.
 *  - The Neural Map (V1 knowledge, V2 architecture, V3 agents) opens in that same workspace, as an object
 *    of the conversation, from the canonical map.
 */

import { chatWindowId, type useGenesis } from "../GenesisCore";
import { setUniverseOpen } from "../chat/universe/universeOpen";
import WorkspaceStewardStore from "../../../../core/interface/WorkspaceStewardStore";
import { summon } from "../../../../core/thread/ThreadObjects";

type Genesis = ReturnType<typeof useGenesis>;

function conversationOf(genesis: Genesis): string | null {
  const { conversations, activeConversationId } = genesis.state;
  return (conversations.find((c) => c.id === activeConversationId) ?? conversations[0])?.id ?? genesis.createConversation() ?? null;
}

export function openChatWorkspace(genesis: Genesis, stage: "thread" | "conversation" = "thread"): string | null {
  const id = conversationOf(genesis);
  if (!id) return null;
  setUniverseOpen(true);
  const moduleId = chatWindowId(id);
  genesis.openModule(moduleId);
  genesis.setModulePresentation(moduleId, "inline");
  genesis.raiseModule(moduleId);
  WorkspaceStewardStore.setStage(id, stage);
  return id;
}

export const MAP_TITLES = { v1: "V1 · Knowledge", v2: "V2 · Cognitive architecture", v3: "V3 · Agent society" } as const;

export function showNeuralMap(genesis: Genesis, aspect: "v1" | "v2" | "v3"): void {
  const id = conversationOf(genesis);
  if (!id) return;
  summon({ conversationId: id, kind: "neural-map", by: "user", title: MAP_TITLES[aspect], map: { aspect, view: aspect === "v3" ? "core-orbit" : "force-directed", dim: "2d", highlight: [], selected: null } });
  openChatWorkspace(genesis);
}
