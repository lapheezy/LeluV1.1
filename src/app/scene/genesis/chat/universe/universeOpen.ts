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
 * The full (single-panel) chat is only for what the Universe windows cannot
 * do yet — attachments. Everywhere else "open the chat" means the Universe.
 * The Universe's own "attach in the full chat" control asks for it once.
 */
let fullChatRequested = false;

export function requestFullChatOnce(): void {
  fullChatRequested = true;
}

export function consumeFullChatRequest(): boolean {
  const requested = fullChatRequested;
  fullChatRequested = false;
  return requested;
}
