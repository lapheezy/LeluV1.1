/**
 * Whether the home (CosmosHome) is mounted in front of the Cosmos.
 *
 * The home is painted on translucent glass over the live scene, so anything
 * the scene draws as DOM (the portal name chips) shows through and over its
 * cards. The 3D canvas cannot read the interface's React context, so the
 * home announces itself here and the scene reads it.
 */
import { useSyncExternalStore } from "react";

let mounted = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Called by CosmosHome on mount; returns the unmount cleanup. */
export function announceHome(): () => void {
  mounted += 1;
  emit();
  return () => {
    mounted = Math.max(0, mounted - 1);
    emit();
  };
}

export function homeInFront(): boolean {
  return mounted > 0;
}

export function useHomeInFront(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    homeInFront,
    () => false,
  );
}
