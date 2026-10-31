/**
 * ==========================================================
 * LÉLU — AVATAR BEHAVIOUR (face, gaze, speech, body language)
 *
 * Runs every frame on top of whatever clip the mixer plays,
 * on the ONE model the presence already shows. It drives two
 * kinds of controls, using whichever the model actually has:
 *
 *   morph targets   ARKit / Ready-Player-Me / VRM names
 *                   (eyeBlinkLeft, jawOpen, viseme_aa,
 *                   mouthSmileLeft, browInnerUp, …): blinking,
 *                   speech-synced mouth, expressions
 *   bones           Head / Neck / Spine of the humanoid rig:
 *                   gaze, nods while speaking, listening lean,
 *                   thinking glance, breathing
 *
 * A Meshy rig has the bones but no face controls, so on that
 * model the face part reports itself unavailable and the body
 * language still runs. Nothing here invents a face.
 *
 * Bone offsets are applied on top of the pose the mixer wrote
 * this frame; when no clip drives a bone, they are applied on
 * top of its rest pose, so they never accumulate.
 * ==========================================================
 */

import * as THREE from "three";
import { findBone } from "../forge/Attachment";

export type BehaviourMode = "idle" | "listening" | "thinking" | "speaking" | "acting";
export type Expression = "neutral" | "happy" | "focused" | "concerned" | "surprised" | "attentive";

export interface BehaviourInput {
  mode: BehaviourMode;
  expression: Expression;
  /** 0–1 mouth opening from the speech envelope. */
  mouth: number;
  /** World point to look at (the camera / the user), or null. */
  lookAt: THREE.Vector3 | null;
}

/** Morph names for each control, in the conventions face-rigged GLBs use. */
const MORPHS = {
  blinkL: ["eyeBlinkLeft", "eyeBlink_L", "blink_l", "Blink_L"],
  blinkR: ["eyeBlinkRight", "eyeBlink_R", "blink_r", "Blink_R"],
  blink: ["blink", "Blink", "eyesClosed"],
  jaw: ["jawOpen", "viseme_aa", "mouthOpen", "MouthOpen", "A", "aa"],
  smileL: ["mouthSmileLeft", "mouthSmile_L"],
  smileR: ["mouthSmileRight", "mouthSmile_R"],
  smile: ["mouthSmile", "happy", "Joy"],
  browUp: ["browInnerUp"],
  browDownL: ["browDownLeft", "browDown_L"],
  browDownR: ["browDownRight", "browDown_R"],
  frownL: ["mouthFrownLeft", "mouthFrown_L"],
  frownR: ["mouthFrownRight", "mouthFrown_R"],
  wideL: ["eyeWideLeft", "eyeWide_L"],
  wideR: ["eyeWideRight", "eyeWide_R"],
} as const;

type Control = keyof typeof MORPHS;

interface MorphBinding {
  mesh: THREE.Mesh;
  index: number;
}

interface BoneBinding {
  bone: THREE.Object3D;
  rest: THREE.Quaternion;
  written: THREE.Quaternion;
}

/** What each expression asks of the face, as morph weights. */
const EXPRESSION_WEIGHTS: Record<Expression, Partial<Record<Control, number>>> = {
  neutral: {},
  happy: { smileL: 0.6, smileR: 0.6, smile: 0.6 },
  focused: { browDownL: 0.35, browDownR: 0.35 },
  concerned: { browUp: 0.55, frownL: 0.3, frownR: 0.3 },
  surprised: { browUp: 0.7, wideL: 0.6, wideR: 0.6, jaw: 0.25 },
  attentive: { browUp: 0.2, smileL: 0.15, smileR: 0.15 },
};

export interface AvatarBehaviour {
  /** Which controls this model really has — reported, not assumed. */
  readonly capabilities: { face: Control[]; bones: string[] };
  update(input: BehaviourInput, delta: number, time: number): void;
}

const offset = new THREE.Quaternion();
const euler = new THREE.Euler();
const target = new THREE.Vector3();
const headWorld = new THREE.Vector3();
const parentQuat = new THREE.Quaternion();

