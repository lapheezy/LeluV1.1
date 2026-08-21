/**
 * ==========================================================
 * LÉLU
 * USE VOICE — REACT MIRROR OF THE ONE VOICE ENGINE
 * ==========================================================
 */

import { useCallback, useEffect, useState } from "react";

import VoiceEngine, {
  type VoiceDiagnostics,
  type VoiceState,
  type VoiceTurn,
} from "./VoiceEngine";

export type { VoiceDiagnostics, VoiceErrorKind } from "./VoiceEngine";

export interface VoiceView {
  engine: VoiceEngine;
  state: VoiceState;
  interim: string;
  turn: VoiceTurn | null;
  diagnostics: VoiceDiagnostics;
  toggle: () => void;
}

export function useVoice(): VoiceView {
  const engine = VoiceEngine.getInstance();

  const [state, setState] = useState<VoiceState>(() => engine.getState());
  const [interim, setInterim] = useState("");
  const [turn, setTurn] = useState<VoiceTurn | null>(null);
  const [diagnostics, setDiagnostics] = useState<VoiceDiagnostics>(() =>
    engine.getDiagnostics(),
  );

  useEffect(() => {
    const unsubState = engine.onStateChange(setState);
    const unsubInterim = engine.onInterim(setInterim);
    const unsubTurn = engine.onTurn(setTurn);
    const unsubDiagnostics = engine.onDiagnostics(setDiagnostics);

    return () => {
      unsubState();
      unsubInterim();
      unsubTurn();
      unsubDiagnostics();
    };
  }, [engine]);

  const toggle = useCallback(() => {
    void engine.toggle();
  }, [engine]);

  return {
    engine,
    state,
    interim,
    turn,
    diagnostics,
    toggle,
  };
}
