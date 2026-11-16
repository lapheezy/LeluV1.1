/**
 * Whether the Spatial bar is shown.
 *
 * It starts hidden on every visit: the bar sat over the Home's own bottom
 * navigation and the Cosmos orb. It appears only when she asks for it: the
 * side tab, the "Spatial navigation" entry in the menu, or LÉLU ("open the
 * spatial menu"). Everything talks through one window event so the router
 * (core) never imports the interface.
 */

import { useSyncExternalStore } from "react";

export const SPATIAL_NAV_EVENT = "lelu-spatial-nav";

export type SpatialNavRequest = { open: boolean | "toggle" };

let shown = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === shown) return;
  shown = next;
  if (typeof document !== "undefined") document.body.dataset.spatialNavShown = next ? "true" : "false";
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener(SPATIAL_NAV_EVENT, (event) => {
    const detail = (event as CustomEvent<SpatialNavRequest>).detail;
    const open = detail?.open ?? "toggle";
    set(open === "toggle" ? !shown : Boolean(open));
  });
}

/** Show, hide or toggle the Spatial bar from anywhere. */
export function requestSpatialNav(open: boolean | "toggle"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SpatialNavRequest>(SPATIAL_NAV_EVENT, { detail: { open } }));
}

export function isSpatialNavShown(): boolean {
  return shown;
}

export function useSpatialNavShown(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => shown,
    () => false,
  );
}
