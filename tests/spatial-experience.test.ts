/**
 * ==========================================================
 * LÉLU — SPATIAL EXPERIENCE ENGINE (verification)
 *
 * CATEGORY: unit. No network, no WebGL.
 *
 * Pins the contract the spatial work has to keep:
 *
 *  - exactly the ten transitions the brief names, every one a
 *    continuous camera path (endpoints exact, midpoint bent);
 *  - ONE scene orchestration: current / previous / destination,
 *    camera, lighting, particles, avatar, workspace, interaction,
 *    progress — and every change goes through it;
 *  - transitions are interruptible, resumable and reversible;
 *  - every workspace destination maps to a real GenesisPanel, so
 *    travelling opens the existing surface, never a mockup;
 *  - no second renderer: the spatial layer draws inside the
 *    existing canvas and uses the existing OrbitControls;
 *  - chat is optional: the app opens at the Core, and voice can be
 *    toggled without opening the conversation.
 *
 * RUN: npx tsx --test tests/spatial-experience.test.ts
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  SPATIAL_DESTINATIONS,
  TRANSITIONS,
  TRANSITION_COUNT,
  destinationFor,
  destinationForPanel,
  sampleCameraPath,
  transitionFor,
  type CameraPath,
  type TransitionKind,
} from "../src/app/scene/spatial/SpatialScenes";
import SpatialRuntime from "../src/app/scene/spatial/SpatialRuntime";

const RUNTIME = "src/app/scene/spatial/SpatialRuntime.ts";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function fresh(): SpatialRuntime {
  SpatialRuntime.resetForTests();
  return SpatialRuntime.getInstance();
}

const REQUIRED_TRANSITIONS: TransitionKind[] = [
  "core-awakening",
  "camera-pullback",
  "galaxy-approach",
  "planet-approach",
  "portal-open",
  "environment-morph",
  "workspace-expand",
  "browser-materialize",
  "studio-entrance",
  "return-to-core",
];

/* --------------------------- the ten transitions ------------------------- */

test("the ten cinematic transitions exist, and only those", () => {
  assert.equal(TRANSITION_COUNT, 10);
  assert.deepEqual(Object.keys(TRANSITIONS).sort(), [...REQUIRED_TRANSITIONS].sort());
  for (const kind of REQUIRED_TRANSITIONS) {
    const spec = TRANSITIONS[kind];
    assert.equal(spec.kind, kind);
    assert.ok(spec.durationMs >= 800, `${kind} must take long enough to see`);
    assert.ok(spec.burst >= 0 && spec.burst <= 1, `${kind} burst in 0..1`);
    assert.ok(spec.morph >= 0 && spec.morph <= 1, `${kind} morph in 0..1`);
    assert.ok(spec.light[0] >= 0 && spec.light[1] <= 1, `${kind} light in 0..1`);
  }
});

test("every path starts and ends EXACTLY at its poses (interruptible, no jump)", () => {
  const from = destinationFor("core").camera;
  const to = destinationFor("cosmos").camera;
  const paths: CameraPath[] = ["straight", "arc", "pullback", "dive", "materialize"];
  for (const path of paths) {
    const start = sampleCameraPath(from, to, 0, path);
    const end = sampleCameraPath(from, to, 1, path);
    for (const axis of ["x", "y", "z"] as const) {
      assert.ok(Math.abs(start.position[axis] - from.position[axis]) < 1e-9, `${path}: start position ${axis}`);
      assert.ok(Math.abs(end.position[axis] - to.position[axis]) < 1e-9, `${path}: end position ${axis}`);
      assert.ok(Math.abs(start.target[axis] - from.target[axis]) < 1e-9, `${path}: start target ${axis}`);
      assert.ok(Math.abs(end.target[axis] - to.target[axis]) < 1e-9, `${path}: end target ${axis}`);
    }
    assert.equal(start.fov, from.fov);
    assert.equal(end.fov, to.fov);
  }
});

