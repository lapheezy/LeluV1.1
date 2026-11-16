/**
 * ==========================================================
 * LÉLUVERSE — RENDER CONTEXT GUARD
 *
 * Mounted INSIDE a canvas. It does two things no canvas in this
 * project did:
 *
 *  1. REGISTERS the surface. The manager only knows about
 *     surfaces that announced themselves, which is what makes
 *     "no canvas paints and nobody knows why" detectable.
 *
 *  2. CATCHES CONTEXT LOSS. A lost WebGL context (driver reset,
 *     GPU process crash, a backgrounded mobile tab, an
 *     out-of-memory eviction) used to leave a dead, transparent
 *     canvas in the tree with no event and no recovery: the world
 *     simply vanished. The DOM cosmos is behind the canvas and
 *     shows through the moment it stops painting, so loss now
 *     degrades to the sky instead of to a void — and the budget
 *     is told, so nothing keeps drawing into a dead context
 *     while it is restored.
 *
 * `preventDefault()` on loss is required by the spec for the
 * browser to attempt restoration at all; without it the context
 * is gone for good.
 * ==========================================================
 */

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import {
  getSceneRenderManager,
  type RenderSurfaceKind,
} from "../SceneRenderManager";

export default function RenderContextGuard({
  id,
  kind,
}: {
  id: string;
  kind: RenderSurfaceKind;
}) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const manager = getSceneRenderManager();
    manager.registerSurface(id, kind);

    const canvas = gl.domElement;
    const onLost = (event: Event) => {
      event.preventDefault();
      manager.reportContextLost(id);
    };
    const onRestored = () => manager.reportContextRestored(id);

    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      manager.unregisterSurface(id);
    };
  }, [gl, id, kind]);

  return null;
}
