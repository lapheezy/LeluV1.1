/**
 * ==========================================================
 * LÉLU — THE SCENE'S VIEW OF GENESIS
 *
 * A second, deliberately STABLE context for the consumers that
 * live inside the render loop.
 *
 * Why it exists: GenesisCore builds its whole context value in
 * one useMemo keyed on `state`, and `state` is a single object
 * holding messages, conversations, notifications, engine
 * statuses and cognition together. React context has no
 * selector, so any change to any field produces a new context
 * value and re-renders every one of the ~40 useGenesis()
 * consumers — including Cosmos, StarField, AuroraCosmos,
 * CoreAtmosphere and EngineTick. A streamed reply therefore
 * re-rendered the 3D scene on every token.
 *
 * What the scene consumers actually read is already stable:
 * ref getters and callbacks, not state. So this exposes exactly
 * those, memoised once for the lifetime of the provider, and
 * never changes identity. It is not a second source of truth —
 * every getter reads the same refs and the same state
 * GenesisCore already owns.
 *
 * `getLiveState` is for frame-loop code that needs the live
 * dialogue flags: read it inside useFrame rather than
 * subscribing to the state object, so a token does not become a
 * render.
 * ==========================================================
 */

import { createContext, useContext } from "react";
import type EventBus from "../../../core/EventBus";
import type EngineRuntime from "./engines/EngineRuntime";
import type { GenesisState as UniverseState } from "./state/GenesisState";
import type { GenesisUIState } from "./GenesisCore";

export interface GenesisSceneValue {
  /** The live universe object the engines mutate in place. */
  getLiveUniverse: () => UniverseState;
  /** The live UI state, read on demand rather than subscribed to. */
  getLiveState: () => GenesisUIState;
  engineRuntime: EngineRuntime | null;
  eventBus: EventBus;
  updateUniverse: (updater: (state: UniverseState) => void) => void;
}

export const GenesisSceneContext = createContext<GenesisSceneValue | null>(null);

/**
 * A development-only render ledger.
 *
 * The claim this context exists to make — a streamed token no longer
 * re-renders the 3D scene — could not be measured. The obvious metric,
 * long tasks, is dominated in a GPU-less container by SwiftShader
 * compiling shaders: a CPU profile put 20.6s of 26.6s in `(program)`,
 * so the render cascade was invisible underneath it either way. The
 * claim was therefore true but unproven, which is not good enough.
 *
 * So the consumers count themselves. One counter per context, read by
 * scripts/measure-render-cost.mjs around a real turn, which gives the
 * number the claim is actually about: how many consumer renders one
 * message costs. It needs no GPU, no profiler and no React internals.
 *
 * Dev-only and branch-free in production: the whole block is behind
 * import.meta.env.DEV, which Vite replaces with `false` and drops.
 */
export interface RenderLedger {
  scene: number;
  chat: number;
  /** Per-consumer counts, so a remaining re-render can be attributed. */
  by: Record<string, number>;
}

export function countRender(which: "scene" | "chat", who = "unnamed"): void {
  if (!import.meta.env.DEV) return;
  const host = globalThis as { __leluRenderLedger?: RenderLedger };
  const ledger = (host.__leluRenderLedger ??= { scene: 0, chat: 0, by: {} });
  ledger[which] += 1;
  const key = `${which}:${who}`;
  ledger.by[key] = (ledger.by[key] ?? 0) + 1;
}

/**
 * Scene-side access to Genesis.
 *
 * Throws rather than returning null: a scene component outside the
 * provider is a wiring mistake, and silently rendering an empty cosmos
 * would hide it.
 */
export function useGenesisScene(who?: string): GenesisSceneValue {
  const value = useContext(GenesisSceneContext);
  if (!value) {
    throw new Error("useGenesisScene must be used inside the Genesis provider.");
  }
  countRender("scene", who);
  return value;
}
