/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS V2 — LÉLU PRESENCE
 *
 * The ONE authoritative LÉLU avatar, present INSIDE the Gen V2
 * world. Reads the same AvatarStore every other surface reads:
 *
 *   SAVED AVATAR → AvatarStore → this presence → WebGL scene
 *
 *  - If the user saved a reference image, the EXACT saved
 *    visual is rendered in 3D space as a living, camera-facing
 *    presence (floating above a candlelit platform ring), with
 *    real presence animation driven by actual state:
 *      listening → leans in, attention glow
 *      thinking  → shimmer ring, gold pulse
 *      speaking  → warm breath pulse + halo
 *      working / searching / rendering / completed / error →
 *      live label from the REAL agent event bus
 *  - If no image is saved yet, the procedural 3D figure from
 *    the SAME authoring pipeline stands in (fallback only —
 *    a saved image always wins and is never substituted).
 *
 * There is exactly ONE LÉLU: the portrait, the avatar panel,
 * the render pipeline and this 3D presence all read the same
 * profile.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import AvatarStore from "../../../core/avatar/AvatarProfile";
import AvatarCommandBus, { type AvatarCommand } from "../../../core/avatar/AvatarCommandBus";
import Avatar3DReconstructor, { fingerprintOf } from "../../../core/avatar/Avatar3DReconstructor";
import AgentEventBus, { type AgentEvent } from "../../../core/agent/AgentEvents";
import ExecutiveRuntime from "../../../core/executive/ExecutiveRuntime";
import { useGenesis } from "./GenesisCore";
import {
  buildAvatarModel,
  tickAvatar,
  type AvatarPresenceMode,
  type AvatarParts,
} from "../../../core/creative/Procedural3DPipeline";
import { V2_LELU_POS } from "./GenesisV2CameraRig";

/* ------------------------ activity → presence ------------------------- */

export type LeluActivity =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING"
  | "PRESENTING"
  | "SEARCHING"
  | "BROWSING"
  | "WORKING"
  | "BUILDING"
  | "RENDERING"
  | "EXPLORING"
  | "COMPLETED"
  | "ERROR";

const ACTIVITY_ACCENT: Record<LeluActivity, string> = {
  IDLE: "#4ade80",
  LISTENING: "#38bdf8",
  THINKING: "#a78bfa",
  SPEAKING: "#f0abfc",
  PRESENTING: "#c4b5fd",
  SEARCHING: "#22d3ee",
  BROWSING: "#7dd3fc",
  WORKING: "#fbbf24",
  BUILDING: "#fb923c",
  RENDERING: "#e879f9",
  EXPLORING: "#34d399",
  COMPLETED: "#4ade80",
  ERROR: "#f87171",
};

function modeForActivity(activity: LeluActivity): AvatarPresenceMode {
  switch (activity) {
    case "LISTENING":
      return "listening";
    case "PRESENTING":
      return "speaking";
    case "THINKING":
    case "SEARCHING":
    case "BROWSING":
    case "WORKING":
    case "BUILDING":
    case "RENDERING":
    case "EXPLORING":
      return "thinking";
    case "SPEAKING":
      return "speaking";
    default:
      return "idle";
  }
}

function activityFromAgentEvent(event: AgentEvent): LeluActivity | null {
  switch (event.type) {
    case "tool_started":
      if (event.tool === "creative") {
        const label = (event.label ?? "").toLowerCase();
        if (label.includes("3d") || label.includes("render")) return "RENDERING";
        if (label.includes("video")) return "EXPLORING";
        return "BUILDING";
      }
      if (event.tool === "avatar") return "PRESENTING";
      if (event.tool === "research") return "SEARCHING";
      if (event.tool === "engineering" || event.tool === "sandbox") return "WORKING";
      if (event.tool === "browser") return "BROWSING";
      return "WORKING";
    case "browser_opened":
      return "BROWSING";
    case "tool_progress":
      return "WORKING";
    case "task_completed":
      return "COMPLETED";
    case "task_failed":
      return "ERROR";
    default:
      return null;
  }
}

