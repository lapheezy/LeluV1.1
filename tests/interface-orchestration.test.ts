/**
 * LÉLU — INTERFACE ORCHESTRATION
 *
 * LÉLU controls her own interface through her own tools, against a
 * window host shaped exactly like the Genesis one (chat + module
 * windows). Every scenario goes through the real ToolDispatcher, so
 * what is tested is what the model can actually do:
 *
 *   understand → propose (isolated, previewed) → the human decides →
 *   applied, versioned, persisted, undoable.
 *
 * And the invariants: nothing applies without a human decision, no tool
 * can approve, destructive changes need a second confirmation, stale
 * proposals are refused, blocked scopes are refused, phone layouts never
 * overlap or cover the composer.
 */

import assert from "node:assert/strict";
import test from "node:test";

// Browser storage for KvStore, as in the other agentic tests: a reload is
// modelled by a fresh engine reading the same storage.
if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";
import { toolSchemasForModel } from "../src/core/tools/ToolSchemas";
import AutonomyGate from "../src/core/cognition/AutonomyGate";
import AgentEventBus from "../src/core/agent/AgentEvents";
import { registerInterfaceTools } from "../src/core/interface/InterfaceTools";
import InterfaceOrchestrator, { INTERFACE_STORAGE_KEYS, isDefaultLook, type InterfaceHost } from "../src/core/interface/InterfaceOrchestrator";
import KvStore from "../src/core/storage/KvStore";
import { checkLayout, makeViewport, planWindows, type Viewport, type WindowDescriptor, type WindowLayout } from "../src/core/interface/SpatialModel";
import { DEFAULT_TOKENS, mergeTokens, tokensToCssVariables } from "../src/core/interface/DesignTokens";
import { validateCustomFont } from "../src/core/interface/FontLibrary";

/** A host with the same contract GenesisInterfaceHost provides in the browser. */
function makeHost(width = 1440, height = 900) {
  let viewport: Viewport = makeViewport(width, height);
  const windows = new Map<string, WindowDescriptor>([
    ["chat", { id: "chat", kind: "chat", label: "Chat", presentation: "inline", rect: { x: 440, y: 200, width: 560, height: 480 }, zIndex: 21, rotation: 0 }],
    ["browser", { id: "browser", kind: "module", label: "Browser", presentation: "inline", rect: { x: 120, y: 110, width: 620, height: 480 }, zIndex: 31, rotation: 0 }],
    ["projects", { id: "projects", kind: "module", label: "Projects", presentation: "inline", rect: { x: 160, y: 140, width: 620, height: 480 }, zIndex: 32, rotation: 0 }],
    ["render", { id: "render", kind: "module", label: "Render", presentation: "closed", rect: { x: 0, y: 0, width: 620, height: 480 }, zIndex: 30, rotation: 0 }],
  ]);
  const applied: Array<Record<string, WindowLayout>> = [];
  const host: InterfaceHost = {
    windows: () => [...windows.values()].map((w) => structuredClone(w)),
    viewport: () => viewport,
    workspaces: () => [
      { kind: "conversation", id: "conv-a", title: "LÉLU core", active: true },
      { kind: "conversation", id: "conv-b", title: "Garden research" },
      { kind: "project", id: "proj-c", title: "Studio launch" },
    ],
    applyWindows: (layout) => {
      applied.push(layout);
      for (const [id, l] of Object.entries(layout)) {
        const w = windows.get(id);
        if (!w) continue;
        w.presentation = l.presentation;
        w.rect = { x: l.x, y: l.y, width: l.width, height: l.height };
        w.zIndex = l.zIndex;
        w.rotation = l.rotation;
        w.group = l.group;
      }
    },
  };
  return { host, windows, applied, setViewport: (w: number, h: number) => (viewport = makeViewport(w, h)) };
}

let n = 0;
const call = (name: string, args: Record<string, unknown>) => dispatchToolCall({ id: `i${++n}`, name, arguments: args }, "t-interface");

function fresh() {
  for (const key of Object.values(INTERFACE_STORAGE_KEYS)) KvStore.getInstance().remove(key);
  InterfaceOrchestrator.resetForTests();
  const orchestrator = InterfaceOrchestrator.getInstance();
  const env = makeHost();
  orchestrator.attachHost(env.host);
  return { orchestrator, ...env };
}

