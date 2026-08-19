/**
 * ==========================================================
 * LÉLU
 * WORKSPACE RESOLVER
 *
 * The agent's controlled workspace tool. Part of the EXISTING
 * router chain (after browser, before the provider stage). When
 * a request is a workspace action ("show me a diagram of your
 * provider architecture", "move the memory system to the right",
 * "two tabs — one with UI engineering and one with TV stats"),
 * this stage drives the WorkspaceEngine through its explicit API
 * (open_view / split_view / focus_view / close_view / minimize_view
 * / update_visual) and then returns unhandled so the provider
 * still answers conversationally — workspace and response run
 * simultaneously.
 *
 * Visuals are built from REAL state (provider registry snapshot,
 * memory pattern counts, cognition state, browser capabilities)
 * — never hard-coded fiction.
 * ==========================================================
 */

import type RouterContext from "./RouterContext";
import type { BrainResult } from "./RouterResults";
import AgentEventBus from "../agent/AgentEvents";
import BrowserTool from "../browser/BrowserTool";
import WorkspaceEngine from "../workspace/WorkspaceEngine";
import VisualEngine from "../visual/VisualEngine";
import type { WorkspaceViewKind } from "../workspace/WorkspaceEngine";
import type { GraphNode, VisualSpec } from "../workspace/VisualSpec";
import {
  activityTimeline,
  browserCapabilities,
  cognitionPipeline,
  engineeringFlow,
  memoryArchitecture,
  providerArchitecture,
  uiWireframe,
} from "../workspace/visualizers";

/* The canonical interface panel list — mirrors the real dock. */
const INTERFACE_PANELS: { id: string; label: string; group: string }[] = [
  { id: "chat", label: "Chat", group: "core" },
  { id: "history", label: "History", group: "core" },
  { id: "workspaces", label: "Workspaces", group: "core" },
  { id: "reasoning", label: "Reasoning", group: "intelligence" },
  { id: "agents", label: "Knowledge", group: "intelligence" },
  { id: "memory", label: "Memory", group: "intelligence" },
  { id: "providers", label: "API Status", group: "system" },
  { id: "diagnostics", label: "Engines", group: "system" },
  { id: "logs", label: "Logs", group: "system" },
  { id: "browser", label: "Browser", group: "system" },
  { id: "workspace", label: "Workspace", group: "system" },
];

export interface WorkspaceCommand {
  action:
    | "open_view"
    | "open_many"
    | "split_view"
    | "stack_view"
    | "focus_view"
    | "close_view"
    | "minimize_view"
    | "maximize_view"
    | "pin_view"
    | "unpin_view"
    | "group_view"
    | "reorder_view"
    | "resize_view"
    | "lock_layout"
    | "unlock_layout"
    | "restore_layout"
    | "close_temporary"
    | "set_visual_mode"
    | "visual_trace"
    | "focus_element"
    | "zoom_view"
    | "expand_view"
    | "follow_view"
    | "return_to_core"
    | "transform_core"
    | "update_visual"
    | "set_interface_focus"
    | "none";
  kind?: WorkspaceViewKind;
  kinds?: WorkspaceViewKind[];
  secondKind?: WorkspaceViewKind;
  visualMode?: "matrix" | "neuron" | "nerve" | "heartbeat" | "core";
  interfaceFocus?: "genesis" | "visual";
  /** Morphology target for transform_core (one of MORPH_ORDER) or null to release the request. */
  morphology?: string | null;
  /** Optional internal system mode for transform_core. */
  system?: string;
  traceKind?: "memory" | "cognition" | "providers" | "engineering" | "response";
  nodeLabel?: string;
  direction?: "left" | "right" | "up" | "down";
  addNode?: string;
  ids?: string[];
}

