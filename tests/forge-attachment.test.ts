/**
 * LÉLU 3D FORGE — ATTACHMENTS FOLLOW THE RIG
 *
 * A real skinned, animated GLB (support/glbFixture.ts) is parsed with
 * three's GLTFLoader, normalised the way the presence normalises LÉLU,
 * and driven by its own clip through an AnimationMixer. The accessory
 * pose from src/core/forge/Attachment.ts must track the bone through
 * the animation, keep its offset in the bone's frame, and ignore the
 * rig's scale.
 */

import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildGlb } from "./support/glbFixture";
import { attachmentPose, boneKey, findBone } from "../src/core/forge/Attachment";

async function loadRig() {
  const bytes = buildGlb({ skinned: true, animated: true });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  const presence = new THREE.Group();
  presence.name = "V2Lelu";
  presence.position.set(0, -2.55, 3.3);
  gltf.scene.scale.setScalar(7); // the presence fits the rig to LÉLU's height
  presence.add(gltf.scene);
  const world = new THREE.Scene();
  world.add(presence);
  return { gltf, presence, world };
}

test("bone names match across rig naming conventions", () => {
  assert.equal(boneKey("mixamorig:LeftHand"), "lefthand");
  assert.equal(boneKey("Armature_LeftHand"), "lefthand");
  assert.equal(boneKey("Left Hand"), "lefthand");
});

test("an attached accessory follows its bone through the animation, offset in the bone's frame, unscaled", async () => {
  const { gltf, presence, world } = await loadRig();
  const head = findBone(presence, "head");
  assert.ok(head, "the Head bone is found by a lower-case name");
  assert.equal(findBone(presence, "Tail"), null, "a missing bone is reported, not guessed");

  const spec = { bone: "Head", offset: [0.1, 0, 0.05] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const boneWorld = new THREE.Vector3();

  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations[0]).play();
  const samples: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    mixer.update(0.15);
    world.updateMatrixWorld(true);
    attachmentPose(head!, spec, null, pos, quat);
    head!.getWorldPosition(boneWorld);
    const headQuat = head!.getWorldQuaternion(new THREE.Quaternion());
    const expected = boneWorld.clone().add(new THREE.Vector3(0.1, 0, 0.05).applyQuaternion(headQuat));
    assert.ok(pos.distanceTo(expected) < 1e-6, "accessory sits at bone + offset (offset in world units, not rig-scaled)");
    assert.ok(quat.angleTo(headQuat) < 1e-6, "accessory takes the bone's orientation");
    samples.push(pos.clone());
  }
  const travel = samples.slice(1).reduce((d, p, i) => d + p.distanceTo(samples[i]), 0);
  assert.ok(travel > 0.01, `the accessory moved with the animated rig (travelled ${travel.toFixed(3)})`);

  // In a parent's space the pose is the same world point.
  const parent = new THREE.Group();
  parent.position.set(5, 1, -2);
  parent.rotation.y = 0.7;
  world.add(parent);
  world.updateMatrixWorld(true);
  const local = new THREE.Vector3();
  attachmentPose(head!, spec, parent, local, new THREE.Quaternion());
  attachmentPose(head!, spec, null, pos, quat);
  assert.ok(parent.localToWorld(local.clone()).distanceTo(pos) < 1e-6);
});
