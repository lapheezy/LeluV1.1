/**
 * ==========================================================
 * LÉLUVERSE — GENESIS WINDOW FIT
 *
 * Pure geometry for GenesisWindowFrame, kept out of the
 * component file so it can be tested and so fast refresh
 * keeps working.
 * ==========================================================
 */

export type FrameRect = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width">;

/**
 * Where a desktop frame fits. It is anchored 24px above its container's
 * bottom and centred on it; what shows it is that container intersected
 * with every clipping ancestor and the viewport. Returns content-box caps
 * (16px padding + 1px border per side are outside them) and the sideways
 * nudge that keeps both edges 12px inside.
 */
export function fitFrame(
  anchor: FrameRect,
  clips: FrameRect[],
  viewport: { width: number; height: number },
  frameOuterWidth: number,
): { width: number; height: number; nudgeX: number } {
  let left = Math.max(anchor.left, 0);
  let right = Math.min(anchor.right, viewport.width);
  let top = Math.max(anchor.top, 0);
  let bottom = Math.min(anchor.bottom, viewport.height);
  for (const clip of clips) {
    left = Math.max(left, clip.left);
    right = Math.min(right, clip.right);
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
  }
  const width = Math.max(280, Math.floor(right - left - 24 - 34));
  const height = Math.max(220, Math.floor(Math.min(bottom, anchor.bottom - 24) - (top + 12) - 34));
  const outer = Math.min(frameOuterWidth, width + 34);
  const desiredLeft = anchor.left + anchor.width / 2 - outer / 2;
  const clampedLeft = Math.min(Math.max(desiredLeft, left + 12), Math.max(left + 12, right - 12 - outer));
  return { width, height, nudgeX: Math.round(clampedLeft - desiredLeft) };
}
