/**
 * ==========================================================
 * LÉLU — REVISION, RESTORE AND WHAT OWNS A PHONE SCREEN
 *
 * CATEGORY: unit. Three contracts that Mission 3.4 measured as broken
 * or undefined, pinned here so they cannot silently regress:
 *
 *   1. A surface's revision survives save → restore. Re-opening a saved
 *      view is not a content change, so it must not rewind the number
 *      (measured before: mutate → 2, restore → 1) and must not invent an
 *      increment either.
 *   2. Composing or restoring asks the ONE presentation path for the
 *      System environment (`genesis-show-surface {panel:"visual"}`), and
 *      asks only when it is not already showing — never toggling the
 *      user back out.
 *   3. On a phone, the System environment keeps the field rendered while
 *      the chat floats above it. Every other compact mode keeps the old
 *      rule: an expanded chat owns the screen and no scene is mounted.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

/* ------------------------- browser shims ---------------------------- */

interface StubEvent {
  type: string;
  detail?: unknown;
}

const dispatched: StubEvent[] = [];

function installWindow(): void {
  const stub = {
    dispatchEvent: (event: StubEvent) => {
      dispatched.push(event);
      return true;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (globalThis as Record<string, unknown>).window = stub;
}

installWindow();

if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

import WorkspaceEngine from "../src/core/workspace/WorkspaceEngine";
import EnvironmentOrchestrationEngine from "../src/core/orchestrator/EnvironmentOrchestrationEngine";
import VisualEngine from "../src/core/visual/VisualEngine";
import { resolveSurface } from "../src/app/scene/genesis/surface/Surface";
import { chatFillsScreen } from "../src/app/scene/genesis/chat/chatLayout";

const workspace = WorkspaceEngine.getInstance();
const environment = EnvironmentOrchestrationEngine.getInstance();

function surfaceRequests(): Array<{ panel?: string }> {
  return dispatched
    .filter((event) => event.type === "genesis-show-surface")
    .map((event) => (event.detail ?? {}) as { panel?: string });
}

/* --------------------- 1. revision continuity ----------------------- */

test("a new surface starts at revision 1 and content changes increment it once", () => {
  workspace.clear();
  const created = workspace.openView({ kind: "file", title: "Notes", text: "one" });
  assert.equal(created.revision, 1, "a new surface is a first revision");

  workspace.updateView(created.id, { text: "two" });
  assert.equal(workspace.getState().views[0].revision, 2, "changed content is a new revision");

  // Writing the same content again is not a revision: the view did not change.
  workspace.updateView(created.id, { text: "two" });
  assert.equal(workspace.getState().views[0].revision, 2, "an unchanged write is not a revision");
});

test("restoring a snapshot keeps every surface's stored revision", async () => {
  workspace.clear();
  const a = await environment.composeEnvironment({
    title: "Continuity",
    surfaces: [
      { kind: "file", title: "Findings", text: "first pass" },
      { kind: "diagram", title: "Evidence map", text: "draft" },
    ],
  });
  assert.equal(a.ok, true);

  const target = a.createdViews[0];
  environment.mutateSurface(target.id, { text: "revised pass" });
  const before = workspace.getState().views.map((view) => ({ id: view.id, revision: view.revision }));
  const revised = before.find((view) => view.id === target.id);
  assert.equal(revised?.revision, 2, "the mutation advanced exactly one revision");

  const snapshot = environment.saveSnapshot("continuity");
  workspace.clear();
  assert.equal(workspace.getState().views.length, 0, "the workspace really was cleared");

  const restored = environment.restoreSnapshot(snapshot.id);
  assert.equal(restored.ok, true);

  const after = workspace.getState().views.map((view) => ({ id: view.id, revision: view.revision }));
  assert.deepEqual(after, before, "restore brings back the same ids and the same revisions");
  assert.equal(
    workspace.getState().views.find((view) => view.id === target.id)?.text,
    "revised pass",
    "restore brings back the revised content, not the original",
  );
});

test("a visualizer rebuilding an identical spec is not a new revision", () => {
  workspace.clear();
  const created = workspace.openView({
    kind: "chart",
    title: "Telemetry",
    spec: { kind: "chart", title: "Telemetry", series: [{ label: "a", value: 1 }] },
  });
  assert.equal(created.revision, 1);

  // Same value, brand-new object — exactly what a refresh tick produces.
  workspace.updateView(created.id, {
    spec: { kind: "chart", title: "Telemetry", series: [{ label: "a", value: 1 }] },
  });
  assert.equal(workspace.getState().views[0].revision, 1, "an identical spec is not a change");

  workspace.updateView(created.id, {
    spec: { kind: "chart", title: "Telemetry", series: [{ label: "a", value: 2 }] },
  });
  assert.equal(workspace.getState().views[0].revision, 2, "a genuinely different spec is");
});

/* ------------------- 2. the one presentation path -------------------- */

test("composing asks the presentation layer for the System environment", async () => {
  VisualEngine.getInstance().setInterfaceFocus("genesis");
  dispatched.length = 0;

  await environment.composeEnvironment({
    title: "Present me",
    surfaces: [{ kind: "file", title: "Surface", text: "visible work" }],
  });

  const requests = surfaceRequests();
  assert.equal(requests.length, 1, "one compose is one presentation request");
  assert.equal(requests[0].panel, "visual", "it asks for the System environment, the one renderer");
});

test("presenting is idempotent while the environment is already showing", async () => {
  VisualEngine.getInstance().setInterfaceFocus("visual");
  dispatched.length = 0;

  await environment.composeEnvironment({
    title: "Already visible",
    surfaces: [{ kind: "file", title: "Second", text: "still here" }],
  });

  assert.deepEqual(surfaceRequests(), [], "it never toggles the user back out of the environment");
});

test("restoring asks for the presentation layer too", () => {
  VisualEngine.getInstance().setInterfaceFocus("genesis");
  const snapshot = environment.saveSnapshot("republish");
  VisualEngine.getInstance().setInterfaceFocus("visual");
  workspace.clear();
  dispatched.length = 0;

  environment.restoreSnapshot(snapshot.id);
  // Focus was "visual" at restore time, so nothing is requested — but the
  // restored state is on screen. Prove the request path with focus cleared.
  assert.deepEqual(surfaceRequests(), [], "already showing: no toggle");

  VisualEngine.getInstance().setInterfaceFocus("genesis");
  dispatched.length = 0;
  environment.restoreSnapshot(snapshot.id);
  assert.equal(surfaceRequests().length, 1, "a restore from the default world presents the work");
  assert.equal(surfaceRequests()[0].panel, "visual");
});

/* --------------------- 3. what owns a phone screen ------------------- */

test("every required phone width is compact and a desktop width is not", () => {
  for (const width of [360, 375, 390, 430]) {
    assert.equal(chatFillsScreen({ width, height: width === 430 ? 932 : 844 }), true, `${width} is compact`);
  }
  assert.equal(chatFillsScreen({ width: 1440, height: 900 }), false, "1440 is not compact");
});

test("on a phone an expanded chat owns the screen unless LÉLU is showing a workspace", () => {
  const phone = {
    activePanel: "chat",
    minimized: false,
    openModuleCount: 0,
    visibleModuleCount: 0,
    compact: true,
    chatExpanded: true,
  };

  const conversation = resolveSurface(phone);
  assert.equal(conversation.chatOwnsScreen, true, "the conversation is the screen by default");
  assert.equal(conversation.cosmosRendered, false, "no scene is mounted underneath it");

  const system = resolveSurface({ ...phone, systemEnvironmentActive: true });
  assert.equal(system.chatOwnsScreen, false, "the System environment outranks the expanded chat");
  assert.equal(system.cosmosRendered, true, "so the workspace field is really rendered");
});

test("a phone module window still owns the screen in the System environment", () => {
  const surface = resolveSurface({
    activePanel: "none",
    minimized: false,
    openModuleCount: 1,
    visibleModuleCount: 1,
    compact: true,
    systemEnvironmentActive: true,
  });
  assert.equal(surface.workspaceOwnsScreen, true);
  assert.equal(surface.cosmosRendered, false, "an open module window is still the phone's screen");
});

test("desktop surface resolution is unchanged by the phone rule", () => {
  const surface = resolveSurface({
    activePanel: "chat",
    minimized: false,
    openModuleCount: 0,
    visibleModuleCount: 0,
    compact: false,
    chatExpanded: true,
    systemEnvironmentActive: true,
  });
  assert.equal(surface.chatOwnsScreen, false);
  assert.equal(surface.cosmosRendered, true);
});
