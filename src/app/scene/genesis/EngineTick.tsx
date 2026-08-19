/**
 * ==========================================================
 * LÉLUVERSE
 * ENGINE TICK — THE ONE SIMULATION HEARTBEAT (APP-LEVEL)
 *
 * The simulation (engine registry + EngineBus + universe
 * evolution) previously advanced only inside the v1 3D canvas
 * (GenesisRenderer.useFrame). That meant the moment the user
 * opened Genesis v2 — which unmounts the v1 canvas — the whole
 * universe froze: the v2 Core stopped morphing, the evolution
 * cycle stalled, telemetry went static.
 *
 * This component runs the same engineRuntime.update() on a plain
 * requestAnimationFrame loop and is mounted ONCE beside the
 * workspace router, so the ONE Core keeps living — morphing,
 * pulsing, evolving — no matter which workspace page owns the
 * viewport. The v1 canvas no longer ticks the engine; it only
 * renders it.
 * ==========================================================
 */

import { useEffect, useRef } from "react";

import { useGenesis } from "./GenesisCore";
import {
  idleGenesisSignals,
  type GenesisSignals,
} from "./engines/GenesisSignals";

export default function EngineTick() {
  const { state: uiState, engineRuntime, updateUniverse } = useGenesis();

  /* Mirrors the signals the v1 renderer used to feed the engine:
     live UI state (thinking/speaking/listening/reasoning…) sampled
     once per frame, not once per React render. */
  const signalsRef = useRef<GenesisSignals>(idleGenesisSignals);
  const lastProviderRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const lastMessage = uiState.messages[uiState.messages.length - 1];
    const provider = lastMessage?.provider;
    const providerSwitched =
      provider !== undefined &&
      lastProviderRef.current !== undefined &&
      provider !== lastProviderRef.current;

    if (provider !== undefined) {
      lastProviderRef.current = provider;
    }

    signalsRef.current = {
      thinking: uiState.thinking,
      speaking: uiState.speaking,
      listening: uiState.listening,
      reasoningActive: Boolean(uiState.cognition?.reasoning),
      planningActive: Boolean(uiState.cognition?.plan),
      providerSwitched,
      engineErrorCount: uiState.engineStatuses.filter(
        (status) => Boolean(status.error) || status.enabled === false,
      ).length,
    };
  }, [
    uiState.thinking,
    uiState.speaking,
    uiState.listening,
    uiState.cognition,
    uiState.engineStatuses,
    uiState.messages,
  ]);

  useEffect(() => {
    if (!engineRuntime) {
      return;
    }

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const delta = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      last = now;

      updateUniverse((universeState) => {
        engineRuntime.update(universeState, delta, signalsRef.current);
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [engineRuntime, updateUniverse]);

  return null;
}
