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

export interface LeluBodyInfo {
  /** Face and bone controls the model really has (reported by AvatarBehaviour). */
  capabilities: AvatarBehaviour["capabilities"];
  /** Bounds after normalisation (feet at y = 0). */
  height: number;
  /** Height of her head's centre, for framing a head-and-shoulders view. */
  headY: number;
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
  onFrame?: (time: number) => void;
}) {
  const { camera } = useThree();
  const [model, setModel] = useState<THREE.Group | null>(null);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
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
          console.info("[Lélu Body] avatar controls", behaviour.current.capabilities);
          setModel(holder);
          callbacks.current.onReady?.({ capabilities: behaviour.current.capabilities, height, headY });

          // Idle is preferred; without one, the first clip loops.
          void Promise.all(
            (clips ?? []).map((bytes) =>
              new GLTFLoader().parseAsync(bytes, "").then((g) => g.animations).catch(() => [] as THREE.AnimationClip[]),
            ),
          ).then((extra) => {
            if (disposed) return;
            const all = [...gltf.animations, ...extra.flat()];
            if (all.length === 0) return;
            const m = new THREE.AnimationMixer(scene);
            const clip = all.find((c) => /idle|breath/i.test(c.name)) ?? all[0];
            m.clipAction(clip).play();
            mixer.current = m;
          });
        },
        fail,
      );
    } catch (error) {
      fail(error);
    }
    return () => {
      disposed = true;
      mixer.current?.stopAllAction();
      mixer.current = null;
      behaviour.current = null;
    };
  }, [glb, clips, height]);

  useFrame(({ clock }, delta) => {
    if (!model) return;
    const t = clock.getElapsedTime();
    mixer.current?.update(delta);
    speechClock.current = t;
    const mode = behaviourModeFor(activity);
    const wanted = expressionFor(activity);
    behaviour.current?.update(
      {
        mode,
        expression: wanted === "neutral" && mood ? mood : wanted,
        mouth: envelope.current.value(t, mode === "speaking", delta),
        lookAt: callbacks.current.lookAt ? callbacks.current.lookAt() : camera.position,
      },
      delta,
      t,
    );
    callbacks.current.onFrame?.(t);
  });

  return model ? <primitive object={model} /> : null;
}
