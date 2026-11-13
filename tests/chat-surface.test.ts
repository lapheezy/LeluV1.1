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
import { thrownMessage } from "../src/app/scene/genesis/thrownMessage";

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
  assert.match(ui, /surface\.chatOwnsScreen \|\| showHome \? null : <VisualInterface \/>/);
  assert.match(ui, /\{surface\.chatOwnsScreen \|\| showHome \? null : \(\s*<div/, "the top chrome is not drawn over the chat header");
  assert.match(
    ui,
    /const navHidden =[\s\S]{0,500}?surface\.chatOwnsScreen[\s\S]{0,200}?surface\.workspaceOwnsScreen/,
    "the navigation is not told that the chat owns the screen",
  );
  assert.match(
    ui,
    /state\.activePanel !== "none"[\s\S]{0,160}?window\.innerWidth < 720/,
    "an open application window must also hide the phone navigation",
  );
  assert.match(ui, /hidden=\{navHidden\}/, "the spatial navigation ignores navHidden");
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
    // The send engine stays mounted (always hidden — the Chat Universe is
    // the chat) and unmounts only with the whole interface.
    /\{state\.minimized \? null : \(\s*<ChatErrorBoundary onLeave=\{handleExitChat\}>[\s\S]{0,160}<GenesisChat hidden \/>/,
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

/* ------------------------ phone: workspaces + menu ------------------------ */

test("on a phone a visible workspace owns the screen; chat waits underneath", () => {
  const withModule = resolveSurface({ activePanel: "chat", minimized: false, openModuleCount: 1, visibleModuleCount: 1, compact: true });
  assert.equal(withModule.workspaceOwnsScreen, true);
  assert.equal(withModule.chatOwnsScreen, false, "the chat must not cover the module");
  assert.equal(withModule.cosmosRendered, false);
  const minimized = resolveSurface({ activePanel: "chat", minimized: false, openModuleCount: 1, visibleModuleCount: 0, compact: true });
  assert.equal(minimized.workspaceOwnsScreen, false);
  assert.equal(minimized.chatOwnsScreen, true, "minimizing the module brings the chat back");
  const desktop = resolveSurface({ activePanel: "chat", minimized: false, openModuleCount: 1, visibleModuleCount: 1, compact: false });
  assert.equal(desktop.workspaceOwnsScreen, false, "on a desktop module windows float beside the chat");
  // The old browser-style chat tab strip is gone; the Chat Universe is the chat.
  assert.doesNotMatch(code("src/app/scene/genesis/GenesisInterface.tsx"), /<MultiChatTabs\b/);
});

test("the LÉLU menu sheet sits above its own backdrop", () => {
  // Measured: backdrop within("navigation", 1) = 201 over the sheet at 200,
  // so every tap on an item hit the backdrop and closed the menu.
  const dock = code("src/app/scene/genesis/GenesisDock.tsx");
  const backdrop = dock.match(/onClick=\{\(\) => setMenuOpen\(false\)\}[\s\S]{0,200}?zIndex: within\("navigation", (\d+)\)/);
  const sheet = code("src/app/scene/genesis/GenesisMobileMenu.tsx").match(/zIndex: within\("navigation", (\d+)\)/);
  assert.ok(backdrop && sheet, "both layers are on the navigation scale");
  assert.ok(Number(sheet[1]) > Number(backdrop[1]), `sheet ${sheet[1]} must be above backdrop ${backdrop[1]}`);
});

test("framed panels scroll with one finger at 1×; pinch zoom still works", () => {
  const pinch = code("src/app/scene/genesis/PinchZoomContainer.tsx");
  assert.match(pinch, /\.\.\.\(zoomed \? \{ overflow: "hidden" \} : \{ overflowX: "hidden", overflowY: "auto" \}\)/);
  assert.match(pinch, /touchAction: zoomed \? "none" : "pan-y"/);
  assert.ok(!/overflow: zoomed \? "hidden" : undefined/.test(pinch), "no undefined shorthand next to its long-hands");
  assert.match(code("src/app/scene/genesis/GenesisWindowFrame.tsx"), /\) : narrow \? \(\s*\/\/[\s\S]{0,200}overflowY: "auto"/);
});

/* ------------------------- phone: the Browser ------------------------- */

test("on a phone, LÉLU browsing for the chat on screen opens the Browser full screen", () => {
  const controller = code("src/app/scene/genesis/GenesisSurfaceController.tsx");
  assert.match(
    controller,
    /surface === "browser" &&\s*isLiveResearchSurface &&\s*ownedByChat &&\s*ownerForTask\(event\.taskId\) === MultiChatStore\.getInstance\(\)\.getActiveId\(\) &&\s*chatFillsScreen\(Workspace\.getInstance\(\)\.get\(\)\)/,
    "only for the conversation being looked at, only on a phone",
  );
  assert.match(controller, /const key = `\$\{event\.taskId\}:browser-module`;[\s\S]{0,120}openModule\("browser"\)/, "once per task: minimizing it is not undone by the next page");
});

test("the chat is one tap away from a phone workspace", () => {
  const host = code("src/app/scene/genesis/GenesisModuleHost.tsx");
  assert.match(host, /aria-label="Back to chat"\s*onClick=\{\(\) => \{\s*minimizeModule\(id\);\s*openPanel\("chat"\);/);
  assert.match(host, /const compactScreen = chatFillsScreen\(/);
});

test("the chat is never counted as a module window", () => {
  // openPanel("chat") records "chat" in `modules`; counted, it made opening
  // chat on a phone read as "a workspace owns the screen" and hid the chat.
  assert.match(code("src/app/scene/genesis/surface/useSurface.ts"), /\.filter\(\(\[id\]\) => id !== "chat"\)/);
});

test("a panel inside a module window is a body, not a second window", () => {
  // Measured on a phone: the panel's own fixed 587px sheet rose over the
  // 560px window's title bar, so ◎ Chat / — / ✕ could not be touched. On
  // desktop the same panel drew a second full glass frame (border, shadow,
  // its own "Exit Core") inside the host window — one window, two chromes.
  const host = code("src/app/scene/genesis/GenesisModuleHost.tsx");
  assert.equal(host.split("<InModuleWindow.Provider value={true}>").length - 1, 2, "both window shapes mark their panel");
  const frame = code("src/app/scene/genesis/GenesisWindowFrame.tsx");

  // ONE rule for both widths: inside the host the frame is a plain body.
  assert.match(
    frame,
    /const frameStyle: CSSProperties = inModuleWindow\s*\?\s*\{[\s\S]{0,400}position: "relative",[\s\S]{0,200}boxSizing: "border-box",/,
    "no viewport-dependent chrome inside a module window",
  );
  assert.match(frame, /background: "transparent",\s*border: "none",/, "no second glass pane inside the window");
  assert.match(
    frame,
    /\{inModuleWindow \? \(\s*\/\*[\s\S]{0,400}data-lelu-panel-heading/,
    "identity and counts stay; the window controls do not",
  );
  assert.match(frame, /\{resizable && !narrow && !inModuleWindow \? \(/, "the window has the resize handle, not the panel");
  assert.match(frame, /\{narrow && resizable && !inModuleWindow \? \(/, "the sheet handle too");
});

test("nothing is toasted over a full-screen phone workspace either", () => {
  // Measured: an "I read that" toast lay over the Browser's title bar and
  // swallowed the tap on "◎ Chat".
  assert.match(
    code("src/app/scene/genesis/GenesisNotificationCenter.tsx"),
    /const chatOwnsScreen = surface\.chatOwnsScreen \|\| surface\.workspaceOwnsScreen;/,
  );
});

/* ---------------- Phase 2: the Chat Universe owns the phone ---------------- */

test("an open Chat Universe (workspace mode) owns a phone screen: no Cosmos, no Home", () => {
  const universe = resolveSurface({ activePanel: "none", minimized: false, openModuleCount: 0, visibleModuleCount: 0, compact: true, universeOwnsScreen: true });
  assert.equal(universe.chatOwnsScreen, true);
  assert.equal(universe.cosmosRendered, false);
  // Floating mode keeps the live Cosmos behind the windows, by design.
  const floating = resolveSurface({ activePanel: "none", minimized: false, openModuleCount: 0, visibleModuleCount: 0, compact: true, universeOwnsScreen: false });
  assert.equal(floating.cosmosRendered, true);
  // A desktop Universe never takes the screen.
  const desktop = resolveSurface({ activePanel: "none", minimized: false, openModuleCount: 0, visibleModuleCount: 0, compact: false, universeOwnsScreen: true });
  assert.equal(desktop.chatOwnsScreen, false);
  assert.equal(desktop.cosmosRendered, true);
  // Minimizing the whole interface returns Home even with the Universe open.
  assert.equal(resolveSurface({ activePanel: "none", minimized: true, openModuleCount: 0, compact: true, universeOwnsScreen: true }).cosmosRendered, true);
});

test("the surface reads the Universe's open state from one shared store", () => {
  const surface = readFileSync("src/app/scene/genesis/surface/useSurface.ts", "utf8");
  assert.match(surface, /useUniverseOpen\(\)/);
  assert.match(surface, /universeOpen && cosmosMode !== "floating"/);
  const universe = readFileSync("src/app/scene/genesis/chat/universe/ChatUniverse.tsx", "utf8");
  assert.match(universe, /const open = useUniverseOpen\(\)/, "the Universe uses the shared store, not a private useState");
});

test("Home and the spatial nav leave the tree (not hidden) while a conversation owns the phone", () => {
  const ui = readFileSync("src/app/scene/genesis/GenesisInterface.tsx", "utf8");
  assert.match(ui, /const showHome = [^;]*!surface\.chatOwnsScreen && !surface\.workspaceOwnsScreen;/);
  assert.match(ui, /navHidden && \(surface\.chatOwnsScreen \|\| surface\.workspaceOwnsScreen\) \? null : \(\s*<SpatialNav/);
});

test("on a phone a conversation window is the full visual viewport; one composer; apps above the chat panel", () => {
  const host = readFileSync("src/app/scene/genesis/GenesisModuleHost.tsx", "utf8");
  assert.match(host, /const phoneSheet = compactScreen && chatWindow;/);
  assert.match(host, /top: viewport\.offsetTop,\s*width: viewportWidth,\s*height: viewportHeight,/, "follows the keyboard-shrunk visual viewport");
  assert.match(host, /env\(safe-area-inset-bottom/);
  assert.match(host, /Math\.max\(APP_WINDOW_Z, mod\.zIndex \?\? APP_WINDOW_Z \+ cascadeIndex\)/);
  const universe = readFileSync("src/app/scene/genesis/chat/universe/ChatUniverse.tsx", "utf8");
  assert.match(universe, /\{sheetOpen \? null : \(/, "the Universe composer leaves while a conversation sheet owns the screen");
});

test("opening a conversation over the Universe leaves the Universe header on screen", () => {
  // Measured at 390×844 before this: `.lcu-head` occupied y 10–80 while the
  // conversation sheet covered y 0–844, so an 80px overlap buried the header,
  // its cards and its close control and the app read as if the Universe had
  // closed. The sheet must start below the header whenever the Universe is
  // open, and keep the whole visual viewport when it is not.
  const host = readFileSync("src/app/scene/genesis/GenesisModuleHost.tsx", "utf8");
  assert.match(host, /const universeOpen = useUniverseOpen\(\);/, "the host reads the one Universe open store");
  assert.match(
    host,
    /const universeHeadInset = phoneSheet && universeOpen \? UNIVERSE_COMPACT_HEAD : 0;/,
    "only an open Universe lifts the sheet, and only on a phone sheet",
  );
  assert.match(host, /const UNIVERSE_COMPACT_HEAD = 88;/, "the header clearance is explicit");
  assert.match(
    host,
    /top: `calc\(\$\{viewport\.offsetTop\}px \+ \$\{universeHeadInset\}px \+ env\(safe-area-inset-top, 0px\)\)`/,
    "the sheet starts below the Universe header, including the device's top safe area",
  );
  assert.match(
    host,
    /height: `calc\(\$\{viewportHeight\}px - \$\{universeHeadInset\}px - env\(safe-area-inset-top, 0px\)\)`/,
    "the sheet keeps the remaining visual viewport (keyboard-shrunk, not the layout viewport)",
  );
  assert.match(host, /paddingTop: 0,/, "the safe area is above the sheet, so it is not padded twice");
  // The correction lives inside the `phoneSheet ? …` block: desktop windows are
  // untouched, and a phone chat opened straight from Home still fills the screen.
  assert.match(
    host,
    /const phoneSheet = compactScreen && chatWindow;[\s\S]{0,400}const universeHeadInset = phoneSheet && universeOpen/,
    "the inset is phone-only and gated on the Universe being open",
  );
});

test("Step 3: under a phone sheet LÉLU's single presence stays mounted, drawing slowly at an edge (no unmount, no hidden WebGL)", () => {
  // Phase 2 unmounted her window under phone sheets (a hidden canvas stalled
  // the GPU). Step 3 keeps ONE presence: under a sheet she rests visible at
  // the least obstructive edge, paused (a live canvas beside a sheet stalled the page), and in a world view
  // she is hidden AND paused — never a hidden canvas that keeps drawing.
  const companion = readFileSync("src/app/scene/genesis/avatar/LeluCompanion.tsx", "utf8");
  assert.doesNotMatch(companion, /return null;\s*\/\/ Where she belongs/, "no unmount under a sheet");
  assert.match(companion, /paused=\{inWorld \|\| underSheet\}/, "hidden in a world, or beside a phone sheet ⇒ paused (measured stall otherwise)");
  assert.match(companion, /scale\(\$\{scale\.toFixed\(4\)\}\)/, "under a sheet she is scaled, not resized (a resize clears her last frame)");
  assert.match(companion, /underSheet \? CHAT_WINDOW_Z \+ 10/, "above the sheet, not hidden behind it");
  assert.match(companion, /const underSheet = compact && !surface\.cosmosRendered;/);
  const character3d = readFileSync("src/app/scene/genesis/avatar/LeluCharacter3D.tsx", "utf8");
  assert.match(character3d, /if \(mode === "paused" \|\| paused\) return;/);
});


test("Universe replies render markdown with the shared renderer and never overflow the conversation", () => {
  const window = readFileSync("src/app/scene/genesis/chat/universe/UniverseChatWindow.tsx", "utf8");
  assert.match(window, /m\.role === "assistant" \? <ChatMarkdown text=\{m\.text\} \/> : <p>\{m\.text\}<\/p>/, "the same ChatMarkdown as the classic transcript, not a second renderer");
  const css = readFileSync("src/app/scene/genesis/chat/universe/chatUniverse.css", "utf8");
  // Measured on iPhone 13: thread scrollWidth 360 === clientWidth 360, 0 elements past its edges.
  assert.match(css, /\.lcu-thread \{ overflow-x: hidden; \}/);
  assert.match(css, /\.lcu-msg \{ min-width: 0; \}/);
  assert.match(css, /\.lcu-bubble \{ min-width: 0; max-width: 100%; overflow-wrap: anywhere; \}/);
});

test("LÉLU's shared model fits its textures once at parse (measured: 240 → 96 MB uploaded per mount on iPhone 13)", () => {
  const body = readFileSync("src/app/scene/genesis/avatar/LeluBody.tsx", "utf8");
  assert.match(body, /export const SHARED_TEXTURE_LIMIT = 2048;/);
  assert.match(body, /new GLTFLoader\(\)\.parseAsync\(bytes, ""\)\.then\(async \(gltf\) => \{\s*const resized = await fitTexturesTo\(gltf\.scene, SHARED_TEXTURE_LIMIT\);/);
});