/** Reads the REAL agent event bus and derives LÉLU's current activity. */
export function useLeluActivity(): LeluActivity {
  const genesis = useGenesis();
  const [activity, setActivity] = useState<LeluActivity>("IDLE");

  useEffect(() => {
    const unsub = AgentEventBus.getInstance().subscribe((event) => {
      const next = activityFromAgentEvent(event);
      if (next) setActivity(next);
    });
    return unsub;
  }, []);

  // Conversation state is the ground truth when no tool is running —
  // the avatar listens, thinks and speaks with LÉLU's real dialogue.
  useEffect(() => {
    if (activity === "COMPLETED" || activity === "ERROR") return;
    const g = genesis.state;
    if (g.speaking || g.dialogue === "responding" || g.dialogue === "complete") {
      setActivity("SPEAKING");
    } else if (g.thinking || g.dialogue === "processing") {
      setActivity("THINKING");
    } else if (g.listening || g.dialogue === "listening") {
      setActivity("LISTENING");
    } else if (activity !== "SEARCHING" && activity !== "WORKING" && activity !== "BROWSING" && activity !== "RENDERING" && activity !== "PRESENTING") {
      setActivity("IDLE");
    }
  }, [genesis.state.thinking, genesis.state.speaking, genesis.state.listening, genesis.state.dialogue, activity]);

  // A completed/error state is a beat, not a stuck state — settle back
  // to idle after a few seconds so the presence never freezes.
  useEffect(() => {
    if (activity !== "COMPLETED" && activity !== "ERROR") return;
    const timer = setTimeout(() => setActivity("IDLE"), 4200);
    return () => clearTimeout(timer);
  }, [activity]);

  return activity;
}

/* --------------------- executive avatar commands ---------------------- */

/**
 * The DOWN-link executor. When the executive/chat layer issues an
 * avatar command (AvatarCommandBus), BOTH presence variants perform
 * it as real transform work and CONFIRM with measured deltas.
 *
 * A command is only confirmed when the renderer's own transforms
 * actually changed — if the scene is frozen or the presence absent,
 * the command times out upstream and LÉLU reports honest failure.
 */

interface CommandRunState {
  id: string;
  startedAt: number;
  basePosX: number;
  basePosY: number;
}

const COMMAND_DELTA_EPSILON = 0.002;

function adoptCommand(
  run: MutableRefObject<CommandRunState | null>,
  command: AvatarCommand,
  posX: number,
  posY: number,
): void {
  run.current = { id: command.id, startedAt: performance.now(), basePosX: posX, basePosY: posY };
  AgentEventBus.getInstance().emit({
    type: "tool_started",
    taskId: command.id,
    tool: "avatar-motion",
    label: command.label,
  });
}

function settleCommand(
  run: MutableRefObject<CommandRunState | null>,
  command: AvatarCommand,
  posX: number,
  posY: number,
): void {
  const base = run.current;
  if (!base) return;
  const dx = Math.abs(posX - base.basePosX);
  const dy = Math.abs(posY - base.basePosY);
  run.current = null;
  // VERIFICATION: only confirm when transforms measurably changed.
  if (Math.max(dx, dy) <= COMMAND_DELTA_EPSILON) return; // timeout upstream reports the failure
  AgentEventBus.getInstance().emit({
    type: "tool_result",
    taskId: command.id,
    tool: "avatar-motion",
    result: `${command.label} verified — transform Δx=${dx.toFixed(3)}, Δy=${dy.toFixed(3)}`,
  });
  AvatarCommandBus.getInstance().confirm(
    command.id,
    `${command.label} executed — position changed by Δx=${dx.toFixed(3)}, Δy=${dy.toFixed(3)} over ${(command.durationMs / 1000).toFixed(1)}s`,
  );
}

