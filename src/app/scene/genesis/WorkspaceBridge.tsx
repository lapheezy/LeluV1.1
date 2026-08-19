/**
 * ==========================================================
 * LÉLUVERSE
 * WORKSPACE BRIDGE
 *
 * The app-level connection between REAL agent activity and the
 * visual workspace. Subscribes to the same AgentEventBus the
 * resolver chain emits into, plus AIService's live state, and
 * creates/updates workspace views from actual work:
 *
 *   engineering tool result  → engineering flow diagram + activity
 *   research tool result     → research data table
 *   browser opened           → browser view (the page she opened)
 *   memory retrieval/update  → memory architecture with live counts
 *   provider selected/status → provider map from the live registry
 *   task started/completed   → activity timeline of real events
 *
 * Nothing here fabricates activity — it renders what the agent
 * genuinely did. Views use stable ids per kind, so a new task
 * updates the existing view instead of stacking tabs.
 * ==========================================================
 */

import { useEffect, useRef } from "react";
import AIService from "../../../core/AIService";
import AgentEventBus from "../../../core/agent/AgentEvents";
import WorkspaceEngine from "../../../core/workspace/WorkspaceEngine";
import {
  engineeringFlow,
  memoryArchitecture,
  providerArchitecture,
  table,
} from "../../../core/workspace/visualizers";
import type { MemoryLayerData } from "../../../core/workspace/visualizers";

const ai = AIService.getInstance();

export default function WorkspaceBridge() {
  const engineRef = useRef(WorkspaceEngine.getInstance());

  useEffect(() => {
    const engine = engineRef.current;

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
        engine.showMemory("Memory Architecture", memoryArchitecture(layers), "view-memory");
        void taskId;
      } catch {
        // Memory may not be initialized yet — the activity log still shows the retrieval.
      }
    }

    async function refreshProviders(taskId?: string) {
      try {
        const status = await ai.getApiStatus();
        engine.showProviderStatus(
          "Provider Architecture",
          providerArchitecture(status.runtime.providers),
          "view-providers",
        );
        void taskId;
      } catch {
        // Providers not initialized — nothing to visualize yet.
      }
    }

    function refreshResearch(
      result: string,
      taskId: string,
      results?: Array<{ title?: string; url?: string; type?: string }>,
    ) {
      engine.showData(
        "Research Data",
        table(
          "Research Data",
          [
            { key: "result", label: "Retrieved" },
            { key: "task", label: "Task" },
          ],
          [{ result, task: taskId.slice(0, 8) }],
          "From the knowledge-provider tool run",
        ),
        `view-research-${taskId}`,
        true,
      );

      // Progressive media surfaces: real result URLs become video/image
      // views immediately, while the rest of the task still runs.
      if (results?.length) {
        const video = results.find((item) =>
          /youtube|youtu\.be|vimeo|\.(mp4|webm|ogg|mov)/i.test(item.url ?? ""),
        );
        const image = results.find((item) =>
          /\.(png|jpe?g|gif|webp|avif)/i.test(item.url ?? ""),
        );
        if (video?.url) {
          engine.showVideo(video.title ?? "Video", video.url, `view-video-${taskId}`, true);
        }
        if (image?.url) {
          engine.showImage(image.title ?? "Image", image.url, `view-image-${taskId}`, true);
        }
      }
    }

    const unsubscribe = AgentEventBus.getInstance().subscribe((event) => {
      switch (event.type) {
        case "task_started":
          engine.showActivity("Agent Activity", "view-activity");
          break;
        case "tool_result":
          if (event.tool === "engineering") {
            engine.showDiagram("Engineering Activity", engineeringFlow(), "view-engineering");
          }
          if (event.tool === "research") {
            refreshResearch(event.result ?? "Research completed.", event.taskId, event.results);
          }
          break;
        case "browser_opened":
          engine.showBrowser("Browser", event.url, `view-browser-${event.taskId}`);
          break;
        case "memory_retrieval":
        case "memory_update": {
          void refreshMemory(event.taskId);
          // The agent actively moves through the memory network: bring
          // the layers into focus and animate their connections while
          // the retrieval signal travels through the visual engine.
          const layers = ["core-identity", "user", "relational", "long-term", "short-term", "working"];
          const count = Math.max(1, Math.min(6, event.type === "memory_retrieval" ? event.count : 3));
          engine.focusElements("view-memory", layers.slice(0, count));
          engine.tracePath("view-memory", layers.slice(0, count));
          engine.expandView("view-memory", true);
          break;
        }
        case "provider_selected":
        case "provider_status":
          void refreshProviders(event.taskId);
          break;
        default:
          break;
      }
    });

    return unsubscribe;
  }, []);

  return null;
}
