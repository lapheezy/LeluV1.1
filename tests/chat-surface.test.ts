/**
 * ==========================================================
 * LÉLU — CHAT AND COSMOS ARE SIBLING SURFACES
 *
 * CATEGORY: unit. Pure surface resolution and measurement; reads
 * the real source tree for the structural assertions.
 *
 * Why this exists. On a phone, chat was a full-screen window over a
 * live 3D world: the canvas, the sky backdrop, the phase HUD and the
 * overview all kept rendering behind it. Measured at 390×844 with
 * chat open and idle: 2 frames a second and ~8.6 s of native WebGL
 * work per 8 s; a tap on the composer timed out after 20 s. After the
 * separation, same page and viewport: 61 fps, no long tasks during a
 * streamed reply, a composer tap in 56 ms.
 *
 * And four lifecycle faults that the separation exposed:
 *   - the AI bridges lived inside the v1 scene, so leaving that scene
 *     (Gen V2, System — or, now, a phone chat) stopped replies being
 *     written back;
 *   - every keystroke set the GLOBAL dialogue phase to "typing",
 *     re-rendering the whole tree, energising the 3D Core, and — typed
 *     during a reply — overwriting "processing";
 *   - closing chat unmounted it mid-turn, so the reopened chat had no
 *     Stop control and a turn queue that did not know a turn was
 *     running;
 *   - a thrown `undefined` left the error boundary re-rendering the
 *     child that threw.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { resolveSurface } from "../src/app/scene/genesis/surface/Surface";
import { chatFillsScreen } from "../src/app/scene/genesis/chat/chatLayout";
import { measure } from "../src/core/ui/Workspace";
import { thrownMessage } from "../src/app/scene/genesis/GenesisErrorBoundary";

const code = (path: string) => readFileSync(path, "utf8");

/** The surface for a viewport and a panel, the way useSurface() builds it. */
function surfaceAt(width: number, height: number, activePanel: string, extra: { minimized?: boolean; openModuleCount?: number } = {}) {
  return resolveSurface({
    activePanel,
    minimized: extra.minimized ?? false,
    openModuleCount: extra.openModuleCount ?? 0,
    compact: chatFillsScreen({ width, height }),
  });
}

/* ------------------------------ surfaces ------------------------------ */

const PHONES: Array<[string, number, number]> = [
  ["iPhone portrait", 390, 844],
  ["iPhone landscape", 844, 390],
  ["small Android portrait", 360, 740],
  ["small Android landscape", 740, 360],
];

test("on every phone viewport, open chat owns the screen and Cosmos is not rendered", () => {
  for (const [name, width, height] of PHONES) {
    const surface = surfaceAt(width, height, "chat");
    assert.equal(surface.mode, "chat", name);
    assert.equal(surface.chatOwnsScreen, true, `${name}: chat owns the screen`);
    assert.equal(surface.cosmosRendered, false, `${name}: no Cosmos under the chat`);
  }
});

test("Cosmos is Home: closing chat on a phone renders it again", () => {
  for (const [name, width, height] of PHONES) {
    const surface = surfaceAt(width, height, "none");
    assert.equal(surface.mode, "home", name);
    assert.equal(surface.cosmosRendered, true, name);
  }
});

test("a desktop or tablet chat is a window over Cosmos, not the whole screen", () => {
  for (const [width, height] of [[1440, 900], [820, 1180]]) {
    const surface = surfaceAt(width, height, "chat");
    assert.equal(surface.mode, "chat");
    assert.equal(surface.chatOwnsScreen, false);
    assert.equal(surface.cosmosRendered, true);
  }
});

test("the modes are explicit: home, chat, workspace, agent, notifications", () => {
  assert.equal(surfaceAt(390, 844, "none").mode, "home");
  assert.equal(surfaceAt(390, 844, "chat").mode, "chat");
  assert.equal(surfaceAt(390, 844, "memory").mode, "workspace");
  assert.equal(surfaceAt(390, 844, "none", { openModuleCount: 1 }).mode, "workspace");
  assert.equal(surfaceAt(390, 844, "agents").mode, "agent");
  assert.equal(surfaceAt(390, 844, "history").mode, "notifications");
  // Minimized is the chip over Cosmos, whatever panel was open.
  const minimized = surfaceAt(390, 844, "chat", { minimized: true });
  assert.equal(minimized.mode, "home");
  assert.equal(minimized.cosmosRendered, true);
});

