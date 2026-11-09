/**
 * The old single-panel chat (with the browser-style tab strip) is gone:
 * every "open the chat" opens the Chat Universe, the old panel never draws,
 * and the Universe composer carries attachments, screen sharing and voice.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const code = (p: string) => readFileSync(p, "utf8");

test("the tab strip component no longer exists and is not rendered", () => {
  assert.equal(existsSync("src/app/scene/genesis/MultiChatTabs.tsx"), false);
  assert.doesNotMatch(code("src/app/scene/genesis/GenesisInterface.tsx"), /MultiChatTabs/);
});

test("the old panel is mounted only as the send engine and never draws", () => {
  const ui = code("src/app/scene/genesis/GenesisInterface.tsx");
  assert.match(ui, /<GenesisChat hidden \/>/);
  assert.match(code("src/app/scene/genesis/GenesisChat.tsx"), /if \(hidden\) return null;/);
});

test("openPanel('chat') always opens the Chat Universe — no way back to the old panel", () => {
  const core = code("src/app/scene/genesis/GenesisCore.tsx");
  assert.match(core, /if \(panel === "chat"\) \{[\s\S]{0,200}lelu-open-universe[\s\S]{0,40}return;/);
  assert.doesNotMatch(core, /consumeFullChatRequest/);
  assert.doesNotMatch(code("src/app/scene/genesis/chat/universe/ChatUniverse.tsx"), /full chat|requestFullChatOnce/);
});

test("the Universe composer carries attachments, screen sharing and voice itself", () => {
  const u = code("src/app/scene/genesis/chat/universe/ChatUniverse.tsx");
  assert.match(u, /aria-label="Attach an image or video"/);
  assert.match(u, /screenShareSupport\(\)\.supported/);
  assert.match(u, /VoiceEngine\.getInstance\(\)\.toggle\(\)/);
  assert.match(u, /media: attached/);
  assert.match(code("src/app/scene/genesis/GenesisChat.tsx"), /universeMediaRef\.current = media;/);
});