test("interface tools are registered, offered to the model, and none of them approves", () => {
  registerInterfaceTools();
  AutonomyGate.getInstance().setLevel(1);
  const offered = toolSchemasForModel().map((s) => s.name);
  for (const id of ["interface_inspect", "interface_propose", "interface_revert", "interface_themes", "interface_recommend"]) {
    assert.ok(offered.includes(id), `${id} is offered`);
  }
  assert.ok(!offered.some((name) => /^interface_(approve|apply|decide|confirm)/.test(name)), "no approving tool exists");
});

test("Test 1 — typography: propose a futuristic editorial system, preview it, apply only after approval", async () => {
  const { orchestrator } = fresh();
  registerInterfaceTools();
  const before = structuredClone(orchestrator.getLive().tokens);

  const inspect = await call("interface_inspect", { section: "design" });
  assert.equal(inspect.ok, true);
  assert.match(inspect.content, /fonts body=system-sans/);

  const r = await call("interface_propose", {
    description: "Futuristic editorial typography for the Cosmos",
    typographySystem: "futuristic-editorial",
    rationale: "Wide geometric display over a technical grotesque",
  });
  assert.equal(r.ok, true, r.content);
  assert.match(r.content, /PROPOSED, NOT APPLIED/);
  const id = (r.data as { proposalId: string }).proposalId;

  // Not applied — but previewed.
  assert.deepEqual(orchestrator.getLive().tokens, before, "live tokens unchanged before consent");
  const view = orchestrator.view();
  assert.equal(view.previewing?.id, id);
  assert.equal(view.effective.tokens.typography.headingFont, "unbounded");
  assert.deepEqual(view.previewing?.scopes, ["typography"]);

  // The compiled preview is what approval will apply.
  const css = tokensToCssVariables(view.effective.tokens);
  assert.match(css.variables["--lelu-font-heading"], /Unbounded/);
  assert.equal(css.variables["--lelu-heading-case"], "uppercase");

  const decision = orchestrator.decide(id, "approved");
  assert.equal(decision.ok, true, decision.reason);
  assert.equal(orchestrator.getLive().tokens.typography.headingFont, "unbounded");
  assert.equal(orchestrator.getLive().tokens.typography.bodyFont, "space-grotesk");
  assert.equal(orchestrator.getLive().version, 1);
  assert.match(orchestrator.getLive().tokens.typography.rationale ?? "", /geometric/);
});

test("Test 2 — window manipulation: browser beside chat, projects above it, everything on screen", async () => {
  const { orchestrator, windows, applied, host } = fresh();
  registerInterfaceTools();

  const inspect = await call("interface_inspect", { section: "windows" });
  assert.match(inspect.content, /browser "Browser"/);
  assert.match(inspect.content, /overlaps/, "LÉLU sees that the windows currently overlap");

  const r = await call("interface_propose", {
    description: "Browser beside the chat, project window above it, everything fits",
    windows: [
      {
        op: "arrange",
        strategy: "relations",
        relations: [
          { id: "my browser window", relation: "beside", of: "chat" },
          { id: "project", relation: "above", of: "browser" },
        ],
      },
    ],
  });
  assert.equal(r.ok, true, r.content);
  const id = (r.data as { proposalId: string }).proposalId;
  assert.equal(applied.length, 0, "nothing moved before consent");
  assert.equal(windows.get("browser")!.rect.x, 120);

  const proposal = orchestrator.getProposal(id)!;
  assert.equal(proposal.windowsChanged, true);
  const layout = proposal.next.windows;
  const chat = layout.chat;
  const browser = layout.browser;
  const projects = layout.projects;
  // beside: to the right of chat, vertically overlapping
  assert.ok(browser.x >= chat.x + chat.width, "browser is to the right of chat");
  assert.ok(browser.y < chat.y + chat.height && browser.y + browser.height > chat.y, "browser is level with chat");
  // above: same column, projects ends before browser starts
  assert.ok(projects.y + projects.height <= browser.y, "projects is above browser");
  assert.equal(projects.x, browser.x);
  const check = checkLayout(layout, host.viewport(), { chat: "chat", browser: "module", projects: "module", render: "module" });
  assert.deepEqual(check.overlaps, []);
  assert.deepEqual(check.offscreen, []);

  orchestrator.decide(id, "approved");
  assert.equal(applied.length, 1, "applied once, after approval");
  assert.equal(windows.get("browser")!.rect.x, browser.x);
});

