/**
 * ==========================================================
 * LÉLUVERSE
 * VISUAL BRIDGE
 *
 * The app-level connection between REAL runtime state and the
 * visual interface layer:
 *
 *   - AgentEvents (the same bus the resolver chain emits into)
 *     → VisualEngine.ingest(), which maps each real event to a
 *       mode + signal (memory_retrieval → neuron trace,
 *       provider_selected → matrix routing, tool execution →
 *       nerve path, speech → heartbeat, task_complete → settle).
 *   - AIService thinking/speaking/listening flags → the
 *     heartbeat rate.
 *   - Real registry structure (provider names, memory layers,
 *     tool names) → the matrix/neuron renderers.
 *   - task_completed → a short real-time settle, then the
 *     environment resolves back toward the conversational core.
 *
 * No decorative animation: every mode change corresponds to an
 * event that actually happened.
 * ==========================================================
 */

import { useEffect, useRef } from "react";
import AIService from "../../../core/AIService";
import AgentEventBus from "../../../core/agent/AgentEvents";
import VisualEngine from "../../../core/visual/VisualEngine";

const ai = AIService.getInstance();

export default function VisualBridge() {
  const engineRef = useRef(VisualEngine.getInstance());

  useEffect(() => {
    const engine = engineRef.current;
    let settleTimer: number | null = null;

    async function loadStructure() {
      try {
        const providers = ai.getProviders();
        const names = providers.ai.map((provider) => provider.name);
        let memory: string[] = [];
        try {
          const rows = await ai.getMemories(120);
          memory = Array.from(new Set(rows.map((row) => row.category ?? "general")));
        } catch {
          memory = ["identity", "preference", "goal", "relationship", "conversation"];
        }
        engine.setStructure({
          providers: names,
          memory,
          tools: ["engineering", "research", "browser"],
        });
      } catch {
        engine.setStructure({
          providers: ["Groq", "OpenRouter", "Cerebras", "Mistral", "Fireworks"],
          memory: ["identity", "preference", "goal", "relationship", "conversation"],
          tools: ["engineering", "research", "browser"],
        });
      }
    }

    void loadStructure();

    const removeEvents = AgentEventBus.getInstance().subscribe((event) => {
      engine.ingest(event);

      // After a task completes, let the environment settle briefly
      // (real time) before resolving back toward the conversational core.
      if (event.type === "task_completed" || event.type === "task_failed") {
        if (settleTimer) {
          window.clearTimeout(settleTimer);
        }
        settleTimer = window.setTimeout(() => {
          engine.returnToCore();
          settleTimer = null;
        }, 2800);
      }
      if (event.type === "task_started") {
        if (settleTimer) {
          window.clearTimeout(settleTimer);
          settleTimer = null;
        }
      }
    });

    const removeThinking = ai.subscribeThinking((thinking) => {
      engine.setRuntime({ thinking });
    });
    const removeSpeaking = ai.subscribeSpeaking((speaking) => {
      engine.setRuntime({ speaking });
    });
    const removeListening = ai.subscribeListening((listening) => {
      engine.setRuntime({ listening });
    });

    return () => {
      removeEvents();
      removeThinking();
      removeSpeaking();
      removeListening();
      if (settleTimer) {
        window.clearTimeout(settleTimer);
      }
    };
  }, []);

  return null;
}
