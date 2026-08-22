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
 * Also handles planetary exploration: near the LÉLU planet the
 * OrbitControls target tracks the surface so the user can descend
 * continuously from orbit → city → street, and WASD/arrow keys walk
 * streets at close range.
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
  useFrame,
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

import {
  PLANET_CENTER,
  PLANET_RADIUS,
} from "./render/PlanetExplorer";

interface GenesisCameraControllerProps {
  navigator: GenesisNavigator;
}

const ORIGIN = new Vector3(0, 0, 0);
const UP_AXIS = new Vector3(0, 1, 0);

/** Smoothly fly the camera + OrbitControls target to a destination. */
function flyCameraTo(
  camera: PerspectiveCamera,
  controls: any,
  targetPos: Vector3,
  lookAt: Vector3,
  duration = 1.5,
) {
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  let progress = 0;
  let lastTime = performance.now();

  function animate() {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    progress += dt / duration;
    const t = Math.min(1, progress);
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

export default function GenesisCameraController({
  navigator,
}: GenesisCameraControllerProps) {
  const { camera, size } = useThree();
  const controlsRef = useRef<any>(null);
  const followTarget = useRef(new Vector3(0, 0, 0));
  const keysRef = useRef<Record<string, boolean>>({});

  /*
   * Responsive framing: on narrow/portrait viewports the same composition
   * (core, shells, world-nodes) needs a wider field of view to stay inside
   * the frame; wide screens get a tighter, more cinematic angle.
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
      flyCameraTo(camera as PerspectiveCamera, controls, targetPos, lookAt);
    }

    window.addEventListener("cosmos-navigate", onCosmosNavigate);
    return () => window.removeEventListener("cosmos-navigate", onCosmosNavigate);
  }, [camera]);

  /*
   * Planet navigation — dispatched by the planet explorer HUD.
   * Flies to Atlantis or back to space.
   */
  useEffect(() => {
    function onPlanetNavigate(e: Event) {
      const detail = (e as CustomEvent).detail;
      const controls = controlsRef.current;
      if (!controls) return;

      if (detail?.resetToSpace) {
        flyCameraTo(camera as PerspectiveCamera, controls, new Vector3(0, 0, 6.8), ORIGIN.clone());
        return;
      }

      if (detail?.pos && detail?.lookAt) {
        const pos = new Vector3(detail.pos.x, detail.pos.y, detail.pos.z);
        const lookAt = new Vector3(detail.lookAt.x, detail.lookAt.y, detail.lookAt.z);
        flyCameraTo(camera as PerspectiveCamera, controls, pos, lookAt);
      }
    }

    window.addEventListener("planet-navigate", onPlanetNavigate);
    return () => window.removeEventListener("planet-navigate", onPlanetNavigate);
  }, [camera]);

  /*
   * Keyboard traversal — WASD / arrow keys walk the streets at close
   * range. Keys move BOTH the camera and the controls target along the
   * view plane so it reads as walking, not zooming.
   */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if (key === "arrowup" || key === "arrowdown" || key === "arrowleft" || key === "arrowright") {
        e.preventDefault();
      }
      keysRef.current[key] = true;
    }
    function onKeyUp(e: KeyboardEvent) {
      keysRef.current[e.key.toLowerCase()] = false;
    }
    function onBlur() {
      keysRef.current = {};
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  /*
   * Per-frame: near the planet, retarget the OrbitControls to the
   * surface point under the camera (continuous descent); walk with
   * WASD at close range.
   */
  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const toCam = camera.position.clone().sub(PLANET_CENTER);
    const dist = toCam.length();

    if (dist < PLANET_RADIUS + 2.5 && dist > 0.001) {
      // Entering the planet: focus the controls on the surface under us.
      const dir = toCam.clone().normalize();
      const surface = PLANET_CENTER.clone().addScaledVector(dir, PLANET_RADIUS);
      controls.target.lerp(surface, 0.06);
    } else if (controls.target.distanceTo(PLANET_CENTER) < 4) {
      // Leaving the planet: gently drift the target back to the origin.
      controls.target.lerp(ORIGIN, 0.04);
    }

    // WASD / arrow-key walking at close range.
    const k = keysRef.current;
    const walking =
      k["w"] || k["a"] || k["s"] || k["d"] ||
      k["arrowup"] || k["arrowdown"] || k["arrowleft"] || k["arrowright"];

    if (walking && dist < PLANET_RADIUS + 5) {
      const forward = camera.position.clone().sub(controls.target);
      if (forward.lengthSq() > 1e-8) {
        forward.normalize();
        const right = new Vector3().crossVectors(forward, UP_AXIS).normalize();
        const speed = Math.max(0.02, camera.position.distanceTo(controls.target)) * 1.4 * delta;

        if (k["w"] || k["arrowup"]) {
          camera.position.addScaledVector(forward, speed);
          controls.target.addScaledVector(forward, speed);
        }
        if (k["s"] || k["arrowdown"]) {
          camera.position.addScaledVector(forward, -speed);
          controls.target.addScaledVector(forward, -speed);
        }
        if (k["a"] || k["arrowleft"]) {
          camera.position.addScaledVector(right, -speed);
          controls.target.addScaledVector(right, -speed);
        }
        if (k["d"] || k["arrowright"]) {
          camera.position.addScaledVector(right, speed);
          controls.target.addScaledVector(right, speed);
        }
      }
    }

    controls.update();
  });

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
      const next = Math.min(1500, Math.max(0.06, distance * factor));
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
      minDistance={0.06}
      maxDistance={1500}
      maxPolarAngle={Math.PI * 0.98}
      target={[0, 0, 0]}
    />
  );
}
