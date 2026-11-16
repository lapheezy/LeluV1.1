/**
 * LÉLU — her life between conversations: sitting on her sofa, talking
 * seated, getting up, walking off and coming back. Driven by her real
 * state; pure logic over LeluMotion's clips (no renderer).
 */

import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import LeluMotion from "../src/core/avatar/LeluMotion";
import LeluLife from "../src/core/avatar/LeluLife";

const CLIPS = ["idle", "idle_1", "listen", "talk_open", "sit_down", "sit_idle", "sit_talk", "sit_arms_crossed", "sit_to_stand", "strut", "wave"];

function her() {
  const root = new THREE.Object3D();
  const hips = new THREE.Bone();
  hips.name = "Hips";
  root.add(hips);
  const clips = CLIPS.map((name) => new THREE.AnimationClip(name, 1, [new THREE.VectorKeyframeTrack("Hips.position", [0, 1], [0, 0, 0, 0, 1, 0])]));
  return new LeluMotion(root, clips, () => 0.9);
}

/** Run her for `seconds` in a mode, 50 ms at a time. */
function run(motion: LeluMotion, life: LeluLife, mode: Parameters<LeluLife["update"]>[0], seconds: number) {
  for (let t = 0; t < seconds; t += 0.05) {
    life.update(mode, 0.05);
    motion.update(0.05);
  }
}

test("quiet for a while, she sits down on her sofa and settles in", () => {
  const motion = her();
  const life = new LeluLife(motion, { sitAfter: 5, random: () => 0.9 });
  run(motion, life, "idle", 4);
  assert.equal(motion.posture, "standing");
  run(motion, life, "idle", 3);
  assert.equal(motion.posture, "sitting");
  run(motion, life, "idle", 3);
  assert.match(motion.playing ?? "", /^sit_(idle|arms_crossed)/, "a seated idle after sitting down");
});

test("spoken to while seated, she talks seated", () => {
  const motion = her();
  const life = new LeluLife(motion, { sitAfter: 1, random: () => 0.9 });
  run(motion, life, "idle", 4);
  motion.setMode("speaking");
  run(motion, life, "speaking", 1);
  assert.equal(motion.posture, "sitting");
  assert.equal(motion.playing, "sit_talk");
});

test("seated a long while, she gets up and walks off — and comes back when needed", () => {
  const motion = her();
  const life = new LeluLife(motion, { sitAfter: 1, standAfter: 3, walkChance: 1, awayFor: 60, random: () => 0.1 });
  run(motion, life, "idle", 4);
  assert.equal(motion.posture, "sitting");
  run(motion, life, "idle", 2.5);
  assert.equal(life.walking, true, "walking off after getting up");
  assert.equal(motion.playing, "strut");
  run(motion, life, "idle", 6);
  assert.equal(life.away, true);
  assert.equal(life.placement.visible, false, "out of view");
  // You talk to her: she comes back at once.
  run(motion, life, "listening", 6);
  assert.equal(life.walking, false);
  assert.equal(life.placement.x, 0);
  assert.equal(life.placement.visible, true);
  assert.equal(motion.posture, "standing");
});

test("asked to: sit, walk away, come back", () => {
  const motion = her();
  const life = new LeluLife(motion, { sitAfter: 999, random: () => 0.9 });
  assert.equal(life.command("sit"), true);
  run(motion, life, "idle", 2);
  assert.equal(motion.posture, "sitting");
  assert.equal(life.command("leave"), true, "gets up, then walks off");
  run(motion, life, "idle", 1.5);
  assert.equal(life.walking, true);
  run(motion, life, "idle", 5);
  assert.equal(life.command("return"), true);
  run(motion, life, "idle", 6);
  assert.equal(life.walking, false);
  assert.equal(life.placement.x, 0);
});
