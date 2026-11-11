/**
 * ==========================================================
 * LÉLUVERSE — ADAPTIVE QUALITY
 *
 * Resolution follows measured frame rate, not the display:
 * the canvas starts at a device-appropriate pixel ratio and
 * is raised (up to the display's own ratio, capped at 3 — a
 * 4K panel at its native ratio) while frames stay smooth, and
 * lowered (to 0.75 on phones, 1 on desktop) when they do not. Measured fps, pixel ratio,
 * drawing-buffer size and draw calls are published as
 * window.__leluRenderStats for diagnostics and tests.
 * ==========================================================
 */

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

export interface RenderStats {
  fps: number;
  dpr: number;
  buffer: [number, number];
  calls: number;
  triangles: number;
  mobile: boolean;
  /** Frames this canvas has painted since mount.
   *  A rising number means the canvas is drawing; a frozen one means the
   *  scene is not consuming the budget (see SceneRenderBudget). Frame RATE
   *  hides that: a paused canvas reports the same "fps" as a slow one. */
  frames: number;
  /** The render budget's current mode, so a paused world is observable. */
  mode: string;
}

declare global {
  interface Window {
    __leluRenderStats?: RenderStats;
  }
}

import { DPR_MAX, DPR_MIN, DPR_START, mobile } from "./qualityLimits";
import { getSceneRenderBudget } from "./SceneRenderBudget";

/**
 * Inside a <Canvas dpr={dpr}> whose `dpr` is React state: measures fps
 * every second and reports the next pixel ratio through onChange, so
 * the Canvas prop itself changes (a ratio set behind the prop's back is
 * reset whenever the scene re-renders). Steps by 0.25 — down after 2 s under 40 fps, up after 4 s over
 * 57 fps — never thrashing (a step waits at least 2 s for the next).
 */
export default function AdaptiveQuality({ onChange }: { onChange: (dpr: number) => void }) {
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  const since = useRef(performance.now());
  const dpr = useRef(DPR_START);
  const slow = useRef(0);
  const fast = useRef(0);
  const lastChange = useRef(0);
  const painted = useRef(0);

  useFrame(() => {
    frames.current += 1;
    painted.current += 1;
    const now = performance.now();
    if (now - since.current < 1000) return;
    const fps = (frames.current * 1000) / (now - since.current);
    frames.current = 0;
    since.current = now;

    // A spatial transition re-renders the same scene through a moving
    // camera; lowering the pixel ratio mid-flight reallocates the drawing
    // buffer exactly when the frame budget is thinnest. Hold adaptation
    // steady while the SpatialRuntime reports a transition.
    const transitioning = Boolean(document.body.dataset.spatialTransition);

    slow.current = !transitioning && fps < 40 ? slow.current + 1 : 0;
    fast.current = !transitioning && fps > 57 ? fast.current + 1 : 0;
    let next = dpr.current;
    if (slow.current >= 2) next = Math.max(DPR_MIN, dpr.current - 0.25);
    else if (fast.current >= 4) next = Math.min(DPR_MAX, dpr.current + 0.25);
    if (next !== dpr.current && now - lastChange.current > 2000) {
      dpr.current = next;
      lastChange.current = now;
      slow.current = 0;
      fast.current = 0;
      onChange(next);
    }

    window.__leluRenderStats = {
      fps: Math.round(fps),
      dpr: gl.getPixelRatio(),
      buffer: [gl.domElement.width, gl.domElement.height],
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      mobile,
      frames: painted.current,
      mode: getSceneRenderBudget().mode(),
    };
  });
  return null;
}
