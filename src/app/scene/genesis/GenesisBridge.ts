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

import { useEffect, useRef } from "react";
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
  const { addAction, updateCognition, upsertMessage, setThinking, setSpeaking, setListening, notify } = useGenesis();

  // Keep the LATEST context callbacks in a ref so the subscription
  // effect below can run exactly once (ai is a module-level singleton;
  // its subscriptions never need to change) while every callback still
  // calls the current function. Found via a live Playwright audit:
  // with these functions in the effect's dependency array, ordinary
  // ambient activity (the exploration/discovery loop updating cognition
  // state) gave several of them a new identity every few seconds,
  // re-running this effect — which meant every AIService subscription
  // (messages, streaming text, thinking/speaking state, notifications)
  // was torn down and re-established that often. Between the teardown
  // and the new subscribe call, any event AIService emitted in that
  // gap was silently dropped — a real, intermittent "message never
  // appeared" / "seems frozen" class of bug, not just log noise.
  const latest = useRef({ addAction, updateCognition, upsertMessage, setThinking, setSpeaking, setListening, notify });
  latest.current = { addAction, updateCognition, upsertMessage, setThinking, setSpeaking, setListening, notify };

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
      latest.current.addAction({
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
      latest.current.updateCognition({
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
      latest.current.upsertMessage({
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
      latest.current.upsertMessage({
        id: event.id,
        role: "assistant",
        text: cleanAssistantText(event.text),
        timestamp: Date.now(),
        source: "ai",
      });
    });

    const removeThinking = ai.subscribeThinking((value: boolean) => {
      latest.current.setThinking(value);
    });

    const removeSpeaking = ai.subscribeSpeaking((value: boolean) => {
      latest.current.setSpeaking(value);
    });

    const removeListening = ai.subscribeListening((value: boolean) => {
      latest.current.setListening(value);
    });

    const removeNotifications = ai.subscribeNotifications((notification: { title: string; description?: string }) => {
      latest.current.notify(notification.title, notification.description);
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
  }, []);

  return null;
}
