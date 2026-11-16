/**
 * Mission 11 — the interface must call the systems it already has.
 *
 * These are wiring regressions, not screenshots: the Unified Studio must
 * mount the canonical editors, the Universe must hand real files into the
 * existing chat send path, chat windows must expose their controls, and
 * world navigation must clear whatever was covering the destination.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const code = (path: string) => readFileSync(path, "utf8");

test("Visual Studio mounts the canonical Sketch, Render and Avatar workspaces", () => {
  const studio = code("src/app/scene/genesis/GenesisVisualStudio.tsx");
  assert.match(studio, /import GenesisSketchPanel/);
  assert.match(studio, /import GenesisRenderPanel/);
  assert.match(studio, /import GenesisAvatarPanel/);
  assert.match(studio, /<GenesisSketchPanel onClose=\{onClose\}/);
  assert.match(studio, /<GenesisRenderPanel onClose=\{onClose\}/);
  assert.match(studio, /<GenesisAvatarPanel onClose=\{onClose\}/);
  // The old placeholder routed a prompt to a second generation pipeline.
  assert.doesNotMatch(studio, /CreativeOrchestrator/);
});

test("Sketch creates a document without a blocking native prompt", () => {
  const sketch = code("src/app/scene/genesis/GenesisSketchPanel.tsx");
  const create = sketch.slice(sketch.indexOf("function createDocument()"), sketch.indexOf("return (", sketch.indexOf("function createDocument()")));
  assert.match(create, /store\.create\(`Sketch \$\{docs\.length \+ 1\}`\)/);
  assert.doesNotMatch(create, /window\.prompt/);
});

test("the Universe composer passes documents to GenesisChat's real send path", () => {
  const universe = code("src/app/scene/genesis/chat/universe/ChatUniverse.tsx");
  const chat = code("src/app/scene/genesis/GenesisChat.tsx");
  assert.match(universe, /interface UniverseFile/);
  assert.match(universe, /preview = \(await file\.text\(\)\)/);
  assert.match(universe, /files: attachedFiles/);
  assert.match(universe, /onDrop=/);
  assert.match(universe, /\.txt,\.md,\.json/);
  assert.match(chat, /const universeFilesRef = useRef<PendingFile\[\]>/);
  assert.match(chat, /universeFilesRef\.current = files/);
  assert.match(chat, /const files = reused \? handedFiles : pendingFiles/);
});

test("each chat window owns one expandable control tab", () => {
  const win = code("src/app/scene/genesis/chat/universe/UniverseChatWindow.tsx");
  assert.match(win, /aria-label="Chat controls"/);
  assert.match(win, /aria-haspopup="menu"/);
  assert.match(win, /Pin conversation|Unpin conversation/);
  assert.match(win, /Minimize/);
  assert.match(win, /Maximize|Restore window/);
  assert.match(win, /Chat settings/);
  assert.match(win, /Close window/);
});

test("Cosmos clears the active panel instead of only changing its label", () => {
  const worlds = code("src/app/scene/genesis/home/HomeSheets.tsx");
  const cosmos = worlds.slice(worlds.indexOf('id: "cosmos"'), worlds.indexOf('id: "genesisv2"'));
  assert.match(cosmos, /goHome\(genesis\)/);
  assert.match(cosmos, /HomeStore\.setImmersive\(false\)/);
  const earth = worlds.slice(worlds.indexOf('id: "earth"'), worlds.indexOf('id: "system"'));
  assert.match(earth, /if \(scene === "genesisv2"\) genesis\.openPanel\("none"\)/);
  assert.match(earth, /genesis\.openPanel\("earth"/);
});

test("a phone gives an open application window the screen", () => {
  const ui = code("src/app/scene/genesis/GenesisInterface.tsx");
  assert.match(ui, /state\.activePanel !== "none" && typeof window !== "undefined" && window\.innerWidth < 720/);
});
