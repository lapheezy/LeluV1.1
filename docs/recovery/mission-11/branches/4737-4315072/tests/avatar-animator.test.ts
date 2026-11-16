import test from "node:test";
import assert from "node:assert/strict";

import AvatarAnimator, { AVATAR_EXPRESSIONS, type AvatarPose } from "../src/core/avatar/AvatarAnimator";

const run = (animator: AvatarAnimator, totalMs: number, stepMs = 16): AvatarPose => {
  let pose = animator.tick(0);
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) pose = animator.tick(stepMs);
  return pose;
};

test("the avatar starts neutral, hood down, mask off", () => {
  const animator = new AvatarAnimator();
  const pose = animator.tick(16);
  assert.equal(pose.expression, "neutral");
  assert.equal(pose.hood, "down");
  assert.equal(pose.maskVisible, false);
  assert.ok(pose.blendshapes.mouthSmile < 0.1);
  assert.equal(pose.moving, false);
});

test("hood and mask are real state, not props", () => {
  const animator = new AvatarAnimator();
  animator.toggleHood();
  assert.equal(animator.tick(16).hood, "up");
  animator.toggleHood();
  assert.equal(animator.tick(16).hood, "down");
  animator.setMask(true);
  assert.equal(animator.tick(16).maskVisible, true);
  animator.toggleMask();
  assert.equal(animator.tick(16).maskVisible, false);
});

test("every authored expression actually moves the face", () => {
  for (const expression of AVATAR_EXPRESSIONS) {
    if (expression === "neutral") continue;
    const animator = new AvatarAnimator();
    animator.setExpression(expression);
    const pose = run(animator, 700);
    const total = Object.values(pose.blendshapes).reduce((sum, value) => sum + value, 0);
    assert.ok(total > 0.15, `${expression} produced an almost motionless face (${total.toFixed(3)})`);
  }
});

test("expressions blend rather than pop", () => {
  const animator = new AvatarAnimator({ hood: "down", mask: false, seed: 5 });
  animator.setExpression("happy");
  const early = animator.tick(16);
  const settled = run(animator, 900);
  assert.ok(early.blendshapes.mouthSmile < settled.blendshapes.mouthSmile, "the smile must fade in");
  assert.ok(settled.blendshapes.mouthSmile > 0.4, `smile too weak: ${settled.blendshapes.mouthSmile}`);
});

test("a transient expression returns to neutral on its own", () => {
  const animator = new AvatarAnimator();
  animator.express("excited", 400);
  assert.equal(animator.tick(16).expression, "excited");
  const after = run(animator, 800);
  assert.equal(after.expression, "neutral");
});

test("the avatar blinks on its own cadence", () => {
  const animator = new AvatarAnimator({ blinkEveryMs: [200, 400], seed: 3 });
  let peak = 0;
  for (let index = 0; index < 200; index += 1) {
    const pose = animator.tick(16);
    peak = Math.max(peak, pose.blendshapes.eyeBlinkL, pose.blendshapes.eyeBlinkR);
  }
  assert.ok(peak > 0.5, `no blink observed (peak ${peak.toFixed(3)})`);
  const settled = run(animator, 400);
  assert.ok(settled.blendshapes.eyeBlinkL < 0.2, "the eyes must open again");
});

test("speech drives the mouth and stopping closes it", () => {
  const animator = new AvatarAnimator();
  animator.setSpeaking(true);
  animator.setSpeechLevel(0.8);
  const speaking = run(animator, 400);
  assert.ok(speaking.mouthOpen > 0.1, `mouth barely moved while speaking (${speaking.mouthOpen})`);
  assert.ok(speaking.blendshapes.jawOpen > 0.1);

  animator.setSpeaking(false);
  animator.setSpeechLevel(0);
  const silent = run(animator, 900);
  assert.ok(silent.mouthOpen < 0.05, `mouth stayed open after speech (${silent.mouthOpen})`);
});

test("gaze follows a world point and stays anatomically clamped", () => {
  const animator = new AvatarAnimator();
  animator.setHeadPosition({ x: 0, y: 1.6, z: 0 });
  animator.lookAt({ x: 100, y: 1.6, z: 0 });
  const pose = run(animator, 800);
  assert.ok(pose.gaze.yaw > 0.3, "the avatar did not turn toward the target");
  assert.ok(pose.gaze.yaw <= 0.75 + 1e-6, "neck must clamp the turn");
  assert.ok(Math.abs(pose.bones.head.y) > 0.1, "the head bone must follow the gaze");

  animator.lookAt(null);
  const centred = run(animator, 1200);
  assert.ok(Math.abs(centred.gaze.yaw) < 0.1, "gaze must return to centre");
});

test("walking advances a cycle only while actually moving", () => {
  const animator = new AvatarAnimator();
  animator.setMoving(true);
  const walking = run(animator, 400);
  assert.ok(walking.moving);
  assert.ok(walking.walkPhase > 0, "the walk cycle must advance while moving");

  animator.setMoving(false);
  const still = run(animator, 1200);
  assert.equal(still.moving, false);
});

test("gestures run and then release", () => {
  const animator = new AvatarAnimator();
  animator.startGesture("wave", 300);
  const waving = animator.tick(16);
  assert.equal(waving.gesture, "wave");
  assert.ok(Math.abs(waving.bones.shoulderR.z) > 0.2, "the arm must actually lift");
  const settled = run(animator, 600);
  assert.equal(settled.gesture, "idle");
});

test("a hostile tick (NaN, negative, huge) cannot break the pose", () => {
  const animator = new AvatarAnimator();
  const nan = animator.tick(Number.NaN);
  assert.ok(Number.isFinite(nan.blendshapes.jawOpen));
  const negative = animator.tick(-100);
  assert.ok(Number.isFinite(negative.blendshapes.mouthSmile));
  const huge = animator.tick(1_000_000);
  assert.ok(Number.isFinite(huge.walkPhase));
  assert.ok(Object.values(huge.bones).every((bone) => Number.isFinite(bone.x) && Number.isFinite(bone.y) && Number.isFinite(bone.z)));
});
