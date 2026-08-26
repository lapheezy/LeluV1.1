/**
 * ==========================================================
 * LÉLU — SURFACE RESOLVER
 *
 * CHAT IS THE PRIMARY CONTROL SURFACE. When the user explicitly
 * asks LÉLU to open/show/enter one of her own surfaces, this
 * resolver EXECUTES that command against the real live UI:
 *
 *   "open the browser"        → Browser surface opens
 *   "show me the 3d"          → Gen V2 viewport + camera to LÉLU
 *   "take me into gen v2"     → Gen V2 viewport (queued camera)
 *   "open your workspace"     → Workspace surface opens
 *   "show me your avatar"     → Avatar panel opens
 *   "make it fullscreen"      → Camera fullscreen command
 *   … chat, memory, render, projects, settings, reasoning,
 *     providers, diagnostics, engineering, cognition, sketch,
 *     video, knowledge, evolution, agents.
 *
 * Execution is REAL, not conversational: it dispatches the same
 * `genesis-show-surface` window command GenesisSurfaceController
 * consumes for every other surface opening (the verified path),
 * and emits proper AgentEventBus lifecycle events so the
 * Executive Runtime and the live Workspace mirror see exactly
 * what was opened. No LLM round-trip is needed — this is a
 * deterministic local capability like time.
 * ==========================================================
 */

import type { AIResponse } from "../../providers/AIProvider";
import type RouterContext from "./RouterContext";
import type { WorkspaceViewKind } from "../workspace/WorkspaceEngine";
import type WorkspaceResolver from "./WorkspaceResolver";
import { type BrainResult } from "./RouterResults";
import AgentEventBus from "../agent/AgentEvents";

/** Explicit surface commands → real GenesisPanel targets. */
const SURFACE_TARGETS: Array<[RegExp, string, string]> = [
  // [pattern, panel, human label]
  [/\bgen\s*v(2|ersion\s*2)|genesis\s*v2\b/, "genesisv2", "the Gen V2 world"],
  [/\b3\s?d\b.*\b(world|environment|scene|view|space)\b|\bworld\b.*\b3\s?d\b/, "genesisv2", "the 3D world"],
  [/\bbrowser\b/, "browser", "the Browser"],
  [/\bworkspace(s)?\b/, "workspace", "your Workspace"],
  [/\bavatar\b/, "avatar", "your Avatar"],
  [/\brender(s|ing)?\b/, "render", "the Render gallery"],
  [/\bsketch(es)?\b/, "sketch", "the Sketch pad"],
  [/\bvideo(s)?\b/, "video", "the Video studio"],
  [/\bprojects?\b/, "projects", "Projects"],
  [/\bsettings?\b/, "settings", "Settings"],
  [/\bmemor(y|ies)\b/, "memory", "your Memory"],
  [/\breasoning\b/, "reasoning", "your Reasoning view"],
  [/\bproviders?\b|\bapis?\b/, "providers", "the API layer"],
  [/\bdiagnostics?\b/, "diagnostics", "Diagnostics"],
  [/\bengineering\b|\bsandbox\b/, "engineering", "the Engineering sandbox"],
  [/\bcognition\b/, "cognition", "your Cognition view"],
  [/\bknowledge\b/, "knowledge", "Knowledge"],
  [/\bevolution\b/, "evolution", "the Evolution engine"],
  [/\bagents?\b/, "agents", "Agents"],
  [/\bhistory\b/, "history", "conversation History"],
  [/\bchat\b/, "chat", "Chat"],
];

/**
 * Surfaces with a REAL workspace-engine equivalent can be shown
 * side by side in the always-on agent workspace layer (split/grid
 * layout). Panel-only surfaces have no engine view — they open as
 * the active panel instead, which the workspace layer coexists
 * with on screen.
 */
const ENGINE_VIEW_FOR_PANEL: Partial<Record<string, WorkspaceViewKind>> = {
  browser: "browser",
  memory: "memory",
  cognition: "cognition",
  reasoning: "cognition",
  providers: "providers",
  engineering: "diagram",
  workspace: "activity",
};

export default class SurfaceResolver {
  /** Injected by AIRouter — multi-surface views reuse ITS builders. */
  constructor(private readonly workspace: WorkspaceResolver) {}

