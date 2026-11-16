/**
 * ==========================================================
 * LÉLUVERSE — SCENE FRAME GOVERNOR
 *
 * Applies the SceneRenderBudget to a react-three-fiber canvas:
 *   full    → frameloop "always"
 *   reduced → frameloop "demand", invalidated at ~12 fps
 *   paused  → frameloop "never" (the last frame stays on screen)
 *
 * The frameloop itself MUST be passed as the <Canvas> prop
 * (useSceneFrameloop): r3f re-applies its props whenever the
 * canvas's parent renders, so a setFrameloop() call made from
 * inside the scene is silently reset to "always". This
 * component only supplies the ~12 fps invalidation while
 * reduced.
 * ==========================================================
 */

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  getSceneRenderBudget,
  REDUCED_FRAME_MS,
  useSceneRenderMode,
  type SceneRenderMode,
} from "./SceneRenderBudget";

export type Frameloop = "always" | "demand" | "never";

export function frameloopFor(mode: SceneRenderMode): Frameloop {
  return mode === "full" ? "always" : mode === "paused" ? "never" : "demand";
}

/** The frameloop prop for a governed <Canvas>. */
export function useSceneFrameloop(): Frameloop {
  return frameloopFor(useSceneRenderMode());
}

export default function SceneFrameGovernor() {
  const mode = useSceneRenderMode();
  const invalidate = useThree((s) => s.invalidate);

  // Sustained slow frames while rendering freely (> ~40 ms over 3 s) mean
  // this device cannot draw the scene and keep the caret responsive at the
  // same time — let typing yield here too, not only on phones.
  const slow = useRef({ since: 0, frames: 0, flagged: false });
  useFrame(() => {
    const s = slow.current;
    if (s.flagged || mode !== "full") return;
    const now = performance.now();
    if (s.since === 0) s.since = now;
    s.frames += 1;
    const elapsed = now - s.since;
    if (elapsed < 3000) return;
    if (elapsed / s.frames > 40) {
      s.flagged = true;
      getSceneRenderBudget().markSlowRendering();
    }
    s.since = now;
    s.frames = 0;
  });

  useEffect(() => {
    if (mode !== "reduced") return;
    const id = window.setInterval(() => invalidate(), REDUCED_FRAME_MS);
    return () => window.clearInterval(id);
  }, [mode, invalidate]);

  return null;
}
