/**
 * Mission 18 — creative objects as real, mutable, persistent objects.
 *
 * These tests exercise the store, not a mock: geometry is built by the
 * engine, components are extracted and reattached, state is reloaded from
 * the same bytes, and every export is parsed back before it is asserted.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { garmentAssembly, patternAssembly } from "../src/core/couture/components";
import { exportGlb, exportObj, exportProject, validateGlb, validateObj, validateProject } from "../src/core/couture/exporters";
import { buildGarment } from "../src/core/couture/garment";
import CreativeObjects, { geometryFingerprint, memoryStorage } from "../src/core/couture/objects";
import { draftPattern } from "../src/core/couture/pattern";
import { buildProduct, evalExpression, resolveVariables } from "../src/core/couture/product";
import { parseObjectCall } from "../src/core/couture/CoutureTools";

const STYLE = { category: "dress" as const, sleeves: "long" as const, length: "knee" as const, silhouette: "fit-and-flare" as const, darts: true, waistSeam: true };

function buildGown() {
  const built = buildGarment({ name: "test gown", style: STYLE, material: "silk-mikado", rows: 16, cols: 48, steps: 12, iterations: 4, seed: 7 });
  assert.equal(built.ok, true, built.reason);
  assert.ok(built.garment);
  return built.garment;
}

function makeStoreWithGown() {
  const storage = memoryStorage();
  const store = new CreativeObjects(storage);
  const assembly = garmentAssembly(buildGown());
  const gown = store.create({ kind: "garment", name: "Test gown", parts: assembly.parts, components: assembly.components, sockets: assembly.sockets, data: assembly.data });
  return { storage, store, gown };
}

test("a garment is an assembly of components with stable ids", () => {
  const { store, gown } = makeStoreWithGown();
  assert.ok(gown.components.length >= 3, `expected a shell and two sleeves, got ${gown.components.map((c) => c.kind).join(", ")}`);
  const sleeves = gown.components.filter((c) => c.kind === "sleeve");
  assert.equal(sleeves.length, 2);
  for (const sleeve of sleeves) {
    assert.equal(sleeve.patternPieceId, "sleeve");
    assert.ok(sleeve.partIds.length === 1);
    const part = gown.parts.find((p) => p.id === sleeve.partIds[0]);
    assert.ok(part && part.mesh.indices.length > 0, "sleeve must own real triangles");
  }
  assert.equal(store.integrity().every((c) => c.ok), true);
});

test("a textile change alters no geometry", () => {
  const { store, gown } = makeStoreWithGown();
  const before = geometryFingerprint(gown);
  store.setMaterial(gown.id, "velvet-silk", gown.components[0].id);
  assert.equal(geometryFingerprint(gown), before);
  assert.equal(gown.parts.find((p) => p.componentId === gown.components[0].id)?.materialId, "velvet-silk");
});

test("placing, floating, moving and rotating do not change identity", () => {
  const { store, gown } = makeStoreWithGown();
  store.placeInCosmos(gown.id, { roomId: "cosmos-core", position: [120, 0, 0] });
  store.setMotion(gown.id, { kind: "orbit", speed: 3, radiusMm: 300 });
  store.moveBy(gown.id, [40, 0, 0]);
  store.rotateBy(gown.id, [0, 15, 0]);
  assert.equal(gown.location, "cosmos");
  assert.deepEqual(gown.transform.position, [160, 0, 0]);
  assert.equal(gown.motion.kind, "orbit");
  assert.equal(store.integrity().every((c) => c.ok), true);
});

test("detaching a sleeve extracts real geometry and does not corrupt the parent", () => {
  const { store, gown } = makeStoreWithGown();
  store.placeInCosmos(gown.id, {});
  const before = geometryFingerprint(gown);
  const partsBefore = gown.parts.length;
  const detached = store.detachComponent(gown.id, "right sleeve", { position: [600, 0, 100] });
  assert.equal(detached.ok, true, detached.message);
  assert.ok(detached.object);
  const child = detached.object!;
  assert.equal(child.location, "cosmos");
  assert.equal(child.parts.length, 1);
  assert.equal(child.parts[0].mesh.indices.length > 0, true);
  // The parent keeps every part; the extracted one is only excluded from composition.
  assert.equal(gown.parts.length, partsBefore);
  assert.equal(geometryFingerprint(gown), before);
  const composed = store.compose(gown.id);
  assert.ok(composed);
  assert.equal(composed!.parts.some((p) => p.componentId === "c-sleeve-right"), false, "detached sleeve must not render on the garment");
  assert.equal(store.integrity().every((c) => c.ok), true);

  const attached = store.attachComponent(child.id, gown.id);
  assert.equal(attached.ok, true, attached.message);
  assert.equal(store.findComponent(gown.id, "right sleeve")?.status, "attached");
  assert.ok(store.get(child.id), "the extracted object is kept after reattaching, not deleted");
  assert.equal(store.compose(gown.id)!.parts.some((p) => p.componentId === "c-sleeve-right"), true);
});

test("a component cannot be attached to an incompatible object", () => {
  const { store, gown } = makeStoreWithGown();
  const detached = store.detachComponent(gown.id, "right sleeve");
  assert.ok(detached.object);
  const pendant = buildProduct("pendant");
  assert.ok(pendant.assembly);
  const jewellery = store.create({ kind: "jewelry", name: "A pendant", parts: pendant.assembly!.parts, components: pendant.assembly!.components, sockets: pendant.assembly!.sockets });
  const reuse = store.reuseComponent(detached.object!.id, jewellery.id);
  assert.equal(reuse.ok, false);
  assert.match(reuse.message, /no socket that accepts a sleeve/);
});

test("taking an object out of the cosmos keeps it and can be undone", () => {
  const { store, gown } = makeStoreWithGown();
  store.placeInCosmos(gown.id, {});
  const revision = gown.revision;
  store.removeFromCosmos(gown.id);
  assert.equal(gown.location, "workspace");
  assert.ok(store.get(gown.id));
  assert.equal(store.compose(gown.id)!.parts.length > 0, true, "the geometry still composes outside the cosmos");
  store.undo();
  assert.equal(store.get(gown.id)!.location, "cosmos");
  assert.equal(store.get(gown.id)!.revision, revision);
});

test("state survives a reload with identity, geometry and relationships", () => {
  const { storage, store, gown } = makeStoreWithGown();
  store.placeInCosmos(gown.id, { position: [10, 20, 30] });
  const detached = store.detachComponent(gown.id, "left sleeve");
  assert.ok(detached.object);
  const fingerprint = geometryFingerprint(gown);
  const history = gown.history.length;

  const reloaded = new CreativeObjects(storage);
  const again = reloaded.get(gown.id);
  assert.ok(again);
  assert.equal(again!.revision, gown.revision);
  assert.equal(again!.parts.length, gown.parts.length);
  assert.equal(again!.components.length, gown.components.length);
  assert.equal(again!.history.length, history);
  assert.equal(again!.location, "cosmos");
  assert.equal(geometryFingerprint(again!), fingerprint);
  assert.equal(again!.components.find((c) => c.kind === "sleeve" && c.status === "detached")?.detachedObjectId, detached.object!.id);
  assert.equal(reloaded.integrity().every((c) => c.ok), true);
});

test("an ambiguous reference is refused, never guessed", () => {
  const { store } = makeStoreWithGown();
  const duplicate = store.duplicate(store.list()[0].id, { name: "Test gown (copy)" });
  assert.ok(duplicate);
  const resolved = store.resolve("gown");
  assert.equal(resolved.ok, false);
  assert.match(resolved.message, /matches 2 objects/);
  const byId = store.resolve(store.list()[0].id);
  assert.equal(byId.ok, true);
});

test("a duplicate has its own identity and does not share components", () => {
  const { store, gown } = makeStoreWithGown();
  const copy = store.duplicate(gown.id, { name: "Copy" });
  assert.ok(copy);
  assert.notEqual(copy!.id, gown.id);
  copy!.components[0].status = "detached";
  assert.equal(gown.components[0].status, "attached");
  store.detachComponent(copy!.id, "right sleeve");
  assert.equal(gown.components.filter((c) => c.status === "detached").length, 0);
});

test("only an explicit delete destroys a record", () => {
  const { store, gown } = makeStoreWithGown();
  assert.equal(store.deletePermanently(gown.id, "wrong").ok, false);
  assert.ok(store.get(gown.id));
  const deleted = store.deletePermanently(gown.id, "Test gown");
  assert.equal(deleted.ok, true);
  assert.equal(store.get(gown.id), undefined);
  assert.equal(store.undo().ok, true);
  assert.ok(store.get(gown.id), "undo brings a deleted object back");
});

test("patterns and product templates produce checkable parametric geometry", () => {
  const pattern = draftPattern(STYLE, {});
  const assembly = patternAssembly(pattern);
  assert.equal(assembly.parts.length, pattern.pieces.length);
  assert.equal(assembly.checks.every((c) => c.ok), true);
  assert.equal(evalExpression("legHeight + seatThickness", { legHeight: 420, seatThickness: 32 }), 452);
  const built = buildProduct("chair", { seatWidth: 500 });
  assert.equal(built.ok, true);
  assert.equal(built.variables?.values.seatHeight, 452);
  assert.equal(built.assembly?.checks.every((c) => c.ok), true);
  const specs = resolveVariables({ a: { value: 1, min: 0, max: 2, unit: "mm", label: "a" }, b: { value: 0, min: 0, max: 9, unit: "mm", label: "b", expression: "a * 3" } }, { a: 2 });
  assert.equal(specs.values.b, 6);
  assert.throws(() => evalExpression("window.alert(1)", { window: 1 }));
});

test("exports are written and re-parsed successfully", () => {
  const pendant = buildProduct("pendant", { discDiameter: 24, stoneDiameter: 8 });
  assert.ok(pendant.assembly);
  const parts = pendant.assembly!.parts.map((p) => ({ id: p.id, label: p.label, mesh: p.mesh, color: p.color, materialId: p.materialId, opacity: p.opacity, componentId: p.componentId }));
  const glb = exportGlb(parts, { objectId: "obj-jewelry-1" });
  const glbReport = validateGlb(glb);
  assert.equal(glbReport.ok, true, glbReport.errors.join("; "));
  assert.equal(glbReport.meshes, parts.length);
  assert.ok(glbReport.triangles > 0);

  const obj = exportObj(parts, "pendant");
  const objReport = validateObj(obj);
  assert.equal(objReport.ok, true, objReport.errors.join("; "));
  assert.equal(objReport.groups, parts.length);

  const { store } = makeStoreWithGown();
  const project = exportProject(store.all(), { mission: "18" });
  const projectReport = validateProject(project);
  assert.equal(projectReport.ok, true, projectReport.errors.join("; "));

  // A corrupted file is reported as corrupt rather than accepted.
  const broken = Uint8Array.from(glb);
  broken[0] = 0;
  assert.equal(validateGlb(broken).ok, false);
});

test("object operations never touch the network", () => {
  const original = globalThis.fetch;
  let calls = 0;
  // @ts-expect-error the test replaces fetch deliberately
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("network access attempted");
  };
  try {
    const { store, gown } = makeStoreWithGown();
    store.placeInCosmos(gown.id, {});
    store.setMotion(gown.id, { kind: "spin" });
    const detached = store.detachComponent(gown.id, "right sleeve");
    assert.ok(detached.object);
    store.attachComponent(detached.object!.id, gown.id);
    store.removeFromCosmos(gown.id);
    store.placeInCosmos(gown.id, {});
    const chair = buildProduct("chair");
    assert.ok(chair.assembly);
    exportGlb(chair.assembly!.parts.map((p) => ({ id: p.id, label: p.label, mesh: p.mesh, color: p.color, materialId: p.materialId, opacity: 1 })));
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls, 0);
});

test("tool calls are validated before they execute", () => {
  assert.equal(parseObjectCall({}).ok, false);
  assert.equal(parseObjectCall({ action: "teleport" }).ok, false);
  assert.equal(parseObjectCall({ action: "detach", object: "gown" }).ok, false);
  assert.equal(parseObjectCall({ action: "move", object: "gown" }).ok, false);
  const ok = parseObjectCall({ action: "detach", object: "gown", component: "right sleeve" });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.call.action, "detach");
    assert.equal(ok.call.component, "right sleeve");
  }
  const moved = parseObjectCall({ action: "move", object: "gown", position: [10, 0, 20] });
  assert.equal(moved.ok, true);
  if (moved.ok) assert.deepEqual(moved.call.position, [10, 0, 20]);
});
