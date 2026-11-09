/**
 * LÉLU — AVATAR BEHAVIOUR
 *
 * The driver is run frame by frame against (a) a face-rigged mesh with
 * ARKit-named morph targets and a Head/Neck/Spine skeleton, and (b) the
 * Meshy-style rig fixture, which has bones and no face controls. It must
 * blink, open the mouth with speech, show expressions, turn the head to
 * the user, lean in when listening — and report honestly what a model
 * cannot do.
 */

import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildGlb } from "./support/glbFixture";
import { createAvatarBehaviour, SpeechEnvelope, type BehaviourInput } from "../src/core/avatar/AvatarBehaviour";

function faceRig() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const names = ["eyeBlinkLeft", "eyeBlinkRight", "jawOpen", "mouthSmileLeft", "mouthSmileRight", "browInnerUp"];
  geometry.morphAttributes.position = names.map(() => geometry.attributes.position.clone());
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.updateMorphTargets();
  mesh.morphTargetDictionary = Object.fromEntries(names.map((n, i) => [n, i]));
  const spine = new THREE.Bone();
  spine.name = "Spine02";
  const neck = new THREE.Bone();
  neck.name = "Neck";
  neck.position.y = 1;
  const head = new THREE.Bone();
  head.name = "mixamorig:Head";
  head.position.y = 0.2;
  spine.add(neck);
  neck.add(head);
  const root = new THREE.Group();
  root.add(mesh, spine);
  root.updateMatrixWorld(true);
  return { root, mesh, head, spine };
}

const weight = (mesh: THREE.Mesh, name: string) => mesh.morphTargetInfluences![mesh.morphTargetDictionary![name]];

function run(behaviour: ReturnType<typeof createAvatarBehaviour>, input: BehaviourInput, seconds: number, from = 0, sample?: (t: number) => void) {
  for (let t = from; t < from + seconds; t += 1 / 60) {
    behaviour.update(input, 1 / 60, t);
    sample?.(t);
  }
  return from + seconds;
}

test("a face-rigged model blinks, speaks with its mouth, and shows expressions", () => {
  const { root, mesh } = faceRig();
  const b = createAvatarBehaviour(root, () => 0.5);
  assert.deepEqual([...b.capabilities.face].sort(), ["blinkL", "blinkR", "browUp", "jaw", "smileL", "smileR"]);
  assert.deepEqual(b.capabilities.bones, ["Head", "Neck", "Spine02"]);

  let maxBlink = 0;
  let t = run(b, { mode: "idle", expression: "neutral", mouth: 0, lookAt: null }, 8, 0, () => (maxBlink = Math.max(maxBlink, weight(mesh, "eyeBlinkLeft"))));
  assert.ok(maxBlink > 0.8, `blinked (peak ${maxBlink.toFixed(2)})`);
  assert.ok(weight(mesh, "eyeBlinkLeft") < 0.2, "eyes reopen");

  t = run(b, { mode: "speaking", expression: "neutral", mouth: 0.9, lookAt: null }, 0.5, t);
  assert.ok(weight(mesh, "jawOpen") > 0.6, "mouth opens with speech");
  t = run(b, { mode: "idle", expression: "neutral", mouth: 0, lookAt: null }, 0.5, t);
  assert.ok(weight(mesh, "jawOpen") < 0.05, "mouth closes when speech stops");

  run(b, { mode: "idle", expression: "happy", mouth: 0, lookAt: null }, 1.5, t);
  assert.ok(weight(mesh, "mouthSmileLeft") > 0.5 && weight(mesh, "mouthSmileRight") > 0.5, "happy smiles");
});

test("body language: gaze toward the user, listening lean, and no drift without a clip", () => {
  const { root, head, spine } = faceRig();
  const b = createAvatarBehaviour(root, () => 0.5);
  const rest = head.quaternion.clone();

  // The user stands to her right: the head turns that way, not past the limit.
  run(b, { mode: "idle", expression: "neutral", mouth: 0, lookAt: new THREE.Vector3(5, 1.2, 5) }, 2);
  const yaw = new THREE.Euler().setFromQuaternion(rest.clone().invert().multiply(head.quaternion), "XYZ").y;
  assert.ok(yaw > 0.2 && yaw <= 0.6 * 0.7 + 1e-6, `head turned toward the user (yaw ${yaw.toFixed(2)})`);

  // Same input for longer: the pose must settle, not keep adding up.
  const before = head.quaternion.clone();
  run(b, { mode: "idle", expression: "neutral", mouth: 0, lookAt: new THREE.Vector3(5, 1.2, 5) }, 2, 2);
  assert.ok(before.angleTo(head.quaternion) < 0.05, "offsets do not accumulate frame to frame");

  run(b, { mode: "listening", expression: "attentive", mouth: 0, lookAt: null }, 2, 4);
  const lean = new THREE.Euler().setFromQuaternion(spine.quaternion).x;
  assert.ok(lean > 0.03, `leans in while listening (${lean.toFixed(3)})`);

  // A clip that writes the bone each frame: offsets go on top of the clip's pose.
  const clipPose = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.4));
  head.quaternion.copy(clipPose);
  b.update({ mode: "idle", expression: "neutral", mouth: 0, lookAt: null }, 1 / 60, 10);
  assert.ok(clipPose.angleTo(head.quaternion) < 0.5, "starts from the animated pose");
});

test("on a Meshy-style rig (bones, no face controls) the face is reported unavailable and the body still moves", async () => {
  const bytes = buildGlb({ skinned: true, animated: true });
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "");
  const b = createAvatarBehaviour(gltf.scene);
  assert.deepEqual(b.capabilities.face, [], "no morph targets → no claimed face");
  assert.ok(b.capabilities.bones.includes("Head") && b.capabilities.bones.includes("Neck"));
  const head = gltf.scene.getObjectByName("Head")!;
  const rest = head.quaternion.clone();
  run(b, { mode: "speaking", expression: "happy", mouth: 0.8, lookAt: null }, 1);
  assert.ok(rest.angleTo(head.quaternion) > 0.01, "the head moves while she speaks");
});

test("speech envelope opens on each word and closes after speech", () => {
  const env = new SpeechEnvelope();
  let t = 0;
  env.word(t, 6);
  let peak = 0;
  for (; t < 0.3; t += 1 / 60) peak = Math.max(peak, env.value(t, true, 1 / 60));
  assert.ok(peak > 0.4, `opens during a word (${peak.toFixed(2)})`);
  for (; t < 1; t += 1 / 60) env.value(t, false, 1 / 60);
  assert.ok(env.value(t, false, 1 / 60) < 0.02, "closed after speech ends");
});
