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
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import AgentEventBus from "../../../../core/agent/AgentEvents";
import AvatarCommandBus, { type AvatarCommand, type AvatarCommandKind } from "../../../../core/avatar/AvatarCommandBus";
import LeluMotion, { SEATED_GESTURES } from "../../../../core/avatar/LeluMotion";
import LeluLife from "../../../../core/avatar/LeluLife";
import VoiceEngine from "../../../../core/voice/VoiceEngine";
import LeluSofa from "./LeluSofa";
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
  sit: [],
  stand: [],
  leave: [],
  return: [],
};

/** What she does seated in place of a standing gesture. */
const SEATED_ALTERNATIVE: Partial<Record<AvatarCommandKind, string>> = {
  agree: "sit_thumbs_up",
  nod: "sit_thumbs_up",
  cheer: "sit_thumbs_up",
};

/** The feeling in what she is about to say, for her face while she says it. */
function feelingOf(text: string): Expression | null {
  const t = text.toLowerCase();
  if (/\b(sorry|unfortunately|i can'?t|cannot|couldn'?t|failed|error|afraid|sad)\b/.test(t)) return "concerned";
  if (/\b(wow|whoa|really\?|no way|amazing)\b/.test(t)) return "surprised";
  if (/(!|\b(love|great|glad|happy|yay|congrat|awesome|wonderful|beautiful|perfect|haha|lol)\b)/.test(t)) return "happy";
  if (/\?\s*$/.test(t)) return "attentive";
  return null;
}

/** Her foot while she waits: two quick taps, a pause, again. */
function tapAngle(t: number): number {
  const cycle = t % 1.6;
  if (cycle > 0.9) return 0;
  return Math.max(0, Math.sin((cycle / 0.45) * Math.PI)) * 0.32;
}

/**
 * Her model is parsed once per approved version and handed from view to
 * view: only one of her views is mounted at a time (the chat backdrop OR
 * her window; neither in Genesis V2, where the world shows her), so the
 * view being mounted takes the parsed scene from the one that left.
 * Switching between face and window does not decode 48 MB again. If two
 * views ever overlap, the second parses its own copy. (A skeleton clone
 * would share more, but measured: a SkeletonUtils clone of this rig
 * rendered nothing.)
 */
const parsedModels = new WeakMap<ArrayBuffer, Promise<GLTF>>();
const parsedClips = new WeakMap<ArrayBuffer, Promise<THREE.AnimationClip[]>>();
function parseModel(bytes: ArrayBuffer): Promise<GLTF> {
  let parsed = parsedModels.get(bytes);
  if (!parsed) {
    parsed = new GLTFLoader().parseAsync(bytes, "");
    parsedModels.set(bytes, parsed);
    parsed.catch(() => parsedModels.delete(bytes));
  }
  return parsed;
}
function parseClips(bytes: ArrayBuffer): Promise<THREE.AnimationClip[]> {
  let parsed = parsedClips.get(bytes);
  if (!parsed) {
    parsed = new GLTFLoader().parseAsync(bytes, "").then((g) => g.animations).catch(() => [] as THREE.AnimationClip[]);
    parsedClips.set(bytes, parsed);
  }
  return parsed;
}

