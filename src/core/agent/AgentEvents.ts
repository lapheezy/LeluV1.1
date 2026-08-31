/**
 * ==========================================================
 * LÉLU
 * AGENT EVENTS
 *
 * A single, shared event bus carrying REAL agent/tool lifecycle
 * events from the existing execution path to the workspace UI.
 *
 * The events are emitted by the actual code that does the work —
 * the router resolvers (engineering, research, browser, provider,
 * brain) and the AIService task lifecycle — never fabricated for
 * animation. The workspace subscribes here and renders whatever
 * the agent is genuinely doing.
 *
 * Every event carries a `taskId` so the workspace can group the
 * activity of one request into one live view.
 * ==========================================================
 */

export type ExecutionSide = "backend" | "frontend" | "both";

/**
 * Granular execution phase — the canonical "what is LÉLU doing right
 * now" event. Every meaningful stage of a command (parse, project
 * resolve, memory read, provider connect, fallback, backend task,
 * frontend update, render, validation) is emitted here so chat and
 * workspace render the SAME live stream with real state.
 */
export type ExecutionPhase =
  | "command_received"
  | "command_parsed"
  | "project_resolved"
  | "memory_read_started"
  | "memory_read_completed"
  | "memory_write_started"
  | "memory_write_completed"
  | "provider_connect_started"
  | "provider_connected"
  | "provider_fallback"
  | "provider_failed"
  | "tool_selected"
  | "tool_started"
  | "backend_task_started"
  | "backend_task_progress"
  | "backend_task_completed"
  | "file_read"
  | "file_created"
  | "file_updated"
  | "frontend_update_started"
  | "frontend_update_completed"
  | "media_generated"
  | "render_started"
  | "render_completed"
  | "validation_started"
  | "validation_completed"
  | "retry"
  | "error"
  | "execution_completed";

export type AgentEvent =
  | { type: "task_started"; taskId: string; label: string }
  | { type: "task_planning"; taskId: string; plan?: string }
  | {
      type: "execution_phase";
      taskId: string;
      phase: ExecutionPhase;
      label: string;
      side?: ExecutionSide;
      detail?: string;
    }
  | { type: "tool_selected"; taskId: string; tool: string; label?: string }
  | { type: "tool_started"; taskId: string; tool: string; label?: string }
  | { type: "tool_progress"; taskId: string; tool: string; progress: number; note?: string }
  | {
      type: "tool_result";
      taskId: string;
      tool: string;
      result?: string;
      /** Structured results rendered by the live execution surface. */
      results?: AgentResultItem[];
      query?: string;
      provider?: string;
      status?: "complete" | "blocked" | "error";
    }
  | { type: "tool_failed"; taskId: string; tool: string; error?: string }
  /**
   * Agent lifecycle. Emitted by AgentRunner — the ONE entry point every
   * agent run passes through — so an agent started from the Agents panel
   * is as visible as one delegated from chat. `taskId` is the parent
   * cognitive turn when the run happens inside one, so the trace can
   * attribute the work to that turn; a standalone run carries its own.
   */
  | { type: "agent_started"; taskId: string; agent: string; objective: string }
  | {
      type: "agent_completed";
      taskId: string;
      agent: string;
      objective: string;
      provider?: string;
      durationMs?: number;
      resultPreview?: string;
    }
  | { type: "agent_failed"; taskId: string; agent: string; objective: string; error?: string }
  | { type: "file_opened"; taskId: string; path: string }
  | { type: "file_changed"; taskId: string; path: string }
  | { type: "browser_opened"; taskId: string; url: string }
  | { type: "browser_navigation"; taskId: string; url: string }
  | {
      type: "browser_result";
      taskId: string;
      url: string;
      title?: string;
      excerpt?: string;
      status: "read" | "blocked" | "error";
      error?: string;
    }
  | { type: "memory_retrieval"; taskId: string; query: string; count: number }
  | { type: "memory_update"; taskId: string; category: string }
  | { type: "provider_selected"; taskId: string; provider: string; priority?: number }
  | { type: "provider_status"; taskId: string; provider: string; status: string }
  | { type: "diagram_created"; taskId: string; label: string }
  | { type: "visual_created"; taskId: string; label: string }
  | { type: "ui_prototype_created"; taskId: string; label: string }
  | {
      type: "creative_artifact";
      taskId: string;
      /** Data URL of the real produced image (render snapshot). */
      image: string;
      label: string;
    }
  | { type: "workspace_open"; taskId: string }
  | { type: "workspace_focus"; taskId: string; view: string }
  | {
      type: "spatial_event";
      taskId: string;
      op: string;
      label: string;
      side?: ExecutionSide;
      layer?: string;
    }
  | {
      type: "core_transform";
      taskId: string;
      /** Morphology target (one of MORPH_ORDER) or null to release the lab request and resume auto evolution. */
      morphology: string | null;
      /** Optional internal system mode (heartbeat | matrix | nerve | neuron | core). */
      system?: string;
    }
  | { type: "workspace_minimize"; taskId: string }
  | { type: "task_completed"; taskId: string; label: string }
  | { type: "task_failed"; taskId: string; label: string; error?: string }
  | { type: "cognitive_sync"; taskId: string; source: string; detail?: string }
  | {
      type: "visual_state_changed";
      taskId: string;
      state: "conversation" | "research" | "browser" | "analysis" | "engineering" | "testing" | "earth";
      reason: string;
    }
  | {
      type: "approval_requested";
      taskId: string;
      approvalId: string;
      title: string;
      detail: string;
      systemsAffected?: string[];
    }
  | {
      type: "approval_resolved";
      taskId: string;
      approvalId: string;
      decision: "approved" | "rejected" | "modified";
    };

export interface AgentResultItem {
  title?: string;
  url?: string;
  type?: string;
  content?: string;
  source?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export type AgentEventListener = (event: AgentEvent) => void;

/**
 * Lightweight publish/subscribe singleton. Imported directly by the
 * resolver chain (same pattern as AIService.getInstance() and the
 * VoiceEngine singleton) so events can be emitted without threading
 * a bus through every constructor.
 */
class AgentEventBus {
  private static instance: AgentEventBus | null = null;

  private readonly listeners = new Set<AgentEventListener>();
  /** Bounded ring of recent events — cognition reads this for situational awareness. */
  private readonly history: AgentEvent[] = [];
  private static readonly HISTORY_LIMIT = 60;

  private constructor() {}

  public static getInstance(): AgentEventBus {
    if (!AgentEventBus.instance) {
      AgentEventBus.instance = new AgentEventBus();
    }
    return AgentEventBus.instance;
  }

  public subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Emit one agent event. Listener exceptions are contained — a
   * UI listener throwing must never break the agent execution path.
   */
  public emit(event: AgentEvent): void {
    this.history.push(event);
    if (this.history.length > AgentEventBus.HISTORY_LIMIT) {
      this.history.splice(0, this.history.length - AgentEventBus.HISTORY_LIMIT);
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[Lélu AgentEvents] listener threw (contained)", error);
      }
    }
  }

  /** The most recent `count` real events, oldest first. */
  public recent(count: number): AgentEvent[] {
    return this.history.slice(-Math.max(0, count));
  }
}

export default AgentEventBus;
