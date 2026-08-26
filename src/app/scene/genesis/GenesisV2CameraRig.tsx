/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS V2 — CAMERA RIG (FREE EXPLORATION)
 *
 * Unlocks the Gen V2 camera. The scene is a real explorable
 * 3D world, not a locked cinematic frame:
 *
 *   ORBIT  — drag to orbit, wheel/pinch to zoom, right-drag /
 *            two-finger to pan (default)
 *   FREE FLY — WASD/arrows move, Q/E descend/ascend, drag to
 *            look, wheel/pinch to dolly
 *   TOUCH  — 1 finger orbit/look · 2 fingers pan · pinch zoom.
 *            touch-action none + preventDefault so the page
 *            never steals the gesture. (iPhone-ready.)
 *   FOCUS  — smooth flight to LÉLU / Core / Studio / Lab /
 *            Vault / whole-world view (intent bus + DOM bridge)
 *   USER WINS — any pointer/touch/key input cancels an
 *            autonomous camera flight immediately; the camera
 *            never fights the user, and it never snaps back.
 *   BOUNDS — configurable world limits so exploration stays
 *            inside the scene without locking the camera.
 *
 * The rig is mounted inside the v2 Canvas (GenesisV2Scene3D)
 * and unmounts with it — nothing leaks into v1.
 * ==========================================================
 */

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  genesisCameraIntentBus,
  requestV2Fullscreen,
  type GenesisCameraIntent,
  type GenesisV2FocusTarget,
} from "./GenesisCameraIntent";

/* --------------------------- world anchors ---------------------------- */

export const V2_LELU_POS = new THREE.Vector3(0, -2.55, 3.3);
export const V2_CORE_POS = new THREE.Vector3(0, 2.0, 0);
export const V2_STUDIO_POS = new THREE.Vector3(-4.5, -1.05, 0);
export const V2_LAB_POS = new THREE.Vector3(4.5, -1.05, 0);
export const V2_VAULT_POS = new THREE.Vector3(0, -2.1, 0);

/* ------------------------- configurable bounds ------------------------ */

export interface V2CameraLimits {
  /** Min distance from the orbit target. */
  minDistance: number;
  /** Max distance from the orbit target. */
  maxDistance: number;
  /** World half-extent on X and Z (fly + orbit target clamp). */
  worldRadius: number;
  /** Vertical limits for the camera. */
  yMin: number;
  yMax: number;
  /** Movement speed in free-fly (units/sec). */
  moveSpeed: number;
  /** Look sensitivity (radians per pixel). */
  lookSpeed: number;
  /** Wheel/pinch zoom multiplier. */
  zoomSpeed: number;
}

const DEFAULT_LIMITS: V2CameraLimits = {
  minDistance: 1.8,
  maxDistance: 64,
  worldRadius: 36,
  yMin: -12,
  yMax: 30,
  moveSpeed: 5.2,
  lookSpeed: 0.0042,
  zoomSpeed: 1.085,
};

const DEFAULT_CAMERA = new THREE.Vector3(0, 1.7, 10.4);
const DEFAULT_LOOK = new THREE.Vector3(0, 0.6, 0);

export type V2CameraMode = "orbit" | "fly";

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampToWorld(pos: THREE.Vector3, limits: V2CameraLimits): void {
  pos.x = clamp(pos.x, -limits.worldRadius, limits.worldRadius);
  pos.z = clamp(pos.z, -limits.worldRadius, limits.worldRadius);
  pos.y = clamp(pos.y, limits.yMin, limits.yMax);
}

