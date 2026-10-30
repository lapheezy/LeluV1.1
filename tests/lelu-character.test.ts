/**
 * ==========================================================
 * LÉLU — HER CHARACTER: ASSETS, RIG AND LIVING STATE
 *
 * CATEGORY: unit. The real look assets (public/avatar/lelu/*), the real
 * rig maths and shader contract (LeluRig), and the real animation driver
 * (LeluAnimation) fed speech events the way VoiceEngine emits them. What
 * her pixels look like is checked in the running app by
 * scripts/verify-lelu-character.mjs (screenshots kept as evidence).
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => {},
    get length() { return Object.keys(store).length; },
    key: () => null,
  };
}

import LeluAnimation, { blinkAmount, buildSpeechTimeline, charAt, expressionFor, visemeFor } from "../src/core/avatar/LeluAnimation";
import { LELU_LOOKS, mouthFrame, mouthPivot, RIG_FRAGMENT_SHADER, rigUniforms, viewFor, type LeluRigData } from "../src/core/avatar/LeluRig";
import { REST_PARAMS } from "../src/core/avatar/LeluAnimation";
import LeluCharacterStore from "../src/core/avatar/LeluCharacterStore";
import { companionDimensions } from "../src/core/avatar/CompanionStore";

const rigOf = (id: string) => JSON.parse(readFileSync(`public/avatar/lelu/${id}/rig.json`, "utf8")) as LeluRigData;

/** Width and height of a WebP file, from its own header. */
function webpSize(path: string): [number, number] {
  const b = readFileSync(path);
  assert.equal(b.toString("ascii", 0, 4), "RIFF");
  assert.equal(b.toString("ascii", 8, 12), "WEBP");
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
}

test("every look is her reference, cut out, with a rig built on that same image", () => {
  for (const { id } of LELU_LOOKS) {
    const body = `public/avatar/lelu/${id}/body.webp`;
    assert.ok(existsSync(body), `${id}: body.webp`);
    const rig = rigOf(id);
    assert.deepEqual(webpSize(body), rig.size, `${id}: the rig's landmarks are in this image's pixels`);
    const header = readFileSync(body).subarray(12, 30);
    assert.ok(header.toString("ascii", 0, 4) === "VP8X" && (header[8] & 0x10) !== 0, `${id}: has an alpha channel (no background)`);
    // Anatomy sanity: eyes above the mouth, mouth above the chin, head above the feet.
    assert.ok(rig.eyes.left.ellipse[1] < rig.mouth.center[1] && rig.mouth.center[1] < rig.chin[1], id);
    assert.ok(rig.head[1] < rig.neck[1] && rig.neck[1] < rig.chest[1] && rig.chest[1] < rig.feet[1], id);
  }
});

test("her mouth opens along her own lips: corner to corner, and with her own teeth where they show", () => {
  for (const { id } of LELU_LOOKS) {
    const rig = rigOf(id);
    const frame = mouthFrame(rig);
    const [a, b] = frame.curve;
    // The parting curve passes through both corners (local coords).
    const pivot = mouthPivot(rig).center;
    for (const corner of [rig.mouth.left, rig.mouth.right]) {
      const dx = corner[0] - pivot[0];
      const dy = corner[1] - pivot[1];
      const u = (dx * frame.axis[0] + dy * frame.axis[1]) / frame.halfWidth;
      const v = dx * -frame.axis[1] + dy * frame.axis[0];
      assert.ok(Math.abs(a * u * u + b * u - v) < 0.01, `${id}: curve misses a corner`);
    }
    assert.ok(frame.chinV > 0, `${id}: the chin is below the mouth`);
  }
  // Both references show her teeth between parted lips: the jaw drops with
  // the lower lip, her real upper teeth stay; no drawn teeth over real ones.
  assert.equal(mouthPivot(rigOf("gothic")).ownTeeth, true);
});

test("framing: all of her, or head and shoulders", () => {
  const rig = rigOf("gothic");
  const full = viewFor(rig, "full", 0.5);
  assert.ok(full[1] <= rig.top && full[3] >= rig.bottom, "full: hair to feet");
  const face = viewFor(rig, "face", 0.75);
  assert.ok(face[1] < rig.head[1] - rig.head[3] && face[3] < rig.feet[1] && face[3] > rig.chin[1], "face: head and shoulders, no feet");
  assert.ok(Math.abs((face[2] - face[0]) / (face[3] - face[1]) - 0.75) < 1e-9, "fits the canvas shape");
});

test("every uniform the shader reads is supplied, and nothing else", () => {
  const declared = new Set([...RIG_FRAGMENT_SHADER.matchAll(/uniform\s+\w+\s+(\w+);/g)].map((m) => m[1]));
  declared.delete("uTex"); // the texture unit, bound by the renderer
  const supplied = new Set(Object.keys(rigUniforms(rigOf("earthy"), REST_PARAMS, { view: [0, 0, 1, 1], framing: "full", holo: 0, time: 0 })));
  assert.deepEqual([...declared].filter((name) => !supplied.has(name)), [], "declared but never set");
  assert.deepEqual([...supplied].filter((name) => !declared.has(name)), [], "set but never declared");
});

