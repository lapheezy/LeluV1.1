/**
 * LÉLU WARDROBE — SKINNED ITEMS FOLLOW HER LIVE BONES
 *
 * Hair, shoes and carried bags are exported on her own skeleton
 * (scripts/blender/lelu_m25c_hairitem.py, lelu_m25c_bagattach.py with
 * itemOnly). The client binds each item's skinned meshes to her live
 * bones by name (src/core/forge/Attachment.ts bindSkinnedItem). The same
 * skinned GLB is loaded twice — once as "her", normalised and animated the
 * way the presence does it, once as the item at the origin, unscaled —
 * and after binding, every item vertex must land exactly where her own
 * matching vertex is, through the animation.
 */

import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildGlb } from "./support/glbFixture";
import { bindSkinnedItem, isSkinnedItem } from "../src/core/forge/Attachment";

async function load() {
  const bytes = buildGlb({ skinned: true, animated: true });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new GLTFLoader().parseAsync(buffer, "");
}

function skinnedOf(root: THREE.Object3D): THREE.SkinnedMesh {
  let mesh: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  assert.ok(mesh, "fixture has a skinned mesh");
  return mesh;
}

/** World position of vertex i after skinning (what the GPU draws). */
function skinnedWorld(mesh: THREE.SkinnedMesh, i: number): THREE.Vector3 {
  const v = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position as THREE.BufferAttribute, i);
  mesh.applyBoneTransform(i, v);
  return v.applyMatrix4(mesh.matrixWorld);
}

test("a skinned wardrobe item is recognised and bound to her bones by name", async () => {
  const her = await load();
  const item = await load();
  assert.equal(isSkinnedItem(item.scene), true);
  const presence = new THREE.Group();
  presence.name = "V2Lelu";
  presence.position.set(0, -2.55, 3.3);
  her.scene.scale.setScalar(7); // the presence fits her rig to her height
  presence.add(her.scene);
  const world = new THREE.Scene();
  world.add(presence);
  const holder = new THREE.Group();
  holder.position.set(5, 1, -2); // wherever the placement group happens to be
  holder.add(item.scene);
  world.add(holder);

  const { bound, missing } = bindSkinnedItem(item.scene, presence);
  assert.equal(bound, 1);
  assert.deepEqual(missing, []);
  const itemMesh = skinnedOf(item.scene);
  const herMesh = skinnedOf(her.scene);
  // every bone of the item is now one of hers
  for (const b of itemMesh.skeleton.bones) {
    let o: THREE.Object3D | null = b;
    while (o && o !== presence) o = o.parent;
    assert.equal(o, presence, `${b.name} belongs to her`);
  }

  const mixer = new THREE.AnimationMixer(her.scene);
  mixer.clipAction(her.animations[0]).play();
  const count = herMesh.geometry.attributes.position.count;
  for (let step = 0; step < 6; step++) {
    mixer.update(0.15);
    world.updateMatrixWorld(true);
    herMesh.skeleton.update();
    itemMesh.skeleton.update();
    for (let i = 0; i < count; i++) {
      const a = skinnedWorld(herMesh, i);
      const b = skinnedWorld(itemMesh, i);
      assert.ok(a.distanceTo(b) < 1e-4, `vertex ${i} at step ${step}: ${a.toArray()} vs ${b.toArray()}`);
    }
  }
});

test("re-binding after her model is swapped uses the new bones", async () => {
  const first = await load();
  const second = await load();
  const item = await load();
  const presence = new THREE.Group();
  presence.add(first.scene);
  bindSkinnedItem(item.scene, presence);
  presence.remove(first.scene);
  presence.add(second.scene);
  bindSkinnedItem(item.scene, presence);
  const bones = skinnedOf(item.scene).skeleton.bones;
  for (const b of bones) {
    let o: THREE.Object3D | null = b;
    while (o && o !== second.scene) o = o.parent;
    assert.equal(o, second.scene, `${b.name} is the new model's`);
  }
});

test("an unskinned accessory is not treated as skinned", async () => {
  const bytes = buildGlb({ skinned: false, animated: false });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  assert.equal(isSkinnedItem(gltf.scene), false);
});