test("Test 3 — Cosmos Garden is a full environment configuration, not a background image", async () => {
  const { orchestrator } = fresh();
  registerInterfaceTools();
  const r = await call("interface_propose", { description: "Turn the workspace into a living Cosmos Garden", preset: "cosmos-garden" });
  assert.equal(r.ok, true, r.content);
  const p = orchestrator.getProposal((r.data as { proposalId: string }).proposalId)!;
  for (const scope of ["typography", "theme", "materials", "environment", "scene", "layout"]) {
    assert.ok(p.scopes.includes(scope as never), `garden covers ${scope}`);
  }
  assert.equal(p.next.tokens.environment.backdrop, "garden");
  assert.equal(p.next.tokens.materials.windowShape, "organic");
  assert.ok(p.next.scene.objects.filter((o) => o.kind === "flora").length >= 3, "living botanical forms in the 3D scene");
  assert.ok(Object.values(p.next.windows).some((w) => w.rotation !== 0), "organic window arrangement");
  orchestrator.decide(p.id, "approved");
  assert.equal(orchestrator.getLive().name, "Cosmos Garden");
  assert.equal(isDefaultLook(orchestrator.getLive()), false);
});

test("Test 4 — three interactive planets, one per active workspace", async () => {
  const { orchestrator } = fresh();
  registerInterfaceTools();
  const r = await call("interface_propose", {
    description: "Three floating planets for my three active workspaces",
    scene: [{ op: "populate", from: "workspaces", kind: "planet" }],
  });
  assert.equal(r.ok, true, r.content);
  const p = orchestrator.getProposal((r.data as { proposalId: string }).proposalId)!;
  const planets = p.next.scene.objects.filter((o) => o.kind === "planet");
  assert.equal(planets.length, 3);
  assert.deepEqual(planets.map((o) => o.link?.id).sort(), ["conv-a", "conv-b", "proj-c"]);
  assert.ok(planets.every((o) => o.animation.type !== "none"), "animated");
  orchestrator.decide(p.id, "approved");
  assert.equal(orchestrator.getLive().scene.objects.length, 3);
});

test("Test 5 — complete transformation covers layout, typography, windows, materials and environment", async () => {
  const { orchestrator } = fresh();
  registerInterfaceTools();
  const r = await call("interface_propose", {
    description: "Organic, fluid, colourful workspace without rigid boxes",
    rationale: "Soft serif headlines and rounded body text; organic window outlines float on an ellipse",
    typographySystem: "organic-soft",
    tokens: {
      palette: { background: "#120a2a", surface: "#1d1240", surfaceAlt: "#3b1d5e", accent: "#f472b6", border: "#f9a8d4", glow: "#f472b6" },
      materials: { windowShape: "organic", radius: 28, texture: "silk", surfaceOpacity: 0.8 },
      motion: { profile: "fluid", floatAmplitude: 5 },
      environment: { backdrop: "nebula", nebulaColors: ["#f472b6", "#a78bfa", "#38bdf8"] },
    },
    windows: [{ op: "arrange", strategy: "organic" }],
    scene: [{ op: "add", object: { kind: "nebula", label: "Cotton-candy nebula", color: "#f9a8d4", secondaryColor: "#a78bfa", position: [0, 1, -7], scale: 6 } }],
  });
  assert.equal(r.ok, true, r.content);
  const p = orchestrator.getProposal((r.data as { proposalId: string }).proposalId)!;
  assert.deepEqual([...p.scopes].sort(), ["environment", "layout", "materials", "scene", "theme", "typography"]);
  const check = checkLayout(p.next.windows, makeViewport(1440, 900), { chat: "chat" });
  assert.deepEqual(check.overlaps, [], "organic does not mean overlapping");
});

test("nothing applies without a human; the timeline's approve reaches the same gate", () => {
  const { orchestrator } = fresh();
  const r = orchestrator.propose({ description: "Warmer accent", tokens: { palette: { accent: "#fb923c" } } });
  assert.ok(r.ok && r.proposal);
  assert.equal(orchestrator.getLive().tokens.palette.accent, DEFAULT_TOKENS.palette.accent);
  // The existing execution timeline emits exactly this when its Approve is pressed.
  AgentEventBus.getInstance().emit({ type: "approval_resolved", taskId: "interface", approvalId: r.proposal.id, decision: "approved" });
  assert.equal(orchestrator.getLive().tokens.palette.accent, "#fb923c");
});

