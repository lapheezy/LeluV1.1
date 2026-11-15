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
