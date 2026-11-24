/**
 * M23 WP02 — the chat microphone on a phone.
 *
 * CATEGORY: unit (source + the real space measurement in a minimal DOM).
 * The behaviour itself — the button, permission, recording state, audio
 * reaching the server, the transcript, and the visible error — is exercised
 * in a real browser by scripts/e2e/mic-e2e.cjs; this file pins the two
 * defects that run found so they cannot quietly return.
 *
 *  1. Voice errors were only notify()-ed, and while the chat owns a phone
 *     screen notifications are filed silently: a denied microphone showed
 *     nothing on a phone. The button now renders its own alert.
 *  2. The companion avoids `[data-lelu-composer]`, which only the old
 *     GenesisChat carried: on a phone she stood on the Chat Universe
 *     composer's send button.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { measureSpace } from "../src/app/scene/genesis/avatar/spatialPresence";

const read = (file: string) => readFileSync(file, "utf8");

test("the microphone button shows its own error, as an alert, on every device", () => {
  const source = read("src/app/scene/genesis/chat/universe/VoiceToggle.tsx");
  assert.match(source, /role="alert"/);
  assert.match(source, /data-lelu-voice-error=\{state\.errorKind/);
  assert.match(source, /aria-describedby=\{error \? "lcu-voice-error"/);
  // Shown only while not active, and a new attempt replaces it.
  assert.match(source, /!state\.active && state\.error && state\.error !== dismissed/);
  assert.match(source, /VoiceEngine\.getInstance\(\)\.toggle\(\)/);
  const css = read("src/app/scene/genesis/chat/universe/chatUniverse.css");
  assert.match(css, /\.lcu-voice-error \{/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.lcu-icon\.sm\[data-lelu-voice-toggle\]/);
});

test("both Chat Universe composers are marked as the composer the companion must avoid", () => {
  assert.match(read("src/app/scene/genesis/chat/universe/ChatUniverse.tsx"), /className="lcu-composer" data-lelu-composer/);
  assert.match(read("src/app/scene/genesis/chat/universe/UniverseChatWindow.tsx"), /data-lelu-composer\n\s+className="lcu-win-composer/);
});

test("the space measurement takes the first composer actually on screen", () => {
  const rect = (left: number, top: number, width: number, height: number) => () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
  const hidden = { getBoundingClientRect: rect(0, 0, 0, 0), closest: () => null };
  const visible = { getBoundingClientRect: rect(10, 540, 370, 56), closest: () => null };
  const doc = {
    querySelector: () => null,
    querySelectorAll: (selector: string) => (selector === "[data-lelu-composer]" ? [hidden, visible] : []),
    defaultView: { innerWidth: 390, innerHeight: 664, matchMedia: () => ({ matches: false }), getComputedStyle: () => ({ getPropertyValue: () => "" }) },
    documentElement: {},
  } as unknown as Document;
  const space = measureSpace(doc);
  assert.deepEqual(space.composer, { left: 10, top: 540, width: 370, height: 56 });
});
