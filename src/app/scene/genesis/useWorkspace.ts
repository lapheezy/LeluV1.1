/**
 * ==========================================================
 * LÉLU — WORKSPACE HOOK
 *
 * The React half of core/ui/Workspace: one subscription, one answer.
 *
 * Replaces eleven independent `window.innerWidth` reads, each with its
 * own threshold and its own listener. Components ask this what the space
 * is, so the dock and the chat can no longer disagree about whether they
 * are on mobile — which is what put their controls on top of each other.
 * ==========================================================
 */

import { useEffect, useState } from "react";
import Workspace, { type WorkspaceMetrics } from "../../../core/ui/Workspace";

/** Current workspace metrics, updating as the container changes. */
export function useWorkspace(): WorkspaceMetrics {
  const [metrics, setMetrics] = useState<WorkspaceMetrics>(() =>
    Workspace.getInstance().get(),
  );
  useEffect(() => Workspace.getInstance().subscribe(setMetrics), []);
  return metrics;
}

/**
 * Attach the measurement root.
 *
 * Returns a ref callback for the element that genuinely bounds the
 * interface. Everything else measures that element rather than the
 * window, which is the whole point: inside the Freebuff workspace the
 * window is bigger than the room available.
 */
export function useWorkspaceRoot(): (element: HTMLElement | null) => void {
  return (element) => Workspace.getInstance().observe(element);
}
