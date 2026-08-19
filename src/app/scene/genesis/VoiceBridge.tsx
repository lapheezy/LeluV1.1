/**
 * ==========================================================
 * LÉLUVERSE
 * VOICE BRIDGE — THE ONE VOICE SESSION, CONNECTED TO GENESIS
 *
 * App-level subscriber to the VoiceEngine singleton. Mounted once
 * inside the Genesis controller, so voice conversation continues
 * across every LÉLU section — it is owned by the application
 * runtime, not by any single visual component.
 *
 * Responsibilities:
 * - mirror the engine's phase into the existing Genesis UI state
 *   (the ONE Core reads it for breathing/state)
 * - persist voice user utterances through the existing addMessage
 *   channel, exactly like typed messages (assistant replies arrive
 *   through the existing AIService → bridge message channel)
 * - surface safe, non-crashing permission/error notifications
 *
 * No second brain, no second memory, no second chat pipeline:
 * the engine itself calls the same AIService.chat() as text chat.
 * ==========================================================
 */

import { useEffect } from "react";

import VoiceEngine from "../../../core/voice/VoiceEngine";
import { useGenesis } from "./GenesisCore";

export default function VoiceBridge() {
  const { addMessage, setVoice, notify } = useGenesis();

  useEffect(() => {
    const engine = VoiceEngine.getInstance();

    const unsubState = engine.onStateChange((next) => {
      setVoice(next.phase);
    });

    const unsubUtterance = engine.onUtterance((text) => {
      addMessage({
        id: crypto.randomUUID(),
        role: "user",
        text,
        timestamp: Date.now(),
        source: "local",
      });
    });

    const unsubError = engine.onError((message) => {
      notify("Lélu Voice", message);
    });

    return () => {
      unsubState();
      unsubUtterance();
      unsubError();
    };
  }, [addMessage, notify, setVoice]);

  return null;
}
