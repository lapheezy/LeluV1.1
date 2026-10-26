/**
 * LÉLU — when the chat is the whole screen, and what it must make room for.
 *
 * Narrow workspaces (phones in portrait) and short ones (phones in
 * landscape: 844×390 is wide, but there is no room for a floating
 * window under the tab bar) both get the full-screen sky. GenesisChat
 * applies the same rule inline; the tab bar and the dock read it here
 * so all three always agree.
 */
import { useEffect, useState } from "react";
import type { WorkspaceMetrics } from "../../../../core/ui/Workspace";

export function chatFillsScreen(workspace: Pick<WorkspaceMetrics, "width" | "height">): boolean {
  return workspace.width <= 720 || workspace.height <= 520;
}

interface Box {
  left: number;
  right: number;
  width: number;
  height: number;
}

/**
 * How far a left navigation rail reaches into the screen, plus a gap.
 *
 * The dock has three shapes (phone pill, floating tablet rail, full-height
 * desktop rail) chosen by its own breakpoint. Only a rail on the left edge
 * takes horizontal room from a full-screen chat; the pill does not.
 */
export function leftRailInset(boxes: Box[], gap = 8): number {
  let reach = 0;
  for (const box of boxes) {
    const isLeftRail = box.width > 0 && box.width < 160 && box.height > 160 && box.left < 24;
    if (isLeftRail) reach = Math.max(reach, box.right);
  }
  return reach > 0 ? Math.ceil(reach + gap) : 0;
}

/** Live measurement of leftRailInset() for the mounted dock. */
export function useDockInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setInset(0);
      return;
    }
    const measure = () => {
      const boxes = [...document.querySelectorAll<HTMLElement>("[data-lelu-dock]")].map((el) => el.getBoundingClientRect());
      setInset(leftRailInset(boxes));
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    // The dock's size is a user setting and can change without a resize;
    // a rect read every couple of seconds is negligible.
    const id = window.setInterval(measure, 2000);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.clearInterval(id);
    };
  }, [enabled]);
  return inset;
}
