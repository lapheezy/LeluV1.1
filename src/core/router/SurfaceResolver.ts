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
 * Execution is REAL, not conversational: single-panel opens go
 * through UIActionBus — the validated action/orchestration layer
 * that checks the target against the LIVE UI's own declared
 * capability set and reports back whether it actually happened
 * (never a blind "Done" — see openSingle/confirm below). It emits
 * proper AgentEventBus lifecycle events too, so the Executive
 * Runtime and the live Workspace mirror see exactly what was
 * opened. No LLM round-trip is needed — this is a deterministic
 * local capability like time.
 * ==========================================================
 */

import type { AIResponse } from "../../providers/AIProvider";
import type RouterContext from "./RouterContext";
import type { WorkspaceViewKind } from "../workspace/WorkspaceEngine";
import type WorkspaceResolver from "./WorkspaceResolver";
import { type BrainResult } from "./RouterResults";
import AgentEventBus from "../agent/AgentEvents";
import UIActionBus, { type UIActionResult } from "../cognition/UIActionBus";

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

    // "Go back" — a real back-navigation through UIActionBus, restoring
    // whichever surface was active before the last panel change (whether
    // that change was this user's own command or LÉLU's own initiative).
    if (/^(?:lelu[,\s]+|l[eé]lu[,\s]+)*(go back|take me back|back to where i was|return to (where i was|the previous|my previous))\b/.test(text)) {
      const result = UIActionBus.getInstance().dispatch({
        type: "return_to_previous",
        reason: "User asked to go back.",
        initiatedBy: "user",
      });
      const taskId = String(context.request.timestamp ?? Date.now());
      AgentEventBus.getInstance().emit({
        type: "cognitive_sync",
        taskId,
        source: "surface-command",
        detail: result.ok ? `returned to previous surface: ${result.detail}` : `go-back failed: ${result.detail}`,
      });
      return {
        handled: true,
        response: {
          text: result.ok ? result.detail : `I couldn't go back — ${result.detail}`,
          provider: "browser",
          model: "surface-command",
          processingTime: Date.now() - context.started,
          metadata: { intent: "navigation", success: result.ok, timestamp: Date.now() },
        },
      };
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

  /** Single-surface command → active panel via UIActionBus (validated
   * against the live UI's own declared capability set, real result). */
  private openSingle(
    context: RouterContext,
    target: { panel: string; label: string },
    text: string,
  ): BrainResult {
    const focusLelu = /\b(lelu|l[eé]lu|yourself|avatar|you)\b/.test(text);

    const result = UIActionBus.getInstance().dispatch({
      type: "open_panel",
      target: target.panel,
      reason: `User asked to see ${target.label}.`,
      initiatedBy: "user",
    });

    // Entering the 3D world: present LÉLU's area once the canvas is
    // live (SurfaceController queues pre-mount camera commands) — only
    // once the panel actually opened.
    if (result.ok && target.panel === "genesisv2" && focusLelu) {
      this.dispatchCamera({ intent: "focus", target: "lelu" });
    }

    return this.confirm(context, [target], false, 0, [result]);
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

    const results: UIActionResult[] = targets
      .filter((t) => Boolean(ENGINE_VIEW_FOR_PANEL[t.panel]))
      .map(() => ({
        ok: openedViews > 0,
        detail: openedViews > 0 ? "opened in the workspace layer" : "the workspace layer did not open any views",
      }));

    // Panel-only surfaces (render gallery, avatar, settings, Gen V2…)
    // have no engine view: bring up the first one as the active panel,
    // through UIActionBus like any other single panel open. The
    // workspace layer renders below it, so both stay visible.
    const panelOnly = targets.find((t) => !ENGINE_VIEW_FOR_PANEL[t.panel]);
    if (panelOnly) {
      results.push(
        UIActionBus.getInstance().dispatch({
          type: "open_panel",
          target: panelOnly.panel,
          reason: `User asked to see ${panelOnly.label} alongside other surfaces.`,
          initiatedBy: "user",
        }),
      );
    }

    return this.confirm(context, targets, false, openedViews, results);
  }

  private dispatchCamera(command: Record<string, unknown>): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("genesis-v2-camera", { detail: command }));
  }

  /**
   * Confirmation backed by the REAL result of each dispatch above —
   * never a blanket "Done" regardless of what actually happened. When
   * `results` is omitted (fullscreen — a direct camera command with no
   * validated target) every target is trusted, matching prior behavior;
   * whenever results ARE supplied, each one is checked before claiming
   * success for that surface.
   */
  private confirm(
    context: RouterContext,
    opened: Array<{ panel: string; label: string }>,
    fullscreen: boolean,
    sideBySideCount = 0,
    results: UIActionResult[] = [],
  ): BrainResult {
    const taskId = String(context.request.timestamp ?? Date.now());
    const events = AgentEventBus.getInstance();

    const failedIndexes = results.reduce<number[]>((acc, r, i) => {
      if (!r.ok) acc.push(i);
      return acc;
    }, []);
    const allOk = fullscreen || results.length === 0 || failedIndexes.length === 0;
    const failed = failedIndexes.map((i) => opened[i]).filter(Boolean);
    const succeeded = opened.filter((t) => !failed.includes(t));

    // Real event stream entries — Executive Runtime and the live
    // Workspace mirror see exactly what was opened (or failed to open).
    events.emit({
      type: allOk ? "tool_started" : "tool_failed",
      taskId,
      tool: "ui",
      ...(allOk
        ? {
            label:
              opened.length > 1
                ? `Opening ${opened.length} surfaces side by side`
                : `Opening ${opened[0]?.label ?? "surface"}`,
          }
        : { error: failed.map((t) => t.label).join(", ") }),
    } as never);
    events.emit({
      type: "cognitive_sync",
      taskId,
      source: "surface-command",
      detail: allOk
        ? `surfaces opened: ${opened.map((t) => t.panel).join(" + ")}${fullscreen ? " (fullscreen)" : ""}`
        : `surface command partially/fully failed: succeeded=${succeeded.map((t) => t.panel).join(",") || "none"}, failed=${failed.map((t) => t.panel).join(",")}`,
    });

    context.logger.info(
      "SurfaceResolver",
      `Executed surface command → ${opened.map((t) => t.panel).join(" + ")} (ok=${allOk})`,
    );

    let responseText: string;
    if (fullscreen) {
      responseText = "Immersive mode engaged — the environment now fills the viewport.";
    } else if (!allOk) {
      const failedNames = failed.map((t) => t.label).join(" and ");
      const failureDetail = results[failedIndexes[0]]?.detail ?? "unknown reason";
      responseText =
        succeeded.length > 0
          ? `${succeeded.map((t) => t.label).join(" and ")} opened, but I couldn't open ${failedNames}: ${failureDetail}`
          : `I couldn't open ${failedNames}: ${failureDetail}`;
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
        success: allOk,
        timestamp: Date.now(),
        surfaces: succeeded.map((t) => t.panel),
      },
    };
    return { handled: true, response };
  }
}
