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

const ai = AIService.getInstance();

export default function GenesisBridge() {
  const { addAction, updateCognition, addMessage, setThinking, setSpeaking, setListening, notify } = useGenesis();

  useEffect(() => {
    ai.initialize().catch(console.error);

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

    const removeMessages = ai.subscribeMessages((message: AIMessageEvent) => {
      addMessage({
        id: message.id,
        role: message.role,
        text: message.text,
        timestamp: message.timestamp,
        source: "ai",
        provider: message.provider,
        confidence: message.confidence,
        reasoning: message.reasoning ?? undefined,
        plan: message.plan ?? undefined,
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
      removeThinking();
      removeSpeaking();
      removeListening();
      removeNotifications();
    };
  }, [addAction, updateCognition, addMessage, setThinking, setSpeaking, setListening, notify]);

  return null;
}
