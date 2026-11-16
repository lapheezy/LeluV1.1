/**
 * LÉLU — her captured animations.
 *
 * The motion-only GLBs the client loads carry her bones and one named clip
 * and nothing that draws; the motion controller picks the loop for her state
 * and plays gestures once over it.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";
import LeluMotion from "../src/core/avatar/LeluMotion";

const ANIMATIONS = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "leluverse/assets/characters/lelu_character/animations");

function glbJson(bytes: Uint8Array): Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as Record<string, unknown>;
}

test("every committed motion.glb is bones plus one named clip, nothing that draws", () => {
  const dirs = existsSync(ANIMATIONS) ? readdirSync(ANIMATIONS).filter((d) => existsSync(path.join(ANIMATIONS, d, "motion.glb"))) : [];
  assert.ok(dirs.length >= 25, `expected her 25 animation slots, found ${dirs.length}`);
  const names = new Set<string>();
  for (const dir of dirs) {
    const bytes = new Uint8Array(readFileSync(path.join(ANIMATIONS, dir, "motion.glb")));
    assert.ok(bytes.byteLength < 1_000_000, `${dir}: ${bytes.byteLength} bytes`);
    const json = glbJson(bytes) as { meshes?: unknown[]; images?: unknown[]; animations: Array<{ name: string }>; nodes: Array<{ name?: string; mesh?: number }> };
    assert.equal(json.meshes, undefined, `${dir} has meshes`);
    assert.equal(json.images, undefined, `${dir} has images`);
    assert.equal(json.animations.length, 1);
    assert.ok(json.nodes.some((n) => n.name === "Hips"), `${dir} lacks her Hips bone`);
    names.add(json.animations[0].name);
  }
  for (const slot of ["idle", "listen", "talk_open", "wave", "dance_cherish", "bow", "shrug", "heart"]) {
    assert.ok(names.has(slot), `missing ${slot}`);
  }
});

function rig(): THREE.Object3D {
  const root = new THREE.Object3D();
  const hips = new THREE.Bone();
  hips.name = "Hips";
  root.add(hips);
  return root;
}

function clip(name: string, seconds = 1): THREE.AnimationClip {
  return new THREE.AnimationClip(name, seconds, [
    new THREE.VectorKeyframeTrack("Hips.position", [0, seconds], [0, 0, 0, 3, 1, 4]),
  ]);
}

test("her state picks the loop; gestures play once and return to it", () => {
  const motion = new LeluMotion(rig(), ["idle", "idle_1", "listen", "talk_open", "talk_right", "wave"].map((n) => clip(n)), () => 0.9);
  assert.equal(motion.hasLibrary, true);
  motion.update(0.016);
  assert.match(motion.playing ?? "", /^idle/);
  motion.setMode("speaking");
  assert.match(motion.playing ?? "", /^talk_/);
  motion.setMode("listening");
  assert.equal(motion.playing, "listen");
  const seconds = motion.play("wave");
  assert.equal(seconds, 1);
  assert.equal(motion.playing, "wave");
  for (let i = 0; i < 80; i++) motion.update(0.02);
  assert.equal(motion.playing, "listen", "back to her state after the gesture");
  assert.equal(motion.play("does_not_exist"), 0);
});

test("clips play in place: the hips keep their height, lose their travel", () => {
  const root = rig();
  const motion = new LeluMotion(root, [clip("idle", 1)], () => 0.9);
  motion.update(0.5);
  const hips = root.getObjectByName("Hips")!;
  assert.equal(hips.position.x, 0);
  assert.equal(hips.position.z, 0);
  assert.ok(hips.position.y > 0, "vertical motion kept");
});
