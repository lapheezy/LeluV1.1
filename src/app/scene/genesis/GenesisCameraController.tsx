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
   * Zoom range: minDistance 2 for close core view; maxDistance 500
   * allows infinite-feel navigation through the cosmos.
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
   * Cosmos navigation — dispatched by the cosmos map panel tap.
   * Smoothly moves the camera AND the OrbitControls target
   * so the user arrives at the destination with full orbit control.
   */
  useEffect(() => {
    function onCosmosNavigate(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail?.pos || !detail?.lookAt) return;
      const controls = controlsRef.current;
      if (!controls) return;

      const targetPos = new Vector3(detail.pos.x, detail.pos.y, detail.pos.z);
      const lookAt = new Vector3(detail.lookAt.x, detail.lookAt.y, detail.lookAt.z);

      // Smoothly animate via lerp in the next frames
      const startPos = camera.position.clone();
      const startTarget = controls.target.clone();
      let progress = 0;
      const duration = 1.5; // seconds
      let lastTime = performance.now();

      function animate() {
        const now = performance.now();
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        progress += dt / duration;
        const t = Math.min(1, progress);
        // Smooth ease-in-out
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        camera.position.lerpVectors(startPos, targetPos, ease);
        controls.target.lerpVectors(startTarget, lookAt, ease);
        controls.update();

        if (t < 1) {
          requestAnimationFrame(animate);
        }
      }
      requestAnimationFrame(animate);
    }

    window.addEventListener("cosmos-navigate", onCosmosNavigate);
    return () => window.removeEventListener("cosmos-navigate", onCosmosNavigate);
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
      const next = Math.min(1500, Math.max(1, distance * factor));
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
      enablePan={true}
      panSpeed={1.5}
      zoomSpeed={1.2}
      rotateSpeed={0.5}
      minDistance={1}
      maxDistance={1500}
      maxPolarAngle={Math.PI * 0.98}
      target={[0, 0, 0]}
    />
  );
}