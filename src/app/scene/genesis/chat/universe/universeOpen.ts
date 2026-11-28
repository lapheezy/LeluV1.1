/**
 * LÉLU — is the Chat Universe open?
 *
 * The Universe kept this in its own useState, so nothing else could know:
 * the surface resolver went on treating the phone as Home while the
 * Universe covered it, and Home, the spatial nav and the Genesis V1 scene
 * stayed mounted (hidden) underneath. One tiny store, read by the Universe
 * and by useSurface, fixes that without a second state system.
 */

import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export function isUniverseOpen(): boolean {
  return open;
}

export function setUniverseOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  if (!next) originalBackdrop = false;
  for (const listener of listeners) listener();
}

export function subscribeUniverseOpen(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUniverseOpen(): boolean {
  return useSyncExternalStore(subscribeUniverseOpen, isUniverseOpen, () => false);
}


/**
 * Open the hub ONCE on its original backdrop (WP21.4 OG access) without changing the saved Cosmos mode;
 * cleared when the hub closes.
 */
let originalBackdrop = false;
export function setUniverseOriginalBackdrop(on: boolean): void {
  if (originalBackdrop === on) return;
  originalBackdrop = on;
  for (const listener of listeners) listener();
}
export function universeOriginalBackdrop(): boolean {
  return originalBackdrop;
}