test("no surface but phone chat takes Cosmos away", () => {
  for (const panel of ["none", "memory", "agents", "history", "cosmos", "self-evolution"]) {
    assert.equal(surfaceAt(390, 844, panel).cosmosRendered, true, panel);
  }
});

/* ------------------------- the router and scene ------------------------ */

test("the router renders no scene while chat owns the screen", () => {
  const scene = code("src/app/scene/genesis/GenesisScene.tsx");
  const router = scene.slice(scene.indexOf("function GenesisWorkspaceRouter"));
  // The scene switch begins with the surface gate, so V1 (canvas, sky,
  // HUD), the System scene and Gen V2 are all inside it.
  const gate = router.indexOf("!surface.cosmosRendered ?");
  assert.ok(gate > 0, "the scene switch is gated on the surface");
  for (const scenePart of ["<GenesisV2Workspace", "<LivingSystemUI", "<GenesisV1Workspace"]) {
    assert.ok(router.indexOf(scenePart) > gate, `${scenePart} sits behind the gate`);
  }
  assert.match(router, /surface\.cosmosRendered && !v2Active && !systemActive && \(\s*<Suspense fallback=\{null\}>\s*<CosmosOverview/);
});

test("the AI bridges belong to the app, not to the v1 scene", () => {
  const scene = code("src/app/scene/genesis/GenesisScene.tsx");
  const v1 = scene.slice(scene.indexOf("const GenesisV1Workspace"), scene.indexOf("function GenesisV2Workspace"));
  const router = scene.slice(scene.indexOf("function GenesisWorkspaceRouter"));
  for (const bridge of ["<GenesisBridge />", "<ProactiveBridge />", "<VoiceBridge />"]) {
    assert.ok(!v1.includes(bridge), `${bridge} must not unmount with the scene`);
    assert.equal(router.split(bridge).length - 1, 1, `${bridge} is mounted once, in the router`);
    assert.ok(router.indexOf(bridge) < router.indexOf("!surface.cosmosRendered"), `${bridge} is outside the scene gate`);
  }
});

test("the interface leaves out Cosmos chrome while chat owns the screen", () => {
  const ui = code("src/app/scene/genesis/GenesisInterface.tsx");
  assert.match(ui, /surface\.chatOwnsScreen \? null : <VisualInterface \/>/);
  assert.match(ui, /\{surface\.chatOwnsScreen \? null : \(\s*<div/, "the top chrome is not drawn over the chat header");
  assert.match(ui, /chatOwnsScreen=\{surface\.chatOwnsScreen\}/, "the dock is told");
  const dock = code("src/app/scene/genesis/GenesisDock.tsx");
  assert.match(dock, /const breakpoint: Breakpoint = chatOwnsScreen \? "mobile" : measuredBreakpoint;/,
    "a landscape phone (844px wide) must not get a tablet rail beside the full-screen chat");
});

/* ------------------------------ the chat ------------------------------ */

test("typing is the composer's own state, never a global dialogue phase", () => {
  const chat = code("src/app/scene/genesis/GenesisChat.tsx");
  assert.ok(!/setDialogue\("typing"\)/.test(chat), "no keystroke or attachment sets the global phase");
  const onChange = chat.slice(chat.indexOf("onChange={(event) => {", chat.indexOf("<textarea")), chat.indexOf("onKeyDown=", chat.indexOf("<textarea")));
  assert.ok(onChange.length > 0);
  assert.ok(!/setDialogue/.test(onChange), "the composer's onChange does not touch the Core");
  assert.match(onChange, /setInput\(event\.target\.value\)/);
});

test("closing chat hides it; it is unmounted only with the whole interface", () => {
  const ui = code("src/app/scene/genesis/GenesisInterface.tsx");
  assert.match(
    ui,
    /\{state\.minimized \? null : \(\s*<ChatErrorBoundary onLeave=\{handleExitChat\}>\s*<GenesisChat hidden=\{!\(state\.activePanel === "chat" \|\| openModuleIds\.length > 0\)\} \/>/,
  );
  const chat = code("src/app/scene/genesis/GenesisChat.tsx");
  assert.match(chat, /display: hidden \? "none" : "flex"/);
  assert.match(chat, /if \(hiddenRef\.current\) return;/, "a hidden chat does not take Escape or keystrokes");
  assert.match(chat, /!hidden && shownQuestion\?\.status === "pending"/, "a question is not marked seen while hidden");
  // Re-showing does not reset a turn that is still running.
  assert.match(chat, /if \(!liveTurnsRef\.current\.has\(MultiChatStore\.getInstance\(\)\.getActiveId\(\)\)\) \{\s*setDialogueRef\.current\("listening"\);/);
});

test("the phone chat is edge to edge: no dock inset, 100vw × 100dvh, keyboard-aware", () => {
  const chat = code("src/app/scene/genesis/GenesisChat.tsx");
  assert.ok(!/useDockInset|dockInset/.test(chat), "nothing pushes the full-screen chat over");
  assert.ok(!/export function useDockInset/.test(code("src/app/scene/genesis/chat/chatLayout.ts")));
  assert.ok(!/useDockInset/.test(code("src/app/scene/genesis/MultiChatTabs.tsx")));
  assert.match(chat, /left: 0,\s*right: 0,\s*top: workspace\.keyboardOpen \? workspace\.visibleTop : 0,\s*width: "100vw",\s*height: workspace\.keyboardOpen \? workspace\.visibleHeight : "100dvh",/);
  assert.match(chat, /paddingTop: isFullMobile \? "calc\(env\(safe-area-inset-top, 0px\) \+ 10px\)"/, "safe areas are padding inside the sky");
});

test("an open keyboard is measured: visible height and where the visible area starts", () => {
  const closed = measure(390, 844, { visibleHeight: 844 });
  assert.equal(closed.keyboardOpen, false);
  assert.equal(closed.visibleTop, 0);
  const open = measure(390, 844, { visibleHeight: 508, visibleTop: 290 });
  assert.equal(open.keyboardOpen, true);
  assert.equal(open.visibleHeight, 508);
  assert.equal(open.visibleTop, 290, "iOS scrolls the visible area up under a keyboard");
  assert.equal(measure(390, 844, { visibleTop: -4 }).visibleTop, 0, "rubber-band overscroll is not an offset");
  // Address bar collapse/expand is browser chrome, not a keyboard.
  assert.equal(measure(390, 844, { visibleHeight: 780 }).keyboardOpen, false);
  assert.match(code("src/core/ui/Workspace.ts"), /Math\.round\(next\.visibleTop\) === Math\.round\(current\.visibleTop\)/, "a visibleTop change is published");
});

/* --------------------------- notifications ---------------------------- */

test("nothing is toasted over a phone chat; it goes to the Chats panel's notifications", () => {
  const center = code("src/app/scene/genesis/GenesisNotificationCenter.tsx");
  assert.match(center, /if \(chatOwnsScreen\) return null;/);
  assert.match(center, /provider\.notify\(\{[\s\S]{0,200}silent: true/, "recorded in the inbox, without a toast");
  assert.match(center, /dismissNotification\(notification\.id\)/);
});

/* ------------------------------ errors ------------------------------- */

test("a thrown value is described in words — never the word undefined", () => {
  assert.equal(thrownMessage(new Error("Stream interrupted")), "Stream interrupted");
  assert.equal(thrownMessage("Provider unavailable"), "Provider unavailable");
  for (const thrown of [undefined, null, new Error(""), "   ", 42, {}]) {
    const text = thrownMessage(thrown);
    assert.ok(text.length > 0);
    assert.ok(!/undefined|null|\[object Object\]/.test(text), `${String(thrown)} → ${text}`);
  }
});

test("a boundary that caught `undefined` stays caught instead of re-rendering the child", () => {
  const boundary = code("src/app/scene/genesis/GenesisErrorBoundary.tsx");
  assert.match(boundary, /if \(this\.state\.failed\)/);
  assert.match(boundary, /failed: true,/);
  const chat = code("src/app/scene/genesis/chat/ChatErrorBoundary.tsx");
  assert.match(chat, /console\.error\("\[LÉLU chat\] render error", error, info\.componentStack\)/, "the real error is logged");
  assert.match(chat, /Reopen the conversation/);
  assert.match(chat, /generation: current\.generation \+ 1/, "reopen is a fresh mount");
});
