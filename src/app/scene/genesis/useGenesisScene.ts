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
 * Scene-side access to Genesis.
 *
 * Throws rather than returning null: a scene component outside the
 * provider is a wiring mistake, and silently rendering an empty cosmos
 * would hide it.
 */
export function useGenesisScene(): GenesisSceneValue {
  const value = useContext(GenesisSceneContext);
  if (!value) {
    throw new Error("useGenesisScene must be used inside the Genesis provider.");
  }
  return value;
}
