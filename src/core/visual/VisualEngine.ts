/**
 * ==========================================================
 * LÉLU
 * VISUAL ENGINE
 *
 * The agent-controlled visual state model — the second visual
 * interface layer. LÉLU (through real agent events) transitions
 * between four modes that share one visual language:
 *
 *   core      — conversational ambient
 *   heartbeat — system pulse reacting to runtime state
 *   matrix    — computational structure (routing, processing chains)
 *   nerve     — flowing signal network (information propagation)
 *   neuron    — organic cognition network (memory associations)
 *
 * Modes are NOT user-selected tabs: the engine maps REAL agent
 * events to modes and signals (memory_retrieval → neuron trace,
 * provider_selected → matrix routing, tool execution → nerve
 * path, speech → heartbeat, task_complete → return toward core).
 * The UI renders engine state; nothing here is decorative — every
 * signal corresponds to a real event that happened.
 *
 * Pure core logic, no DOM/React — fully testable. The React
 * VisualBridge feeds it AgentEvents + AIService runtime flags.
 * ==========================================================
 */

import type { AgentEvent } from "../agent/AgentEvents";

export type VisualMode = "core" | "heartbeat" | "matrix" | "nerve" | "neuron";

export type InterfaceFocus = "genesis" | "visual";

export interface VisualStage {
  id: string;
  label: string;
}

/** The logical information path — shared by matrix/nerve/neuron so mode transitions stay continuous. */
export const COGNITION_STAGES: VisualStage[] = [
  { id: "input", label: "Input" },
  { id: "cognition", label: "Cognition" },
  { id: "memory", label: "Memory" },
  { id: "tool", label: "Tool" },
  { id: "provider", label: "Provider" },
  { id: "result", label: "Result" },
  { id: "response", label: "Response" },
];

export interface VisualSignal {
  id: string;
  mode: VisualMode;
  path: string[];
  label: string;
  createdAt: number;
}

export interface VisualRuntimeState {
  thinking: boolean;
  speaking: boolean;
  listening: boolean;
  toolsActive: number;
  error: boolean;
}

export interface VisualState {
  mode: VisualMode;
  interfaceFocus: InterfaceFocus;
  runtime: VisualRuntimeState;
  signals: VisualSignal[];
  /** Nodes currently lit (real element ids, e.g. provider names, memory layer ids). */
  activeNodes: string[];
  /** Connection ids currently animated (real event provenance). */
  activeConnections: string[];
  /** Elements the agent is focusing (e.g. retrieved memory layers). */
  focusedElements: string[];
  /** Heartbeat rate (beats per minute) derived from runtime state. */
  heartbeatRate: number;
  /** Current task id, when one is running. */
  taskId: string | null;
  /** Real runtime structure used by matrix/nerve/neuron renderers. */
  structure: {
    providers: string[];
    memory: string[];
    tools: string[];
  };
}