test("the cinematic paths MOVE through the space, not fade between two stills", () => {
  const from = destinationFor("core").camera;
  const to = destinationFor("cosmos").camera;
  const linearMid = {
    x: (from.position.x + to.position.x) / 2,
    y: (from.position.y + to.position.y) / 2,
    z: (from.position.z + to.position.z) / 2,
  };
  for (const path of ["arc", "pullback", "dive", "materialize"] as CameraPath[]) {
    const mid = sampleCameraPath(from, to, 0.5, path);
    const deviation =
      Math.abs(mid.position.x - linearMid.x) +
      Math.abs(mid.position.y - linearMid.y) +
      Math.abs(mid.position.z - linearMid.z);
    assert.ok(deviation > 1, `${path} should bow away from the straight line (was ${deviation})`);
  }
  const straight = sampleCameraPath(from, to, 0.5, "straight");
  assert.ok(Math.abs(straight.position.x - linearMid.x) < 1e-9);
});

test("sampling is monotone and continuous along t", () => {
  const from = destinationFor("core").camera;
  const to = destinationFor("galaxy").camera;
  let previous = sampleCameraPath(from, to, 0, "arc").position;
  for (let step = 1; step <= 40; step += 1) {
    const point = sampleCameraPath(from, to, step / 40, "arc").position;
    const jump = Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
    assert.ok(jump < 12, `no discontinuity (step ${step} moved ${jump})`);
    previous = point;
  }
});

/* ---------------------------- the orchestrator -------------------------- */

test("travel records current, previous, destination and a running transition", () => {
  const runtime = fresh();
  runtime.start("core");
  runtime.travel("galaxy", { durationMs: 2000 });
  const during = runtime.getState();
  assert.equal(during.current, "core", "not arrived yet");
  assert.equal(during.destination, "galaxy");
  assert.equal(during.transition?.kind, "galaxy-approach");
  assert.equal(during.interaction.mode, "travelling");
  assert.ok(during.camera, "camera pose is published during the flight");

  runtime.seek(0.5);
  assert.equal(runtime.getState().transition?.progress, 0.5);
  assert.ok(runtime.getState().particles > 0, "the particle burst is driven by progress");

  runtime.arrive();
  const after = runtime.getState();
  assert.equal(after.current, "galaxy");
  assert.equal(after.previous, "core");
  assert.equal(after.destination, null);
  assert.equal(after.transition, null);
  assert.equal(after.interaction.mode, "observe", "a galaxy is a place, not a workspace");
  assert.equal(after.particles, 0);

  // Arriving at an environment that HAS a surface reads as a workspace.
  runtime.travel("browser", { instant: true });
  assert.equal(runtime.getState().interaction.mode, "workspace");
});

test("an instant travel commits without a cinematic (boot and tests)", () => {
  const runtime = fresh();
  runtime.travel("browser", { instant: true });
  const state = runtime.getState();
  assert.equal(state.current, "browser");
  assert.equal(state.transition, null);
  assert.equal(state.activeWorkspace, null, "the bridge, not the runtime, opens panels");
});

test("a transition is interruptible, resumable and reversible", () => {
  const runtime = fresh();
  runtime.start("core");
  runtime.travel("cosmos", { durationMs: 4000 });
  runtime.seek(0.4);

  runtime.interrupt();
  const stopped = runtime.getState();
  assert.equal(stopped.transition?.interrupted, true);
  assert.equal(stopped.interaction.mode, "interrupted");
  assert.equal(stopped.current, "core", "it did not secretly arrive");
  assert.equal(stopped.transition?.progress, 0.4, "it stopped where it actually was");

  runtime.resume();
  assert.equal(runtime.getState().transition?.interrupted, false);
  runtime.arrive();
  assert.equal(runtime.getState().current, "cosmos");

  // Reversible: go out again, then run the transition backwards.
  runtime.travel("core", { durationMs: 4000 });
  runtime.seek(0.6);
  runtime.reverse();
  runtime.seek(0);
  assert.equal(runtime.getState().current, "cosmos", "reversing returns to where the flight began");

  SpatialRuntime.resetForTests();
});

test("the camera pose follows the live Cosmos anchors, everywhere", () => {
  const runtime = fresh();
  runtime.setAnchors({ galaxy: { x: 40, y: -20, z: -60 } });
  const destination = destinationFor("galaxy");
  const defaultPose = destination.camera;
  const live = runtime.poseFor("galaxy");
  assert.equal(live.target.x, defaultPose.target.x + (40 - destination.anchor.x), "it flies to the galaxy that exists");
  assert.equal(live.target.y, defaultPose.target.y + (-20 - destination.anchor.y));
  assert.equal(live.target.z, defaultPose.target.z + (-60 - destination.anchor.z));
  assert.equal(live.fov, defaultPose.fov, "the framing is unchanged by the anchor");
  SpatialRuntime.resetForTests();
});

