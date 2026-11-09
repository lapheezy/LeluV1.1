// Load a GLB as the Cosmos presence does, play its clip, run AvatarBehaviour on top,
// and report where her Head and Hips end up — a headless check that she stays upright.
//   npx tsx scripts/measure-behaviour.ts <file.glb>
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createAvatarBehaviour } from "../src/core/avatar/AvatarBehaviour";

const file = process.argv[2];
const bytes = readFileSync(file);
const loader = new GLTFLoader();
loader.register(() => ({ name: "no-textures", loadTexture: () => Promise.resolve(new THREE.Texture()) }) as never);
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
const scene = gltf.scene;
const bone = (re: RegExp) => {
  let hit: THREE.Object3D | null = null;
  scene.traverse((o) => {
    if (!hit && (o as THREE.Bone).isBone && re.test(o.name)) hit = o;
  });
  return hit as THREE.Object3D | null;
};
const report = (label: string) => {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const h = bone(/^head$/i)?.getWorldPosition(new THREE.Vector3());
  const hips = bone(/^hips$/i)?.getWorldPosition(new THREE.Vector3());
  console.log(`${label}: box y ${box.min.y.toFixed(3)}..${box.max.y.toFixed(3)} z ${box.min.z.toFixed(3)}..${box.max.z.toFixed(3)} head ${h?.toArray().map((n) => n.toFixed(3))} hips ${hips?.toArray().map((n) => n.toFixed(3))}`);
};
report("rest");
const mixer = new THREE.AnimationMixer(scene);
if (gltf.animations[0]) mixer.clipAction(gltf.animations[0]).play();
mixer.update(0.016);
report("clip");
const behaviour = createAvatarBehaviour(scene);
console.log("capabilities", JSON.stringify(behaviour.capabilities));
for (let i = 0; i < 30; i++) {
  mixer.update(0.016);
  behaviour.update({ mode: "acting", expression: "focused", mouth: 0, lookAt: new THREE.Vector3(0, 1.6, 4) }, 0.016, i * 0.016);
}
report("clip+behaviour");
