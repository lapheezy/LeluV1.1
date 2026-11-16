/**
 * React view of InterfaceCompositionStore — the one owner of interface
 * compositions. Tiny and dependency-free so the scene router can read
 * whether an open composition covers the world without fetching the
 * composition view's chunk.
 */

import { useSyncExternalStore } from "react";
import InterfaceCompositionStore, {
  compositionCoversWorld,
  type InterfaceCompositionState,
} from "../../../../core/interface/InterfaceCompositionStore";

const subscribe = (listener: () => void) => InterfaceCompositionStore.subscribe(() => listener());
const snapshot = () => InterfaceCompositionStore.getState();

export function useInterfaceCompositions(): InterfaceCompositionState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** True while an open composition shows something other than the Cosmos. */
export function useCompositionCoversWorld(): boolean {
  return compositionCoversWorld(useInterfaceCompositions());
}

export function useCompositionOpen(): boolean {
  return useInterfaceCompositions().open !== null;
}

/**
 * Whether LÉLU's Room (Genesis V2) is on screen as the CURRENT region of an
 * open composition (M17.1). The Room region is live only while current
 * (one WebGL region at a time), so "current" is exactly "her room is being
 * drawn, with her body in it". Read by the companion so that, as in the
 * standalone Room, there is ONE LÉLU: the one standing in her room.
 */
export function useComposedRoomPresented(): boolean {
  return useInterfaceCompositions().open?.currentInterface === "lelu-room";
}
