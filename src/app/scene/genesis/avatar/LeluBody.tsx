/**
 * ==========================================================
 * LÉLU — HER BODY (shared by every surface)
 *
 * The approved 3D Forge model, alive: parsed once per approved
 * version, normalised to a given height with her feet at the
 * origin, her own clips (and the Forge animation slots made for
 * the same rig) on a mixer, and AvatarBehaviour on top — gaze
 * toward the viewer, head and body language from her REAL
 * activity, a word-synchronised mouth from her real speech, and
 * blinking/expressions on every face control the model has.
 *
 * The Cosmos world (LeluV2Presence) places this in the world; the
 * companion (LeluCharacter) frames it in its own transparent view
 * over chat and workspaces. Same model, same controller, same
 * drivers — one LÉLU, not one per screen.
 * ==========================================================
 */

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import AgentEventBus from "../../../../core/agent/AgentEvents";
import AvatarCommandBus, { type AvatarCommandKind } from "../../../../core/avatar/AvatarCommandBus";
import LeluMotion from "../../../../core/avatar/LeluMotion";
import {
  createAvatarBehaviour,
  SpeechEnvelope,
  SPEECH_BOUNDARY_EVENT,
  type AvatarBehaviour,
  type BehaviourMode,
  type Expression,
} from "../../../../core/avatar/AvatarBehaviour";
import type { AvatarMood } from "../../../../core/forge/ForgeClient";
import type { LeluActivity } from "./leluActivity";

export function behaviourModeFor(activity: LeluActivity): BehaviourMode {
  switch (activity) {
    case "SPEAKING":
    case "PRESENTING":
      return "speaking";
    case "LISTENING":
      return "listening";
    case "THINKING":
    case "SEARCHING":
      return "thinking";
    case "IDLE":
    case "COMPLETED":
    case "ERROR":
      return "idle";
    default:
      return "acting";
  }
}

export function expressionFor(activity: LeluActivity): Expression {
  switch (activity) {
    case "COMPLETED":
      return "happy";
    case "ERROR":
      return "concerned";
    case "THINKING":
    case "SEARCHING":
    case "WORKING":
    case "BUILDING":
      return "focused";
    case "LISTENING":
      return "attentive";
    case "SPEAKING":
    case "PRESENTING":
      return "happy";
    default:
      return "neutral";
  }
}

/** Which of her captured clips performs each command. */
const COMMAND_CLIPS: Record<AvatarCommandKind, string[]> = {
  wave: ["wave", "wave_big"],
  move: ["walk"],
  look: ["idle_look_around", "turn_left", "turn_right"],
  dance: ["dance_cherish", "dance_love"],
  nod: ["agree"],
  agree: ["agree"],
  bow: ["bow"],
  shrug: ["shrug"],
  heart: ["heart"],
  cheer: ["cheer"],
  jump: ["happy_jump"],
  sit: ["sit_idle"],
  stand: ["sit_to_stand"],
};

/** She greets the person once per visit, not once per surface. */
let greeted = false;

export interface LeluBodyInfo {
  /** Face and bone controls the model really has (reported by AvatarBehaviour). */
  capabilities: AvatarBehaviour["capabilities"];
  /** Bounds after normalisation (feet at y = 0). */
  height: number;
  /** Height of her head's centre, for framing a head-and-shoulders view. */
  headY: number;
  /** Her captured animation clips, by slot name. */
  clips: string[];
}

function reportFailure(message: string): void {
  AgentEventBus.getInstance().emit({
    type: "tool_failed",
    taskId: `avatar-3d-load-${Date.now()}`,
    tool: "avatar-reconstruction",
    error: message,
  });
}

