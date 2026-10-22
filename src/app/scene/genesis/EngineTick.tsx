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

import { memo, useCallback, useEffect, useRef } from "react";

import { useGenesisScene } from "./useGenesisScene";
import {
  idleGenesisSignals,
  type GenesisSignals,
} from "./engines/GenesisSignals";
import Sentinel from "../../../core/sentinel/Sentinel";

/**
 * Memoised, and that is the other half of the scene-isolation fix.
 *
 * Reading the stable scene context stops a token re-rendering this
 * through CONTEXT. It does not stop it re-rendering because its PARENT
 * did: GenesisWorkspaceRouter calls useGenesis(), so it re-renders on
 * every state change and rebuilds every child element beneath it.
 * Measured with the render ledger: 62 scene-consumer renders for one
 * message even after the context work, against 320 chat-consumer
 * renders. memo() takes props into account and this takes none, so a
 * parent re-render is now a no-op here.
 */
function EngineTickImpl() {
  // The SCENE context, which never changes identity.
  //
  // This component's own comment already said the signals are "sampled
  // once per frame, not once per React render" — but it read them from
  // useGenesis(), whose value is rebuilt whenever any part of the
  // monolithic Genesis state changes, and its effect listed
  // uiState.messages among its dependencies. So every streamed token
  // re-rendered the component driving the engine loop and re-ran the
  // sampling. Reading the live state on demand is what the comment
  // described; this is it.
  // NOT destructured: `engineRuntime` is a getter on the scene context,
  // and the whole object's identity never changes. GenesisCore creates
  // the runtime in its own effect, and a child's effects run BEFORE its
  // parent's — so at this component's first render and first effect the
  // runtime is still null. It used to recover by accident: its parent
  // re-rendered at render rate, so a later render eventually read a
  // non-null value. Memoising this component (correctly) removed that
  // accident, which would have left the simulation never started.
  //
  // So the frame loop reads the getter each frame instead, which is
  // exactly what the stable context is for.
  const scene = useGenesisScene("EngineTick");
  const { getLiveState, updateUniverse } = scene;

  const signalsRef = useRef<GenesisSignals>(idleGenesisSignals);
  const lastProviderRef = useRef<string | undefined>(undefined);

  /** Sample the live UI state. Called from the frame loop, not from React. */
  const sampleSignals = useCallback((): GenesisSignals => {
    const uiState = getLiveState();
    const lastMessage = uiState.messages[uiState.messages.length - 1];
    const provider = lastMessage?.provider;
    const providerSwitched =
      provider !== undefined &&
      lastProviderRef.current !== undefined &&
      provider !== lastProviderRef.current;

    if (provider !== undefined) {
      lastProviderRef.current = provider;
    }

    return {
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
  }, [getLiveState]);

  useEffect(() => {
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

      // Once per frame, from the live state — which is what the engine
      // needs and what the comment above always claimed.
      signalsRef.current = sampleSignals();

      // Read per frame, so a runtime that arrives after this effect
      // started is picked up on the next frame rather than never.
      const runtime = scene.engineRuntime;
      if (runtime) {
        updateUniverse((universeState) => {
          runtime.update(universeState, delta, signalsRef.current);
        });
      }

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
  }, [scene, updateUniverse, sampleSignals]);

  return null;
}

export default memo(EngineTickImpl);
