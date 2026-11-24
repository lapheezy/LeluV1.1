/**
 * ==========================================================
 * LÉLU — THE MICROPHONE IS IN THE ACTUAL CHAT SURFACE
 *
 * CATEGORY: integration (source-level). Component existence is not the
 * claim being tested. The claim is that the canonical per-conversation
 * chat window — the surface the workforce branch really renders — mounts
 * the ONE microphone control, and that control calls the existing
 * VoiceEngine rather than merely drawing an icon.
 *
 * Why this exists. The original mic fix (commit c5c532b) lived in the old
 * single chat panel. The Chat Universe replaced that panel; the old chat
 * stayed mounted but hidden, and UniverseChatWindow — the window a user
 * actually types into — never received a microphone. This test fails if
 * that integration is lost again, or if a second, decorative mic is added.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("the canonical chat window mounts the shared microphone control", () => {
  const windowSource = read("src/app/scene/genesis/chat/universe/UniverseChatWindow.tsx");
  assert.match(windowSource, /import VoiceMicButton from "[^"]*core\/voice\/VoiceMicButton"/);
  assert.match(windowSource, /<VoiceMicButton context=\{`chat:\$\{conversation\.id\}`\}/, "the window composer has no microphone");
  assert.match(windowSource, /className="lcu-win-composer"/, "the microphone is not attached to the real composer");
});

test("the microphone control invokes the existing voice pipeline, not a new one", () => {
  const mic = read("src/core/voice/VoiceMicButton.tsx");
  assert.match(mic, /useVoice\(\)/);
  assert.match(mic, /voice\.engine\.toggle\(\)/, "the control does not start/stop the real VoiceEngine");
  assert.match(mic, /state\.error/, "permission and device failures are not shown");
  assert.match(mic, /state\.active/, "the control has no listening state");
  assert.match(mic, /data-testid="lelu-voice-status"/, "there is no visible state/error feedback");
  assert.match(mic, /CircularControl/, "the microphone is not part of the shared interaction system");
  assert.match(read("src/core/voice/VoiceEngine.ts"), /dismissError\(\)/, "voice errors cannot be cleared");
});

test("the universal composer and the in-scene bar use the same mic, with no duplicate toggle", () => {
  const universe = read("src/app/scene/genesis/chat/universe/ChatUniverse.tsx");
  assert.match(universe, /import VoiceMicButton/);
  assert.match(universe, /<VoiceMicButton context="chat-universe"/);
  assert.doesNotMatch(universe, /VoiceEngine\.getInstance\(\)\.toggle\(\)/, "a second microphone implementation is still present");

  const spatial = read("src/app/scene/spatial/SpatialNavigator.tsx");
  assert.match(spatial, /<VoiceMicButton context="spatial"/);
  assert.doesNotMatch(spatial, /VoiceEngine\.getInstance\(\)\.toggle\(\)/, "the spatial bar has its own mic implementation");

  const core = read("src/app/scene/genesis/GenesisChat.tsx");
  assert.match(core, /<VoiceMicButton context="core-chat"/);
});

test("the hidden send engine still exists, so the fix is in the visible surface", () => {
  const iface = read("src/app/scene/genesis/GenesisInterface.tsx");
  assert.match(iface, /<GenesisChat hidden \/>/, "the old send engine was removed instead of being left as the engine");
  assert.match(iface, /<ChatUniverse \/>/, "the Chat Universe is not mounted by the canonical interface");
});

test("every radial menu comes from the one shared implementation", () => {
  const sources = [
    "src/app/scene/genesis/home/SpatialNav.tsx",
    "src/app/scene/genesis/interaction/EnvironmentRadial.tsx",
    "src/app/scene/genesis/chat/universe/ChatUniverse.tsx",
    "src/app/scene/genesis/chat/universe/UniverseChatWindow.tsx",
    "src/core/voice/VoiceMicButton.tsx",
  ];
  for (const path of sources) {
    const source = read(path);
    assert.match(
      source,
      /from "(?:\.\.\/)+(?:core\/)?interaction"/,
      `${path} does not use the shared interaction system`,
    );
    assert.doesNotMatch(source, /function RadialMenu\s*\(|const RadialMenu\s*=/, `${path} has its own radial implementation`);
  }
});
