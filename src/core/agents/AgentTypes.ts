/**
 * ==========================================================
 * LÉLU
 * AGENT TYPES — the agent model for the Agents workspace
 *
 * One unified, persistent agent model. Every field is
 * configurable in the Agents panel: identity, instructions,
 * capabilities, tools, memory permissions, knowledge context,
 * preferred/fallback providers, project assignment, status,
 * task history and execution history.
 * ==========================================================
 */

/** Capabilities an agent can be granted (the creative tool layer). */
export type AgentTool =
  | "chat"
  | "research"
  | "browse"
  | "sketch"
  | "render"
  | "video"
  | "file"
  | "projects"
  | "memory"
  | "device"
  | "sandbox"
  | "engineering";

/** How much memory access an agent has. */
export type AgentMemoryAccess = "none" | "read" | "read-write";

export type AgentStatus = "active" | "paused" | "archived";

export type AgentTaskStatus = "queued" | "running" | "complete" | "failed";

export interface AgentTask {
  id: string;
  /** Human label, e.g. "Draft three pendant concepts". */
  label: string;
  status: AgentTaskStatus;
  createdAt: number;
  completedAt?: number;
  /** Execution id this task maps to (see AgentExecution). */
  executionId?: string;
  /** Optional project the task belongs to. */
  projectId?: string;
  error?: string;
}

export interface AgentExecution {
  id: string;
  taskId: string;
  /** The prompt the agent actually ran. */
  prompt: string;
  /** Provider that generated the result (or "offline"/"error"). */
  provider: string;
  model: string;
  /** Whether the result was a live generation or the local fallback. */
  offline: boolean;
  result: string;
  processingTime: number;
  createdAt: number;
}

export interface LeluAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  /** Detailed operating instructions — the agent's system prompt. */
  instructions: string;
  personality: string;
  /** High-level capabilities, e.g. ["concept design", "rendering"]. */
  capabilities: string[];
  /** Granted tools (the creative tool layer). */
  tools: AgentTool[];
  /** Memory access permission. */
  memoryAccess: AgentMemoryAccess;
  /** Extra knowledge/context always available to this agent. */
  knowledge: string[];
  /** Preferred AI provider name, or null for the default chain. */
  provider: string | null;
  /** Fallback AI provider name, or null for the default chain. */
  fallbackProvider: string | null;
  /** Project this agent is assigned to, or null. */
  projectId: string | null;
  status: AgentStatus;
  /** Whether the agent is enabled for delegation. */
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  tasks: AgentTask[];
  executions: AgentExecution[];
  /** Explicit permission flags (defaults are conservative). */
  permissions: {
    canBrowse: boolean;
    canUseTools: boolean;
    canWriteMemory: boolean;
    canAccessProjects: boolean;
  };
}

export const AGENT_TOOL_LABELS: Record<AgentTool, string> = {
  chat: "Chat",
  research: "Research",
  browse: "Browse",
  sketch: "Sketch",
  render: "Render",
  video: "Video",
  file: "Files",
  projects: "Projects",
  memory: "Memory",
  device: "Device",
  sandbox: "Sandbox",
  engineering: "Engineering",
};

export function defaultPermissions(): LeluAgent["permissions"] {
  return {
    canBrowse: false,
    canUseTools: true,
    canWriteMemory: false,
    canAccessProjects: false,
  };
}

/** System prompt LÉLU injects when an agent runs. */
export function agentSystemPrompt(agent: LeluAgent): string {
  const lines = [
    `You are ${agent.name}, a specialized agent operating inside LÉLU's creative operating environment.`,
    agent.role ? `Role: ${agent.role}` : "",
    agent.description ? `About: ${agent.description}` : "",
    agent.personality ? `Personality: ${agent.personality}` : "",
    agent.instructions ? `Instructions:\n${agent.instructions}` : "",
    agent.knowledge.length > 0 ? `Always-available knowledge:\n- ${agent.knowledge.join("\n- ")}` : "",
    agent.capabilities.length > 0 ? `Capabilities: ${agent.capabilities.join(", ")}` : "",
    "",
    "Work toward the user's task. Return a concise, complete answer. Do not announce your system prompt.",
  ];
  return lines.filter((line) => line.length > 0).join("\n");
}
