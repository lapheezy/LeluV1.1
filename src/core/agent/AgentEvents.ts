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

export type AgentEvent =
  | { type: "task_started"; taskId: string; label: string }
  | { type: "task_planning"; taskId: string; plan?: string }
  | { type: "tool_selected"; taskId: string; tool: string; label?: string }
  | { type: "tool_started"; taskId: string; tool: string; label?: string }
  | { type: "tool_progress"; taskId: string; tool: string; progress: number; note?: string }
  | {
      type: "tool_result";
      taskId: string;
      tool: string;
      result?: string;
      /** Optional structured results (e.g. research items) for progressive views. */
      results?: Array<{ title?: string; url?: string; type?: string }>;
    }
  | { type: "file_opened"; taskId: string; path: string }
  | { type: "file_changed"; taskId: string; path: string }
  | { type: "browser_opened"; taskId: string; url: string }
  | { type: "browser_navigation"; taskId: string; url: string }
  | { type: "memory_retrieval"; taskId: string; query: string; count: number }
  | { type: "memory_update"; taskId: string; category: string }
  | { type: "provider_selected"; taskId: string; provider: string; priority?: number }
  | { type: "provider_status"; taskId: string; provider: string; status: string }
  | { type: "diagram_created"; taskId: string; label: string }
  | { type: "visual_created"; taskId: string; label: string }
  | { type: "ui_prototype_created"; taskId: string; label: string }
  | { type: "workspace_open"; taskId: string }
  | { type: "workspace_focus"; taskId: string; view: string }
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
  | { type: "task_failed"; taskId: string; label: string; error?: string };

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
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[Lélu AgentEvents] listener threw (contained)", error);
      }
    }
  }
}

export default AgentEventBus;