test("rejection discards the preview and leaves the live interface untouched", () => {
  const { orchestrator } = fresh();
  const r = orchestrator.propose({ description: "Plain backdrop", tokens: { environment: { backdrop: "plain" } } });
  assert.ok(r.proposal);
  assert.equal(orchestrator.view().effective.tokens.environment.backdrop, "plain");
  orchestrator.decide(r.proposal.id, "rejected");
  assert.equal(orchestrator.view().previewing, null);
  assert.equal(orchestrator.view().effective.tokens.environment.backdrop, "cosmos");
  assert.equal(orchestrator.getLive().version, 0);
});

test("destructive changes need the separate confirmation; a plain approve is not enough", () => {
  const { orchestrator, windows } = fresh();
  const r = orchestrator.propose({ description: "Close the browser", windows: [{ op: "close", id: "browser" }] });
  assert.ok(r.proposal?.destructive);
  AgentEventBus.getInstance().emit({ type: "approval_resolved", taskId: "interface", approvalId: r.proposal.id, decision: "approved" });
  assert.equal(windows.get("browser")!.presentation, "inline", "timeline approve alone did not close it");
  const bare = orchestrator.decide(r.proposal.id, "approved");
  assert.equal(bare.ok, false);
  assert.match(bare.reason ?? "", /destructive/);
  const confirmed = orchestrator.decide(r.proposal.id, "approved", { confirmDestructive: true });
  assert.equal(confirmed.ok, true, confirmed.reason);
  assert.equal(windows.get("browser")!.presentation, "closed");
});

test("the chat cannot be closed, and stale proposals are never applied over newer changes", () => {
  const { orchestrator } = fresh();
  const closeChat = orchestrator.propose({ description: "Close chat", windows: [{ op: "close", id: "chat" }] });
  assert.equal(closeChat.ok, false);
  assert.match(closeChat.reason ?? "", /cannot be closed/);

  const a = orchestrator.propose({ description: "A", tokens: { palette: { accent: "#22c55e" } } }, { origin: "user" });
  const b = orchestrator.propose({ description: "B", tokens: { palette: { accent: "#ef4444" } } }, { origin: "user" });
  assert.equal(orchestrator.decide(a.proposal!.id, "approved").ok, true);
  const stale = orchestrator.decide(b.proposal!.id, "approved");
  assert.equal(stale.ok, false);
  assert.equal(orchestrator.getProposal(b.proposal!.id)!.status, "stale");
  assert.equal(orchestrator.getLive().tokens.palette.accent, "#22c55e");
});

test("a newer LÉLU proposal supersedes her older undecided one", () => {
  const { orchestrator } = fresh();
  const a = orchestrator.propose({ description: "A", tokens: { palette: { accent: "#22c55e" } } });
  const b = orchestrator.propose({ description: "B", tokens: { palette: { accent: "#ef4444" } } });
  assert.equal(orchestrator.getProposal(a.proposal!.id)!.status, "superseded");
  assert.equal(orchestrator.view().previewing?.id, b.proposal!.id);
});

test("blocked scopes are refused before anything is staged", () => {
  const { orchestrator } = fresh();
  orchestrator.setScopePolicy("scene", "blocked");
  const r = orchestrator.propose({ description: "Add a moon", scene: [{ op: "add", object: { kind: "moon" } }] });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /blocked/);
  orchestrator.setScopePolicy("scene", "ask");
});

test("invalid design values are clamped or refused, never injected", () => {
  const merged = mergeTokens(DEFAULT_TOKENS, {
    palette: { accent: "red; background:url(javascript:alert(1))" },
    typography: { baseSize: 400, bodyFont: "Comic Neue Pirated" },
    materials: { windowShape: "<script>" as never },
  });
  assert.equal(merged.tokens.palette.accent, DEFAULT_TOKENS.palette.accent);
  assert.equal(merged.tokens.typography.baseSize, 22);
  assert.equal(merged.tokens.typography.bodyFont, "system-sans");
  assert.equal(merged.tokens.materials.windowShape, "rounded");
  assert.ok(merged.issues.length >= 2);
  assert.match(validateCustomFont({ family: "Mystery", url: "https://x.example/f.woff2", licence: "unknown" }).error ?? "", /does not permit/);
  assert.ok(validateCustomFont({ family: "Atkinson Hyperlegible", url: "https://cdn.example/atkinson.woff2", licence: "OFL-1.1" }).font);
});

