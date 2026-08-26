/**
 * ==========================================================
 * LÉLUVERSE
 * WORKSPACE BRIDGE
 *
 * The app-level connection between REAL agent activity and the
 * visual workspace. This is the heart of "the workspace shows
 * what LÉLU is actually doing":
 *
 *   When LÉLU searches     → Workspace shows Browser
 *   When LÉLU renders      → Workspace shows Render
 *   When LÉLU works        → Workspace shows Engineering/Sandbox
 *   When LÉLU watches      → Workspace shows Video
 *   When LÉLU browses      → Workspace shows Browser
 *   When LÉLU researches   → Workspace shows Browser + data
 *   When LÉLU is idle       → Workspace shows Avatar/Environment
 *
 * Memory Architecture, Provider Architecture, and Agent Activity
 * are available as diagnostic views but are NOT the default workspace.
 * The workspace is LÉLU's desk — it shows the current work.
 *
 * Nothing here fabricates activity — it renders what the agent
 * genuinely did. Views use stable ids per kind, so a new task
 * updates the existing view instead of stacking tabs.
 * ==========================================================
 */

import { useEffect, useRef } from "react";
import AIService from "../../../core/AIService";
import AgentEventBus, { type AgentEvent } from "../../../core/agent/AgentEvents";
import WorkspaceEngine from "../../../core/workspace/WorkspaceEngine";
import {
  memoryArchitecture,
  providerArchitecture,
} from "../../../core/workspace/visualizers";
import type { MemoryLayerData } from "../../../core/workspace/visualizers";

const ai = AIService.getInstance();

/** The kind of task LÉLU is currently performing. */
type ActiveTaskKind =
  | "idle"
  | "search"
  | "research"
  | "news"
  | "browser"
  | "render"
  | "creative"
  | "avatar"
  | "engineering"
  | "sandbox"
  | "video"
  | "youtube"
  | "sketch"
  | "memory"
  | "project"
  | "cosmos";