export default function GenesisV2CameraRig({ limits }: { limits?: Partial<V2CameraLimits> }) {
  const { camera, gl } = useThree();

  const cfg = useRef<V2CameraLimits>({ ...DEFAULT_LIMITS, ...limits });
  const mode = useRef<V2CameraMode>("orbit");

  /* Orbit state */
  const orbitTarget = useRef(new THREE.Vector3(0, 0.6, 0));
  const spherical = useRef({
    radius: DEFAULT_CAMERA.distanceTo(orbitTarget.current),
    theta: 0,
    phi: Math.PI / 2 - 0.12,
  });

  /* Fly state */
  const flyPos = useRef(DEFAULT_CAMERA.clone());
  const yaw = useRef(Math.PI);
  const pitch = useRef(-0.08);

  /* Flight animation (LÉLU focus / user reset / explicit fly) */
  const flight = useRef<{
    active: boolean;
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;
    duration: number;
  } | null>(null);

  /* Input */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mid: { x: number; y: number } } | null>(null);
  const keys = useRef<Record<string, boolean>>({});
  const userActiveRef = useRef(false);

  const rightDown = useRef(false);

  /* ------------------------- user gesture signals --------------------- */

  function userStart(): void {
    if (!userActiveRef.current) {
      userActiveRef.current = true;
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("genesis-user-camera-start"));
      }
    }
    // The user has taken the camera — cancel any autonomous flight.
    flight.current = null;
  }

  function userEnd(): void {
    if (userActiveRef.current) {
      userActiveRef.current = false;
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("genesis-user-camera-end"));
      }
    }
  }

  /* ------------------------------ flight ------------------------------ */

  function startFlight(toPos: THREE.Vector3, toTarget: THREE.Vector3, duration = 1.4): void {
    const fromPos = camera.position.clone();
    const fromTarget =
      mode.current === "orbit"
        ? orbitTarget.current.clone()
        : toTarget.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(1));
    flight.current = {
      active: true,
      fromPos,
      toPos: toPos.clone(),
      fromTarget,
      toTarget: toTarget.clone(),
      t: 0,
      duration,
    };
  }

  function focusTarget(target: GenesisV2FocusTarget): void {
    const limits = cfg.current;
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    switch (target) {
      case "lelu":
        look = V2_LELU_POS.clone();
        pos = V2_LELU_POS.clone().add(new THREE.Vector3(0, 0.9, 3.4));
        break;
      case "studio":
        look = V2_STUDIO_POS.clone();
        pos = V2_STUDIO_POS.clone().add(new THREE.Vector3(3.6, 1.1, 3.4));
        break;
      case "lab":
        look = V2_LAB_POS.clone();
        pos = V2_LAB_POS.clone().add(new THREE.Vector3(-3.6, 1.1, 3.4));
        break;
      case "vault":
        look = V2_VAULT_POS.clone();
        pos = V2_VAULT_POS.clone().add(new THREE.Vector3(0, 2.1, 4.2));
        break;
      case "world":
        look = new THREE.Vector3(0, 0.4, 0);
        pos = new THREE.Vector3(0, 10.5, 17.5);
        break;
      case "core":
      default:
        look = V2_CORE_POS.clone();
        pos = V2_CORE_POS.clone().add(new THREE.Vector3(0, 0.8, 8.4));
        break;
    }
    clampToWorld(pos, limits);
    startFlight(pos, look);
  }

  function applyIntent(intent: GenesisCameraIntent): void {
    const limits = cfg.current;
    switch (intent.type) {
      case "zoom-in": {
        if (mode.current === "fly") {
          const dir = new THREE.Vector3();
          camera.getWorldDirection(dir);
          flyPos.current.addScaledVector(dir, limits.moveSpeed * 0.22);
        } else {
          spherical.current.radius /= limits.zoomSpeed;
        }
        break;
      }
      case "zoom-out": {
        if (mode.current === "fly") {
          const dir = new THREE.Vector3();
          camera.getWorldDirection(dir);
          flyPos.current.addScaledVector(dir, -limits.moveSpeed * 0.22);
        } else {
          spherical.current.radius *= limits.zoomSpeed;
        }
        break;
      }
      case "reset":
        startFlight(DEFAULT_CAMERA, DEFAULT_LOOK, 1.2);
        break;
      case "focus":
        focusTarget(intent.target);
        break;
      case "fly": {
        const pos = new THREE.Vector3(...intent.position);
        clampToWorld(pos, limits);
        const look = intent.lookAt
          ? new THREE.Vector3(...intent.lookAt)
          : camera.position
              .clone()
              .add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(2));
        startFlight(pos, look);
        break;
      }
      case "fullscreen":
        requestV2Fullscreen();
        break;
    }
  }

  /* ------------------------------ listeners --------------------------- */

  useEffect(() => {
    const unsub = genesisCameraIntentBus.subscribe(applyIntent);
    return unsub;
  }, [camera]);

  useEffect(() => {
    function onCommand(e: Event) {
      const detail = (e as CustomEvent).detail as
        | { intent: "focus"; target: GenesisV2FocusTarget }
        | { intent: "fly"; position: [number, number, number]; lookAt?: [number, number, number] }
        | { intent: "reset" }
        | { intent: "fullscreen" };
      if (!detail?.intent) return;
      if (detail.intent === "focus") focusTarget(detail.target);
      else if (detail.intent === "fly") applyIntent({ type: "fly", position: detail.position, lookAt: detail.lookAt });
      else if (detail.intent === "reset") applyIntent({ type: "reset" });
      else if (detail.intent === "fullscreen") requestV2Fullscreen();
    }
    function onMode(e: Event) {
      const detail = (e as CustomEvent).detail as { mode?: V2CameraMode };
      if (detail?.mode === "fly" || detail?.mode === "orbit") {
        mode.current = detail.mode;
        // Entering fly mode adopts the current camera pose so the switch
        // is seamless — no snap, no reset.
        if (detail.mode === "fly") {
          flyPos.current.copy(camera.position);
          const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
          yaw.current = euler.y;
          pitch.current = clamp(euler.x, -Math.PI / 2.4, Math.PI / 2.4);
        } else {
          const offset = camera.position.clone().sub(orbitTarget.current);
          spherical.current.radius = Math.max(
            cfg.current.minDistance,
            Math.min(cfg.current.maxDistance, offset.length()),
          );
          spherical.current.theta = Math.atan2(offset.x, offset.z);
          spherical.current.phi = Math.acos(clamp(offset.y / Math.max(0.01, offset.length()), -1, 1));
        }
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if (
        ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key) &&
        mode.current === "fly"
      ) {
        e.preventDefault();
      }
      keys.current[key] = true;
    }
    function onKeyUp(e: KeyboardEvent) {
      keys.current[e.key.toLowerCase()] = false;
    }
    function onBlur() {
      keys.current = {};
      pointers.current.clear();
      pinch.current = null;
      rightDown.current = false;
      userEnd();
    }
    function onContextMenu(e: Event) {
      e.preventDefault();
    }

    window.addEventListener("genesis-v2-camera", onCommand);
    window.addEventListener("genesis-v2-camera-mode", onMode);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    gl.domElement.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("genesis-v2-camera", onCommand);
      window.removeEventListener("genesis-v2-camera-mode", onMode);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      gl.domElement.removeEventListener("contextmenu", onContextMenu);
    };
  }, [camera, gl]);

  /* --------------------------- pointer / touch ------------------------ */

  useEffect(() => {
    const el = gl.domElement;
    el.style.touchAction = "none";
    el.style.cursor = "grab";

    function pointerDown(e: PointerEvent) {
      el.setPointerCapture?.(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.button === 2) rightDown.current = true;
      if (pointers.current.size === 1) userStart();
      if (pointers.current.size === 2) {
        const [a, b] = Array.from(pointers.current.values());
        pinch.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
      }
      el.style.cursor = "grabbing";
    }

    function pointerMove(e: PointerEvent) {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Two pointers → pan + pinch zoom.
      if (pointers.current.size >= 2 && pinch.current) {
        const [a, b] = Array.from(pointers.current.values());
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const zoomFactor = dist / Math.max(1, pinch.current.dist);
        if (Math.abs(zoomFactor - 1) > 0.012) {
          if (mode.current === "fly") {
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            flyPos.current.addScaledVector(dir, (1 - zoomFactor) * cfg.current.moveSpeed * 1.6);
          } else {
            spherical.current.radius = clamp(
              spherical.current.radius / zoomFactor,
              cfg.current.minDistance,
              cfg.current.maxDistance,
            );
          }
        }
        const panX = (mid.x - pinch.current.mid.x) * 0.006;
        const panY = (mid.y - pinch.current.mid.y) * 0.006;
        panCamera(panX, panY);
        pinch.current = { dist, mid };
        return;
      }

      // Single pointer → orbit (orbit mode) or look (fly mode).
      if (pointers.current.size === 1 && !rightDown.current) {
        if (mode.current === "fly") {
          yaw.current -= dx * cfg.current.lookSpeed;
          pitch.current = clamp(pitch.current - dy * cfg.current.lookSpeed, -Math.PI / 2.4, Math.PI / 2.4);
        } else {
          spherical.current.theta -= dx * cfg.current.lookSpeed * 2.4;
          spherical.current.phi = clamp(
            spherical.current.phi - dy * cfg.current.lookSpeed * 2.4,
            0.08,
            Math.PI - 0.08,
          );
        }
        return;
      }

      // Right-drag → pan (desktop).
      if (rightDown.current || mode.current === "fly") {
        panCamera(dx * 0.0045, dy * 0.0045);
      }
    }

    function panCamera(dx: number, dy: number): void {
      if (mode.current === "fly") {
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        camera.getWorldDirection(right);
        right.cross(camera.up).normalize();
        up.copy(camera.up);
        flyPos.current.addScaledVector(right, -dx * cfg.current.moveSpeed * 0.4);
        flyPos.current.addScaledVector(up, dy * cfg.current.moveSpeed * 0.4);
        return;
      }
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      camera.getWorldDirection(right);
      right.cross(camera.up).normalize();
      up.copy(camera.up);
      const scale = spherical.current.radius * 0.0012;
      orbitTarget.current.addScaledVector(right, -dx * scale);
      orbitTarget.current.addScaledVector(up, dy * scale);
      clampToWorld(orbitTarget.current, cfg.current);
    }

    function pointerUp(e: PointerEvent) {
      pointers.current.delete(e.pointerId);
      if (e.button === 2) rightDown.current = false;
      if (pointers.current.size < 2) pinch.current = null;
      if (pointers.current.size === 0) {
        userEnd();
        el.style.cursor = "grab";
      }
    }

    function wheel(e: WheelEvent) {
      e.preventDefault();
      const factor = Math.pow(cfg.current.zoomSpeed, -Math.sign(e.deltaY) * Math.min(4, Math.abs(e.deltaY) / 40 || 1));
      if (mode.current === "fly") {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        flyPos.current.addScaledVector(dir, (factor - 1) * cfg.current.moveSpeed * 6);
      } else {
        spherical.current.radius = clamp(
          spherical.current.radius * factor,
          cfg.current.minDistance,
          cfg.current.maxDistance,
        );
      }
    }

    el.addEventListener("pointerdown", pointerDown);
    el.addEventListener("pointermove", pointerMove);
    el.addEventListener("pointerup", pointerUp);
    el.addEventListener("pointercancel", pointerUp);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", pointerDown);
      el.removeEventListener("pointermove", pointerMove);
      el.removeEventListener("pointerup", pointerUp);
      el.removeEventListener("pointercancel", pointerUp);
      el.removeEventListener("wheel", wheel);
    };
  }, [camera, gl]);

  /* ----------------------------- per-frame ---------------------------- */

  useFrame((_, delta) => {
    const d = Math.min(delta, 0.05);
    const limits = cfg.current;

    // Autonomous flight (focus / reset / agent camera moves). Any user
    // input cancels it (userStart above); it never re-asserts itself.
    if (flight.current) {
      const f = flight.current;
      f.t += d / f.duration;
      const t = Math.min(1, f.t);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      camera.position.lerpVectors(f.fromPos, f.toPos, ease);
      if (mode.current === "orbit") {
        orbitTarget.current.lerpVectors(f.fromTarget, f.toTarget, ease);
      }
      if (t >= 1) {
        flight.current = null;
        // Adopt the flight's final pose into the active mode so the
        // camera NEVER snaps back to its pre-flight position.
        if (mode.current === "orbit") {
          orbitTarget.current.copy(f.toTarget);
          const offset = camera.position.clone().sub(orbitTarget.current);
          spherical.current.radius = clamp(
            offset.length(),
            limits.minDistance,
            limits.maxDistance,
          );
          spherical.current.theta = Math.atan2(offset.x, offset.z);
          spherical.current.phi = Math.acos(
            clamp(offset.y / Math.max(0.01, offset.length()), -1, 1),
          );
        } else {
          const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
          yaw.current = euler.y;
          pitch.current = clamp(euler.x, -Math.PI / 2.4, Math.PI / 2.4);
        }
      }
      camera.lookAt(
        mode.current === "orbit" ? orbitTarget.current : f.toTarget,
      );
      return;
    }

    if (mode.current === "orbit") {
      const s = spherical.current;
      const offset = new THREE.Vector3(0, 0, s.radius)
        .applyAxisAngle(X_AXIS, s.phi)
        .applyAxisAngle(Y_AXIS, s.theta);
      camera.position.copy(orbitTarget.current).add(offset);
      clampToWorld(camera.position, limits);
      camera.lookAt(orbitTarget.current);
      return;
    }

    /* Free-fly movement */
    const k = keys.current;
    const speed = limits.moveSpeed * (k["shift"] ? 2.2 : 1);
    const forward = new THREE.Vector3(
      -Math.sin(yaw.current),
      0,
      -Math.cos(yaw.current),
    ).normalize();
    const right = new THREE.Vector3().crossVectors(forward, Y_AXIS).normalize();
    if (k["w"] || k["arrowup"]) flyPos.current.addScaledVector(forward, speed * d);
    if (k["s"] || k["arrowdown"]) flyPos.current.addScaledVector(forward, -speed * d);
    if (k["a"] || k["arrowleft"]) flyPos.current.addScaledVector(right, -speed * d);
    if (k["d"] || k["arrowright"]) flyPos.current.addScaledVector(right, speed * d);
    if (k["q"] || k["e"]) {
      const down = k["q"] ? 1 : -1;
      flyPos.current.addScaledVector(Y_AXIS, -down * speed * d);
    }
    clampToWorld(flyPos.current, limits);

    camera.position.copy(flyPos.current);
    camera.quaternion.setFromEuler(new THREE.Euler(pitch.current, yaw.current, 0, "YXZ"));
  });

  return null;
}