const VIEW_KINDS: Array<[RegExp, WorkspaceViewKind]> = [
  [/(provider|api)( status| map| architecture| chain| fallback)?/, "providers"],
  [/memor(y|ies|y architecture)/, "memory"],
  [/cognition|cognitive|thinking|reasoning pipeline/, "cognition"],
  [/(engineering|architecture|system) (architecture|map|diagram)|how (you|your) (work|are built|ui)/, "diagram"],
  [/browser|browsing|browse/, "browser"],
  [/(ui (prototype|design|wireframe)|prototype|wireframe|design change|(change|modify|redesign|improve) your (ui|interface))/, "wireframe"],
  [/genesis (core|state|engine)/, "genesis"],
  [/activit(y|ies)|tool execution|what (is|are) you doing/, "activity"],
  [/chart|graph|statistics|stats/, "chart"],
  [/table|data view|list of/, "table"],
  [/timeline/, "timeline"],
];

function detectKind(text: string): WorkspaceViewKind | undefined {
  for (const [pattern, kind] of VIEW_KINDS) {
    if (pattern.test(text)) {
      return kind;
    }
  }
  return undefined;
}

/**
 * Pure command parser — exported so the verification suite can test
 * it without a runtime. Returns the FIRST matching workspace action.
 */
export function parseWorkspaceCommand(input: string): WorkspaceCommand {
  const text = input.toLowerCase().trim();

  // "break that down" / "break it down" → decompose into several views.
  if (/break\s+(that|it|this)\s+down/.test(text) || /decompose\s+this/.test(text)) {
    return {
      action: "open_many",
      kinds: ["diagram", "memory", "providers", "activity"],
    };
  }

  // "show me everything" → expand the workspace, not one giant panel.
  if (/show\s+(me\s+)?everything/.test(text) || /open\s+everything/.test(text)) {
    return {
      action: "open_many",
      kinds: ["providers", "memory", "cognition", "diagram", "browser", "activity"],
    };
  }

  // "lock the layout" / "unlock" / "automatic layout"
  if (/lock\s+(the\s+)?(layout|workspace)/.test(text)) {
    return { action: "lock_layout" };
  }
  if (/unlock|automatic\s+layout|auto\s+layout|return to (the )?auto/.test(text)) {
    return { action: "unlock_layout" };
  }

  // "restore the previous layout"
  if (/restore\s+(the\s+)?(previous\s+)?layout/.test(text)) {
    return { action: "restore_layout" };
  }

  // "clean up" / "close temporary views"
  if (/close\s+(the\s+)?temporary|clean\s+up/.test(text)) {
    return { action: "close_temporary" };
  }

  // Visual modes — LÉLU selects the representation, the user may too.
  if (/matrix|algorithm|computational/.test(text) && /mode|view|show/.test(text)) {
    return { action: "set_visual_mode", visualMode: "matrix" };
  }
  if (/neuron|neural|cognitive (network|mode)/.test(text) && /mode|view|show/.test(text)) {
    return { action: "set_visual_mode", visualMode: "neuron" };
  }
  if (/nerve|signal (mode|network|path)/.test(text) && /mode|view|show/.test(text)) {
    return { action: "set_visual_mode", visualMode: "nerve" };
  }
  if (/heartbeat|pulse/.test(text) && /mode|view|show/.test(text)) {
    return { action: "set_visual_mode", visualMode: "heartbeat" };
  }
  if (/back to (the )?core|core mode|return to (the )?core/.test(text)) {
    return { action: "return_to_core" };
  }

  /*
   * Transform the ONE Core — LÉLU drives the shared Core's morphology
   * ("transform the core to plasma", "morph the core into ocean") and/or
   * its internal system ("make the core run in nerve mode"). The event
   * is consumed by the app layer, which forwards it to the shared
   * EngineBus — the ONE Core morphs, nothing is recreated.
   */
  {
    const MORPH_WORDS: Array<[RegExp, string]> = [
      [/hazard/, "HAZARD"],
      [/aurora/, "AURORA"],
      [/ocean/, "OCEAN"],
      [/plasma/, "PLASMA"],
      [/electric/, "ELECTRIC"],
      [/biohazard/, "BIOHAZARD"],
      [/hybrid/, "HYBRID"],
    ];
    const SYSTEM_WORDS: Array<[RegExp, string]> = [
      [/heartbeat/, "heartbeat"],
      [/matrix/, "matrix"],
      [/nerve/, "nerve"],
      [/neuron/, "neuron"],
      [/core/, "core"],
    ];
    const transformMatch = text.match(
      /(transform|morph|convert|turn|shift|evolve)\s+(the\s+)?(genesis\s+)?core\s+(to|into|toward|towards)\s+([a-z0-9 _-]+)/,
    );
    if (transformMatch) {
      const target = transformMatch[5].toLowerCase();
      const morph = MORPH_WORDS.find(([pattern]) => pattern.test(target))?.[1];
      const system = SYSTEM_WORDS.find(([pattern]) => pattern.test(target))?.[1];
      if (morph || system) {
        return { action: "transform_core", morphology: morph ?? null, system };
      }
    }
    // "let the core evolve" / "release the transformation" → release the
    // lab request so the automatic evolution cycle resumes, untouched.
    if (
      /let\s+(the\s+)?core\s+(evolve|breathe|cycle|be)|release\s+(the\s+)?(morph|transformation|request|core)|stop\s+(the\s+)?(morph|transformation|holding)/.test(
        text,
      )
    ) {
      return { action: "transform_core", morphology: null };
    }
  }

  // Interface environments — LÉLU switches between the primary Genesis
  // environment and the Living System environment when the task benefits.
  if (
    /(switch|go|move|change|enter|open|activate|transition).*(living system|system interface|system ui|matrix environment|visual environment)|(living system|system interface|system ui).*(mode|interface|environment|view)/.test(
      text,
    )
  ) {
    return { action: "set_interface_focus", interfaceFocus: "visual" };
  }
  if (
    /(switch|go|move|change|back|return).*(primary|genesis|main) (environment|interface|ui)|(primary|genesis) (environment|interface|ui)/.test(
      text,
    )
  ) {
    return { action: "set_interface_focus", interfaceFocus: "genesis" };
  }

  // "show me how memory gets retrieved" / "how cognition works" → the
  // agent traces the actual operation through the visual system.
  if (/how (is|does|memory|information).*(retriev|work|flow)|show me how (memory|cognition|providers|engineering)/.test(text)) {
    if (/providers?/.test(text)) {
      return { action: "visual_trace", traceKind: "providers" };
    }
    if (/cognition|thinking/.test(text)) {
      return { action: "visual_trace", traceKind: "cognition" };
    }
    if (/engineer/.test(text)) {
      return { action: "visual_trace", traceKind: "engineering" };
    }
    if (/response|answer/.test(text)) {
      return { action: "visual_trace", traceKind: "response" };
    }
    return { action: "visual_trace", traceKind: "memory" };
  }

  // "focus on the X node" / "focus the memory node"
  const focusNode = text.match(/focus\s+(on\s+)?(the\s+)?([a-z0-9 _-]+?)\s+(node|element)/);
  if (focusNode) {
    return { action: "focus_element", nodeLabel: focusNode[3].trim() };
  }

  // zoom / expand / follow on the focused view
  if (/zoom\s+(in|out)/.test(text)) {
    return { action: "zoom_view", direction: /zoom\s+in/.test(text) ? "up" : "down" };
  }
  if (/expand\s+(the\s+)?(view|panel|diagram)/.test(text)) {
    return { action: "expand_view" };
  }
  if (/follow\s+(the\s+)?(view|agent|work)/.test(text)) {
    return { action: "follow_view" };
  }

  // Split: "two tabs/views — one with X and another with Y"
  if (/two (tabs|views|panels)/.test(text) && /and another|one with/.test(text)) {
    const secondPart = text.split(/and another/)[1] ?? "";
    const firstPart = text.split(/and another/)[0] ?? text;
    const first = detectKind(firstPart);
    const second = detectKind(secondPart);
    if (first && second) {
      return { action: "split_view", kind: first, secondKind: second };
    }
    if (first || second) {
      return { action: "split_view", kind: (first ?? second) as WorkspaceViewKind };
    }
  }

  // Multi-open: "show me the providers, the architecture, the browser
  // results, and the statistics" → one view per mentioned kind. The
  // request-level verb gates it ("show me …"), then every comma/and
  // segment becomes a target.
  {
    const wantsMulti = /(show|open|display|render|give me|let me see)\b/.test(text);
    const separators = (text.match(/,/g)?.length ?? 0) >= 1 || /\band\b/.test(text);
    if (wantsMulti && separators) {
      const segments = text
        .split(/,|\band\b|\bplus\b/)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
      const kinds = segments
        .map((segment) => detectKind(segment))
        .filter((kind): kind is WorkspaceViewKind => Boolean(kind));
      if (kinds.length >= 2) {
        return { action: "open_many", kinds };
      }
    }
  }

  // "focus on the chart" → focus the existing view.
  const focus = text.match(/focus\s+(on\s+|the\s+)?(the\s+)?([a-z0-9 _-]+)/);
  if (focus && /focus/.test(text)) {
    const kind = detectKind(focus[3] ?? text);
    if (kind) {
      return { action: "focus_view", kind };
    }
  }

  // "maximize X" / "make X bigger" / "make X smaller"
  const maximize = text.match(/maximi[sz]e\s+(the\s+)?([a-z0-9 _-]+)/);
  if (maximize) {
    const kind = detectKind(maximize[2]);
    if (kind) {
      return { action: "maximize_view", kind };
    }
  }
  const bigger = text.match(/make\s+(the\s+)?([a-z0-9 _-]+?)\s+(bigger|larger|smaller)/);
  if (bigger) {
    const kind = detectKind(bigger[2]);
    if (kind) {
      return {
        action: "resize_view",
        kind,
        direction: bigger[3].includes("smaller") ? "down" : "up",
      };
    }
  }

  // "pin X" / "unpin X"
  const pin = text.match(/(un)?pin\s+(the\s+)?([a-z0-9 _-]+)/);
  if (pin) {
    const kind = detectKind(pin[3]);
    if (kind) {
      return { action: pin[1] ? "unpin_view" : "pin_view", kind };
    }
  }

  // "stack X and Y"
  if (/stack\s+(the\s+)?(views|them)|stack\s+[a-z]+\s+and\s+[a-z]+/.test(text)) {
    const kinds = [detectKind(text), detectKind(text.split(/and/)[1] ?? "")].filter(
      (kind): kind is WorkspaceViewKind => Boolean(kind),
    );
    if (kinds.length > 0) {
      return { action: "stack_view", kinds };
    }
  }

  // "group X and Y"
  if (/group\s+[a-z]+\s+and\s+[a-z]+/.test(text)) {
    const kinds = [detectKind(text), detectKind(text.split(/and/)[1] ?? "")].filter(
      (kind): kind is WorkspaceViewKind => Boolean(kind),
    );
    if (kinds.length > 0) {
      return { action: "group_view", kinds };
    }
  }

  // Update visual: "move X to the right" / "add Y to the diagram"
  const move = text.match(/move\s+(?:the\s+)?([a-z0-9 _-]+?)\s+to\s+the\s+(left|right|up|down)/);
  if (move) {
    return { action: "update_visual", nodeLabel: move[1].trim(), direction: move[2] as WorkspaceCommand["direction"] };
  }

  const add = text.match(/add\s+(?:the\s+)?([a-z0-9 _-]+?)\s+to\s+the\s+(diagram|map|architecture|view)/);
  if (add) {
    return { action: "update_visual", addNode: add[1].trim() };
  }

  // Close / minimize / focus existing views
  if (/close\s+(the\s+)?[a-z]+\s+(view|tab|panel)/.test(text) || /close\s+(the\s+)?workspace/.test(text)) {
    return { action: "close_view", kind: detectKind(text) };
  }
  if (/minimi[sz]e\s+(the\s+)?(workspace|[a-z]+ (view|tab|panel))/.test(text)) {
    return { action: "minimize_view", kind: detectKind(text) };
  }
  if (/focus\s+(the\s+)?[a-z]+\s+(view|tab|panel)/.test(text)) {
    return { action: "focus_view", kind: detectKind(text) };
  }

  // Open a specific view
  const kind = detectKind(text);
  if (kind && /(show|open|display|render|build|create|diagram|visuali[sz]e|give me|let me see)/.test(text)) {
    return { action: "open_view", kind };
  }

  return { action: "none" };
}