test("letters become mouth shapes: open vowels open, lips meet on m/b/p and between words, o/u round", () => {
  assert.ok(visemeFor("a").open > 0.7);
  assert.ok(visemeFor("o").wide < 0 && visemeFor("u").wide < 0, "rounded");
  assert.ok(visemeFor("e").wide > 0.4 && visemeFor("i").wide > 0.4, "spread");
  for (const closed of ["m", "b", "p", " ", "."]) assert.equal(visemeFor(closed).open, 0, closed);
  const timeline = buildSpeechTimeline("Hi. Yes");
  assert.equal(charAt(timeline, 0), 0);
  // The full stop pauses longer than a letter.
  assert.ok(timeline.starts[3] - timeline.starts[2] > (timeline.starts[1] - timeline.starts[0]) * 3);
  assert.equal(charAt(timeline, timeline.duration + 1), -1);
});

test("her voice moves her mouth: start opens it, a word re-syncs it, the end closes it — and silence never does", () => {
  LeluAnimation.resetForTests();
  const anim = LeluAnimation.getInstance();
  let now = 1000;
  const run = (ms: number) => {
    let maxOpen = 0;
    for (let t = 0; t < ms; t += 16) {
      now += 16;
      maxOpen = Math.max(maxOpen, anim.frame(now).open);
    }
    return maxOpen;
  };
  assert.ok(run(2000) < 0.01, "no speech: her mouth stays at rest");

  const text = "Hello, I am LÉLU and I am talking to you now.";
  anim.onSpeech({ speaking: true, kind: "start", text, at: 0 }, now);
  assert.equal(anim.isSpeaking(), true);
  assert.ok(run(1200) > 0.4, "speaking: her mouth opens on the vowels");
  assert.equal(anim.frame(now + 16).speaking, true);

  // A word boundary at "talking": the mouth follows THAT word now.
  const index = text.indexOf("talking");
  anim.onSpeech({ speaking: true, kind: "word", text, charIndex: index, at: 0 }, now);
  const shape = anim.currentViseme(now + 1);
  assert.deepEqual(shape, visemeFor("t"));

  anim.onSpeech({ speaking: false, kind: "end", text: "", at: 0 }, now);
  run(400);
  assert.ok(anim.frame((now += 16)).open < 0.02, "the end closes her mouth");
  assert.equal(anim.isSpeaking(), false);
});

test("she blinks — every few seconds, briefly — and her expression follows what she is doing", () => {
  assert.equal(blinkAmount(-0.01), 0);
  assert.ok(blinkAmount(0.064) > 0.95, "closed at the bottom of a blink");
  assert.equal(blinkAmount(0.5), 0);

  LeluAnimation.resetForTests();
  const anim = LeluAnimation.getInstance();
  let closedFrames = 0;
  let blinks = 0;
  let wasClosed = false;
  const frames = 30 * 30; // 30 s at 30 fps
  for (let i = 0; i < frames; i += 1) {
    const p = anim.frame(1000 + i * (1000 / 30));
    const closed = p.blinkL > 0.5;
    if (closed) closedFrames += 1;
    if (closed && !wasClosed) blinks += 1;
    wasClosed = closed;
  }
  assert.ok(blinks >= 4 && blinks <= 20, `blinks in 30 s: ${blinks}`);
  assert.ok(closedFrames / frames < 0.08, "eyes are open almost all the time");

  assert.ok(expressionFor("THINKING").gazeY < -0.3, "thinking: she looks up");
  assert.ok(expressionFor("ERROR").brow < 0 && expressionFor("ERROR").smile < 0, "an error shows as concern");
  assert.ok(expressionFor("LISTENING").brow > 0, "listening: attentive");

  // Her body never stands still: breath and sway change over a second.
  const a = anim.frame(50_000);
  const b = anim.frame(50_700);
  assert.notEqual(a.breath.toFixed(3), b.breath.toFixed(3));
});

test("one look and one form for every surface, remembered; nothing outside her looks is accepted", () => {
  LeluCharacterStore.resetForTests();
  const store = LeluCharacterStore.getInstance();
  assert.equal(store.get().look, "gothic");
  store.setLook("earthy");
  store.setForm("hologram");
  store.setLook("robot" as never);
  LeluCharacterStore.resetForTests();
  assert.deepEqual([LeluCharacterStore.getInstance().get().look, LeluCharacterStore.getInstance().get().form], ["earthy", "hologram"]);
  // Her full figure is tall and narrow; head-and-shoulders keeps 3:4.
  const full = companionDimensions("medium", "full");
  const face = companionDimensions("medium", "face");
  assert.ok(full.height / full.width > 2 && Math.abs(face.height / face.width - 4 / 3) < 0.01);
});
