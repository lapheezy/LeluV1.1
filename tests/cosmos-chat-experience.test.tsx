/**
 * ==========================================================
 * LÉLU — COSMOS ↔ CHAT EXPERIENCE (regressions)
 *
 * CATEGORY: unit. No network, no WebGL.
 *
 * Each block pins a defect found by driving the app in a real
 * browser (iPhone 13 and 1440×900 viewports):
 *
 *  - typing stalled for 30+ s on a phone because the 3D canvas
 *    kept rendering under the opaque full-screen chat
 *    (SceneRenderBudget);
 *  - the chat showed one exchange at a time and faded it out —
 *    no conversation history (GenesisChatTranscript);
 *  - the composer sat under the iOS keyboard (readVisualViewport);
 *  - GenesisCore rebuilt every action on each universe tick and
 *    keystroke, which re-ran GenesisChat's mount effect in a
 *    loop (source contract below).
 *
 * RUN: npx tsx --tsconfig tsconfig.app.json --test tests/cosmos-chat-experience.test.tsx
 * (the app tsconfig supplies the automatic JSX runtime the
 * components are written for; `npm test` only globs *.test.ts).
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  REDUCED_FRAME_MS,
  SceneRenderBudget,
  TYPING_HOLD_MS,
} from "../src/app/scene/genesis/SceneRenderBudget";
import { frameloopFor } from "../src/app/scene/genesis/SceneFrameGovernor";
import GenesisChatTranscript, {
  anchorExtras,
  transcriptMessages,
} from "../src/app/scene/genesis/GenesisChatTranscript";
import { KEYBOARD_THRESHOLD_PX, readVisualViewport } from "../src/app/scene/genesis/useVisualViewport";
import type { GenesisMessage } from "../src/app/scene/genesis/GenesisCore";

/* ---------------------------- render budget ---------------------------- */

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

test("a full-screen surface pauses the scene and releases it when it closes", () => {
  const budget = new SceneRenderBudget(false);
  const seen: string[] = [];
  budget.subscribe(() => seen.push(budget.mode()));

  assert.equal(budget.mode(), "full");
  budget.setOccluded("genesis-chat", true);
  assert.equal(budget.mode(), "paused");
  assert.equal(budget.allowFrame("sky"), false, "paused loops must skip their paint");
  budget.setOccluded("genesis-chat", true); // idempotent — no extra notification
  budget.setOccluded("genesis-chat", false);
  assert.equal(budget.mode(), "full");
  assert.deepEqual(seen, ["paused", "full"]);
});

test("two occluders: the scene resumes only when both are gone", () => {
  const budget = new SceneRenderBudget(false);
  budget.setOccluded("a", true);
  budget.setOccluded("b", true);
  budget.setOccluded("a", false);
  assert.equal(budget.mode(), "paused");
  budget.setOccluded("b", false);
  assert.equal(budget.mode(), "full");
});

test("typing on a phone reduces the frame rate, then recovers after the hold", async () => {
  const c = clock();
  const budget = new SceneRenderBudget(true, c.now);
  budget.noteTyping();
  assert.equal(budget.mode(), "reduced");

  // Reduced: one paint per REDUCED_FRAME_MS per loop.
  assert.equal(budget.allowFrame("sky", 10_000), true);
  assert.equal(budget.allowFrame("sky", 10_000 + REDUCED_FRAME_MS - 1), false);
  assert.equal(budget.allowFrame("sky", 10_000 + REDUCED_FRAME_MS), true);
  assert.equal(budget.allowFrame("hud", 10_000 + 1), true, "loops are throttled independently");

  c.advance(TYPING_HOLD_MS + 1);
  await new Promise((resolve) => setTimeout(resolve, TYPING_HOLD_MS + 50));
  assert.equal(budget.mode(), "full");
});

test("blurring the composer ends typing immediately", () => {
  const budget = new SceneRenderBudget(true);
  budget.noteTyping();
  budget.endTyping();
  assert.equal(budget.mode(), "full");
});

test("typing does not throttle a desktop until its frames are measured slow — then it pauses", () => {
  const budget = new SceneRenderBudget(false);
  budget.noteTyping();
  assert.equal(budget.mode(), "full");

  budget.markSlowRendering();
  budget.noteTyping();
  assert.equal(budget.mode(), "paused", "a slow device cannot fit ~12 fps between keys");
  budget.endTyping();
  assert.equal(budget.mode(), "full");
});

test("the canvas frameloop follows the budget mode", () => {
  assert.equal(frameloopFor("full"), "always");
  assert.equal(frameloopFor("reduced"), "demand");
  assert.equal(frameloopFor("paused"), "never");
});

/* ------------------------------ transcript ----------------------------- */

