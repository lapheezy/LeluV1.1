/**
 * ==========================================================
 * LÉLUVERSE AGENT COUNCIL
 *
 * The live textual operational interface for agent communication.
 * Must consume the SAME runtime events as the Cosmos Map visual.
 *
 * Shows: agent, executive, timestamp, task, operational message,
 * status, tool activity, findings, decisions, errors.
 *
 * Selecting an agent takes the user to that agent's universe
 * in the Cosmos Map.
 * ==========================================================
 */

import { useEffect, useState, useRef } from "react";
import AgentEventBus, { type AgentEvent } from "../../../../core/agent/AgentEvents";
import AgentStore from "../../../../core/agents/AgentStore";
import CosmosStore from "./CosmosStore";
import type { CosmosState } from "./CosmosTypes";
import { AGENT_TO_EXECUTIVE, EXECUTIVE_DEFS } from "./CosmosTypes";

interface CouncilEntry {
  id: string;
  timestamp: number;
  type: string;
  agent?: string;
  executive?: string;
  task?: string;
  detail?: string;
  status: "running" | "complete" | "error" | "info";
  tool?: string;
}

const STATUS_COLORS: Record<string, string> = {
  running: "rgba(34, 211, 238, 0.9)",
  complete: "rgba(74, 222, 128, 0.9)",
  error: "rgba(248, 113, 113, 0.9)",
  info: "rgba(148, 163, 184, 0.8)",
};

function findAgentName(taskId: string): string | undefined {
  // Try to map taskId back to an agent through the store
  const agents = AgentStore.getInstance().list();
  for (const agent of agents) {
    for (const task of agent.tasks) {
      if (task.executionId === taskId || task.id === taskId) {
        return agent.name;
      }
    }
  }
  return undefined;
}

function getExecutiveForAgent(agentName: string): string {
  const agents = AgentStore.getInstance().list();
  const agent = agents.find((a) => a.name === agentName);
  if (!agent) return "Sage";
  const execType = AGENT_TO_EXECUTIVE[agent.id] ?? "sage";
  return EXECUTIVE_DEFS[execType].name;
}

export default function AgentCouncil() {
  const [entries, setEntries] = useState<CouncilEntry[]>([]);
  const [cosmosState, setCosmosState] = useState<CosmosState>(() => CosmosStore.getInstance().getState());
  const listRef = useRef<HTMLDivElement>(null);
  const maxEntries = 50;

  // Subscribe to real agent events
  useEffect(() => {
    const unsub = AgentEventBus.getInstance().subscribe((event: AgentEvent) => {
      const agentName = findAgentName(event.taskId);
      const entry: CouncilEntry = {
        id: `${event.taskId}-${event.type}-${Date.now()}`,
        timestamp: Date.now(),
        type: event.type,
        agent: agentName,
        executive: agentName ? getExecutiveForAgent(agentName) : undefined,
        task: "task" in event ? (event as any).task : undefined,
        detail: "result" in event ? (event as any).result :
                "label" in event ? (event as any).label :
                "error" in event ? (event as any).error :
                "tool" in event ? (event as any).tool : undefined,
        status: event.type === "task_completed" ? "complete" :
                event.type === "task_failed" ? "error" :
                event.type === "task_started" || event.type === "tool_started" ? "running" : "info",
        tool: "tool" in event ? (event as any).tool : undefined,
      };

      setEntries((prev) => [entry, ...prev].slice(0, maxEntries));
    });

    return unsub;
  }, []);

  // Subscribe to cosmos state for activity indicators
  useEffect(() => {
    return CosmosStore.getInstance().subscribe(setCosmosState);
  }, []);

  // Auto-scroll to top on new entries
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [entries.length]);

  function navigateToAgent(agentName: string) {
    const agents = AgentStore.getInstance().list();
    const agent = agents.find((a) => a.name === agentName);
    if (agent) {
      CosmosStore.getInstance().navigateToEntity(`agent-${agent.id}`);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Activity indicators */}
      <div style={{
        display: "flex",
        gap: 8,
        padding: "6px 10px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        flexShrink: 0,
      }}>
        {cosmosState.executiveGalaxies.map((galaxy) => (
          <div
            key={galaxy.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 8,
              color: `hsl(${galaxy.visualDNA.hue}, 60%, 70%)`,
              opacity: galaxy.activity.energy > 0.2 ? 1 : 0.4,
            }}
          >
            <span
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: `hsl(${galaxy.visualDNA.hue}, 80%, 60%)`,
                boxShadow: galaxy.activity.energy > 0.3
                  ? `0 0 ${4 + galaxy.activity.energy * 6}px hsl(${galaxy.visualDNA.hue}, 80%, 50%)`
                  : "none",
                animation: galaxy.activity.energy > 0.4 ? "genesis-signal-pulse 1.4s ease-in-out infinite" : undefined,
              }}
            />
            {galaxy.name}
          </div>
        ))}
      </div>

      {/* Entries list */}
      <div
        ref={listRef}
        className="genesis-scroll"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "6px 10px",
        }}
      >
        {entries.length === 0 ? (
          <div style={{
            fontSize: 11,
            color: "rgba(180, 170, 210, 0.5)",
            textAlign: "center",
            padding: "20px 0",
          }}>
            No agent activity yet. Send a task or delegate to an agent to see the council in action.
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              style={{
                padding: "6px 8px",
                marginBottom: 4,
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.02)",
                fontSize: 11,
              }}
            >
              {/* Header row */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 2,
              }}>
                {/* Status dot */}
                <span style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: STATUS_COLORS[entry.status],
                  boxShadow: entry.status === "running" ? `0 0 6px ${STATUS_COLORS.running}` : "none",
                  flexShrink: 0,
                  animation: entry.status === "running" ? "genesis-signal-pulse 1.4s ease-in-out infinite" : undefined,
                }} />

                {/* Agent name (clickable → cosmos) */}
                {entry.agent && (
                  <span
                    onClick={() => navigateToAgent(entry.agent!)}
                    style={{
                      color: "rgba(167, 192, 255, 0.9)",
                      fontWeight: 600,
                      cursor: "pointer",
                      textDecoration: "underline",
                      textDecorationStyle: "dotted",
                      textUnderlineOffset: 2,
                    }}
                  >
                    {entry.agent}
                  </span>
                )}

                {/* Executive badge */}
                {entry.executive && (
                  <span style={{
                    fontSize: 8,
                    padding: "1px 5px",
                    borderRadius: 999,
                    background: "rgba(167, 139, 250, 0.12)",
                    color: "rgba(200, 180, 240, 0.7)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}>
                    {entry.executive}
                  </span>
                )}

                {/* Timestamp */}
                <span style={{
                  marginLeft: "auto",
                  fontSize: 9,
                  color: "rgba(148, 163, 184, 0.5)",
                }}>
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>

              {/* Detail */}
              {entry.detail && (
                <div style={{
                  color: "rgba(200, 195, 230, 0.75)",
                  fontSize: 10.5,
                  lineHeight: 1.4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {entry.tool && (
                    <span style={{
                      color: "rgba(34, 211, 238, 0.8)",
                      marginRight: 4,
                    }}>
                      [{entry.tool}]
                    </span>
                  )}
                  {entry.detail}
                </div>
              )}

              {/* Task */}
              {entry.task && entry.task !== entry.detail && (
                <div style={{
                  color: "rgba(180, 170, 210, 0.6)",
                  fontSize: 10,
                  marginTop: 2,
                  fontStyle: "italic",
                }}>
                  {entry.task}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