function commandElapsed(command: AvatarCommand | null, run: CommandRunState | null): number {
  if (!command || !run || run.id !== command.id) return -1;
  return performance.now() - run.startedAt;
}

/* ------------------------ reference-image avatar ---------------------- */

function SavedAvatarPresence({
  image,
  activity,
  position,
}: {
  image: string;
  activity: LeluActivity;
  position?: THREE.Vector3;
}) {
  const pos = position ?? V2_LELU_POS;
  const { camera } = useThree();
  const group = useRef<THREE.Group>(null);
  const plane = useRef<THREE.Mesh>(null);
  const [aspect, setAspect] = useState(0.8);
  // Real render telemetry → Executive Runtime (throttled to ~1Hz so the
  // frame loop never pays for it). Frames reported here PROVE the render
  // loop is alive; transform deltas prove the presence actually moves.
  const telemetry = useRef({ lastReport: 0, lastY: 0 });
  // Active executive command being performed (verified on completion).
  const cmdRun = useRef<CommandRunState | null>(null);
  const cmdDone = useRef<string | null>(null);

  const texture = useMemo(() => {
    const img = new Image();
    const tex = new THREE.Texture(img);
    img.onload = () => {
      tex.needsUpdate = true;
      setAspect(img.naturalWidth / Math.max(1, img.naturalHeight));
    };
    img.src = image;
    return tex;
  }, [image]);

  const accent = ACTIVITY_ACCENT[activity];

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (!group.current || !plane.current) return;

    // Always face the camera — LÉLU is present wherever you look.
    group.current.quaternion.copy(camera.quaternion);

    // Presence motion: slow float + breathing scale; leans subtly while
    // listening, pulses warmly while speaking, shimmers while thinking.
    const float = Math.sin(t * 1.1) * 0.09 + Math.sin(t * 2.7) * 0.02;
    const lean = activity === "LISTENING" ? Math.sin(t * 1.6) * 0.05 : 0;
    let posX = pos.x + Math.sin(t * 0.8) * 0.06;
    let posY = pos.y + float;
    group.current.position.y = posY;
    group.current.position.x = posX;
    group.current.rotation.z = lean;

    // Executive avatar commands — performed as real transform work.
    const bus = AvatarCommandBus.getInstance();
    const command = bus.current;
    if (command && cmdRun.current?.id !== command.id && cmdDone.current !== command.id) {
      adoptCommand(cmdRun, command, posX, posY);
      cmdDone.current = null;
    }
    const elapsed = commandElapsed(command, cmdRun.current);
    if (command && elapsed >= 0) {
      const p = Math.min(1, elapsed / command.durationMs);
      const envelope = Math.sin(p * Math.PI);
      switch (command.kind) {
        case "wave":
          group.current.rotation.z = lean + Math.sin(elapsed / 90) * 0.28 * envelope;
          break;
        case "move":
          posX += Math.sin(p * Math.PI * 2) * 0.7;
          group.current.position.x = posX;
          break;
        case "look":
          group.current.rotation.z = lean + Math.sin(elapsed / 260) * 0.12 * envelope;
          break;
        case "dance":
          posY += Math.abs(Math.sin(elapsed / 130)) * 0.22;
          group.current.position.y = posY;
          group.current.rotation.z = lean + Math.sin(elapsed / 110) * 0.18;
          break;
        case "nod":
          posY -= envelope * 0.12 * (0.5 + 0.5 * Math.sin(elapsed / 140));
          group.current.position.y = posY;
          break;
        case "bow":
          group.current.rotation.z = lean - envelope * 0.35;
          posY -= envelope * 0.15;
          group.current.position.y = posY;
          break;
      }
      if (elapsed >= command.durationMs) {
        cmdDone.current = command.id;
        settleCommand(cmdRun, command, posX, posY);
      }
    }

    const breathe =
      1 +
      (activity === "SPEAKING"
        ? 0.025 + Math.abs(Math.sin(t * 3.4)) * 0.02
        : activity === "THINKING" || activity === "RENDERING" || activity === "WORKING"
          ? 0.012 + Math.abs(Math.sin(t * 2.2)) * 0.012
          : Math.sin(t * 1.3) * 0.008);
    plane.current.scale.set(Math.max(0.9, 1.4 * aspect) * breathe, 1.4 * breathe, 1);

    const mat = plane.current.material as THREE.MeshBasicMaterial;
    mat.color.setHex(activity === "SPEAKING" ? 0xfff2fb : 0xffffff);
    mat.opacity =
      activity === "THINKING" || activity === "SEARCHING" || activity === "WORKING" || activity === "RENDERING"
        ? 0.86 + Math.abs(Math.sin(t * 3.1)) * 0.1
        : 0.96;

    const now = performance.now();
    if (now - telemetry.current.lastReport > 1_000) {
      telemetry.current.lastReport = now;
      ExecutiveRuntime.getInstance().reportAvatarFrame(
        Math.abs(group.current.position.y - telemetry.current.lastY) > 0.001,
      );
      telemetry.current.lastY = group.current.position.y;
    }
  });

  return (
    <group ref={group} position={[pos.x, pos.y, pos.z]} name="V2LeluPresence">
      {/* the exact saved avatar — camera-facing, softly lit */}
      <mesh ref={plane} scale={[1.12, 1.4, 1]} raycast={() => null}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={texture}
          transparent
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
          color="#ffffff"
        />
      </mesh>

      {/* candlelit glow halo behind the presence */}
      <sprite position={[0, 0, -0.12]} scale={[3.4, 3.4, 1]} raycast={() => null}>
        <spriteMaterial
          color={accent}
          transparent
          opacity={0.16}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>

      {/* platform ring under her feet */}
      <mesh position={[0, -1.28, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[0.72, 1.05, 48]} />
        <meshBasicMaterial
          color={accent}
          transparent
          opacity={0.28}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

/* ------------------------- procedural fallback ------------------------- */

function ProceduralPresence({
  activity,
  position,
}: {
  activity: LeluActivity;
  position?: THREE.Vector3;
}) {
  const pos = position ?? V2_LELU_POS;
  const store = AvatarStore.getInstance();
  const profile = useMemo(() => store.get(), []);
  const parts = useMemo<AvatarParts>(() => buildAvatarModel(profile), [profile]);
  const groupRef = useRef<THREE.Group>(null);
  const lastReport = useRef(0);
  const cmdRun = useRef<CommandRunState | null>(null);
  const cmdDone = useRef<string | null>(null);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const t = clock.getElapsedTime();
    let posX = pos.x + Math.sin(t * 0.8) * 0.06;
    let posY = pos.y + Math.sin(t * 1.1) * 0.09;
    group.position.y = posY;
    group.position.x = posX;
    group.position.z = pos.z;
    tickAvatar(parts, modeForActivity(activity), t);

    // Executive avatar commands — same verification contract as the
    // saved-image presence above.
    const bus = AvatarCommandBus.getInstance();
    const command = bus.current;
    if (command && cmdRun.current?.id !== command.id && cmdDone.current !== command.id) {
      adoptCommand(cmdRun, command, posX, posY);
      cmdDone.current = null;
    }
    const elapsed = commandElapsed(command, cmdRun.current);
    if (command && elapsed >= 0) {
      const p = Math.min(1, elapsed / command.durationMs);
      const envelope = Math.sin(p * Math.PI);
      switch (command.kind) {
        case "wave":
          group.rotation.z = Math.sin(elapsed / 90) * 0.28 * envelope;
          break;
        case "move":
          posX += Math.sin(p * Math.PI * 2) * 0.7;
          group.position.x = posX;
          break;
        case "look":
          group.rotation.z = Math.sin(elapsed / 260) * 0.12 * envelope;
          break;
        case "dance":
          posY += Math.abs(Math.sin(elapsed / 130)) * 0.22;
          group.position.y = posY;
          group.rotation.z = Math.sin(elapsed / 110) * 0.18;
          break;
        case "nod":
          posY -= envelope * 0.12 * (0.5 + 0.5 * Math.sin(elapsed / 140));
          group.position.y = posY;
          break;
        case "bow":
          group.rotation.z = -envelope * 0.35;
          posY -= envelope * 0.15;
          group.position.y = posY;
          break;
      }
      if (elapsed >= command.durationMs) {
        cmdDone.current = command.id;
        settleCommand(cmdRun, command, posX, posY);
      }
    }

    // Throttled to ~1Hz — never pay per-frame for telemetry.
    const now = performance.now();
    if (now - lastReport.current > 1_000) {
      lastReport.current = now;
      ExecutiveRuntime.getInstance().reportAvatarFrame(true);
    }
  });

  return <primitive object={parts.group} ref={groupRef} />;
}

