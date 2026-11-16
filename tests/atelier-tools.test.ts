/**
 * ==========================================================
 * LÉLU — ATELIER THROUGH THE REAL TOOL PATH
 *
 * CATEGORY: integration. atelier.* run through the real dispatcher,
 * are offered to the model, emit the events the chat cards are
 * built from, and hand their production documents to the real
 * Creation Studio (exported and verified).
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import AgentEventBus, { type AgentEvent } from "../src/core/agent/AgentEvents";
import { registerAtelierTools } from "../src/core/atelier/AtelierTools";
import { emptyActivity, reduceActivity } from "../src/core/multichat/TurnActivity";
import StudioStore from "../src/core/studio/StudioStore";
import { toolSchemasForModel } from "../src/core/tools/ToolSchemas";
import { dispatchToolCall, toolNameForModel } from "../src/core/tools/ToolDispatcher";

registerAtelierTools();
const ctx = { request: { prompt: "", timestamp: 777, conversationId: "conv-atelier" } } as never;
const call = (id: string, args: Record<string, unknown>) => dispatchToolCall({ id: `c-${id}`, name: toolNameForModel(id), arguments: args }, "task-atelier", ctx);

const box = (id: string, name: string, w: number, d: number, h: number, z: number, extra: Record<string, unknown> = {}) => ({ id, name, shape: "box", size: { width: w, depth: d, height: h }, position: { x: 0, y: 0, z }, material: "ABS", quantity: 1, ...extra });

test("the Atelier tools are offered to the model", () => {
  const names = toolSchemasForModel().map((s) => s.name);
  for (const id of ["atelier.project", "atelier.directions", "atelier.component", "atelier.derive", "atelier.select", "atelier.sources", "atelier.assess", "atelier.export", "atelier.open"]) assert.ok(names.includes(toolNameForModel(id)), id);
});

test("brief → directions → assess → change a part → export files and documents, all verified", async () => {
  const events: AgentEvent[] = [];
  const stop = AgentEventBus.getInstance().subscribe((e) => { events.push(e); });
  const started = await call("atelier.project", { title: "Desk organiser", brief: "A desk organiser for pens and a phone.", sources: [{ id: "S1", title: "ABS sheet price list", kind: "supplier" }], inputs: [{ kind: "photo", name: "desk.jpg" }] });
  assert.equal(started.ok, true, started.content);
  assert.match(started.content, /Not inspected \(recorded as such\): desk\.jpg/);

  const dirs = await call("atelier.directions", { directions: [
    { name: "Stepped tray", architecture: "single moulded stepped tray with pen wells", components: [box("C-01", "Tray", 200, 90, 20, 10, { unitCost: 3, sources: ["S1"] }), box("C-02", "Phone stand", 80, 60, 70, 55, { unitCost: 1.5, sources: ["S1"] })] },
    { name: "Magnetic modules", architecture: "steel base plate with magnetic cylindrical pots that rearrange", components: [{ id: "C-01", name: "Steel plate", shape: "box", size: { width: 220, depth: 110, height: 3 }, position: { x: 0, y: 0, z: 1.5 }, material: "steel", quantity: 1 }, { id: "C-02", name: "Pot", shape: "cylinder", size: { width: 70, height: 90 }, position: { x: -50, y: 0, z: 48 }, material: "aluminium 6061", quantity: 3 }] },
  ] });
  assert.equal(dirs.ok, true, dirs.content);
  assert.match(dirs.content, /D1 Stepped tray — evidence level: calculated/);
  assert.match(dirs.content, /D2 Magnetic modules — evidence level: conceptual/);
  assert.match(dirs.content, /no price: C-01, C-02/, "unknown prices are named, not invented");

  const changed = await call("atelier.component", { direction: "D1", component: "C-02", changes: { size: { height: 90 } } });
  assert.equal(changed.ok, true, changed.content);
  assert.match(changed.content, /changed C-02 in D1/);

  await call("atelier.select", { direction: "D1" });
  const exported = await call("atelier.export", { files: ["stl", "gltf", "svg-orthographic", "step"], documents: ["bom-xlsx", "dossier-docx", "review-pptx"] });
  stop();
  assert.equal(exported.ok, false, "STEP was asked for and refused, so the export as a whole is not reported as complete");
  assert.match(exported.content, /✓ Desk-organiser-D1-v\d+\.stl/);
  assert.match(exported.content, /✓ Desk-organiser-D1-v\d+\.gltf/);
  assert.match(exported.content, /✗ step: STEP/);
  assert.match(exported.content, /✓ Desk-organiser-.*BOM.*\.xlsx/);
  assert.match(exported.content, /✓ .*production-dossier.*\.docx/);
  assert.match(exported.content, /✓ .*design-review.*\.pptx/);
  const docs = StudioStore.getInstance().list().filter((a) => a.conversationId === "conv-atelier");
  assert.equal(docs.length, 3, "three Creation Studio artifacts, bound to the chat");
  assert.ok(docs.every((a) => a.exports.every((e) => e.ok)));

  let activity = emptyActivity();
  for (const e of events) activity = reduceActivity(activity, e);
  const design = activity.artifacts?.find((a) => a.kind === "design");
  assert.ok(design, "a design card for the project");
  assert.ok(design!.exports.some((e) => e.filename.endsWith(".stl") && e.ok));
  assert.equal(activity.artifacts!.filter((a) => a.kind !== "design").length, 3, "a card per production document");
});

test("a cosmetic variation is refused through the tool, with the reason", async () => {
  const again = await call("atelier.directions", { directions: [{ name: "Stepped tray (green)", architecture: "single moulded stepped tray with pen wells", components: [box("C-01", "Tray", 200, 90, 20, 10), box("C-02", "Phone stand", 80, 60, 90, 55)] }] });
  assert.equal(again.ok, false);
  assert.match(again.content, /cosmetic variations, not different architectures/);
});
