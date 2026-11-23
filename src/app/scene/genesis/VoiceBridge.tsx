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

import VoiceEngine, { type VoiceDiagnostics } from "../../../core/voice/VoiceEngine";
import { useGenesisState } from "./GenesisCore";

/**
 * The runtime diagnostic, readable from the page.
 *
 * Same convention as `window.__leluReadiness` and `window.__leluRenderStats`:
 * the REAL pipeline state is published so an acceptance run can measure it
 * instead of inferring it from pixels. Read-only — nothing writes back.
 */
declare global {
  interface Window {
    __leluVoice?: {
      at: number;
      phase: string;
      active: boolean;
      diagnostics: VoiceDiagnostics;
      turnLatency: ReturnType<VoiceEngine["getTurnLatency"]>;
      /**
       * Every turn of this session with the reason it did or did not speak
       * (M23.0). A turn still without an outcome is an unexplained silence.
       */
      turns: ReturnType<VoiceEngine["getTurnLog"]>;
    };
  }
}

export default function VoiceBridge() {
  const { addMessage, setVoice, notify } = useGenesisState();

  useEffect(() => {
    const engine = VoiceEngine.getInstance();

    const publish = (diagnostics: VoiceDiagnostics) => {
      const state = engine.getState();
      window.__leluVoice = {
        at: Date.now(),
        phase: state.phase,
        active: state.active,
        diagnostics,
        turnLatency: engine.getTurnLatency(),
        turns: engine.getTurnLog(),
      };
    };

    const unsubState = engine.onStateChange((next) => {
      setVoice(next.phase);
      publish(engine.getDiagnostics());
    });

    const unsubDiagnostics = engine.onDiagnostics(publish);

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
      unsubDiagnostics();
      unsubUtterance();
      unsubError();
    };
  }, [addMessage, notify, setVoice]);

  return null;
}