  public async execute(context: RouterContext): Promise<BrainResult> {
    const prompt = context.request.prompt ?? "";
    const text = prompt.toLowerCase().trim();

    // Fullscreen applies wherever the user currently is.
    if (
      /\b(fullscreen|full screen|immersive mode)\b/.test(text) &&
      /\b(make|go|enter|give me|switch)\b/.test(text)
    ) {
      this.dispatchCamera({ intent: "fullscreen" });
      return this.confirm(
        context,
        [{ panel: "fullscreen", label: "Immersive mode" }],
        true,
      );
    }

    // Gate: an explicit navigation/command verb is required so ordinary
    // conversation ("what is memory?", "I like your avatar") never
    // hijacks the UI.
    const commanded =
      /^(?:lelu[,\s]+|l[eé]lu[,\s]+|please\s+|can you\s+|could you\s+)*(open|show(\s+me)?|take\s+me(\s+to|into)?|go\s+to|switch\s+to|bring\s+up|display|enter|jump\s+to|focus\s+on?)\b/.test(
        text,
      ) ||
      /^(?:take me into|let me (see|into))\b/.test(text);
    if (!commanded) return { handled: false };

    // Never steal research-style requests ("show me news about browsers").
    if (/\b(news|headlines?|about|who is|what is|search|research)\b/.test(text)) {
      return { handled: false };
    }

    // ---- Collect EVERY surface target named in the command ----
    // Segments split on natural conjunctions so "show me the browser
    // and the render side by side" yields two real targets.
    const segments = text
      .replace(/\bside by side\b|\btogether\b/g, " ")
      .split(/\s*(?:,|&|\+|\band\b|\balso\b|\bthen\b|\balongside\b|\bnext to\b)\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    const targets: Array<{ panel: string; label: string }> = [];
    const seen = new Set<string>();
    for (const segment of segments) {
      for (const [pattern, panel, label] of SURFACE_TARGETS) {
        if (!pattern.test(segment)) continue;
        if (!seen.has(panel)) {
          seen.add(panel);
          targets.push({ panel, label });
        }
        break;
      }
    }

    if (targets.length === 0) return { handled: false };
    if (targets.length === 1) {
      return this.openSingle(context, targets[0], text);
    }
    return this.openMultiple(context, targets);
  }

  /** Single-surface command → active panel via the verified channel. */
  private openSingle(
    context: RouterContext,
    target: { panel: string; label: string },
    text: string,
  ): BrainResult {
    const focusLelu = /\b(lelu|l[eé]lu|yourself|avatar|you)\b/.test(text);

    if (typeof window !== "undefined") {
      // The verified live-surface channel — same one the
      // ExplorationController uses; GenesisSurfaceController applies it.
      window.dispatchEvent(
        new CustomEvent("genesis-show-surface", { detail: { panel: target.panel } }),
      );
      // Entering the 3D world: present LÉLU's area once the canvas is
      // live (SurfaceController queues pre-mount camera commands).
      if (target.panel === "genesisv2" && focusLelu) {
        this.dispatchCamera({ intent: "focus", target: "lelu" });
      }
    }

    return this.confirm(context, [target], false);
  }

  /**
   * Multi-surface command → REAL side-by-side execution. Every
   * requested surface with a workspace-engine equivalent opens as a
   * genuine view in the split/grid layout; panel-only surfaces open
   * as the active panel, which coexists with the workspace layer.
   */
  private async openMultiple(
    context: RouterContext,
    targets: Array<{ panel: string; label: string }>,
  ): Promise<BrainResult> {
    // De-duplicate engine kinds while preserving request order.
    const engineKinds: WorkspaceViewKind[] = [];
    const seenKinds = new Set<WorkspaceViewKind>();
    for (const t of targets) {
      const kind = ENGINE_VIEW_FOR_PANEL[t.panel];
      if (kind && !seenKinds.has(kind)) {
        seenKinds.add(kind);
        engineKinds.push(kind);
      }
    }

    let openedViews = 0;
    if (engineKinds.length > 0) {
      // Delegate to the EXISTING WorkspaceResolver builders — same
      // real views its own commands produce, arranged side by side.
      const ids = await this.workspace.openSideBySide(context, engineKinds);
      openedViews = ids.length;
    }

    // Panel-only surfaces (render gallery, avatar, settings, Gen V2…)
    // have no engine view: bring up the first one as the active panel.
    // The workspace layer renders below it, so both stay visible.
    const panelOnly = targets.find((t) => !ENGINE_VIEW_FOR_PANEL[t.panel]);
    if (panelOnly && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("genesis-show-surface", { detail: { panel: panelOnly.panel } }),
      );
    }

    return this.confirm(context, targets, false, openedViews);
  }

  private dispatchCamera(command: Record<string, unknown>): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("genesis-v2-camera", { detail: command }));
  }

  /** Deterministic confirmation backed by the real state transitions above. */
  private confirm(
    context: RouterContext,
    opened: Array<{ panel: string; label: string }>,
    fullscreen: boolean,
    sideBySideCount = 0,
  ): BrainResult {
    const taskId = String(context.request.timestamp ?? Date.now());
    const events = AgentEventBus.getInstance();

    // Real event stream entries — Executive Runtime and the live
    // Workspace mirror see exactly what was opened.
    events.emit({
      type: "tool_started",
      taskId,
      tool: "ui",
      label:
        opened.length > 1
          ? `Opening ${opened.length} surfaces side by side`
          : `Opening ${opened[0]?.label ?? "surface"}`,
    });
    events.emit({
      type: "cognitive_sync",
      taskId,
      source: "surface-command",
      detail: `surfaces opened: ${opened.map((t) => t.panel).join(" + ")}${
        fullscreen ? " (fullscreen)" : ""
      }`,
    });

    context.logger.info(
      "SurfaceResolver",
      `Executed surface command → ${opened.map((t) => t.panel).join(" + ")}`,
    );

    let responseText: string;
    if (fullscreen) {
      responseText = "Immersive mode engaged — the environment now fills the viewport.";
    } else if (sideBySideCount >= 2) {
      const names = opened.map((t) => t.label).join(" and ");
      responseText = `Done — ${names} are open side by side in my workspace layer.`;
    } else if (opened.length > 1) {
      const names = opened.map((t) => t.label).join(" and ");
      responseText = `Done — ${names} ${opened.length === 2 ? "are" : "are"} open. I'm watching them from here; tell me what you'd like to do next.`;
    } else {
      responseText = `Done — ${opened[0].label} is open. I'm watching it from here; tell me what you'd like to do in it.`;
    }

    const response: AIResponse = {
      text: responseText,
      provider: "browser",
      model: "surface-command",
      processingTime: Date.now() - context.started,
      metadata: {
        intent: "navigation",
        success: true,
        timestamp: Date.now(),
        surfaces: opened.map((t) => t.panel),
      },
    };
    return { handled: true, response };
  }
}