export default class WorkspaceResolver {
  public async execute(context: RouterContext): Promise<BrainResult> {
    const prompt = context.request.prompt;
    const command = parseWorkspaceCommand(prompt);

    if (command.action === "none") {
      return { handled: false };
    }

    const engine = WorkspaceEngine.getInstance();
    const events = AgentEventBus.getInstance();
    const taskId = String(context.request.timestamp ?? Date.now());

    switch (command.action) {
      case "open_view": {
        const kind = command.kind ?? "activity";
        const view = await this.buildView(context, kind);
        if (view) {
          engine.openView(view);
          events.emit({
            type: kind === "diagram" ? "diagram_created" : kind === "wireframe" ? "ui_prototype_created" : "visual_created",
            taskId,
            label: view.title,
          });
        }
        break;
      }
      case "open_many": {
        // One view per requested kind — each opens as soon as its data
        // is ready; the layout engine arranges them together.
        const kinds = command.kinds?.slice(0, 8) ?? ["activity"];
        const ids: string[] = [];
        for (const kind of kinds) {
          const view = await this.buildView(context, kind);
          if (view) {
            engine.openView(view);
            const focused = engine.getState().focusId;
            if (focused && !ids.includes(focused)) {
              ids.push(focused);
            }
          }
        }
        if (ids.length > 1) {
          engine.setLayout("grid");
        }
        events.emit({ type: "workspace_focus", taskId, view: kinds.join(" + ") });
        break;
      }
      case "split_view": {
        const first = await this.buildView(context, command.kind ?? "activity");
        const second = await this.buildView(context, command.secondKind ?? "providers");
        const ids: string[] = [];
        if (first) {
          engine.openView(first);
          const focused = engine.getState().focusId;
          if (focused) {
            ids.push(focused);
          }
        }
        if (second) {
          engine.openView(second);
          const focused = engine.getState().focusId;
          if (focused && !ids.includes(focused)) {
            ids.push(focused);
          }
        }
        if (ids.length > 0) {
          engine.splitView(ids);
        }
        events.emit({ type: "workspace_focus", taskId, view: `${command.kind ?? "?"} + ${command.secondKind ?? "?"}` });
        break;
      }
      case "stack_view": {
        const targets = (command.kinds ?? [])
          .map((kind) => this.findViewByKind(engine, kind))
          .filter((view): view is NonNullable<typeof view> => Boolean(view));
        if (targets.length === 0) {
          const active = engine.getState().views.filter((view) => !view.minimized);
          targets.push(...active.slice(-3));
        }
        engine.stackView(targets.map((view) => view.id));
        break;
      }
      case "focus_view": {
        const target = this.findViewByKind(engine, command.kind);
        if (target) {
          engine.focusView(target.id);
        }
        break;
      }
      case "close_view": {
        const target = this.findViewByKind(engine, command.kind);
        if (target) {
          engine.closeView(target.id);
        }
        break;
      }
      case "minimize_view": {
        if (!command.kind) {
          engine.minimizeAll();
          break;
        }
        const target = this.findViewByKind(engine, command.kind);
        if (target) {
          engine.minimizeView(target.id);
        }
        break;
      }
      case "maximize_view": {
        const target = this.findViewByKind(engine, command.kind);
        if (target) {
          engine.maximizeView(target.id);
        }
        break;
      }
      case "resize_view": {
        const target = this.findViewByKind(engine, command.kind);
        if (target) {
          const delta = command.direction === "down" ? -1 : 1;
          engine.resizeView(target.id, target.weight + delta);
        }
        break;
      }
      case "pin_view": {
        const target = this.findViewByKind(engine, command.kind);
        if (target) {
          engine.pinView(target.id, true);
        }
        break;
      }
      case "unpin_view": {
        const target = this.findViewByKind(engine, command.kind);
        if (target) {
          engine.pinView(target.id, false);
        }
        break;
      }
      case "group_view": {
        const targets = (command.kinds ?? [])
          .map((kind) => this.findViewByKind(engine, kind))
          .filter((view): view is NonNullable<typeof view> => Boolean(view));
        if (targets.length >= 2) {
          engine.groupViews(targets.map((view) => view.id));
        }
        break;
      }
      case "reorder_view": {
        const ordered = (command.kinds ?? [])
          .map((kind) => this.findViewByKind(engine, kind))
          .filter((view): view is NonNullable<typeof view> => Boolean(view));
        if (ordered.length > 0) {
          engine.reorderViews(ordered.map((view) => view.id));
        }
        break;
      }
      case "lock_layout":
        engine.saveLayout();
        engine.lockLayout(true);
        break;
      case "unlock_layout":
        engine.lockLayout(false);
        break;
      case "restore_layout":
        engine.restoreLayout();
        break;
      case "close_temporary":
        engine.closeTemporary();
        break;
      case "set_visual_mode": {
        const mode = command.visualMode ?? "matrix";
        VisualEngine.getInstance().setMode(mode);
        events.emit({ type: "visual_created", taskId, label: `visual mode · ${mode}` });
        break;
      }
      case "set_interface_focus": {
        // LÉLU switches between the primary environment and the Living
        // System environment — the underlying systems are untouched, only
        // the presentation environment changes (GenesisInterface gates on
        // VisualEngine.interfaceFocus).
        const focus = command.interfaceFocus ?? "visual";
        VisualEngine.getInstance().setInterfaceFocus(focus);
        if (focus === "visual") {
          // Bring the real agent views along so the field isn't empty.
          const state = WorkspaceEngine.getInstance().getState();
          if (state.views.length === 0) {
            this.buildView(context, "providers").then((view) => {
              if (view) {
                WorkspaceEngine.getInstance().openView(view);
              }
            });
          }
        }
        events.emit({
          type: "workspace_focus",
          taskId,
          view: focus === "visual" ? "living-system" : "primary",
        });
        break;
      }
      case "visual_trace": {
        // Open the relevant view, focus + trace its real nodes, and emit
        // a signal along the actual logical path.
        const kind = (command.traceKind ?? "memory") as WorkspaceViewKind;
        const view = await this.buildView(context, kind);
        const visual = VisualEngine.getInstance();
        if (view) {
          engine.openView(view);
          const focused = engine.getState().focusId;
          if (focused) {
            const elementIds = (view.spec?.nodes ?? []).map((node) => node.id);
            engine.focusElements(focused, elementIds);
            engine.tracePath(focused, elementIds);
            engine.expandView(focused, true);
          }
        }
        switch (command.traceKind) {
          case "memory":
            visual.tracePath(["memory", "cognition", "response"], "Memory retrieval path", "neuron");
            break;
          case "cognition":
            visual.tracePath(["input", "cognition", "memory", "response"], "Cognition flow", "nerve");
            break;
          case "providers":
            visual.tracePath(["provider", "result"], "Provider routing", "matrix");
            break;
          case "engineering":
            visual.tracePath(["input", "cognition", "tool", "result"], "Engineering flow", "matrix");
            break;
          default:
            visual.tracePath(["result", "response"], "Response path", "nerve");
        }
        events.emit({ type: "visual_created", taskId, label: `visual trace · ${command.traceKind ?? "memory"}` });
        break;
      }
      case "focus_element": {
        const state = engine.getState();
        const target = state.views.find((view) => view.id === state.focusId) ?? state.views[0];
        if (target?.spec?.nodes && command.nodeLabel) {
          const node = target.spec.nodes.find((item) =>
            item.label.toLowerCase().includes(command.nodeLabel!.toLowerCase()),
          );
          if (node) {
            engine.focusElements(target.id, [node.id]);
          }
        }
        break;
      }
      case "zoom_view": {
        const state = engine.getState();
        const target = state.views.find((view) => view.id === state.focusId) ?? state.views[0];
        if (target) {
          engine.zoomView(target.id, command.direction === "down" ? 0.8 : 1.25);
        }
        break;
      }
      case "expand_view": {
        const state = engine.getState();
        const target = state.views.find((view) => view.id === state.focusId) ?? state.views[0];
        if (target) {
          engine.expandView(target.id, true);
        }
        break;
      }
      case "follow_view": {
        const state = engine.getState();
        const target = state.views.find((view) => view.id === state.focusId) ?? state.views[0];
        if (target) {
          engine.follow(target.id);
        }
        break;
      }
      case "return_to_core": {
        engine.returnToCore();
        engine.setLayout("auto");
        VisualEngine.getInstance().returnToCore();
        events.emit({ type: "workspace_focus", taskId, view: "core" });
        break;
      }
      case "transform_core": {
        // LÉLU drives the ONE Core's transformation. The morphology target
        // is emitted as a typed event and consumed by the app layer, which
        // forwards it to the shared EngineBus (setMorphRequest) — the Core
        // morphs, the cycle keeps advancing, nothing is recreated. The
        // internal system mode is applied directly to the VisualEngine.
        if (command.system) {
          VisualEngine.getInstance().setMode(command.system as Exclude<WorkspaceCommand["visualMode"], undefined>);
        }
        events.emit({
          type: "core_transform",
          taskId,
          morphology: command.morphology ?? null,
          system: command.system,
        });
        events.emit({
          type: "visual_created",
          taskId,
          label: command.morphology
            ? `core transform → ${command.morphology}`
            : "core transform · released to auto evolution",
        });
        break;
      }
      case "update_visual": {
        this.applyVisualEdit(engine, command);
        events.emit({ type: "visual_created", taskId, label: "visual updated" });
        break;
      }
    }

    // The provider still answers conversationally — workspace and
    // response run simultaneously through the same request.
    return { handled: false };
  }

