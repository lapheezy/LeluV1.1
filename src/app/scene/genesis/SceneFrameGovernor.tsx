/**
 * ==========================================================
 * LÉLUVERSE — SCENE FRAME GOVERNOR
 *
 * Mounted inside a react-three-fiber <Canvas>. Applies the
 * SceneRenderBudget to that canvas's frameloop:
 *   full    → "always"
 *   reduced → "demand", invalidated at ~12 fps
 *   paused  → "never" (the last frame stays on screen)
 * ==========================================================
 */

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { REDUCED_FRAME_MS, useSceneRenderMode } from "./SceneRenderBudget";

export default function SceneFrameGovernor() {
  const mode = useSceneRenderMode();
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (mode === "full") {
      setFrameloop("always");
      return;
    }
    if (mode === "paused") {
      setFrameloop("never");
      return () => setFrameloop("always");
    }
    setFrameloop("demand");
    const id = window.setInterval(() => invalidate(), REDUCED_FRAME_MS);
    return () => {
      window.clearInterval(id);
      setFrameloop("always");
    };
  }, [mode, setFrameloop, invalidate]);

  return null;
}
