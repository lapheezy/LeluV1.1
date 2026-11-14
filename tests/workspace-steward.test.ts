import test from "node:test";
import assert from "node:assert/strict";

import { isCompact, kindOf, minWidthOf, parseWorkspaceCommand, planWorkspace, type StewardWindow } from "../src/core/interface/WorkspaceSteward";
import { workspacePlan } from "../src/core/router/DirectResolver";
import { INTERFACE_EXECUTORS, INTERFACE_TOOLS } from "../src/core/interface/InterfaceTools";
import UIActionBus from "../src/core/cognition/UIActionBus";

const win = (id: string, order: number, extra: Partial<StewardWindow> = {}): StewardWindow => ({ id, label: id, order, presentation: "inline", ...extra });
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("content kinds carry readable minimum widths", () => {
  assert.equal(kindOf("chat:abc"), "chat");
  assert.equal(kindOf("browser"), "browser");
  assert.equal(kindOf("eng-studio"), "studio");
  assert.equal(kindOf("projects"), "projects");
  assert.equal(kindOf("artifact:1"), "document");
  assert.ok(minWidthOf(win("browser", 1)) > minWidthOf(win("chat:x", 1)));
  // measured overflow raises the minimum
  assert.equal(minWidthOf(win("panel-x", 1, { neededWidth: 900 })), 900);
});

test("phone: the newest window is the full screen, the rest are tabs (nothing lost)", () => {
  const plan = planWorkspace({
    viewport: { width: 393, height: 852 },
    mode: "auto",
    windows: [win("chat:a", 1), win("projects", 2), win("browser", 3), win("eng-studio", 4)],
  });
  assert.equal(plan.compact, true);
  assert.deepEqual(Object.keys(plan.placements), ["eng-studio"]);
  const r = plan.placements["eng-studio"].rect;
  assert.deepEqual([r.x, r.y, r.width, r.height], [0, 0, 393, 852]);
  assert.equal(plan.placements["eng-studio"].sheet, true);
  assert.deepEqual(plan.tabs.sort(), ["browser", "chat:a", "projects"]);
});

test("a phone on its side is compact too, and split puts two side by side", () => {
  assert.equal(isCompact({ width: 852, height: 393 }), true);
  const plan = planWorkspace({ viewport: { width: 852, height: 393 }, mode: "split", focusId: "browser", windows: [win("chat:a", 2), win("browser", 1)] });
  assert.equal(plan.layout, "split");
  const [a, b] = [plan.placements.browser.rect, plan.placements["chat:a"].rect];
  assert.ok(!overlaps(a, b));
  assert.ok(a.x < b.x, "focus on the left");
});

test("desktop auto: four windows tile with zero overlap, inside the screen", () => {
  const viewport = { width: 1440, height: 900 };
  const plan = planWorkspace({ viewport, mode: "auto", windows: [win("chat:a", 1), win("projects", 2), win("browser", 3), win("eng-studio", 4)] });
  const rects = Object.values(plan.placements).map((p) => p.rect);
  assert.ok(rects.length >= 3, `shown ${rects.length}`);
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= viewport.width && r.y + r.height <= viewport.height, "on screen");
    for (let j = i + 1; j < rects.length; j++) assert.ok(!overlaps(r, rects[j]), "no overlap");
  }
  assert.equal(rects.length + plan.tabs.length, 4, "every window is either shown or a tab");
});

test("windows are never squashed below their readable width — extras become tabs", () => {
  const plan = planWorkspace({
    viewport: { width: 1280, height: 800 },
    mode: "tile",
    windows: ["browser", "eng-studio", "visualstudio", "voice-studio", "projects", "chat:a", "chat:b"].map((id, i) => win(id, i)),
  });
  for (const p of Object.values(plan.placements)) {
    assert.ok(p.rect.width >= 300, `${p.id} is ${p.rect.width}px`);
  }
  assert.ok(plan.tabs.length > 0);
});