  /** Build a real-state view for a requested kind. */
  private async buildView(
    context: RouterContext,
    kind: WorkspaceViewKind,
  ): Promise<{ kind: WorkspaceViewKind; title: string; spec?: VisualSpec } | null> {
    switch (kind) {
      case "providers": {
        const providers = context.aiProviders.statusSnapshot();
        return { kind: "providers", title: "Provider Architecture", spec: providerArchitecture(providers) };
      }
      case "memory": {
        return { kind: "memory", title: "Memory Architecture", spec: memoryArchitecture(await this.memoryLayers(context)) };
      }
      case "cognition": {
        const state = context.brain.cognitiveState();
        return {
          kind: "cognition",
          title: "Cognition Pipeline",
          spec: cognitionPipeline({
            agents: state.agents.length,
            workspaces: state.workspaces.length,
            nodes: state.nodes.length,
            reasoningActive: Boolean(state.reasoning),
            planActive: Boolean(context.plan),
          }),
        };
      }
      case "diagram":
        return { kind: "diagram", title: "Engineering Architecture", spec: engineeringFlow() };
      case "browser":
        return {
          kind: "browser",
          title: "Browser Capabilities",
          spec: browserCapabilities({
            nativeLaunchAvailable: BrowserTool.nativeLaunchAvailable(),
            inAppLayer: true,
            lastReadStatus: "none",
          }),
        };
      case "wireframe":
      case "design":
        return { kind: "wireframe", title: "UI Design", spec: uiWireframe(INTERFACE_PANELS) };
      case "video":
        return { kind: "video", title: "Video", spec: undefined };
      case "image":
        return { kind: "image", title: "Image", spec: undefined };
      case "genesis":
        return { kind: "genesis", title: "Genesis", spec: undefined };
      case "activity":
        return { kind: "activity", title: "Agent Activity", spec: undefined };
      case "chart":
        return {
          kind: "chart",
          title: "Research Data",
          spec: this.researchTable(context),
        };
      case "table":
        return { kind: "table", title: "Research Data", spec: this.researchTable(context) };
      case "timeline":
        return {
          kind: "timeline",
          title: "Agent Activity",
          spec: this.activitySpec(),
        };
      default:
        return null;
    }
  }

