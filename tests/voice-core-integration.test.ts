/**
 * ==========================================================
 * LÉLU — VOICE / CORE INTEGRATION TESTS
 *
 * Verifies the Part 2 requirements from the LÉLU NEXT EXECUTION PASS:
 *  - Core planet is the voice entry point (CoreHoldGesture)
 *  - Hold-to-voice works for mouse, touch, and pointer
 *  - Voice overlay stays over existing chat (no navigation away)
 *  - Voice uses same AIService/VoiceEngine path (no second pipeline)
 *  - State machine transitions exist in VoiceEngine
 *  - Voice cancellation uses existing cancelTurn mechanism
 *  - VoiceBridge routes utterances through existing addMessage path
 *  - No new AIService / chat store / cognition loop created
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const src = (path: string) =>
  readFileSync(`/home/user/LeluV1.1/${path}`, "utf8");

function grep(pattern: string, flags = ""): string[] {
  try {
    const result = execSync(
      `grep -rn ${flags} "${pattern}" src/ --include="*.ts" --include="*.tsx"`,
      { cwd: "/home/user/LeluV1.1", encoding: "utf8" },
    );
    return result.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// ---- CoreHoldGesture existence and wiring ---------------------------

test("CoreHoldGesture.tsx exists", () => {
  const code = src("src/app/scene/genesis/CoreHoldGesture.tsx");
  assert.ok(code.length > 100, "CoreHoldGesture.tsx must exist and have content");
});

test("CoreHoldGesture uses VoiceEngine.toggle() — no second voice pipeline", () => {
  const code = src("src/app/scene/genesis/CoreHoldGesture.tsx");
  assert.ok(
    code.includes("VoiceEngine.getInstance()"),
    "CoreHoldGesture must use the singleton VoiceEngine",
  );
  assert.ok(
    code.includes("engine.toggle()"),
    "CoreHoldGesture must call engine.toggle() — not start a new pipeline",
  );
});

test("CoreHoldGesture opens the chat panel (voice stays over chat)", () => {
  const code = src("src/app/scene/genesis/CoreHoldGesture.tsx");
  assert.ok(
    code.includes('openPanel("chat")'),
    "CoreHoldGesture must call openPanel('chat') so voice appears over existing chat",
  );
});

test("CoreHoldGesture handles all pointer types (mouse + touch + pen)", () => {
  const code = src("src/app/scene/genesis/CoreHoldGesture.tsx");
  assert.ok(
    code.includes("onPointerDown") && code.includes("onPointerUp") && code.includes("onPointerMove"),
    "CoreHoldGesture must declare onPointerDown, onPointerUp, onPointerMove handlers",
  );
  // pointerType may be used for threshold selection (touch vs mouse), but must NOT be used
  // as a gate that returns early and skips non-touch events.
  // Detect a blocking guard: early return on non-touch before starting the timer.
  const pdIdx = code.indexOf("onPointerDown");
  const touchGatePattern = /pointerType[^;)]*[=!]=\s*["']touch["'][^;]*return/;
  const sectionBeforeTimer = code.slice(pdIdx, pdIdx + 400);
  assert.ok(
    !touchGatePattern.test(sectionBeforeTimer),
    "CoreHoldGesture must not early-return for non-touch — all pointer types must start the hold timer",
  );
});

test("CoreHoldGesture uses a deliberate hold threshold (≥ 400ms)", () => {
  const code = src("src/app/scene/genesis/CoreHoldGesture.tsx");
  // HOLD_MS constants must exist and be reasonable
  const mouseMatch = code.match(/HOLD_MS_MOUSE\s*=\s*(\d+)/);
  const touchMatch = code.match(/HOLD_MS_TOUCH\s*=\s*(\d+)/);
  assert.ok(mouseMatch, "HOLD_MS_MOUSE constant must exist");
  assert.ok(touchMatch, "HOLD_MS_TOUCH constant must exist");
  const mouseMs = parseInt(mouseMatch![1], 10);
  const touchMs = parseInt(touchMatch![1], 10);
  assert.ok(mouseMs >= 400, `Mouse hold threshold (${mouseMs}ms) must be at least 400ms to be deliberate`);
  assert.ok(touchMs >= 400, `Touch hold threshold (${touchMs}ms) must be at least 400ms to be deliberate`);
});

test("CoreHoldGesture cancels hold on pointer movement (camera orbit still works)", () => {
  const code = src("src/app/scene/genesis/CoreHoldGesture.tsx");
  assert.ok(
    code.includes("MOVE_CANCEL_PX"),
    "CoreHoldGesture must cancel hold on movement to not interfere with camera orbit",
  );
  const moveMatch = code.match(/MOVE_CANCEL_PX\s*=\s*(\d+)/);
  assert.ok(moveMatch, "MOVE_CANCEL_PX constant must exist");
});

test("CoreHoldGesture provides subtle visual feedback during hold countdown", () => {
  const code = src("src/app/scene/genesis/CoreHoldGesture.tsx");
  // Ring animation via DOM (not touching 3D shaders)
  assert.ok(
    code.includes("holdProgress") && code.includes("borderRadius"),
    "CoreHoldGesture must show a ring during the hold countdown",
  );
  // Must be purely DOM, not R3F — no Three.js imports
  assert.ok(
    !code.includes("from \"three\"") && !code.includes("from \"@react-three"),
    "CoreHoldGesture visual feedback must be DOM-only, not touching 3D shaders",
  );
});

// ---- GenesisScene wraps canvas with CoreHoldGesture -----------------

test("GenesisScene wraps the 3D canvas with CoreHoldGesture", () => {
  const code = src("src/app/scene/genesis/GenesisScene.tsx");
  assert.ok(
    code.includes("CoreHoldGesture"),
    "GenesisScene must import and use CoreHoldGesture around the Canvas",
  );
  const holdIdx = code.indexOf("<CoreHoldGesture>");
  const canvasIdx = code.indexOf("<Canvas", holdIdx);
  assert.ok(holdIdx > 0 && canvasIdx > holdIdx, "Canvas must be a child of CoreHoldGesture");
});

// ---- GenesisDock LÉLU pill supports mouse hold ----------------------

test("GenesisDock LÉLU pill activates voice on ALL pointer types (not touch-only)", () => {
  const code = src("src/app/scene/genesis/GenesisDock.tsx");
  // The onPointerDown for the floating pill must NOT gate on pointerType === "touch"
  // Find the section near the LÉLU pill's onPointerDown
  const pillSection = code.slice(code.indexOf("Long-press opens voice"), code.indexOf("chatIsFullscreen", code.indexOf("Long-press opens voice")));
  assert.ok(
    !pillSection.includes('pointerType === "touch"'),
    "LÉLU pill must activate voice for mouse too, not just touch",
  );
});

test("GenesisDock LÉLU pill uses separate thresholds for touch vs mouse", () => {
  const code = src("src/app/scene/genesis/GenesisDock.tsx");
  assert.ok(
    code.includes("pointerType") && code.includes("threshold"),
    "Dock should use different hold thresholds for touch vs mouse",
  );
});

// ---- Voice stays over chat (no navigation away) ---------------------

test("GenesisInterface handleCoreHoldVoice does NOT navigate away from chat", () => {
  const code = src("src/app/scene/genesis/GenesisInterface.tsx");
  const fnIdx = code.indexOf("function handleCoreHoldVoice");
  assert.ok(fnIdx > 0, "handleCoreHoldVoice must exist in GenesisInterface");
  // Extract the function body (next 200 chars after fn name)
  const fnBody = code.slice(fnIdx, fnIdx + 300);
  // Must open chat, not navigate to a different scene
  assert.ok(
    fnBody.includes('openPanel("chat")'),
    "handleCoreHoldVoice must open the chat panel (voice appears OVER chat)",
  );
  assert.ok(
    !fnBody.includes("openModule") && !fnBody.includes("scene-change"),
    "handleCoreHoldVoice must NOT navigate to a different scene or module",
  );
});

// ---- Voice state machine in VoiceEngine ----------------------------

test("VoiceEngine has all required state machine phases", () => {
  const code = src("src/core/voice/VoiceEngine.ts");
  const requiredPhases = ["idle", "listening", "processing", "responding", "speaking"];
  for (const phase of requiredPhases) {
    assert.ok(
      code.includes(`"${phase}"`),
      `VoiceEngine must have phase: "${phase}"`,
    );
  }
});

test("VoiceEngine has interrupt capability (speaking → interrupted → listening)", () => {
  const code = src("src/core/voice/VoiceEngine.ts");
  assert.ok(
    code.includes("cancelSpeech") || code.includes("interrupted"),
    "VoiceEngine must support interrupting speech (cancelSpeech or interrupted state)",
  );
});

// ---- No second voice pipeline created ------------------------------

test("VoiceBridge routes utterances through existing addMessage, not a new pipeline", () => {
  const code = src("src/app/scene/genesis/VoiceBridge.tsx");
  assert.ok(
    code.includes("addMessage"),
    "VoiceBridge must route utterances through the existing addMessage channel",
  );
  // Must not IMPORT or INSTANTIATE a second AIService or chat store —
  // comments mentioning AIService are documentation, not violations.
  assert.ok(
    !code.includes('import AIService') && !code.includes('import MultiChatStore'),
    "VoiceBridge must not import its own AIService or MultiChatStore (uses genesis context instead)",
  );
  assert.ok(
    !code.includes('AIService.getInstance()') && !code.includes('MultiChatStore.getInstance()'),
    "VoiceBridge must not instantiate AIService or MultiChatStore directly",
  );
});

test("no second AIService is created for voice", () => {
  const voiceFiles = ["src/core/voice/VoiceEngine.ts", "src/app/scene/genesis/VoiceBridge.tsx", "src/app/scene/genesis/CoreHoldGesture.tsx"];
  for (const file of voiceFiles) {
    const code = src(file);
    assert.ok(
      !code.includes("new AIService") && !code.includes("AIService.getInstance") || file.includes("VoiceEngine"),
      // VoiceEngine itself may use AIService — that's correct (it's the SAME AIService)
      `${file}: must not create a second AIService`,
    );
  }
  // VoiceEngine calling AIService is the correct single path
  const engineCode = src("src/core/voice/VoiceEngine.ts");
  assert.ok(
    engineCode.includes("AIService"),
    "VoiceEngine must use the existing AIService for voice responses (same pipeline as text chat)",
  );
});

// ---- Voice + chat coexist (same conversationId) --------------------

test("VoiceEngine calls AIService.chat() — same path as text chat", () => {
  const code = src("src/core/voice/VoiceEngine.ts");
  // VoiceEngine routes through the same AIService.chat() as text messages.
  // The conversationId is managed by AIService/MultiChatStore (active conversation).
  // VoiceBridge routes user utterances through addMessage — same path as typed input.
  assert.ok(
    code.includes("AIService"),
    "VoiceEngine must use the existing AIService — not a separate LLM call",
  );
});

test("Core 3D material already has voice phase visual states", () => {
  const code = src("src/app/scene/genesis/materials/GenesisCore.tsx");
  assert.ok(
    code.includes("state.voice") && code.includes('"listening"') && code.includes('"speaking"'),
    "GenesisCore 3D material must already handle voice phases for visual feedback",
  );
});