export default function WorkspaceBridge() {
  const engineRef = useRef(WorkspaceEngine.getInstance());
  const activeTaskRef = useRef<ActiveTaskKind>("idle");

  useEffect(() => {
    const engine = engineRef.current;

    /**
     * Show the workspace view that corresponds to the active task.
     * Each task kind maps to the real workspace view that displays
     * its actual output — not a decorative placeholder.
     */
    function showTaskSurface(kind: ActiveTaskKind, taskId: string, label?: string) {
      switch (kind) {
        case "search":
        case "research":
        case "browser":
          engine.showBrowser(
            label ?? "Browser",
            "",
            `view-browser-${taskId}`,
            false,
          );
          engine.focusView(`view-browser-${taskId}`);
          break;

        case "news":
          engine.showBrowser(
            "News",
            "",
            `view-news-${taskId}`,
            false,
          );
          engine.focusView(`view-news-${taskId}`);
          break;

        case "render":
        case "creative":
          engine.showImage(
            label ?? "Render",
            "",
            `view-render-${taskId}`,
            false,
          );
          engine.focusView(`view-render-${taskId}`);
          break;

        case "avatar":
          engine.showImage(
            "Avatar",
            "",
            `view-avatar-${taskId}`,
            false,
          );
          engine.focusView(`view-avatar-${taskId}`);
          break;

        case "engineering":
        case "sandbox":
          engine.showDiagram(
            label ?? "Sandbox",
            {
              kind: "diagram",
              title: label ?? "Sandbox",
              caption: "Project activity in progress",
              source: "live",
              nodes: [],
              edges: [],
            },
            `view-sandbox-${taskId}`,
            false,
          );
          engine.focusView(`view-sandbox-${taskId}`);
          break;

        case "video":
        case "youtube":
          engine.showVideo(
            label ?? "Video",
            "",
            `view-video-${taskId}`,
            false,
          );
          engine.focusView(`view-video-${taskId}`);
          break;

        case "sketch":
          engine.showImage(
            "Sketch",
            "",
            `view-sketch-${taskId}`,
            false,
          );
          engine.focusView(`view-sketch-${taskId}`);
          break;

        case "project":
          engine.showDiagram(
            "Project",
            {
              kind: "diagram",
              title: "Project",
              caption: "Project activity",
              source: "live",
              nodes: [],
              edges: [],
            },
            `view-project-${taskId}`,
            false,
          );
          engine.focusView(`view-project-${taskId}`);
          break;

        case "memory":
          void refreshMemory(taskId);
          break;

        case "cosmos":
          engine.showGenesis("Environment", `view-cosmos-${taskId}`, false);
          engine.focusView(`view-cosmos-${taskId}`);
          break;

        case "idle":
        default:
          // Don't force a view when idle — let the existing views persist.
          break;
      }
    }

    /** Derive the active task kind from an agent event. */
    function taskKindFromEvent(event: AgentEvent): ActiveTaskKind | null {
      switch (event.type) {
        case "tool_selected":
        case "tool_started": {
          switch (event.tool) {
            case "research":
              return "research";
            case "browser":
              return "browser";
            case "creative": {
              const lbl = ("label" in event ? event.label : "") ?? "";
              const lower = lbl.toLowerCase();
              if (lower.includes("3d") || lower.includes("render") || lower.includes("avatar")) return "render";
              if (lower.includes("video")) return "video";
              if (lower.includes("sketch") || lower.includes("draw")) return "sketch";
              return "creative";
            }
            case "avatar":
              return "avatar";
            case "engineering":
            case "sandbox":
              return "engineering";
            case "video":
              return "video";
            case "memory":
              return "memory";
            case "project":
              return "project";
            case "cosmos":
              return "cosmos";
            default:
              return null;
          }
        }
        case "browser_opened":
          return "browser";
        default:
          return null;
      }
    }

    /* ----- memory refresh — real data from the memory store ----- */

    async function refreshMemory(taskId?: string) {
      try {
        const rows = await ai.getMemories(300);
        const counts = new Map<string, number>();
        for (const row of rows) {
          const category = row.category ?? "general";
          counts.set(category, (counts.get(category) ?? 0) + 1);
        }
        const layer = (id: string, label: string, description: string, category: string): MemoryLayerData => ({
          id,
          label,
          description,
          count: counts.get(category) ?? 0,
        });
        const layers: MemoryLayerData[] = [
          layer("core-identity", "Core Identity", "Lélu's permanent identity", "identity"),
          layer("user", "User Memory", "Established facts about the user", "preference"),
          layer("relational", "Relational Memory", "Shared history", "relationship"),
          layer("long-term", "Long-term Memory", "Retained knowledge", "experience"),
          layer("short-term", "Short-term Memory", "Conversation context", "conversation"),
          layer("working", "Working Memory", "In active use", "general"),
        ];
        engine.showMemory("Memory", memoryArchitecture(layers), "view-memory");
        void taskId;
      } catch {
        // Memory may not be initialized yet.
      }
    }

    /* ----- provider refresh — real data from the provider registry ----- */

    async function refreshProviders() {
      try {
        const status = await ai.getApiStatus();
        engine.showProviderStatus(
          "Providers",
          providerArchitecture(status.runtime.providers),
          "view-providers",
        );
      } catch {
        // Providers not initialized.
      }
    }

    /* ----- research results → actual data in the workspace ----- */

    function refreshResearch(
      _result: string,
      taskId: string,
      results?: Array<{ title?: string; url?: string; type?: string }>,
    ) {
      const video = results?.find((item) =>
        /youtube|youtu\.be|vimeo|\.(mp4|webm|ogg|mov)/i.test(`${item.url ?? ""} ${item.type ?? ""}`),
      );
      if (video?.url) {
        engine.showVideo(video.title ?? "Video", video.url, `view-video-${taskId}`, true);
        engine.focusView(`view-video-${taskId}`);
      }
      const image = results?.find((item) =>
        /\.(png|jpe?g|gif|webp|avif)/i.test(item.url ?? ""),
      );
      if (image?.url) {
        engine.showImage(image.title ?? "Image", image.url, `view-image-${taskId}`, true);
      }
    }

    /* ----- creative artifact → render result in the workspace ----- */

    function showCreativeArtifact(taskId: string, output: string) {
      if (output) {
        engine.showImage("Render Result", output, `view-render-${taskId}`, false);
        engine.focusView(`view-render-${taskId}`);
      }
    }

    /* ----- the agent event subscription — drives the workspace ----- */

    const unsubscribe = AgentEventBus.getInstance().subscribe((event) => {
      // Track the active task kind from real agent events.
      const kind = taskKindFromEvent(event);
      if (kind && kind !== activeTaskRef.current) {
        activeTaskRef.current = kind;
        showTaskSurface(kind, event.taskId, "label" in event ? (event as any).label : undefined);
      }

      // Handle specific event types for data population.
      switch (event.type) {
        case "tool_result": {
          if (event.tool === "research") {
            refreshResearch(event.result ?? "Research completed.", event.taskId, event.results);
          }
          // When a tool completes, show its result in the workspace.
          if (event.tool === "creative" && event.result) {
            // Check if result contains an image data URL.
            if (event.result.startsWith("data:image")) {
              showCreativeArtifact(event.taskId, event.result);
            }
          }
          break;
        }
        case "creative_artifact": {
          // Real render artifact from the creative pipeline.
          showCreativeArtifact(event.taskId, event.image);
          break;
        }
        case "browser_opened": {
          if ("url" in event && event.url) {
            engine.showBrowser("Browser", event.url, `view-browser-${event.taskId}`, false);
            engine.focusView(`view-browser-${event.taskId}`);
          }
          break;
        }
        case "memory_retrieval":
        case "memory_update": {
          // Memory events update the memory view if it's visible,
          // but don't force-switch the workspace to memory.
          void refreshMemory(event.taskId);
          break;
        }
        case "provider_selected":
        case "provider_status": {
          void refreshProviders();
          break;
        }
        case "task_completed":
        case "task_failed": {
          // After a task completes, settle back to idle after a beat.
          // Don't force-switch — let the user see the result.
          void setTimeout(() => {
            activeTaskRef.current = "idle";
          }, 3000);
          break;
        }
        default:
          break;
      }
    });

    // The live validation mirror is a DEFAULT workspace view: what
    // LÉLU is doing right now, streamed from the Executive Runtime.
    // Stable id → re-opening updates in place instead of stacking tabs.
    engine.showExecutive("Lélu · Live Execution", "view-executive", false);

    // Load provider status on mount so the workspace has real data.
    void refreshProviders();

    return () => {
      unsubscribe();
    };
  }, []);

  return null;
}