test("edge transitions are chosen centrally, and the portal opens the portal", () => {
  assert.equal(transitionFor("core", "cosmos"), "camera-pullback");
  assert.equal(transitionFor("cosmos", "galaxy"), "galaxy-approach");
  assert.equal(transitionFor("cosmos", "planet"), "planet-approach");
  assert.equal(transitionFor("cosmos", "browser"), "browser-materialize");
  assert.equal(transitionFor("cosmos", "studio"), "studio-entrance");
  assert.equal(transitionFor("cosmos", "projects"), "workspace-expand");
  assert.equal(transitionFor("cosmos", "portal"), "portal-open");
  assert.equal(transitionFor("galaxy", "planet"), "planet-approach");
  assert.equal(transitionFor("galaxy", "agents"), "galaxy-approach");
  assert.equal(transitionFor("galaxy", "cosmos"), "environment-morph");
  assert.equal(transitionFor("browser", "core"), "return-to-core");
});

test("the avatar is anchored to the scene she is facing", () => {
  const runtime = fresh();
  runtime.start("planet");
  const avatar = runtime.getState().avatar;
  assert.equal(avatar.scene, "planet");
  assert.equal(avatar.anchor.x, destinationFor("planet").anchor.x);
  assert.ok(Number.isFinite(avatar.facing));
  SpatialRuntime.resetForTests();
});

/* --------------------- workspaces are the real surfaces ------------------ */

test("every spatial workspace maps to a canonical GenesisPanel", () => {
  const core = source("src/app/scene/genesis/GenesisCore.tsx");
  const declared = new Set(
    [...core.matchAll(/\|\s*"([a-z0-9-]+)"/g)].map((match) => match[1]),
  );
  const workspaces = SPATIAL_DESTINATIONS.filter((destination) => destination.panel);
  assert.ok(workspaces.length >= 8, "browser, studio, research, projects, agents, files, media, conversations");
  for (const destination of workspaces) {
    assert.ok(
      declared.has(destination.panel as string),
      `${destination.id} opens "${destination.panel}", which GenesisCore declares as a panel`,
    );
  }
  assert.equal(destinationForPanel("browser")?.id, "browser");
  assert.equal(destinationForPanel("visualstudio")?.id, "studio");
  assert.equal(destinationForPanel("projects")?.id, "projects");
});

test("the spatial layer draws inside the existing canvas — no second renderer", () => {
  for (const file of [
    "SpatialPortals.tsx",
    "SpatialNavigator.tsx",
    "SpatialExperience.tsx",
    "useSpatialCamera.ts",
  ]) {
    const code = source(`src/app/scene/spatial/${file}`);
    assert.ok(!/<Canvas\b/.test(code), `${file} must not create a canvas`);
    assert.ok(!/new\s+WebGLRenderer/.test(code), `${file} must not create a renderer`);
  }
  // The camera still belongs to the one OrbitControls controller.
  const controller = source("src/app/scene/genesis/GenesisCameraController.tsx");
  assert.ok(controller.includes("useSpatialCamera("), "the existing controller applies spatial poses");
  assert.equal(
    [...controller.matchAll(/<OrbitControls/g)].length,
    1,
    "still exactly one OrbitControls",
  );
});

test("there is one runtime, and it publishes everything the brief lists", () => {
  const code = source(RUNTIME);
  for (const field of [
    "current",
    "previous",
    "destination",
    "camera",
    "transition",
    "spatialUI",
    "avatar",
    "activeWorkspace",
    "interaction",
    "lighting",
    "particles",
    "geometryMorph",
    "backend",
  ]) {
    assert.ok(new RegExp(`\\b${field}\\b`).test(code), `runtime tracks ${field}`);
  }
  assert.ok(code.includes("tweenProgress("), "transitions are driven by the tween driver");
  assert.ok(
    source("src/app/scene/spatial/tweenDriver.ts").includes("gsapInstance.to("),
    "the driver uses GSAP, with a measured fallback if it cannot load",
  );
  assert.ok(code.includes("interrupt()"), "transitions can be interrupted");
  assert.ok(code.includes("reverse()"), "transitions can be reversed");
});

/* ------------------------------- chat optional -------------------------- */

test("the application opens on the Core, not on the chat", () => {
  const core = source("src/app/scene/genesis/GenesisCore.tsx");
  assert.ok(/activePanel\s*:\s*"none"/.test(core), "the default panel is none");
  const experience = source("src/app/scene/spatial/SpatialExperience.tsx");
  assert.ok(experience.includes('runtime.start("core")'), "the spatial runtime opens at the Core");
});

