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
  recallCameraPose,
  rememberCameraPose,
} from "./cameraPoseMemory";

import {
  noteUserCameraEnd,
  noteUserCameraStart,
} from "./cameraOwnership";

import {
  PLANET_CENTER,
  PLANET_RADIUS,
} from "./render/PlanetExplorer";

import {
  cosmosScaleStore,
  scaleFromDistance,
} from "./cosmos/CosmosScales";

import { useSpatialCamera }
  from "../spatial/useSpatialCamera";

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
  /**
   * True while the camera is held by a gesture OR by a spatial command
   * (LÉLU frames an object, then holds the view for the reveal). The
   * planet-following drift below must not run then: it lerps the controls
   * target back to the origin every frame, which slid a freshly framed
   * object out of the middle of the screen while it was being looked at.
   */
  const cameraHeld = useRef(false);

  /*
   * Spatial transitions move THIS camera through THIS OrbitControls —
   * the one controller stays authoritative, and a pointer press during
   * a cinematic flight hands control straight back to the user.
   */
  useSpatialCamera(camera as PerspectiveCamera, controlsRef);

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

  /*
   * The phone unmounts this whole world while chat owns the screen, so a mount
   * used to reset the view to the origin even though the scene the user was
   * looking at had not changed. Restore the pose this session left behind;
   * the origin is the right answer only for a world that was never left.
   */
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    /*
     * OrbitControls attaches its ref on the first commit, AFTER this effect
     * runs, so reading controlsRef.current here returned null and the pose
     * was silently never restored — the remount started at the canvas
     * default (0, 0, 5). Wait for the controls, then restore once. A reveal
     * that has taken the camera in the meantime wins: it is a newer, more
     * deliberate view than the one being restored.
     */
    const apply = () => {
      if (cancelled) return;
      const controls = controlsRef.current;
      if (!controls) {
        if (attempts++ < 60) requestAnimationFrame(apply);
        return;
      }
      /*
       * Restore unconditionally: framing a NEW object happens later (the
       * bridge waits for the target to be rendered), so a fresh reveal still
       * wins. Skipping while a previous reveal owned the camera was wrong —
       * that claim is exactly the view this pose came from.
       */
      const remembered = recallCameraPose();
      if (remembered) {
        camera.position.set(remembered.position[0], remembered.position[1], remembered.position[2]);
        controls.target.set(remembered.target[0], remembered.target[1], remembered.target[2]);
      } else {
        controls.target.set(0, 0, 0);
      }
      controls.update();
    };
    apply();
    return () => {
      cancelled = true;
    };
  }, [camera]);

  /*
   * Remember the view while the world is live (throttled), not only on
   * unmount. By cleanup time OrbitControls has already detached, so the
   * unmount-only save silently stored nothing and a phone came back to the
   * default pose. Saving during the live frames cannot miss the view.
   */
  const lastPoseSave = useRef(0);
  useEffect(
    () => () => {
      const controls = controlsRef.current;
      if (!controls) return;
      rememberCameraPose({
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
        fov: (camera as PerspectiveCamera).isPerspectiveCamera ? (camera as PerspectiveCamera).fov : undefined,
      });
    },
    [camera],
  );

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
        // Scale jumps (solar/stellar/galactic) fly longer so the camera
        // arrives smoothly instead of snapping across the cosmos.
        const duration = typeof detail.duration === "number" ? detail.duration : 1.5;
        flyCameraTo(camera as PerspectiveCamera, controls, pos, lookAt, duration);
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
    const hold = () => {
      cameraHeld.current = true;
    };
    const release = () => {
      cameraHeld.current = false;
    };
    window.addEventListener("genesis-user-camera-start", hold);
    window.addEventListener("genesis-user-camera-end", release);
    return () => {
      window.removeEventListener("genesis-user-camera-start", hold);
      window.removeEventListener("genesis-user-camera-end", release);
    };
  }, []);

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

    // Cosmic scale tracking — derives the current spatial scale from
    // the REAL camera distance every frame (store only notifies on
    // change), so the HUD and LÉLU's spatial context always reflect
    // where the camera actually is.
    cosmosScaleStore.set(scaleFromDistance(camera.position.length()));

    const toCam = camera.position.clone().sub(PLANET_CENTER);
    const dist = toCam.length();

    if (!cameraHeld.current) {
      if (dist < PLANET_RADIUS + 2.5 && dist > 0.001) {
        // Entering the planet: focus the controls on the surface under us.
        const dir = toCam.clone().normalize();
        const surface = PLANET_CENTER.clone().addScaledVector(dir, PLANET_RADIUS);
        controls.target.lerp(surface, 0.06);
      } else if (controls.target.distanceTo(PLANET_CENTER) < 4) {
        // Leaving the planet: gently drift the target back to the origin.
        controls.target.lerp(ORIGIN, 0.04);
      }
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

    // Keep the pose fresh for a surface that unmounts this world (chat on a
    // phone): the last live frame is the view the user expects to return to.
    const now = performance.now();
    if (now - lastPoseSave.current > 400) {
      lastPoseSave.current = now;
      rememberCameraPose({
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
        fov: (camera as PerspectiveCamera).isPerspectiveCamera ? (camera as PerspectiveCamera).fov : undefined,
      });
    }
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

      /*
       * A fly request (LÉLU's spatial camera: focus, frame, orbit, zoom) is a
       * real destination, not a zoom step. Without this branch every spatial
       * camera command was applied as a 1.3× dolly along the current view axis
       * and the camera never arrived at the pose the caller asked for.
       */
      if (intent.type === "fly") {
        const destination = new Vector3(...intent.position);
        const lookAt = intent.lookAt ? new Vector3(...intent.lookAt) : controls.target.clone();
        flyCameraTo(camera as PerspectiveCamera, controls, destination, lookAt, 0.9);
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

  /*
   * Detect user camera interaction so autonomous camera systems
   * (ExplorationController, GenesisPresenceEngine) can pause
   * while the user is manually exploring — preventing unwanted
   * recentering. OrbitControls fires onStart when the user drags/
   * zooms/pans and onEnd when they release.
   */
  const userCameraActive = useRef(false);

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
      onStart={() => {
        if (userCameraActive.current) return;
        userCameraActive.current = true;
        // A real gesture is the one thing that ends a reveal's hold.
        noteUserCameraStart();
      }}
      onEnd={() => {
        if (!userCameraActive.current) return;
        userCameraActive.current = false;
        noteUserCameraEnd();
      }}
    />
  );
}
