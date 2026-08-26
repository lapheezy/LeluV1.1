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
import Sentinel from "../../../core/sentinel/Sentinel";

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

    // Sentinel: report engine errors every 10 seconds
    const sentinel = Sentinel.getInstance();
    let sentinelTick = 0;
    const SENTINEL_INTERVAL = 10_000; // 10s between health reports

    let raf = 0;
    let last = performance.now();
    let lastSentinel = performance.now();

    const tick = (now: number) => {
      const delta = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      last = now;

      updateUniverse((universeState) => {
        engineRuntime.update(universeState, delta, signalsRef.current);
      });

      // Periodic Sentinel health report
      if (now - lastSentinel >= SENTINEL_INTERVAL) {
        lastSentinel = now;
        sentinelTick++;
        const sig = signalsRef.current;
        if (sig.engineErrorCount > 0) {
          sentinel.warn(
            "system_event",
            `${sig.engineErrorCount} engine(s) in error state`,
            "EngineTick",
            { errorCount: sig.engineErrorCount },
          );
        }
        if (sig.providerSwitched) {
          sentinel.info(
            "provider_health",
            "AI provider switched",
            "EngineTick",
          );
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [engineRuntime, updateUniverse]);

  return null;
}