const msg = (id: string, role: "user" | "assistant", text: string, timestamp: number): GenesisMessage => ({
  id,
  role,
  text,
  timestamp,
  source: role === "user" ? "local" : "ai",
});

const history = [
  msg("u1", "user", "first question", 100),
  msg("a1", "assistant", "first answer", 110),
  msg("u2", "user", "second question", 200),
  msg("a2", "assistant", "second answer", 210),
  msg("blank", "assistant", "   ", 220),
];

test("the transcript keeps every earlier turn and leaves the live turn to the exchange", () => {
  assert.deepEqual(
    transcriptMessages(history, null).map((m) => m.id),
    ["u1", "a1", "u2", "a2"],
    "with no live exchange, the whole conversation is history (blank rows dropped)",
  );
  assert.deepEqual(
    transcriptMessages(history, 200).map((m) => m.id),
    ["u1", "a1"],
    "messages from the live exchange's start onward are not drawn twice",
  );
});

test("a past exchange's images/surfaces stay attached to its reply", () => {
  const anchored = anchorExtras(history, [
    { startedAt: 100, images: ["data:image/png;base64,AA"], surfaces: [] },
    { startedAt: 200, images: ["data:image/png;base64,BB"], surfaces: [] },
  ]);
  assert.equal(anchored.get("a1")?.images[0], "data:image/png;base64,AA");
  assert.equal(anchored.get("a2")?.images[0], "data:image/png;base64,BB");
});

test("the transcript renders both roles, as markdown for LÉLU", () => {
  const markup = renderToStaticMarkup(
    <GenesisChatTranscript
      messages={[msg("u", "user", "hi **there**", 1), msg("a", "assistant", "- **bold** point\n- second", 2)]}
      liveExchangeStartedAt={null}
      extras={[]}
    />,
  );
  assert.match(markup, /role="log"/);
  assert.match(markup, /data-lelu-message="user"[^>]*>hi \*\*there\*\*</, "user text is shown verbatim");
  assert.match(markup, /<li><strong>bold<\/strong> point<\/li>/, "assistant markdown is rendered");
});

/* ---------------------------- visual viewport -------------------------- */

test("the keyboard is detected from the visual viewport, not from 100dvh", () => {
  assert.deepEqual(readVisualViewport({ innerHeight: 844, visualViewport: { height: 844, offsetTop: 0 } }), {
    height: 844,
    offsetTop: 0,
    keyboardOpen: false,
  });
  assert.deepEqual(readVisualViewport({ innerHeight: 844, visualViewport: { height: 508.4, offsetTop: 12.6 } }), {
    height: 508,
    offsetTop: 13,
    keyboardOpen: true,
  });
  // URL-bar collapse is a small change, not a keyboard.
  assert.equal(
    readVisualViewport({ innerHeight: 844, visualViewport: { height: 844 - KEYBOARD_THRESHOLD_PX + 1, offsetTop: 0 } })
      .keyboardOpen,
    false,
  );
  assert.equal(readVisualViewport({ innerHeight: 700, visualViewport: null }).height, 700);
});

/* -------------------------- source contracts --------------------------- */

test("GenesisCore actions do not depend on state or the universe tick", () => {
  const core = readFileSync("src/app/scene/genesis/GenesisCore.tsx", "utf8");
  const actions = core.slice(core.indexOf("const actions ="), core.indexOf("const stateValue ="));
  assert.ok(actions.length > 1000, "the actions block exists");
  const deps = actions.slice(actions.lastIndexOf("["), actions.lastIndexOf("]") + 1);
  assert.doesNotMatch(deps, /\bstate\b|\buniverse\b/, `actions memo deps must stay stable, got ${deps}`);
  assert.doesNotMatch(actions, /[^.\w]state\.activeConversationId/, "read the live id through stateRef");
  assert.match(core, /current\.dialogue === phase\s*\?\s*current/, "setDialogue must not churn state per keystroke");
});

test("chat chrome reads the state-only context and the canvases take the governed frameloop", () => {
  for (const file of ["GenesisChat.tsx", "MultiChatTabs.tsx", "GenesisDock.tsx", "GenesisModuleHost.tsx"]) {
    const source = readFileSync(`src/app/scene/genesis/${file}`, "utf8");
    assert.doesNotMatch(source, /\buseGenesis\(\)/, `${file} should use useGenesisState()`);
  }
  for (const file of ["GenesisScene.tsx", "GenesisV2Scene3D.tsx"]) {
    const source = readFileSync(`src/app/scene/genesis/${file}`, "utf8");
    assert.match(source, /frameloop=\{frameloop\}/, `${file} canvas must take the budgeted frameloop prop`);
  }
});
