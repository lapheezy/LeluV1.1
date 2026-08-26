/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS BRIDGE
 *
 * SINGLE SOURCE OF TRUTH
 *
 * Connects:
 * Shared AIService → Brain / Runtime → Genesis Context → Genesis World + Interface
 * ==========================================================
 */

import { useEffect } from "react";
import { useGenesis } from "./GenesisCore";
import AIService, {
  type AIActionEvent,
  type AIMessageEvent,
  type CognitionEvent,
} from "../../../core/AIService";
import Sentinel from "../../../core/sentinel/Sentinel";
import CapabilityManifest from "../../../core/capabilities/CapabilityManifest";
import { cleanAssistantText } from "../../../core/router/ToolMarkup";

const ai = AIService.getInstance();

export default function GenesisBridge() {
  const { addAction, updateCognition, addMessage, upsertMessage, setThinking, setSpeaking, setListening, notify } = useGenesis();

  useEffect(() => {
    const sentinel = Sentinel.getInstance();
    const caps = CapabilityManifest.getInstance();

    ai.initialize()
      .then(() => {
        sentinel.info("runtime_start", "AI service initialized", "GenesisBridge");
        caps.updateStatus("ai-chat", "available");
      })
      .catch((err) => {
        sentinel.error("provider_error", `AI init failed: ${err instanceof Error ? err.message : String(err)}`, "GenesisBridge");
        caps.updateStatus("ai-chat", "unavailable", String(err));
      });

    const removeActions = ai.subscribeActions((event: AIActionEvent) => {
      addAction({
        id: event.id,
        type: event.type,
        label: event.label,
        source: "ai",
        status: event.status === "error" ? "failed" : event.status,
        progress: event.status === "complete" ? 100 : 0,
        timestamp: event.timestamp,
      });
      if (event.status === "error") {
        sentinel.error("provider_error", `Action failed: ${event.label}`, "GenesisBridge");
      }
    });

    const removeCognition = ai.subscribeCognition((state: CognitionEvent) => {
      updateCognition({
        agents: state.agents,
        workspaces: state.workspaces,
        nodes: state.nodes,
        reasoning: state.reasoning ?? null,
        plan: state.plan ?? null,
      });
    });

    // Upsert semantics: streamed partials share an id with the final
    // completed message, so live text renders in place instead of
    // duplicating bubbles.
    const removeMessages = ai.subscribeMessages((message: AIMessageEvent) => {
      upsertMessage({
        id: message.id,
        role: message.role,
        text: cleanAssistantText(message.text),
        timestamp: message.timestamp,
        source: "ai",
        provider: message.provider,
        confidence: message.confidence,
        reasoning: message.reasoning ?? undefined,
        plan: message.plan ?? undefined,
      });
    });

    const removeStream = ai.subscribeStream((event) => {
      upsertMessage({
        id: event.id,
        role: "assistant",
        text: cleanAssistantText(event.text),
        timestamp: Date.now(),
        source: "ai",
      });
    });

    const removeThinking = ai.subscribeThinking((value: boolean) => {
      setThinking(value);
    });

    const removeSpeaking = ai.subscribeSpeaking((value: boolean) => {
      setSpeaking(value);
    });

    const removeListening = ai.subscribeListening((value: boolean) => {
      setListening(value);
    });

    const removeNotifications = ai.subscribeNotifications((notification: { title: string; description?: string }) => {
      notify(notification.title, notification.description);
    });

    return () => {
      removeActions();
      removeCognition();
      removeMessages();
      removeStream();
      removeThinking();
      removeSpeaking();
      removeListening();
      removeNotifications();
    };
  }, [addAction, updateCognition, addMessage, upsertMessage, setThinking, setSpeaking, setListening, notify]);

  return null;
}
