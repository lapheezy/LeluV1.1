import { useEffect } from "react";

/**
 * TEMPORARY DEBUG — scene mount/unmount lifecycle logger.
 *
 * Used to validate that the three Genesis workspaces (v1, LÉLU system,
 * v2) are truly MOUNTED and EXCHANGED — never layered, hidden, or
 * stacked. Each mounted scene prints a MOUNT line and each real unmount
 * prints an UNMOUNT line; if a V2 component ever stays mounted while
 * v1 is active, its missing UNMOUNT line makes the leak obvious.
 *
 * StrictMode-safe: React StrictMode double-invokes effect
 * setup/cleanup on mount, which would otherwise print ghost UNMOUNT
 * lines. The deferred-unmount scheme below collapses every StrictMode
 * cycle into exactly one MOUNT and one UNMOUNT per real mount.
 *
 * Remove this file (and its call sites) once the isolation check passes.
 */

const ENABLED = true;

/** Names currently mounted that have already logged a MOUNT. */
const mounted = new Set<string>();

/** Pending deferred-UNMOUNT timers, keyed by scene name. */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function useSceneMountLog(name: string, enabled = ENABLED): void {
  useEffect(() => {
    if (!enabled) return;

    if (mounted.has(name)) {
      // StrictMode re-setup right after the ghost cleanup: the real MOUNT
      // was already logged, so stay silent — but cancel the ghost UNMOUNT
      // timer the ghost cleanup just scheduled, and still arm a real
      // deferred UNMOUNT for the eventual true unmount.
      const timer = pending.get(name);
      if (timer !== undefined) {
        clearTimeout(timer);
        pending.delete(name);
      }
      return () => {
        const t = setTimeout(() => {
          mounted.delete(name);
          pending.delete(name);
          console.log(`[scene-mount] ${name} UNMOUNT`);
        }, 0);
        pending.set(name, t);
      };
    }

    mounted.add(name);
    console.log(`[scene-mount] ${name} MOUNT`);

    return () => {
      // Defer the UNMOUNT by one macrotask. If a re-setup for the same
      // name runs synchronously (StrictMode), it cancels this timer and
      // this cleanup was a ghost. Otherwise the timer logs the real
      // unmount.
      const t = setTimeout(() => {
        mounted.delete(name);
        pending.delete(name);
        console.log(`[scene-mount] ${name} UNMOUNT`);
      }, 0);
      pending.set(name, t);
    };
  }, [name, enabled]);
}
