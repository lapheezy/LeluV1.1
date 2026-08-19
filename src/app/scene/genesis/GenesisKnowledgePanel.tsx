/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS KNOWLEDGE PANEL
 *
 * Phase 7 — makes the Knowledge Graph and Cognitive Agents
 * visible as a 2D panel, complementing the 3D spheres already
 * drawn by GenesisWorkspace.
 *
 * Unlike Memory/Providers, this data is already streamed live
 * via GenesisBridge → CognitionRuntime.subscribe → state.cognition
 * (see GenesisBridge.ts, CognitionRuntime.ts) — no new plumbing
 * needed, just a place to read it.
 * ==========================================================
 */

import { useMemo } from "react";
import { useGenesis } from "./GenesisCore";
import { genesisTheme } from "./GenesisTheme";
import GenesisWindowFrame from "./GenesisWindowFrame";

interface AgentShape {
  id?: string;
  name?: string;
  role?: string;
  memories?: string[];
}

interface KnowledgeNodeShape {
  id?: string;
  label?: string;
  type?: string;
}

const EMPTY_AGENTS: AgentShape[] = [];
const EMPTY_NODES: KnowledgeNodeShape[] = [];

interface GenesisKnowledgePanelProps {
  onClose: () => void;
}

export default function GenesisKnowledgePanel({ onClose }: GenesisKnowledgePanelProps) {
  const { state } = useGenesis();

  const agents = (state.cognition?.agents as AgentShape[] | undefined) ?? EMPTY_AGENTS;
  const nodes = (state.cognition?.nodes as KnowledgeNodeShape[] | undefined) ?? EMPTY_NODES;

  const recentNodes = useMemo(() => nodes.slice(-30).reverse(), [nodes]);

  return (
    <GenesisWindowFrame
      title={
        <>
          Knowledge &amp; agents · {agents.length} agents · {nodes.length} nodes
        </>
      }
      onClose={onClose}
      width="min(92vw, 540px)"
    >

      <div style={genesisTheme.text.label}>Cognitive agents</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "8px 0 14px" }}>
        {agents.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            No agents active yet — they spin up as conversations touch different roles.
          </div>
        ) : (
          agents.map((agent, index) => (
            <div
              key={agent.id ?? index}
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                padding: "8px 10px",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                <span style={{ fontWeight: 600 }}>{agent.name ?? "Agent"}</span>
                <span style={{ opacity: 0.6 }}>{agent.role ?? "general"}</span>
              </div>
              {agent.memories && agent.memories.length > 0 ? (
                <div style={{ fontSize: 11, opacity: 0.55, overflowWrap: "anywhere" }}>
                  {agent.memories.slice(0, 4).join(" · ")}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div style={genesisTheme.text.label}>Knowledge graph — recent nodes</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {recentNodes.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            No knowledge nodes recorded yet — they accumulate as Lélu learns concepts from conversation.
          </div>
        ) : (
          recentNodes.map((node, index) => (
            <div
              key={node.id ?? index}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                fontSize: 12,
                padding: "5px 8px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <span style={{ overflowWrap: "anywhere" }}>{node.label ?? "Node"}</span>
              {node.type ? <span style={{ opacity: 0.5, whiteSpace: "nowrap" }}>{node.type}</span> : null}
            </div>
          ))
        )}
      </div>
    </GenesisWindowFrame>
  );
}
