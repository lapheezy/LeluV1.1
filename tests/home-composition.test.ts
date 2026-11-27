/**
 * Mission 15 — Home composition engine (pure) and HomeStore presentations.
 * These prove the rules; the browser script (scripts/home/verify-home.mjs)
 * proves the feature through the real UI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLUMNS,
  DEVICE_CLASSES,
  HOME_MODULES,
  TEMPLATES,
  adaptiveOrder,
  applyHomeOp,
  deviceClassFor,
  presentationFromTemplate,
  readPresentation,
  snapRect,
  solveHome,
  type GridCell,
} from "../src/app/scene/genesis/home/homeComposition";

const overlaps = (a: GridCell, b: GridCell) =>
  a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;

test("the thirteen original compositions (twelve + the Retro Terminal) all remain, and every id is distinct", () => {
  const ORIGINAL = ["lelu-central", "bento-universe", "cosmos-orbit", "spatial-home", "executive-command", "organic-asymmetry", "creative-gallery", "project-hub", "minimal-focus", "adaptive-intelligence", "workspace-deck", "living-ecosystem", "retro-terminal"];
  for (const id of ORIGINAL) assert.ok(TEMPLATES.some((t) => t.id === id), `${id} is still a layout`);
  // Infinite Cosmos adds fourteen layouts that each carry a window design language.
  assert.equal(TEMPLATES.length, 27);
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, 27);
});

test("every composition solves on every device with every module accounted for, and no grid overlaps", () => {
  for (const t of TEMPLATES) {
    const p = presentationFromTemplate(t.id, undefined, 0);
    for (const device of DEVICE_CLASSES) {
      const solved = solveHome(p, device);
      const shown = new Set<string>([...solved.placed.flatMap((m) => m.members), ...solved.floating.map((m) => m.id), ...solved.docked, ...solved.hidden]);
      assert.deepEqual([...shown].sort(), [...HOME_MODULES].sort(), `${t.id}/${device}: every module is placed, floating, docked or hidden`);
      const cells = solved.placed.map((m) => m.cell).filter((c): c is GridCell => Boolean(c));
      if (solved.kind !== "deck") {
        for (const c of cells) assert.ok(c.col >= 1 && c.col + c.w - 1 <= COLUMNS[device], `${t.id}/${device}: ${c.id} inside the columns`);
        for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) assert.ok(!overlaps(cells[i], cells[j]), `${t.id}/${device}: ${cells[i].id} overlaps ${cells[j].id}`);
      }
      for (const m of solved.placed) if (m.rect) assert.ok(m.rect.x >= 0 && m.rect.y >= 0 && m.rect.x + m.rect.w <= 1.0001 && m.rect.y + m.rect.h <= 1.0001, `${t.id}/${device}: ${m.id} inside the canvas`);
    }
  }
});

test("phones never get the absolute (orbit, spatial, freeform) families by default", () => {
  for (const t of TEMPLATES) assert.ok(!["orbit", "spatial", "freeform"].includes(t.kind.phone), t.id);
});

test("device classes: phone < 700 ≤ tablet < 1100 ≤ desktop", () => {
  assert.equal(deviceClassFor(390), "phone");
  assert.equal(deviceClassFor(834), "tablet");
  assert.equal(deviceClassFor(1280), "desktop");
});

test("an edit changes ONE device profile only", () => {
  const p = presentationFromTemplate("lelu-central", undefined, 0);
  const q = applyHomeOp(p, "phone", { op: "resize", id: "weather", size: "xl" }, 1);
  assert.equal(q.profiles.phone.modules.weather.size, "xl");
  assert.equal(q.profiles.desktop.modules.weather.size, p.profiles.desktop.modules.weather.size);
  assert.equal(q.profiles.tablet, p.profiles.tablet);
});

test("move / shift reorder; pinned modules claim the first slot", () => {
  let p = presentationFromTemplate("lelu-central", undefined, 0);
  p = applyHomeOp(p, "desktop", { op: "move", id: "activity", before: "weather" });
  assert.equal(p.profiles.desktop.order[0], "activity");
  p = applyHomeOp(p, "desktop", { op: "shift", id: "activity", delta: 2 });
  assert.equal(p.profiles.desktop.order[2], "activity");
  p = applyHomeOp(p, "desktop", { op: "toggle", id: "library", flag: "pinned" });
  const first = solveHome(p, "desktop").placed.find((m) => m.cell?.row === 1 && m.cell.col === 1);
  assert.equal(first?.id, "library");
});

test("a locked module refuses move, resize, float and dock — and can still be unlocked", () => {
  const p = applyHomeOp(presentationFromTemplate("bento-universe", undefined, 0), "tablet", { op: "toggle", id: "now", flag: "locked" });
  for (const op of [
    { op: "move", id: "now", before: null },
    { op: "grow", id: "now", delta: 1 },
    { op: "float", id: "now" },
    { op: "dock", id: "now" },
  ] as const) assert.equal(applyHomeOp(p, "tablet", op), p, op.op);
  assert.equal(applyHomeOp(p, "tablet", { op: "toggle", id: "now", flag: "locked" }).profiles.tablet.modules.now.locked, false);
});

test("float → place snaps and aligns; dock → restore returns to the layout", () => {
  let p = presentationFromTemplate("lelu-central", undefined, 0);
  p = applyHomeOp(p, "desktop", { op: "float", id: "notifications" });
  assert.equal(solveHome(p, "desktop").floating[0]?.id, "notifications");
  p = applyHomeOp(p, "desktop", { op: "place", id: "notifications", rect: { x: 0.513, y: 0.207, w: 0.333, h: 0.401 } });
  const r = p.profiles.desktop.modules.notifications.float!;
  for (const v of [r.x, r.y, r.w, r.h]) assert.ok(Math.abs(v / 0.02 - Math.round(v / 0.02)) < 1e-6, `snapped: ${v}`);
  p = applyHomeOp(p, "desktop", { op: "dock", id: "weather" });
  assert.deepEqual(solveHome(p, "desktop").docked, ["weather"]);
  p = applyHomeOp(p, "desktop", { op: "restore", id: "weather" });
  assert.deepEqual(solveHome(p, "desktop").docked, []);
});

test("snapRect keeps a surface inside the box and aligns to a neighbour's edge", () => {
  const r = snapRect({ x: 0.9, y: -0.2, w: 0.5, h: 0.3 });
  assert.ok(r.x + r.w <= 1 && r.y >= 0);
  const aligned = snapRect({ x: 0.415, y: 0.1, w: 0.2, h: 0.2 }, [{ x: 0.1, y: 0.1, w: 0.3, h: 0.2 }]);
  assert.equal(aligned.x, 0.4);
});

test("group renders members as one surface; ungrouping the last pair dissolves the group", () => {
  let p = presentationFromTemplate("lelu-central", undefined, 0);
  p = applyHomeOp(p, "desktop", { op: "group", id: "activity", with: "notifications" });
  const leader = solveHome(p, "desktop").placed.find((m) => m.members.length > 1);
  assert.deepEqual(leader?.members, ["notifications", "activity"]);
  p = applyHomeOp(p, "desktop", { op: "ungroup", id: "activity" });
  assert.equal(p.profiles.desktop.modules.notifications.group, undefined);
});

test("adaptive ordering is computed, never saved: approvals and live work rise", () => {
  const order = presentationFromTemplate("adaptive-intelligence", undefined, 0).profiles.desktop.order;
  const live = adaptiveOrder(order, { working: false, unread: 0, approvals: 2, openWindows: 0 });
  assert.equal(live[0], "notifications");
  assert.deepEqual(adaptiveOrder(order, { working: false, unread: 0, approvals: 0, openWindows: 0 }), order);
});

test("readPresentation tolerates damaged storage and invents nothing", () => {
  assert.equal(readPresentation(null), null);
  assert.equal(readPresentation({ id: 3 }), null);
  const fixed = readPresentation({ id: "x", name: "Mine", template: "nope", profiles: { phone: { order: ["weather", "bogus"], modules: { weather: { size: "huge", mode: "teleport" } } } } });
  assert.ok(fixed);
  assert.equal(fixed!.template, "lelu-central");
  assert.equal(fixed!.profiles.phone.order.length, HOME_MODULES.length);
  assert.ok(["s", "m", "l", "xl"].includes(fixed!.profiles.phone.modules.weather.size));
  assert.ok(["grid", "float", "dock"].includes(fixed!.profiles.phone.modules.weather.mode));
});

test("HomeStore: create never overwrites, reset keeps a restore point, undo/redo work", async () => {
  const { default: HomeStore } = await import("../src/app/scene/genesis/home/homeStore");
  const first = HomeStore.activePresentation();
  HomeStore.applyHomeOp("desktop", { op: "resize", id: "weather", size: "xl" });
  assert.equal(HomeStore.activePresentation().profiles.desktop.modules.weather.size, "xl");
  assert.ok(HomeStore.get().presentations.canUndo);
  HomeStore.undo();
  assert.notEqual(HomeStore.activePresentation().profiles.desktop.modules.weather.size, "xl");
  HomeStore.redo();
  assert.equal(HomeStore.activePresentation().profiles.desktop.modules.weather.size, "xl");

  const created = HomeStore.createPresentation("cosmos-orbit");
  assert.equal(HomeStore.get().presentations.activeId, created.id);
  assert.equal(HomeStore.get().presentations.list.find((p) => p.id === first.id)!.profiles.desktop.modules.weather.size, "xl", "the earlier presentation is untouched");

  HomeStore.applyPresentation(first.id);
  HomeStore.resetPresentation("desktop");
  assert.notEqual(HomeStore.activePresentation().profiles.desktop.modules.weather.size, "xl");
  assert.ok(HomeStore.restorePresentation());
  assert.equal(HomeStore.activePresentation().profiles.desktop.modules.weather.size, "xl", "restore brings the arrangement back");

  const dup = HomeStore.duplicatePresentation(first.id)!;
  HomeStore.renamePresentation(dup.id, "Studio day");
  assert.equal(HomeStore.activePresentation().name, "Studio day");
  assert.ok(HomeStore.deletePresentation(dup.id));
  assert.ok(HomeStore.get().presentations.restorePoint, "a deleted presentation can be restored");
});
