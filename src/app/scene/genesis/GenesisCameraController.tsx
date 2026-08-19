/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS CAMERA CONTROLLER
 *
 * Connects:
 *
 * GenesisNavigator
 *        ↓
 * Three camera
 *
 * ==========================================================
 */


import {
  useEffect,
  useRef,
} from "react";

import {
  OrbitControls,
} from "@react-three/drei";

import {
  useThree,
} from "@react-three/fiber";

import {
  PerspectiveCamera,
  Vector3,
} from "three";

import type GenesisNavigator
  from "./GenesisNavigator";

import { genesisCameraIntentBus }
  from "./GenesisCameraIntent";

interface GenesisCameraControllerProps {
  navigator: GenesisNavigator;
}

export default function GenesisCameraController({
  navigator,
}: GenesisCameraControllerProps) {
  const { camera, size } = useThree();
  const controlsRef = useRef<any>(null);
  const followTarget = useRef(new Vector3(0, 0, 0));

  /*
   * Responsive framing: on narrow/portrait viewports the same composition
   * (core, shells, world-nodes) needs a wider field of view to stay inside
   * the frame; wide screens get a tighter, more cinematic angle.
   *
   * Zoom range: minDistance 4 keeps the close Core view; maxDistance 78
   * restores the very-wide cosmic view that fits the full star shell,
   * aurora ring, and all three workspace worlds together (the backdrop
   * sky sphere is radius 85, so 78 stays inside it).
   */
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const clamped = Math.min(1.8, Math.max(0.4, aspect));
    const fov = Math.round(56.5 - 8.5 * (clamped - 0.4) / 1.4);
    const perspective = camera as PerspectiveCamera;
    if (perspective.isPerspectiveCamera) {
      perspective.fov = fov;
      perspective.updateProjectionMatrix();
    }
  }, [camera, size]);

  useEffect(() => {
    const unsubscribe = navigator.subscribe((state) => {
      if (!state.target) {
        return;
      }

      followTarget.current.set(
        state.target.position.x,
        state.target.position.y,
        state.target.position.z,
      );

      if (controlsRef.current) {
        controlsRef.current.target.lerp(followTarget.current, 0.12);
        controlsRef.current.update();
      }
    });

    return unsubscribe;
  }, [navigator]);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, [camera]);

  /*
   * Spatial controls (zoom + / − / reset from the workspace preview)
   * drive the REAL camera through this bus — the buttons move the
   * actual OrbitControls along their current view axis, clamped to
   * the same distance range the controls themselves enforce.
   */
  useEffect(() => {
    const unsubscribe = genesisCameraIntentBus.subscribe((intent) => {
      const controls = controlsRef.current;
      if (!controls) {
        return;
      }
      if (intent.type === "reset") {
        camera.position.set(0, 0, 6.8);
        controls.target.set(0, 0, 0);
        controls.update();
        return;
      }

      const direction = camera.position.clone().sub(controls.target);
      const distance = direction.length();
      if (distance < 0.001) {
        return;
      }
      const factor = intent.type === "zoom-in" ? 0.76 : 1.3;
      const next = Math.min(78, Math.max(4, distance * factor));
      camera.position
        .copy(controls.target)
        .add(direction.normalize().multiplyScalar(next));
      controls.update();
    });
    return unsubscribe;
  }, [camera]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      minDistance={4}
      maxDistance={78}
      maxPolarAngle={Math.PI / 2.1}
      target={[0, 0, 0]}
    />
  );
}