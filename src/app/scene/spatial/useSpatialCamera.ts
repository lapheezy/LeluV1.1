/**
 * ==========================================================
 * LÉLUVERSE — SPATIAL CAMERA CHANNEL
 *
 * The ONE place a spatial transition moves the camera.
 *
 * GenesisCameraController already owns the only OrbitControls in
 * the Genesis world. This hook attaches that controller to the
 * SpatialRuntime: while a transition runs, the controller applies
 * the runtime's sampled pose each frame (position, target, fov)
 * with its own controls temporarily disabled; when the transition
 * ends it hands control straight back to the user's orbit.
 *
 * It is not a second camera manager. There is still exactly one
 * OrbitControls, one camera, and one place that writes to them.
 * A pointer press during a transition interrupts it and gives the
 * camera back immediately (interruptible, never hijacked).
 * ==========================================================
 */

import { useEffect, useRef, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import SpatialRuntime from "./SpatialRuntime";

interface OrbitLike {
  target: { set: (x: number, y: number, z: number) => void };
  update?: () => void;
  enabled: boolean;
}

export function useSpatialCamera(
  camera: PerspectiveCamera,
  controlsRef: RefObject<OrbitLike | null>,
): void {
  const gl = useThree((state) => state.gl);
  const engaged = useRef(false);

  useEffect(() => {
    const runtime = SpatialRuntime.getInstance();

    const unsubscribe = runtime.subscribe((state) => {
      const controls = controlsRef.current;
      if (!controls) return;

      const travelling = Boolean(state.transition);
      if (!travelling && !engaged.current) return;

      if (travelling) {
        engaged.current = true;
        controls.enabled = false;
      }

      const { position, target, fov } = state.camera;
      camera.position.set(position.x, position.y, position.z);
      controls.target.set(target.x, target.y, target.z);
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      controls.update?.();

      if (!travelling) {
        engaged.current = false;
        controls.enabled = true;
      }
    });

    // Taking hold of the camera during a flight stops it where it is —
    // the user always wins over an animation.
    const element = gl.domElement;
    const onPointerDown = () => {
      const state = runtime.getState();
      if (state.transition && !state.transition.interrupted) {
        runtime.interrupt();
        const controls = controlsRef.current;
        if (controls) controls.enabled = true;
      }
    };
    element.addEventListener("pointerdown", onPointerDown);

    return () => {
      unsubscribe();
      element.removeEventListener("pointerdown", onPointerDown);
    };
  }, [camera, controlsRef, gl]);
}

export default useSpatialCamera;