export default function LeluBody({
  glb,
  clips,
  activity,
  mood,
  height,
  lookAt,
  onReady,
  onFrame,
}: {
  glb: ArrayBuffer;
  clips?: ArrayBuffer[];
  activity: LeluActivity;
  /** Resting expression when her activity asks for none. */
  mood?: AvatarMood;
  /** Normalised standing height in scene units. */
  height: number;
  /** Where she looks (default: the camera, i.e. the person). */
  lookAt?: () => THREE.Vector3 | null;
  onReady?: (info: LeluBodyInfo) => void;
  /** Called once per rendered frame after her pose is applied. */
  onFrame?: (time: number, playing: string | null) => void;
}) {
  const { camera } = useThree();
  const [model, setModel] = useState<THREE.Group | null>(null);
  const motion = useRef<LeluMotion | null>(null);
  const hand = useRef<THREE.Object3D | null>(null);
  const behaviour = useRef<AvatarBehaviour | null>(null);
  const envelope = useRef(new SpeechEnvelope());
  const speechClock = useRef(0);
  const callbacks = useRef({ onReady, onFrame, lookAt });
  callbacks.current = { onReady, onFrame, lookAt };

  // Each word LÉLU speaks (VoiceEngine word boundaries) opens the mouth and drives a nod.
  useEffect(() => {
    const onWord = (e: Event) =>
      envelope.current.word(speechClock.current, (e as CustomEvent<{ charLength?: number }>).detail?.charLength ?? 4);
    window.addEventListener(SPEECH_BOUNDARY_EVENT, onWord);
    return () => window.removeEventListener(SPEECH_BOUNDARY_EVENT, onWord);
  }, []);

  useEffect(() => {
    let disposed = false;
    const fail = (err: unknown) => {
      if (disposed) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Lélu Body] model failed to load", err);
      reportFailure(`LÉLU's 3D model failed to load: ${message}`);
    };
    try {
      new GLTFLoader().parse(
        glb,
        "",
        (gltf) => {
          if (disposed) return;
          // The holder carries the normalisation; callers position the holder.
          const holder = new THREE.Group();
          const scene = gltf.scene;
          holder.add(scene);
          const box = new THREE.Box3().setFromObject(scene);
          const size = new THREE.Vector3();
          box.getSize(size);
          if (!isFinite(size.y) || size.y <= 0) {
            reportFailure("LÉLU's 3D model has an invalid bounding box.");
            return;
          }
          scene.scale.setScalar(height / size.y);
          const norm = new THREE.Box3().setFromObject(scene);
          const center = new THREE.Vector3();
          norm.getCenter(center);
          scene.position.x -= center.x;
          scene.position.z -= center.z;
          scene.position.y -= norm.min.y;
          scene.traverse((o) => {
            // A small companion view and a world view both: never cull her away.
            o.frustumCulled = false;
          });
          behaviour.current = createAvatarBehaviour(scene);
          holder.updateMatrixWorld(true);
          let headY = height * 0.9;
          scene.traverse((o) => {
            if ((o as THREE.Bone).isBone && /^head$/i.test(o.name)) {
              headY = o.getWorldPosition(new THREE.Vector3()).y;
            }
          });
          scene.traverse((o) => {
            if (!hand.current && /^righthand$/i.test(o.name)) hand.current = o;
          });
          // Her captured motion: the model's own clip plus every approved slot
          // (motion-only GLBs, clips named by slot), on one controller.
          void Promise.all(
            (clips ?? []).map((bytes) =>
              new GLTFLoader().parseAsync(bytes, "").then((g) => g.animations).catch(() => [] as THREE.AnimationClip[]),
            ),
          ).then((extra) => {
            if (disposed || !behaviour.current) return;
            motion.current = new LeluMotion(scene, [...extra.flat(), ...gltf.animations]);
            console.info("[Lélu Body] avatar controls", behaviour.current.capabilities, "motion", motion.current.names);
            setModel(holder);
            callbacks.current.onReady?.({ capabilities: behaviour.current.capabilities, height, headY, clips: motion.current.names });
            if (!greeted && motion.current.has("wave")) {
              greeted = true;
              motion.current.play("wave");
            }
          });
        },
        fail,
      );
    } catch (error) {
      fail(error);
    }
    return () => {
      disposed = true;
      motion.current?.stop();
      motion.current = null;
      behaviour.current = null;
      hand.current = null;
    };
  }, [glb, clips, height]);

  // Commands ("wave", "dance", "bow"…) from chat or the executive: she
  // performs the clip, and the command is confirmed only when her hand
  // actually moved — measured, not assumed.
  useEffect(() => {
    if (!model) return;
    return AvatarCommandBus.getInstance().subscribe((command) => {
      const m = motion.current;
      if (!m) return;
      const options = COMMAND_CLIPS[command.kind].filter((name) => m.has(name));
      if (!options.length) return;
      const clip = options[Math.floor(Math.random() * options.length)];
      const start = hand.current?.getWorldPosition(new THREE.Vector3()) ?? null;
      m.play(clip);
      // Watch her hand through the gesture; confirm as soon as it has
      // really moved (some clips, like a dance, start slowly).
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const now = hand.current?.getWorldPosition(new THREE.Vector3());
        const moved = start && now ? start.distanceTo(now) : 0;
        if (moved > 0.01) {
          clearInterval(timer);
          AvatarCommandBus.getInstance().confirm(command.id, `played her “${clip}” animation (hand moved ${(moved * 100).toFixed(0)} cm)`);
        } else if (Date.now() - startedAt > command.durationMs + 1500) {
          clearInterval(timer);
        }
      }, 150);
    });
  }, [model]);

  // Moments in the conversation: done → a nod of agreement (sometimes a
  // heart), an error → a shrug.
  const lastActivity = useRef(activity);
  useEffect(() => {
    const previous = lastActivity.current;
    lastActivity.current = activity;
    const m = motion.current;
    if (!m || previous === activity) return;
    if (activity === "COMPLETED") m.play(Math.random() < 0.2 && m.has("heart") ? "heart" : "agree");
    else if (activity === "ERROR") m.play("shrug");
  }, [activity]);

  useFrame(({ clock }, delta) => {
    if (!model) return;
    const t = clock.getElapsedTime();
    speechClock.current = t;
    const mode = behaviourModeFor(activity);
    motion.current?.setMode(mode);
    motion.current?.update(delta);
    const wanted = expressionFor(activity);
    behaviour.current?.update(
      {
        mode,
        expression: wanted === "neutral" && mood ? mood : wanted,
        mouth: envelope.current.value(t, mode === "speaking", delta),
        lookAt: callbacks.current.lookAt ? callbacks.current.lookAt() : camera.position,
        armsFree: !motion.current?.hasLibrary,
      },
      delta,
      t,
    );
    callbacks.current.onFrame?.(t, motion.current?.playing ?? null);
  });

  return model ? <primitive object={model} /> : null;
}