/** Requests that need all of her: a face-only view hands them to her full-body view. */
export const FULL_BODY_COMMANDS = new Set<AvatarCommandKind>(["sit", "stand", "leave", "return", "dance", "move", "jump", "bow"]);
let handoff: { command: AvatarCommand; at: number } | null = null;

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
  life = true,
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
  /** Her life between conversations (sitting, walking off). Off for a face-only view. */
  life?: boolean;
}) {
  const { camera } = useThree();
  const [model, setModel] = useState<THREE.Group | null>(null);
  const motion = useRef<LeluMotion | null>(null);
  const hand = useRef<THREE.Object3D | null>(null);
  const hips = useRef<THREE.Object3D | null>(null);
  const foot = useRef<THREE.Object3D | null>(null);
  const lifeRef = useRef<LeluLife | null>(null);
  const root = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const seat = useRef<THREE.Vector3 | null>(null);
  const [seated, setSeated] = useState(false);
  const feeling = useRef<{ expression: Expression; until: number } | null>(null);
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
    let owned: THREE.Object3D | null = null;
    const fail = (err: unknown) => {
      if (disposed) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Lélu Body] model failed to load", err);
      reportFailure(`LÉLU's 3D model failed to load: ${message}`);
    };
    try {
      parseModel(glb).then(
        async (shared) => {
          if (disposed) return;
          const gltf = shared.scene.parent ? await new GLTFLoader().parseAsync(glb, "") : shared;
          if (disposed) return;
          // The holder carries the normalisation; callers position the holder.
          const holder = new THREE.Group();
          const scene = gltf.scene;
          // Taken over from a view that left: start from its unnormalised state.
          scene.position.set(0, 0, 0);
          scene.scale.set(1, 1, 1);
          holder.add(scene);
          owned = scene;
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
            if (!hips.current && /^hips$/i.test(o.name)) hips.current = o;
            if (!foot.current && /^rightfoot$/i.test(o.name)) foot.current = o;
          });
          // Her captured motion: the model's own clip plus every approved slot
          // (motion-only GLBs, clips named by slot), on one controller.
          void Promise.all(
            (clips ?? []).map((bytes) =>
              parseClips(bytes),
            ),
          ).then((extra) => {
            if (disposed || !behaviour.current) return;
            motion.current = new LeluMotion(scene, [...extra.flat(), ...gltf.animations]);
            lifeRef.current = life ? new LeluLife(motion.current) : null;
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
      // Hand her scene back for the next view.
      owned?.removeFromParent();
      motion.current?.stop();
      motion.current = null;
      lifeRef.current = null;
      behaviour.current = null;
      hand.current = null;
      hips.current = null;
      foot.current = null;
    };
  }, [glb, clips, height, life]);

  // What she says aloud colours her face while she says it.
  useEffect(
    () =>
      VoiceEngine.getInstance().onSpeechActivity((speech) => {
        if (speech.kind !== "start" || !speech.text) return;
        const expression = feelingOf(speech.text);
        feeling.current = expression ? { expression, until: performance.now() + Math.min(9000, 1500 + speech.text.length * 60) } : null;
      }),
    [],
  );

  // Commands ("wave", "dance", "bow"…) from chat or the executive: she
  // performs the clip, and the command is confirmed only when her hand
  // actually moved — measured, not assumed.
  useEffect(() => {
    if (!model) return;
    const perform = (command: AvatarCommand) => {
      const m = motion.current;
      if (!m) return;
      // Her face behind the chat cannot sit down or walk off: her window
      // (which the companion opens for this) takes the request.
      if (!life && FULL_BODY_COMMANDS.has(command.kind)) {
        handoff = { command, at: Date.now() };
        return;
      }
      const lifeNow = lifeRef.current;
      // Posture commands move all of her: measured at the hips.
      const posture = command.kind === "sit" || command.kind === "stand" || command.kind === "leave" || command.kind === "return";
      const probe = posture ? hips : hand;
      const start = probe.current?.getWorldPosition(new THREE.Vector3()) ?? null;
      let clip: string = command.kind;
      if (posture) {
        const acted = lifeNow
          ? lifeNow.command(command.kind as "sit" | "stand" | "leave" | "return")
          : command.kind === "sit"
            ? m.sit()
            : command.kind === "stand"
              ? m.stand()
              : false;
        if (!acted) return;
      } else {
        if (lifeNow?.walking) lifeNow.command("return");
        const seatedAlt = m.posture === "sitting" ? SEATED_ALTERNATIVE[command.kind] : undefined;
        const options = seatedAlt && m.has(seatedAlt) ? [seatedAlt] : COMMAND_CLIPS[command.kind].filter((name) => m.has(name));
        if (!options.length) return;
        clip = options[Math.floor(Math.random() * options.length)];
        // A standing gesture while seated: she gets up first.
        if (m.posture === "sitting" && !SEATED_GESTURES.has(clip)) m.stand(() => m.play(clip));
        else m.play(clip);
      }
      // Watch her hand through the gesture; confirm as soon as it has
      // really moved (some clips, like a dance, start slowly).
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const now = probe.current?.getWorldPosition(new THREE.Vector3());
        const moved = start && now ? start.distanceTo(now) : 0;
        if (moved > 0.01) {
          clearInterval(timer);
          AvatarCommandBus.getInstance().confirm(command.id, `played her “${clip}” animation (${posture ? "her body" : "hand"} moved ${(moved * 100).toFixed(0)} cm)`);
        } else if (Date.now() - startedAt > command.durationMs + 1500) {
          clearInterval(timer);
        }
      }, 150);
    };
    // A request handed over by her face view moments ago.
    if (life && handoff && Date.now() - handoff.at < 5000) {
      const pending = handoff.command;
      handoff = null;
      perform(pending);
    }
    return AvatarCommandBus.getInstance().subscribe(perform);
  }, [model, life]);

  // Moments in the conversation: done → a nod of agreement (sometimes a
  // heart), an error → a shrug.
  const lastActivity = useRef(activity);
  useEffect(() => {
    const previous = lastActivity.current;
    lastActivity.current = activity;
    const m = motion.current;
    if (!m || previous === activity) return;
    if (lifeRef.current?.walking) return;
    if (m.posture === "sitting") {
      if (activity === "COMPLETED" && m.has("sit_thumbs_up")) m.play("sit_thumbs_up");
      return;
    }
    if (activity === "COMPLETED") m.play(Math.random() < 0.2 && m.has("heart") ? "heart" : "agree");
    else if (activity === "ERROR") m.play("shrug");
  }, [activity]);

  useFrame(({ clock }, delta) => {
    if (!model) return;
    const t = clock.getElapsedTime();
    speechClock.current = t;
    const mode = behaviourModeFor(activity);
    const m = motion.current;
    m?.setMode(mode);
    // Her life between conversations: where her body is, and how it faces.
    const place = lifeRef.current?.update(mode, delta);
    const body = bodyRef.current;
    if (body && place) {
      body.position.x = place.x * height;
      body.rotation.y = place.yaw;
      body.visible = place.visible;
    }
    m?.update(delta);
    // Seated: the sofa under her hips, and her foot tapping while she waits.
    const isSeated = m?.posture === "sitting";
    if (isSeated !== seated) setSeated(isSeated);
    if (isSeated && hips.current && root.current) {
      seat.current = root.current.worldToLocal(hips.current.getWorldPosition(new THREE.Vector3()));
      const playing = m?.playing ?? "";
      if (foot.current && mode === "idle" && (playing === "sit_idle" || playing === "sit_arms_crossed")) tapFoot(foot.current, model, tapAngle(t));
    }
    const now = performance.now();
    const felt = feeling.current && feeling.current.until > now && mode === "speaking" ? feeling.current.expression : null;
    const wanted = felt ?? expressionFor(activity);
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

  // dispose={null}: the geometry and textures are shared with her other views.
  return model ? (
    <group ref={root}>
      <group ref={bodyRef}>
        <primitive object={model} dispose={null} />
      </group>
      {life ? <LeluSofa height={height} shown={seated} seat={seat} /> : null}
    </group>
  ) : null;
}

const tapAxis = new THREE.Vector3();
const tapTurn = new THREE.Quaternion();
const tapWorld = new THREE.Quaternion();
const tapParent = new THREE.Quaternion();
const tapRoot = new THREE.Quaternion();

/** Lift her toes (heel down) by `angle` about her own left-right axis, on top of the clip's pose. */
function tapFoot(foot: THREE.Object3D, root: THREE.Object3D, angle: number): void {
  if (angle <= 0 || !foot.parent) return;
  root.getWorldQuaternion(tapRoot);
  tapAxis.set(1, 0, 0).applyQuaternion(tapRoot);
  tapTurn.setFromAxisAngle(tapAxis, -angle);
  foot.getWorldQuaternion(tapWorld);
  tapWorld.premultiply(tapTurn);
  foot.parent.getWorldQuaternion(tapParent);
  foot.quaternion.copy(tapParent.invert().multiply(tapWorld));
}