test("Test 7 — persistence: approved changes survive a reload; previous layouts can be restored; undo/redo", () => {
  const { orchestrator } = fresh();
  const r = orchestrator.propose({ description: "Celestial", preset: "celestial-cosmos" });
  orchestrator.decide(r.proposal!.id, "approved");
  const liveVersion = orchestrator.getLive().version;

  // A reload: a new engine reads the same storage.
  InterfaceOrchestrator.resetForTests();
  const reloaded = InterfaceOrchestrator.getInstance();
  assert.equal(reloaded.getLive().version, liveVersion);
  assert.equal(reloaded.getLive().name, "Celestial Cosmos");
  assert.equal(reloaded.view().previewing, null, "a reload never resumes a preview");

  assert.equal(reloaded.undo(), true);
  assert.equal(reloaded.getLive().version, 0);
  assert.equal(isDefaultLook(reloaded.getLive()), true);
  assert.equal(reloaded.redo(), true);
  assert.equal(reloaded.getLive().name, "Celestial Cosmos");

  const restore = reloaded.proposeRestore(0);
  assert.ok(restore.proposal);
  assert.equal(reloaded.getLive().name, "Celestial Cosmos", "restoring is also proposed, not imposed");
  reloaded.decide(restore.proposal.id, "approved");
  assert.equal(isDefaultLook(reloaded.getLive()), true);
});

test("saved themes are reusable; deleting one is a destructive proposal", async () => {
  const { orchestrator } = fresh();
  registerInterfaceTools();
  const p = orchestrator.propose({ description: "Studio", preset: "creative-studio" });
  orchestrator.decide(p.proposal!.id, "approved");
  const saved = await call("interface_themes", { action: "save", name: "My Studio" });
  assert.equal(saved.ok, true, saved.content);
  const themeId = (saved.data as { id: string }).id;
  const del = await call("interface_themes", { action: "delete", id: themeId });
  assert.match(del.content, /Destructive/);
  assert.ok(orchestrator.view().themes.some((t) => t.id === themeId), "not deleted without consent");
  orchestrator.decide((del.data as { proposalId: string }).proposalId, "approved", { confirmDestructive: true });
  assert.ok(!orchestrator.view().themes.some((t) => t.id === themeId));
});

test("Test 6 (engine) — phone layouts: chat stays full-screen, one sheet, nothing covers the composer", () => {
  const viewport = makeViewport(390, 844);
  const current: WindowDescriptor[] = [
    { id: "chat", kind: "chat", label: "Chat", presentation: "inline", rect: { x: 0, y: 0, width: 390, height: 844 }, zIndex: 21, rotation: 0 },
    { id: "browser", kind: "module", label: "Browser", presentation: "inline", rect: { x: 8, y: 200, width: 374, height: 520 }, zIndex: 31, rotation: 0 },
    { id: "projects", kind: "module", label: "Projects", presentation: "expanded", rect: { x: 8, y: 300, width: 374, height: 600 }, zIndex: 33, rotation: 0 },
  ];
  for (const strategy of ["relations", "grid", "organic", "focus", "fit"] as const) {
    const plan = planWindows(current, [{ op: "arrange", strategy, relations: [{ id: "browser", relation: "beside", of: "chat" }, { id: "projects", relation: "above", of: "browser" }] }], viewport);
    const sheets = Object.entries(plan.layout).filter(([id, l]) => id !== "chat" && l.presentation === "inline");
    assert.equal(sheets.length, 1, `${strategy}: one sheet`);
    assert.equal(plan.layout.chat.width, 390, `${strategy}: chat full width`);
    assert.deepEqual(plan.check.coversComposer, [], `${strategy}: composer reachable`);
    assert.deepEqual(plan.check.overlaps, [], `${strategy}: no overlap`);
    assert.ok(sheets.every(([, l]) => l.rotation === 0), `${strategy}: no tilted windows on a phone`);
  }
  const moved = planWindows(current, [{ op: "move", id: "browser", x: 900, y: 900 }], viewport);
  assert.deepEqual(moved.check.offscreen, [], "a drag target off-screen is clamped back");
});
