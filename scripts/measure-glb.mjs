// Measure a GLB the way the Cosmos presence does (three.js GLTFLoader + Box3.setFromObject),
// without a browser: node scripts/measure-glb.mjs <file.glb>…
// Textures are skipped (no DOM); geometry, skins and node transforms are what matter here.
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

globalThis.self = globalThis;
class NoImage {}
globalThis.createImageBitmap = undefined;

for (const file of process.argv.slice(2)) {
  const bytes = readFileSync(file);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const loader = new GLTFLoader();
  loader.register((parser) => ({ name: "no-textures", loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await loader.parseAsync(ab, "");
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  console.log(file.split("/").slice(-2).join("/"));
  console.log("  Box3.setFromObject size", size.toArray().map((n) => +n.toFixed(3)), "min", box.min.toArray().map((n) => +n.toFixed(3)));
  // Play each clip at its start and measure the skinned result (what the presence draws).
  for (const clip of gltf.animations) {
    const mixer = new THREE.AnimationMixer(scene);
    mixer.clipAction(clip).play();
    mixer.update(0.01);
    scene.updateMatrixWorld(true);
    const posed = new THREE.Box3().setFromObject(scene, true);
    const head = scene.getObjectByProperty("type", "Bone") && [...(function* walk(o) { yield o; for (const c of o.children) yield* walk(c); })(scene)].find((o) => o.isBone && /^head$/i.test(o.name));
    const hp = head ? head.getWorldPosition(new THREE.Vector3()) : null;
    console.log(`  clip "${clip.name}" posed size ${posed.getSize(new THREE.Vector3()).toArray().map((n) => +n.toFixed(3))} minY ${posed.min.y.toFixed(3)} maxY ${posed.max.y.toFixed(3)} headBone ${hp ? hp.toArray().map((n) => +n.toFixed(3)) : "none"}`);
    mixer.stopAllAction();
    mixer.uncacheRoot(scene);
  }
  scene.traverse((o) => {
    if (o.isMesh) {
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      const ws = new THREE.Vector3();
      o.getWorldScale(ws);
      console.log(`  ${o.isSkinnedMesh ? "skinned" : "mesh"} ${o.name}: worldScale ${ws.toArray().map((n) => +n.toFixed(4))} geomY ${b.min.y.toFixed(3)}..${b.max.y.toFixed(3)}`);
    }
  });
}