/* ------------------- Session 3D.2 regressions (measured) ----------------- */

test("a repeated travel request cannot re-base the flight already in progress", () => {
  const runtime = fresh();
  runtime.start("core");
  runtime.travel("studio", { durationMs: 4000 });
  runtime.seek(0.45);
  const during = runtime.getState().transition;
  assert.ok(during);
  const camera = runtime.getState().camera.position;

  // The user (or a second click, or an event) asks for the same destination
  // again mid-flight. It must be a no-op, not a restart from the live pose.
  runtime.travel("studio", { durationMs: 4000 });
  const after = runtime.getState().transition;
  assert.equal(after?.progress, 0.45, "the flight stays where it was");
  assert.equal(after?.startedAt, during?.startedAt, "no second tween was created");
  assert.deepEqual(runtime.getState().camera.position, camera, "the camera did not jump");

  // A different destination still redirects (one owner, but the user may change their mind).
  runtime.travel("projects", { durationMs: 4000 });
  assert.equal(runtime.getState().destination, "projects");

  // An explicit replace is allowed to re-base deliberately.
  runtime.travel("studio", { durationMs: 4000, replace: true });
  assert.equal(runtime.getState().destination, "studio");
  assert.equal(runtime.getState().transition?.progress, 0, "replace starts a fresh path");
  SpatialRuntime.resetForTests();
});

test("the browser opens idle: no third-party page is mounted until someone navigates", () => {
  const browser = source("src/app/scene/genesis/GenesisBrowserPanel.tsx");
  assert.ok(/useState\(""\)/.test(browser), "address and page start empty");
  assert.ok(!/useState\("https?:\/\//.test(browser), "no URL is loaded on mount");
  assert.ok(browser.includes("data-lelu-browser-idle"), "the idle surface is a real, visible state");
  assert.ok(browser.includes('loading="lazy"'), "the embedded page loads lazily");
  // An empty address must never start a read.
  const read = browser.slice(browser.indexOf("const readForLelu"), browser.indexOf("setReading(true)"));
  assert.ok(read.includes("if (!current)"), "readForLelu refuses an empty address before doing any work");
});

test("pixel-ratio adaptation is paused during an active spatial transition", () => {
  const quality = source("src/app/scene/genesis/AdaptiveQuality.tsx");
  assert.ok(quality.includes("document.body.dataset.spatialTransition"), "it reads the runtime's transition flag");
  assert.ok(
    !/slow\.current = fps < 40/.test(quality) && /!transitioning && fps < 40/.test(quality),
    "the down-step cannot fire mid-flight",
  );
  assert.ok(/!transitioning && fps > 57/.test(quality), "the up-step cannot fire mid-flight");
  // And the flag is published by the experience, not invented by the consumer.
  const experience = source("src/app/scene/spatial/SpatialExperience.tsx");
  assert.ok(experience.includes("document.body.dataset.spatialTransition = spatial.transition?.kind"));
});

test("portal geometry is stable between emitted frames", () => {
  const portals = source("src/app/scene/spatial/SpatialPortals.tsx");
  assert.ok(!/\}, \[runtime, state\.updatedAt\]\)/.test(portals), "positions are not rebuilt per frame");
  assert.ok(portals.includes("anchorVersion"), "they follow a version that changes only with real anchors");
  assert.ok(/setVersion\(\(value\) => value \+ 1\)/.test(portals), "the version is bumped on anchor sync");
  assert.ok(/\}, \[runtime, anchorVersion\]\)/.test(portals), "the memo depends on the anchor version");
});

test("voice is available without opening the chat", () => {
  const navigator = source("src/app/scene/spatial/SpatialNavigator.tsx");
  const voiceButton = navigator.slice(navigator.indexOf('testId: "voice"') - 600, navigator.indexOf('testId: "voice"'));
  assert.ok(voiceButton.includes("VoiceEngine.getInstance().toggle()"), "the rail's mic talks to LÉLU");
  assert.ok(!voiceButton.includes('openPanel("chat")'), "the mic path never opens the conversation");
  // …and the conversation is still summonable and dismissible from the rail.
  assert.ok(navigator.includes('openPanel(chatOpen ? "none" : "chat")'), "chat is summonable and dismissible");
});
