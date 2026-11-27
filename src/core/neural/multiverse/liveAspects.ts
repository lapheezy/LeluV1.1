/**
 * The three aspects, built from the live authorities: the one place both the
 * standalone Neural Map and the maps inside Chat Universe threads read from,
 * so a map in a conversation is the same map, never a copy (Mission 44.9).
 */

import { neuralMap } from "../NeuralMap";
import AgentStore from "../../agents/AgentStore";
import AgentDialogue from "../../agents/AgentDialogue";
import { EXECUTIVES } from "../../executive/ExecutiveBoard";
import ResourcePolicy from "../../observability/ResourcePolicy";
import type { LeluAgent } from "../../agents/AgentTypes";
import { v1Graph, v2Graph, v3Graph } from "./Aspects";
import type { AspectId, MvGraph } from "./MultiverseTypes";

export function liveAspectGraph(aspect: AspectId, agents: LeluAgent[] = AgentStore.getInstance().list()): MvGraph {
  if (aspect === "v2") return v2Graph();
  if (aspect === "v3") {
    const policy = ResourcePolicy.getInstance().get();
    const dialogues = AgentDialogue.getInstance()
      .list()
      .map((d) => ({ id: d.id, kind: d.kind, participants: d.participants, turns: d.turns, topic: d.topic }));
    return v3Graph(EXECUTIVES, agents, { dialogues, paused: new Set(Object.entries(policy.agents).filter(([, c]) => c.paused).map(([id]) => id)) });
  }
  return v1Graph(neuralMap());
}