test("a valid hand-made arrangement is kept; an overlapping one is re-solved", () => {
  const viewport = { width: 1440, height: 900 };
  const kept = planWorkspace({
    viewport,
    mode: "auto",
    windows: [
      win("chat:a", 2, { manual: true, rect: { x: 100, y: 80, width: 520, height: 700 } }),
      win("browser", 1, { manual: true, rect: { x: 640, y: 80, width: 760, height: 700 } }),
    ],
  });
  assert.equal(kept.layout, "free");
  assert.equal(kept.placements.browser.rect.x, 640);
  const fixed = planWorkspace({
    viewport,
    mode: "auto",
    windows: [
      win("chat:a", 2, { manual: true, rect: { x: 100, y: 80, width: 700, height: 700 } }),
      win("browser", 1, { manual: true, rect: { x: 300, y: 120, width: 760, height: 700 } }),
    ],
  });
  assert.notEqual(fixed.layout, "free");
  assert.equal(fixed.before.overlaps, 1);
  assert.ok(!overlaps(fixed.placements.browser.rect, fixed.placements["chat:a"].rect));
});

test("fullscreen: the focus takes the work area, everything else waits as tabs", () => {
  const plan = planWorkspace({ viewport: { width: 1440, height: 900 }, mode: "fullscreen", focusId: "browser", windows: [win("chat:a", 2), win("browser", 1)] });
  assert.deepEqual(Object.keys(plan.placements), ["browser"]);
  assert.deepEqual(plan.tabs, ["chat:a"]);
});

test("natural language → workspace commands, locally", () => {
  assert.deepEqual(parseWorkspaceCommand("Put the browser beside the chat")?.open, ["browser"]);
  assert.equal(parseWorkspaceCommand("Put the browser beside the chat")?.mode, "split");
  assert.equal(parseWorkspaceCommand("Make this cinematic.")?.stage, "cinematic");
  assert.equal(parseWorkspaceCommand("Turn this into a visual research board")?.stage, "board");
  assert.equal(parseWorkspaceCommand("Expand this into a 3D environment")?.stage, "spatial");
  assert.equal(parseWorkspaceCommand("Move these images beside the chat")?.stage, "gallery");
  assert.equal(parseWorkspaceCommand("Change the entire layout")?.mode, "auto");
  assert.equal(parseWorkspaceCommand("tile my windows")?.mode, "tile");
  assert.equal(parseWorkspaceCommand("organize my windows")?.mode, "auto");
  // questions and ordinary prose are left to LÉLU's reasoning
  assert.equal(parseWorkspaceCommand("How do 3D environments work?"), null);
  assert.equal(parseWorkspaceCommand("I love the browser"), null);
  assert.equal(parseWorkspaceCommand("Research deep-sea bioluminescence"), null);
});

test("workspace requests compile to the workspace tools, explicitly (never a model)", () => {
  const plan = workspacePlan("put the browser beside the chat");
  assert.ok(plan);
  assert.equal(plan!.explicit, true);
  assert.equal(plan!.steps[0].tool, "workspace.arrange");
  assert.deepEqual(plan!.steps[0].args, { layout: "split", modules: ["browser"] });
  assert.equal(workspacePlan("make this cinematic")!.steps[0].tool, "workspace.stage");
});

test("workspace tools are registered and drive the UI action bus", async () => {
  assert.ok(INTERFACE_TOOLS.some((t) => t.id === "workspace.arrange" && t.riskLevel === 0));
  assert.ok(INTERFACE_TOOLS.some((t) => t.id === "workspace.stage"));
  const calls: string[] = [];
  const unregister = UIActionBus.getInstance().registerHandlers({
    supportedPanels: ["browser", "chat"],
    openPanel: () => {},
    openModule: () => {},
    minimizeModule: () => {},
    closeModule: () => {},
    getActivePanel: () => null,
    arrangeWorkspace: (mode, modules) => (calls.push(`${mode}:${modules.join(",")}`), { ok: true, detail: "arranged" }),
    setStage: (stage) => (calls.push(`stage:${stage}`), { ok: true, detail: "staged" }),
  });
  try {
    const arrange = INTERFACE_EXECUTORS.find((e) => e.id === "workspace.arrange")!;
    const result = await arrange.run({ layout: "split", modules: ["browser"] });
    assert.equal(result.ok, true);
    const stage = INTERFACE_EXECUTORS.find((e) => e.id === "workspace.stage")!;
    await stage.run({ stage: "board" });
    assert.deepEqual(calls, ["split:browser", "stage:board"]);
    // unknown modules are refused, not silently "succeeded"
    const refused = UIActionBus.getInstance().dispatch({ type: "arrange_workspace", target: "tile", modules: ["nope"], reason: "t", initiatedBy: "lelu" });
    assert.equal(refused.ok, false);
  } finally {
    unregister();
  }
});