export function createAvatarBehaviour(root: THREE.Object3D, random: () => number = Math.random): AvatarBehaviour {
  const morphs = new Map<Control, MorphBinding[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
    for (const [control, names] of Object.entries(MORPHS) as Array<[Control, readonly string[]]>) {
      const name = names.find((n) => n in mesh.morphTargetDictionary!);
      if (name === undefined) continue;
      const list = morphs.get(control) ?? [];
      list.push({ mesh, index: mesh.morphTargetDictionary![name] });
      morphs.set(control, list);
    }
  });

  const bones = new Map<string, BoneBinding>();
  for (const name of ["Head", "Neck", "Spine02", "Spine01", "Spine"]) {
    const bone = findBone(root, name);
    if (bone && ![...bones.values()].some((b) => b.bone === bone)) {
      bones.set(name, { bone, rest: bone.quaternion.clone(), written: new THREE.Quaternion(NaN, NaN, NaN, NaN) });
    }
  }
  const spine = bones.get("Spine02") ?? bones.get("Spine01") ?? bones.get("Spine");

  // Arms. A rig straight from auto-rigging rests in a T/A pose and its only
  // clip is often that base layer, so without this she stands with her arms
  // held out. The relaxed pose is computed from where each upper arm actually
  // points this frame (whatever the clip wrote), turning it toward hanging at
  // her side — so it works on any humanoid rig and never accumulates.
  const arms: Array<{ side: 1 | -1; arm: BoneBinding; fore: THREE.Object3D }> = [];
  for (const [side, armName, foreName] of [[1, "LeftArm", "LeftForeArm"], [-1, "RightArm", "RightForeArm"]] as const) {
    const arm = findBone(root, armName);
    const fore = findBone(root, foreName);
    if (arm && fore) arms.push({ side, arm: { bone: arm, rest: arm.quaternion.clone(), written: new THREE.Quaternion(NaN, NaN, NaN, NaN) }, fore });
  }
  const armFrom = new THREE.Vector3();
  const armTo = new THREE.Vector3();
  const armDir = new THREE.Vector3();
  const armWant = new THREE.Vector3();
  const rootQuat = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  const boneWorld = new THREE.Quaternion();
  const identity = new THREE.Quaternion();

  const weights = new Map<Control, number>();
  let nextBlink = 1 + random() * 3;
  let blinkStart = -1;
  const gaze = { yaw: 0, pitch: 0 };

  const setMorph = (control: Control, value: number, delta: number, rate = 14) => {
    const list = morphs.get(control);
    if (!list) return;
    const current = weights.get(control) ?? 0;
    const next = current + (value - current) * Math.min(1, delta * rate);
    weights.set(control, next);
    for (const { mesh, index } of list) mesh.morphTargetInfluences![index] = next;
  };

  const applyBone = (binding: BoneBinding | undefined, x: number, y: number, z: number) => {
    if (!binding) return;
    // Untouched since our last write → no clip drives it → start from rest.
    const base = binding.bone.quaternion.equals(binding.written) ? binding.rest : binding.bone.quaternion;
    binding.bone.quaternion.copy(base).multiply(offset.setFromEuler(euler.set(x, y, z)));
    binding.written.copy(binding.bone.quaternion);
  };

  return {
    capabilities: { face: [...morphs.keys()], bones: [...bones.keys(), ...arms.map((a) => a.arm.bone.name)] },

    update(input, delta, time) {
      // Blink every 2–6 s, 150 ms; never while the eyes are already closing.
      if (blinkStart < 0 && time >= nextBlink) blinkStart = time;
      let blink = 0;
      if (blinkStart >= 0) {
        const p = (time - blinkStart) / 0.15;
        blink = p < 1 ? Math.sin(p * Math.PI) : 0;
        if (p >= 1) {
          blinkStart = -1;
          nextBlink = time + 2 + random() * 4;
        }
      }
      for (const c of ["blinkL", "blinkR", "blink"] as Control[]) setMorph(c, blink, delta, 60);

      const face = EXPRESSION_WEIGHTS[input.expression];
      for (const control of Object.keys(MORPHS) as Control[]) {
        if (control.startsWith("blink")) continue;
        const expressionWeight = face[control] ?? 0;
        const value = control === "jaw" ? Math.max(expressionWeight, input.mouth * 0.85) : expressionWeight;
        setMorph(control, value, delta, control === "jaw" ? 30 : 6);
      }

      // Gaze: turn the head toward the point, within a natural range.
      const head = bones.get("Head");
      let wantYaw = 0;
      let wantPitch = 0;
      if (input.lookAt && head) {
        head.bone.getWorldPosition(headWorld);
        target.copy(input.lookAt).sub(headWorld);
        // Into the head's parent frame, so "forward" is the body's forward.
        head.bone.parent?.getWorldQuaternion(parentQuat);
        target.applyQuaternion(parentQuat.invert());
        wantYaw = THREE.MathUtils.clamp(Math.atan2(target.x, target.z), -0.6, 0.6);
        wantPitch = THREE.MathUtils.clamp(-Math.atan2(target.y, Math.hypot(target.x, target.z)), -0.35, 0.35);
      }
      if (input.mode === "thinking") {
        wantYaw += 0.25 + Math.sin(time * 0.7) * 0.05;
        wantPitch -= 0.18;
      }
      gaze.yaw += (wantYaw - gaze.yaw) * Math.min(1, delta * 4);
      gaze.pitch += (wantPitch - gaze.pitch) * Math.min(1, delta * 4);

      const speaking = input.mode === "speaking";
      const nod = speaking ? input.mouth * 0.06 + Math.sin(time * 2.1) * 0.02 : 0;
      const tilt = input.mode === "listening" ? 0.09 : speaking ? Math.sin(time * 0.9) * 0.03 : 0;
      applyBone(head, gaze.pitch * 0.7 + nod, gaze.yaw * 0.7, tilt);
      applyBone(bones.get("Neck"), gaze.pitch * 0.3, gaze.yaw * 0.3, 0);
      const lean = input.mode === "listening" ? 0.06 : speaking ? 0.02 : 0;
      applyBone(spine, lean + Math.sin(time * 1.6) * 0.012, speaking ? Math.sin(time * 0.6) * 0.03 : 0, 0);

      // Arms hang relaxed at her sides, with a little breathing sway and a
      // touch more movement while she talks.
      if (arms.length) {
        root.getWorldQuaternion(rootQuat);
        for (const { side, arm, fore } of arms) {
          const bone = arm.bone;
          if (bone.quaternion.equals(arm.written)) bone.quaternion.copy(arm.rest);
          bone.updateWorldMatrix(true, true);
          bone.getWorldPosition(armFrom);
          fore.getWorldPosition(armTo);
          armDir.copy(armTo).sub(armFrom);
          if (armDir.lengthSq() < 1e-10) continue;
          armDir.normalize();
          const sway = Math.sin(time * 1.1 + side) * 0.02 + (speaking ? Math.sin(time * 1.7 + side * 2) * 0.05 : 0);
          // In her own frame: down, slightly out from the body, slightly forward.
          armWant.set(side * 0.2, -1, 0.1 + sway).normalize().applyQuaternion(rootQuat);
          turn.setFromUnitVectors(armDir, armWant);
          turn.slerp(identity, 0.08); // not perfectly plumb — a resting arm
          // World-space turn → the bone's local rotation.
          bone.getWorldQuaternion(boneWorld);
          boneWorld.premultiply(turn);
          bone.parent?.getWorldQuaternion(parentQuat);
          bone.quaternion.copy(parentQuat.invert().multiply(boneWorld));
          arm.written.copy(bone.quaternion);
        }
      }
    },
  };
}

/* ------------------------------ speech envelope ------------------------------ */

/** Fired by the voice engine at each spoken word: { charLength }. */
export const SPEECH_BOUNDARY_EVENT = "lelu:speech-boundary";

/**
 * Mouth opening from speech: each word boundary opens the mouth, a
 * syllable-rate oscillation runs while speaking, and it closes between
 * words and when speech stops. speechSynthesis gives word timing, not
 * audio, so this is word-synchronised, not phoneme-accurate.
 */
export class SpeechEnvelope {
  private open = 0;
  private wordAt = -10;
  private wordLength = 4;

  word(time: number, charLength: number): void {
    this.wordAt = time;
    this.wordLength = Math.max(1, charLength);
  }

  value(time: number, speaking: boolean, delta: number): number {
    const sinceWord = time - this.wordAt;
    const wordDuration = 0.06 * this.wordLength + 0.08;
    const inWord = speaking && sinceWord < wordDuration;
    const syllables = 0.55 + 0.45 * Math.abs(Math.sin(time * 26));
    const want = inWord ? syllables : speaking && sinceWord > 2 ? 0.35 * syllables : 0;
    this.open += (want - this.open) * Math.min(1, delta * 22);
    return this.open;
  }
}
