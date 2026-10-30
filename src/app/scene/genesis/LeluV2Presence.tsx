/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS V2 — LÉLU PRESENCE
 *
 * LÉLU herself, standing in the Cosmos: the same character rig
 * (core/avatar/LeluRig) the companion and the Avatar panel draw — the
 * owner's reference, cut out of its background, animated live: blinking,
 * gaze, expressions, head and body motion, and a mouth driven by her
 * actual speech (core/avatar/LeluAnimation, shared with every surface).
 *
 * In the scene she is a camera-facing figure whose transparent pixels are
 * transparent: no card, no frame, no halo square, no platform — the
 * Cosmos is behind her. Embodied and hologram are two materials of the
 * same rig (LeluCharacterStore). Executive avatar commands (wave, nod,
 * bow, move…) are performed as real transform work and confirmed by
 * measured deltas, as before.
 *
 * The generic procedural figure and the flat saved-image billboard that
 * stood here are gone: the owner's reference is her identity.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import AvatarCommandBus, { type AvatarCommand } from "../../../core/avatar/AvatarCommandBus";
import AgentEventBus from "../../../core/agent/AgentEvents";
import ExecutiveRuntime from "../../../core/executive/ExecutiveRuntime";
import LeluAnimation from "../../../core/avatar/LeluAnimation";
import { loadLook, rigUniforms, viewFor, RIG_FRAGMENT_SHADER, type LoadedLook } from "../../../core/avatar/LeluRig";
import { V2_LELU_POS } from "./GenesisV2CameraRig";
import { useLeluCharacter } from "./avatar/useLeluCharacter";

import {
  ACTIVITY_ACCENT,
  useLeluActivity,
  type LeluActivity,
} from "./avatar/leluActivity";

export { useLeluActivity, type LeluActivity };

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

/* ------------------------------ her, in 3D ---------------------------- */

/** Her height in scene units (feet to the top of her hair): whole in the LÉLU camera framing. */
const LELU_HEIGHT = 1.9;

const RIG_MESH_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

function toUniformValue(value: number | number[]): number | THREE.Vector2 | THREE.Vector3 | THREE.Vector4 {
  if (typeof value === "number") return value;
  if (value.length === 2) return new THREE.Vector2(value[0], value[1]);
  if (value.length === 3) return new THREE.Vector3(value[0], value[1], value[2]);
  return new THREE.Vector4(value[0], value[1], value[2], value[3]);
}