  /** Real memory layers from the brain's stored patterns. */
  private async memoryLayers(context: RouterContext): Promise<Parameters<typeof memoryArchitecture>[0]> {
    const counts = new Map<string, number>();
    try {
      const rows = await context.brain.recallAll();
      for (const row of rows) {
        const category = row.category ?? "general";
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    } catch {
      // Memory may not be initialized yet — render layers without counts.
    }
    const layer = (
      id: string,
      label: string,
      description: string,
      category: string,
    ): { id: string; label: string; description: string; count?: number } => ({
      id,
      label,
      description,
      count: counts.get(category) ?? 0,
    });
    return [
      layer("core-identity", "Core Identity", "Lélu's permanent foundational identity", "identity"),
      layer("user", "User Memory", "Established facts about the user", "preference"),
      layer("relational", "Relational Memory", "Shared experiences and history", "relationship"),
      layer("long-term", "Long-term Memory", "Important retained knowledge", "experience"),
      layer("short-term", "Short-term Memory", "Current conversation context", "conversation"),
      layer("working", "Working Memory", "Information in active use", "general"),
    ];
  }

  /** Research results as a table — real retrieved data, not fiction. */
  private researchTable(context: RouterContext): VisualSpec {
    const results = context.researchResults ?? [];
    if (results.length === 0) {
      return {
        kind: "table",
        title: "Research Data",
        caption: "No research results for this request yet",
        source: "live",
        columns: [
          { key: "title", label: "Title" },
          { key: "source", label: "Source" },
          { key: "url", label: "URL" },
        ],
        rows: [],
      };
    }
    return {
      kind: "table",
      title: "Research Data",
      caption: `${results.length} result(s) from the knowledge providers`,
      source: "live",
      columns: [
        { key: "title", label: "Title" },
        { key: "source", label: "Source" },
        { key: "url", label: "URL" },
      ],
      rows: results.map((result) => ({
        title: result.title,
        source: result.source ?? "unknown",
        url: result.url ?? "—",
      })),
    };
  }

  private activitySpec(): VisualSpec {
    const engine = WorkspaceEngine.getInstance();
    return activityTimeline(engine.getState().events);
  }

  private findViewByKind(
    engine: WorkspaceEngine,
    kind: WorkspaceViewKind | undefined,
  ) {
    if (!kind) {
      return engine.getState().views[engine.getState().views.length - 1];
    }
    const state = engine.getState();
    return (
      state.views.find((view) => view.kind === kind && !view.minimized) ??
      state.views.find((view) => view.kind === kind)
    );
  }

  /** update_visual: edit the focused diagram's model, then re-render. */
  private applyVisualEdit(engine: WorkspaceEngine, command: WorkspaceCommand): void {
    const state = engine.getState();
    const focused = state.views.find((view) => view.id === state.focusId) ?? state.views[0];
    if (!focused?.spec?.nodes) {
      return;
    }

    const nodes: GraphNode[] = focused.spec.nodes.map((node) => ({ ...node }));

    if (command.direction && command.nodeLabel) {
      const target = nodes.find((node) =>
        node.label.toLowerCase().includes(command.nodeLabel!.toLowerCase()),
      );
      if (target) {
        const delta = 25;
        if (command.direction === "left") target.x = Math.max(0, (target.x ?? 50) - delta);
        if (command.direction === "right") target.x = Math.min(100, (target.x ?? 50) + delta);
        if (command.direction === "up") target.y = Math.max(0, (target.y ?? 50) - delta);
        if (command.direction === "down") target.y = Math.min(100, (target.y ?? 50) + delta);
      }
    }

    if (command.addNode) {
      const label = command.addNode;
      const id = `added-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      if (!nodes.some((node) => node.id === id)) {
        nodes.push({ id, label, kind: "added", x: 70, y: 70, color: "#fbbf24" });
        const edges = focused.spec.edges ?? [];
        if (edges.length > 0) {
          focused.spec.edges = [...edges, { from: edges[0].from, to: id, label: "" }];
        }
      }
    }

    engine.updateView(focused.id, { spec: { ...focused.spec, nodes } });
  }
}