type VisualListener = (state: VisualState) => void;

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export default class VisualEngine {
  private static instance: VisualEngine | null = null;

  private state: VisualState = {
    mode: "core",
    interfaceFocus: "genesis",
    runtime: { thinking: false, speaking: false, listening: false, toolsActive: 0, error: false },
    signals: [],
    activeNodes: [],
    activeConnections: [],
    focusedElements: [],
    heartbeatRate: 60,
    taskId: null,
    structure: { providers: [], memory: [], tools: [] },
  };

  private readonly listeners = new Set<VisualListener>();

  private constructor() {}

  public static getInstance(): VisualEngine {
    if (!VisualEngine.instance) {
      VisualEngine.instance = new VisualEngine();
    }
    return VisualEngine.instance;
  }

  public getState(): VisualState {
    return this.state;
  }

  public subscribe(listener: VisualListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        console.error("[Lélu Visual] listener threw (contained)", error);
      }
    }
  }

  /* ------------------------------------------------------------
   * Structured visual API.
   * ---------------------------------------------------------- */

  /** LÉLU selects a visual mode. Smooth UI transition is the renderer's job. */
  public setMode(mode: VisualMode): void {
    if (this.state.mode === mode) {
      return;
    }
    this.state = { ...this.state, mode };
    this.notify();
  }

  /** The Genesis/Visual interface switch. */
  public setInterfaceFocus(focus: InterfaceFocus): void {
    if (this.state.interfaceFocus === focus) {
      return;
    }
    this.state = { ...this.state, interfaceFocus: focus };
    this.notify();
  }

  /** Feed real system structure (provider registry, memory layers, tools). */
  public setStructure(structure: Partial<VisualState["structure"]>): void {
    this.state = {
      ...this.state,
      structure: {
        providers: structure.providers ?? this.state.structure.providers,
        memory: structure.memory ?? this.state.structure.memory,
        tools: structure.tools ?? this.state.structure.tools,
      },
    };
    this.notify();
  }

  public setRuntime(patch: Partial<VisualRuntimeState>): void {
    this.state = {
      ...this.state,
      runtime: { ...this.state.runtime, ...patch },
      heartbeatRate: this.computeHeartbeat({ ...this.state.runtime, ...patch }),
    };
    this.notify();
  }

  /** Emit a signal that travels along a logical path (stage ids). */
  public emitSignal(path: string[], label: string, mode?: VisualMode): VisualSignal {
    const signal: VisualSignal = {
      id: makeId("signal"),
      mode: mode ?? this.state.mode,
      path,
      label,
      createdAt: Date.now(),
    };
    this.state = {
      ...this.state,
      signals: [...this.state.signals, signal].slice(-24),
      mode: mode ?? this.state.mode,
    };
    this.notify();
    return signal;
  }

  /** Highlight elements; optionally enter a mode at the same time. */
  public highlight(elements: string[], mode?: VisualMode): void {
    this.state = {
      ...this.state,
      focusedElements: elements,
      activeNodes: elements,
      mode: mode ?? this.state.mode,
    };
    this.notify();
  }

  /** Activate a connection/path id (drawn animated in the renderer). */
  public activateConnection(connectionIds: string[]): void {
    this.state = {
      ...this.state,
      activeConnections: [...new Set([...this.state.activeConnections, ...connectionIds])].slice(-16),
    };
    this.notify();
  }

  /** tracePath — emit a signal across logical stages and focus the mode for it. */
  public tracePath(path: string[], label: string, mode: VisualMode): void {
    this.setMode(mode);
    this.emitSignal(path, label, mode);
    this.activateConnection(path);
    this.notify();
  }

  /** Return focus to the conversational core. */
  public returnToCore(): void {
    this.state = {
      ...this.state,
      mode: "core",
      signals: [],
      activeNodes: [],
      activeConnections: [],
      focusedElements: [],
      taskId: null,
    };
    this.notify();
  }

  /* ------------------------------------------------------------
   * Real-event ingestion — the agent decides which mode fits what
   * it is actually doing.
   * ---------------------------------------------------------- */

  public ingest(event: AgentEvent): void {
    switch (event.type) {
      case "task_started":
        this.state = { ...this.state, taskId: event.taskId };
        this.setMode("heartbeat");
        this.notify();
        break;

      case "task_planning":
        // Complex orchestration → computational structure.
        this.tracePath(["input", "cognition"], event.plan ? `Planning · ${event.plan.slice(0, 48)}` : "Planning", "matrix");
        break;

      case "memory_retrieval": {
        // Memory retrieval → organic cognition network, retrieval signal
        // travels memory → cognition → response, and the found layers light up.
        const layers = ["core-identity", "user", "relational", "long-term", "short-term", "working"];
        this.setMode("neuron");
        this.highlight(layers.slice(0, Math.max(1, Math.min(6, event.count))), "neuron");
        this.emitSignal(["memory", "cognition", "response"], `Memory retrieval · ${event.count} pattern(s)`, "neuron");
        this.activateConnection(["memory", "cognition"]);
        this.notify();
        break;
      }

      case "memory_update":
        this.setMode("neuron");
        this.highlight([event.category], "neuron");
        this.emitSignal(["cognition", "memory"], `Memory updated · ${event.category}`, "neuron");
        this.notify();
        break;

      case "provider_selected":
        // Provider routing → matrix, the chosen provider lights up.
        this.setMode("matrix");
        this.highlight([event.provider], "matrix");
        this.emitSignal(
          ["provider", "result"],
          `Routing · ${event.provider}${event.priority ? ` (#${event.priority})` : ""}`,
          "matrix",
        );
        this.notify();
        break;

      case "provider_status":
        this.setMode("matrix");
        this.highlight([event.provider], "matrix");
        this.emitSignal(["provider"], `${event.provider} · ${event.status}`, "matrix");
        this.notify();
        break;

      case "tool_selected":
      case "tool_started":
        // Tool execution → signal path through the tool stage.
        this.setMode("nerve");
        this.activateConnection(["cognition", "tool"]);
        this.emitSignal(["cognition", "tool"], `${event.tool}${event.label ? ` · ${event.label}` : ""}`, "nerve");
        this.setRuntime({ toolsActive: this.state.runtime.toolsActive + 1 });
        this.notify();
        break;

      case "tool_result":
        this.emitSignal(["tool", "result"], `${event.tool} result`, "nerve");
        this.setRuntime({ toolsActive: Math.max(0, this.state.runtime.toolsActive - 1) });
        this.notify();
        break;

      case "browser_opened":
      case "browser_navigation":
        this.setMode("matrix");
        this.emitSignal(["input", "tool", "result"], `Browser · ${event.url}`, "matrix");
        this.notify();
        break;

      case "task_completed":
        // The environment resolves back toward the conversational core.
        this.setMode("heartbeat");
        this.emitSignal(["result", "response"], "Task complete", "heartbeat");
        this.notify();
        break;

      case "task_failed":
        this.setRuntime({ error: true });
        this.setMode("heartbeat");
        this.emitSignal(["result"], `Task failed${event.error ? ` · ${event.error.slice(0, 60)}` : ""}`, "heartbeat");
        this.notify();
        break;

      default:
        break;
    }
  }

  /* ------------------------------------------------------------
   * Heartbeat — a system pulse, not a fake medical signal.
   * ---------------------------------------------------------- */

  private computeHeartbeat(runtime: VisualRuntimeState): number {
    if (runtime.error) {
      return 42;
    }
    if (runtime.toolsActive > 0) {
      return Math.min(150, 96 + runtime.toolsActive * 14);
    }
    if (runtime.speaking) {
      return 104;
    }
    if (runtime.thinking) {
      return 88;
    }
    if (runtime.listening) {
      return 72;
    }
    return 60;
  }

  /** Reset (used by tests). */
  public reset(): void {
    this.state = {
      mode: "core",
      interfaceFocus: "genesis",
      runtime: { thinking: false, speaking: false, listening: false, toolsActive: 0, error: false },
      signals: [],
      activeNodes: [],
      activeConnections: [],
      focusedElements: [],
      heartbeatRate: 60,
      taskId: null,
      structure: { providers: [], memory: [], tools: [] },
    };
    this.notify();
  }
}