function RigAvatarPresence({ look, activity, form, position }: { look: LoadedLook; activity: LeluActivity; form: "embodied" | "hologram"; position?: THREE.Vector3 }) {
  const pos = position ?? V2_LELU_POS;
  const { camera } = useThree();
  const group = useRef<THREE.Group>(null);
  const telemetry = useRef({ lastReport: 0, lastY: 0 });
  const cmdRun = useRef<CommandRunState | null>(null);
  const cmdDone = useRef<string | null>(null);
  const holo = useRef(form === "hologram" ? 1 : 0);
  const accent = ACTIVITY_ACCENT[activity];

  // The whole figure, hair to feet, with room for her arms and hem.
  const view = useMemo(() => viewFor(look.rig, "full", 0.55), [look]);
  const aspect = (view[2] - view[0]) / (view[3] - view[1]);

  const material = useMemo(() => {
    const texture = new THREE.Texture(look.image);
    texture.premultiplyAlpha = true;
    // The shader reads her image top-down (row 0 = the top of her hair).
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    const uniforms: Record<string, THREE.IUniform> = { uTex: { value: texture } };
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: RIG_MESH_VERTEX,
      fragmentShader: RIG_FRAGMENT_SHADER,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }, [look]);
  useEffect(() => () => {
    (material.uniforms.uTex.value as THREE.Texture).dispose();
    material.dispose();
  }, [material]);

  useEffect(() => LeluAnimation.getInstance().attach(), []);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    if (!group.current) return;
    // She faces you wherever you look from — never seen edge-on — and her
    // "up" stays the world's up: the camera's roll never tips her over.
    let posX = pos.x;
    let posY = pos.y;
    group.current.position.set(posX, posY, pos.z);
    group.current.lookAt(camera.position);

    // Executive avatar commands — real transform work, verified by deltas.
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
          group.current.rotateZ(Math.sin(elapsed / 90) * 0.12 * envelope);
          posY += envelope * 0.05;
          break;
        case "move":
          posX += Math.sin(p * Math.PI * 2) * 0.7;
          break;
        case "look":
          group.current.rotateZ(Math.sin(elapsed / 260) * 0.06 * envelope);
          posX += envelope * 0.04;
          break;
        case "dance":
          posY += Math.abs(Math.sin(elapsed / 130)) * 0.18;
          group.current.rotateZ(Math.sin(elapsed / 110) * 0.1);
          break;
        case "nod":
          posY -= envelope * 0.08 * (0.5 + 0.5 * Math.sin(elapsed / 140));
          break;
        case "bow":
          group.current.rotateZ(-envelope * 0.18);
          posY -= envelope * 0.12;
          break;
      }
      group.current.position.set(posX, posY, pos.z);
      if (elapsed >= command.durationMs) {
        cmdDone.current = command.id;
        settleCommand(cmdRun, command, posX, posY);
      }
    }

    // This moment of her — the same one every other surface draws.
    const animation = LeluAnimation.getInstance();
    animation.setActivity(activity);
    const params = animation.frame(performance.now());
    holo.current += ((form === "hologram" ? 1 : 0) - holo.current) * (1 - Math.exp(-6 * Math.min(0.1, delta)));
    const uniforms = rigUniforms(look.rig, params, { view, framing: "full", holo: holo.current, time: t });
    for (const [name, value] of Object.entries(uniforms)) {
      const existing = material.uniforms[name];
      const next = toUniformValue(value);
      if (!existing) material.uniforms[name] = { value: next };
      else if (typeof next === "number") existing.value = next;
      else (existing.value as THREE.Vector2 | THREE.Vector3 | THREE.Vector4).copy(next as never);
    }

    const now = performance.now();
    if (now - telemetry.current.lastReport > 1_000) {
      telemetry.current.lastReport = now;
      // Her breathing and sway move her every frame; a transform that never
      // changes means the render loop has stopped.
      ExecutiveRuntime.getInstance().reportAvatarFrame(
        Math.abs(params.breath - telemetry.current.lastY) > 0.001 || Math.abs(group.current.position.y - pos.y) > 0.001,
      );
      telemetry.current.lastY = params.breath;
    }
  });

  return (
    <group ref={group} position={[pos.x, pos.y, pos.z]} name="V2LeluPresence">
      <mesh scale={[LELU_HEIGHT * aspect, LELU_HEIGHT, 1]} raycast={() => null} material={material}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      {/* live activity label — the real state, not an idle animation */}
      <Html
        position={[0, LELU_HEIGHT / 2 + 0.14, 0]}
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

/* --------------------------- the presence ----------------------------- */

export default function LeluV2Presence({ position }: { position?: THREE.Vector3 }) {
  const activity = useLeluActivity();
  const character = useLeluCharacter();
  const [look, setLook] = useState<LoadedLook | null>(null);
  useEffect(() => {
    let alive = true;
    loadLook(character.look).then(
      (loaded) => {
        if (alive) setLook(loaded);
      },
      (error: unknown) => console.warn("[LeluV2Presence] her look did not load:", error),
    );
    return () => {
      alive = false;
    };
  }, [character.look]);

  // Report unmount so diagnostics can distinguish "renderer not running"
  // from "presence legitimately closed".
  useEffect(() => {
    return () => ExecutiveRuntime.getInstance().reportAvatarUnmounted();
  }, []);

  return (
    <group name="V2Lelu">
      {look ? <RigAvatarPresence look={look} activity={activity} form={character.form} position={position} /> : null}

    </group>
  );
}
