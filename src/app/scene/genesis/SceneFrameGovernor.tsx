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
import type { Camera, Material, Object3D, Scene, Texture, WebGLRenderer } from "three";
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

  useCoveredPreparation(mode === "paused");

  useEffect(() => {
    if (mode !== "reduced") return;
    const id = window.setInterval(() => invalidate(), REDUCED_FRAME_MS);
    return () => window.clearInterval(id);
  }, [mode, invalidate]);

  return null;
}

/*
 * ----------------------------------------------------------
 * PREPARING A COVERED SCENE (M15.3 WP04)
 *
 * A canvas mounted under an opaque surface (her world entered behind the
 * Chat Universe) has frameloop "never", so its whole one-time preparation
 * used to land on its FIRST frame, the instant the cover lifted, which is
 * also the instant she was asked to act. Measured (SwiftShader, desktop):
 * one 10.2 s task, of which 6.9 s waiting on shader compile/link
 * (getShaderInfoLog / getProgramInfoLog / getProgramParameter) and 2.2 s
 * texture uploads (texSubImage2D/3D).
 *
 * While covered, this uses the canvas's OWN renderer and scene:
 *  - `renderer.compile` SUBMITS every program (compile/link run in the GPU
 *    process; three.js only waits for them at first use), so by the first
 *    paint they are linked and the wait is gone;
 *  - textures are uploaded one per idle slice (`initTexture`), so the
 *    upload cost is spread instead of one long task.
 * It never draws a frame (the cover stays authoritative), never creates a
 * renderer or context, and re-checks for content that mounts later (her
 * model arrives asynchronously).
 * ----------------------------------------------------------
 */
/** three.js's WebGLProgram, as listed in renderer.info.programs. */
interface ThreeProgram {
  getUniforms(): unknown;
  getAttributes(): unknown;
}
interface Prepared {
  textures: WeakSet<Texture>;
  programs: WeakSet<object>;
  resolved: number;
  submittedAt: number;
  objects: number;
  uploads: number;
}
const prepared = new WeakMap<WebGLRenderer, Prepared>();

function texturesOf(material: Material, into: Set<Texture>): void {
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    const t = value as Texture | null;
    if (t && (t as { isTexture?: boolean }).isTexture) into.add(t);
  }
}

function hasImage(t: Texture): boolean {
  const img = t.image as { width?: number; complete?: boolean; data?: unknown } | undefined | null;
  if (!img) return false;
  if ((t as { isRenderTargetTexture?: boolean }).isRenderTargetTexture) return false;
  if (img.complete === false) return false;
  return Boolean(img.data) || (img.width ?? 0) > 0;
}

/** One preparation pass; returns the textures still to upload. */
function submitPrograms(gl: WebGLRenderer, scene: Scene, camera: Camera, state: Prepared): Texture[] {
  let objects = 0;
  const textures = new Set<Texture>();
  scene.traverse((o: Object3D) => {
    const m = (o as { material?: Material | Material[] }).material;
    if (!m) return;
    objects += 1;
    for (const mat of Array.isArray(m) ? m : [m]) texturesOf(mat, textures);
  });
  // Only when something new mounted: three.js skips programs it already has,
  // but the key computation is not free on a big scene.
  if (objects !== state.objects) {
    state.objects = objects;
    gl.compile(scene, camera);
    // A canvas that never presents never flushes: without this the compile
    // requests wait in this page's command buffer until the first frame,
    // which is exactly the wait this exists to remove.
    gl.getContext().flush();
    state.submittedAt = performance.now();
  }
  return [...textures].filter((t) => !state.textures.has(t) && hasImage(t));
}

function useCoveredPreparation(covered: boolean): void {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!covered) return;
    let state = prepared.get(gl);
    if (!state) {
      state = { textures: new WeakSet(), programs: new WeakSet(), resolved: 0, submittedAt: 0, objects: -1, uploads: 0 };
      prepared.set(gl, state);
    }
    const st = state;
    let timer = 0;
    let queue: Texture[] = [];
    // A plain timer between slices, not requestIdleCallback: measured, idle
    // callbacks rarely fired while the chat was opening, and the covered
    // time ran out with half the programs unresolved. Each slice is one
    // program or one texture, so input still gets a turn between slices.
    const later = (fn: () => void, ms: number) => {
      timer = window.setTimeout(fn, ms);
    };
    const report = () => {
      gl.domElement.dataset.leluPrepared = JSON.stringify({ programs: gl.info.programs?.length ?? 0, resolved: st.resolved, objects: st.objects, uploads: st.uploads, pending: queue.length });
    };
    const pass = () => {
      if (!timer) return;
      let busy = false;
      try {
        if (!queue.length) queue = submitPrograms(gl, scene, camera, st);
        /*
         * One program per slice: its FIRST USE (uniform and attribute
         * lookup, plus three's error check) is where the driver resolves
         * the link and the page waits for it (measured: ANGLE/SwiftShader
         * does not link on submit, even after a flush). Done here, it is
         * one bounded wait while covered instead of all of them at once on
         * the first frame.
         */
        const next = ((gl.info.programs ?? []) as unknown as ThreeProgram[]).find((pr) => !st.programs.has(pr));
        if (next) {
          next.getUniforms();
          next.getAttributes();
          st.programs.add(next);
          st.resolved += 1;
          busy = true;
        } else {
          // One texture per slice: an upload is main-thread work.
          const t = queue.shift();
          if (t) {
            gl.initTexture(t);
            gl.getContext().flush();
            st.textures.add(t);
            st.uploads += 1;
            busy = true;
          }
        }
      } catch {
        /* a texture or program that cannot be prepared now is prepared by its first frame, as before */
      }
      report();
      // Keep going while there is work; then look for late content once a second.
      later(pass, busy || queue.length ? 16 : 1000);
    };
    later(pass, 50);
    return () => {
      window.clearTimeout(timer);
      timer = 0;
    };
  }, [covered, gl, scene, camera]);
}