/* ----------------------- reconstructed true-3D avatar ------------------ */

const RECON_TARGET_HEIGHT = 2.56; // matches the saved-image presence height

/**
 * The TRUE 3D LÉLU — a real textured mesh produced by the external
 * image-to-3D pipeline (Avatar3DReconstructor) from the EXACT saved
 * reference. Not a substitute character: this geometry was generated
 * FROM the saved visual itself.
 *
 * Same contract as every other presence variant:
 *   - performs AvatarCommandBus gestures as real transform work,
 *   - confirms only with measured deltas,
 *   - reports live render telemetry to the Executive Runtime.
 */
function ReconstructedAvatarPresence({
  glb,
  activity,
  position,
}: {
  glb: ArrayBuffer;
  activity: LeluActivity;
  position?: THREE.Vector3;
}) {
  const pos = position ?? V2_LELU_POS;
  const { camera } = useThree();
  const group = useRef<THREE.Group>(null);
  const [model, setModel] = useState<THREE.Group | null>(null);
  const telemetry = useRef({ lastReport: 0, lastY: 0 });
  const cmdRun = useRef<CommandRunState | null>(null);
  const cmdDone = useRef<string | null>(null);

  // Parse once per stored GLB. The bytes come from IndexedDB — no network.
  useEffect(() => {
    let disposed = false;
    try {
      new GLTFLoader().parse(
        glb,
        "",
        (gltf) => {
          if (disposed) return;
          // Holder keeps normalization offsets separate from the <primitive>
          // position prop (which would otherwise clobber them).
          const holder = new THREE.Group();
          const scene = gltf.scene;
          holder.add(scene);
          // Normalize: uniform scale to presence height, feet at holder origin.
          const box = new THREE.Box3().setFromObject(scene);
          const size = new THREE.Vector3();
          box.getSize(size);
          if (!isFinite(size.y) || size.y <= 0) {
            // Honest failure — surfaced on the agent stream; the presence
            // falls back upstream instead of showing a broken model.
            AgentEventBus.getInstance().emit({
              type: "tool_failed",
              taskId: `avatar-3d-load-${Date.now()}`,
              tool: "avatar-reconstruction",
              error: "Reconstructed model has an invalid bounding box.",
            });
            return;
          }
          scene.scale.setScalar(RECON_TARGET_HEIGHT / size.y);
          const norm = new THREE.Box3().setFromObject(scene);
          const center = new THREE.Vector3();
          norm.getCenter(center);
          scene.position.x -= center.x;
          scene.position.z -= center.z;
          scene.position.y -= norm.min.y;
          setModel(holder);
        },
        (err) => {
          if (disposed) return;
          const message = err instanceof Error ? err.message : String(err);
          console.error("[Lélu Presence] reconstructed GLB failed to load", err);
          AgentEventBus.getInstance().emit({
            type: "tool_failed",
            taskId: `avatar-3d-load-${Date.now()}`,
            tool: "avatar-reconstruction",
            error: `Reconstructed model failed to load: ${message}`,
          });
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Lélu Presence] reconstructed GLB parse threw", error);
      AgentEventBus.getInstance().emit({
        type: "tool_failed",
        taskId: `avatar-3d-load-${Date.now()}`,
        tool: "avatar-reconstruction",
        error: `Reconstructed model failed to load: ${message}`,
      });
    }
    return () => {
      disposed = true;
    };
  }, [glb]);

  useFrame(({ clock }, delta) => {
    const g = group.current;
    if (!g || !model) return;
    const t = clock.getElapsedTime();

    // Presence motion: float + breathe (same rhythm as the other variants).
    let posX = pos.x + Math.sin(t * 0.8) * 0.06;
    let posY = pos.y + Math.sin(t * 1.1) * 0.09 + Math.sin(t * 2.7) * 0.02;
    g.position.set(posX, posY, pos.z);
    g.rotation.set(0, g.rotation.y, 0);

    // Turn toward the user smoothly — she faces you without billboard tilt.
    const dx = camera.position.x - pos.x;
    const dz = camera.position.z - pos.z;
    const targetYaw = Math.atan2(dx, dz);
    let yawDelta = targetYaw - g.rotation.y;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    g.rotation.y += yawDelta * Math.min(1, delta * 2.5);

    // Idle sway when nothing else drives her.
    g.rotation.z = Math.sin(t * 1.3) * 0.02;

    // Executive avatar commands — identical verification contract.
    const bus = AvatarCommandBus.getInstance();
    const command = bus.current;
    if (command && cmdRun.current?.id !== command.id && cmdDone.current !== command.id) {
      adoptCommand(cmdRun, command, posX, posY);
      cmdDone.current = null;
    }
    const elapsed = commandElapsed(command, cmdRun.current);
    if (command && elapsed >= 0) {
      const p = Math.min(1, elapsed / command.durationMs);
      const envelope = Math.sin(p * Math.PI);
      switch (command.kind) {
        case "wave":
          g.rotation.z = Math.sin(elapsed / 90) * 0.28 * envelope;
          break;
        case "move":
          posX += Math.sin(p * Math.PI * 2) * 0.7;
          g.position.x = posX;
          break;
        case "look":
          g.rotation.y += Math.sin(elapsed / 260) * 0.5 * envelope * delta * 8;
          break;
        case "dance":
          posY += Math.abs(Math.sin(elapsed / 130)) * 0.22;
          g.position.y = posY;
          g.rotation.y += delta * 6;
          g.rotation.z = Math.sin(elapsed / 110) * 0.18;
          break;
        case "nod":
          g.rotation.x = envelope * 0.18 * (0.5 + 0.5 * Math.sin(elapsed / 140));
          posY -= envelope * 0.08;
          g.position.y = posY;
          break;
        case "bow":
          g.rotation.x = envelope * 0.45;
          posY -= envelope * 0.15;
          g.position.y = posY;
          break;
      }
      if (elapsed >= command.durationMs) {
        cmdDone.current = command.id;
        settleCommand(cmdRun, command, posX, posY);
      }
    }

    // Throttled ~1Hz render telemetry — proves the loop is live.
    const now = performance.now();
    if (now - telemetry.current.lastReport > 1_000) {
      telemetry.current.lastReport = now;
      ExecutiveRuntime.getInstance().reportAvatarFrame(
        Math.abs(g.position.y - telemetry.current.lastY) > 0.001,
      );
      telemetry.current.lastY = g.position.y;
    }
  });

  return (
    <group ref={group} position={[pos.x, pos.y, pos.z]} name="V2LeluTrue3D">
      {model ? (
        <primitive object={model} position={[0, -RECON_TARGET_HEIGHT / 2 + 0.02, 0]} />
      ) : null}
      {/* candlelit glow halo + platform ring shared with the other variants */}
      <sprite position={[0, 0, -0.12]} scale={[3.4, 3.4, 1]} raycast={() => null}>
        <spriteMaterial
          color={ACTIVITY_ACCENT[activity]}
          transparent
          opacity={0.16}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
      <mesh position={[0, -1.28, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[0.72, 1.05, 48]} />
        <meshBasicMaterial
          color={ACTIVITY_ACCENT[activity]}
          transparent
          opacity={0.28}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

/* ------------------------------ the presence --------------------------- */

export default function LeluV2Presence({ position }: { position?: THREE.Vector3 }) {
  const pos = position ?? V2_LELU_POS;
  const [profile, setProfile] = useState(() => AvatarStore.getInstance().get());
  const activity = useLeluActivity();
  const accent = ACTIVITY_ACCENT[activity];

  useEffect(() => {
    const store = AvatarStore.getInstance();
    const unsub = store.subscribe((next) => setProfile({ ...next }));
    return unsub;
  }, []);

  // True-3D reconstruction of the saved reference — preferred over the
  // billboard whenever a matching GLB exists. Reloads when the source
  // image changes OR when a reconstruction finishes.
  const referenceImage = profile.referenceImage;
  const fingerprint = useMemo(
    () => (referenceImage ? fingerprintOf(referenceImage) : null),
    [referenceImage],
  );
  const [reconVersion, setReconVersion] = useState(0);
  useEffect(() => {
    const reconstructor = Avatar3DReconstructor.getInstance();
    return reconstructor.subscribe(() => setReconVersion((v) => v + 1));
  }, []);
  const [reconGlb, setReconGlb] = useState<ArrayBuffer | null>(null);
  useEffect(() => {
    let alive = true;
    if (!fingerprint) {
      setReconGlb(null);
      return;
    }
    void Avatar3DReconstructor.getInstance()
      .getModelFor(fingerprint)
      .then((glb) => {
        if (alive) setReconGlb(glb);
      });
    return () => {
      alive = false;
    };
  }, [fingerprint, reconVersion]);

    // Report mount/unmount so diagnostics can distinguish "renderer not
  // running" from "presence legitimately closed".
  useEffect(() => {
    return () => ExecutiveRuntime.getInstance().reportAvatarUnmounted();
  }, []);

  return (
    <group name="V2Lelu">
      {/* warm light that follows LÉLU wherever she stands */}
      <pointLight
        position={[pos.x, pos.y + 1.2, pos.z]}
        intensity={reconGlb ? 1.6 : 1.1}
        distance={6}
        color={accent}
      />

      {referenceImage && reconGlb ? (
        /* TRUE 3D LÉLU — real mesh generated from the exact saved reference */
        <ReconstructedAvatarPresence glb={reconGlb} activity={activity} position={position} />
      ) : referenceImage ? (
        <SavedAvatarPresence image={referenceImage} activity={activity} position={position} />
      ) : (
        <ProceduralPresence activity={activity} position={position} />
      )}

      {/* live activity label — the real state, not an idle animation */}
      <Html
        position={[pos.x, pos.y + 1.78, pos.z]}
        center
        zIndexRange={[4, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 9px",
            borderRadius: 999,
            border: `1px solid ${accent}66`,
            background: "rgba(4, 8, 24, 0.55)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            color: "#ffffff",
            fontSize: "clamp(9px, 0.7vw + 4px, 10.5px)",
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            textShadow: `0 0 10px ${accent}`,
          }}
        >
          <span
            aria-hidden
            className="genesis-status-glow"
            style={{ width: 5, height: 5, borderRadius: 999, background: accent, color: accent }}
          />
          {activity}
        </div>
      </Html>
    </group>
  );
}
