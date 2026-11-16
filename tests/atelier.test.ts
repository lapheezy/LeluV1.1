/**
 * ==========================================================
 * LÉLU — ATELIER: DESIGN TO VERIFIED FILES
 *
 * CATEGORY: integration. Real geometry, real writers, real
 * read-back, real Creation Studio export of the production
 * documents. No model is involved: the directions are what a
 * model would supply through atelier.* tools.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { billOfMaterials, interferences } from "../src/core/atelier/AtelierGeometry";
import { ATELIER_FORMATS } from "../src/core/atelier/AtelierFiles";
import { bomWorkbook, dossierDocument, reviewDeck } from "../src/core/atelier/AtelierPackage";
import { parseStl } from "../src/core/atelier/AtelierReadback";
import AtelierStore, { assess } from "../src/core/atelier/AtelierStore";
import { exportArtifact } from "../src/core/studio/StudioExport";

const folding = {
  id: "D1", name: "Folding panel lantern", identity: "Flat-pack lantern whose lid is the solar panel",
  concept: "A hinged lid carries the panel and folds over a translucent diffuser.",
  function: "The panel charges a LiFePO4 cell through a charge controller; LEDs light the diffuser.",
  architecture: "hinged lid solar panel over diffuser, lifepo4 cell in base, buck controller",
  components: [
    { id: "C-01", name: "Base housing", shape: "box", size: { width: 120, depth: 120, height: 30 }, position: { x: 0, y: 0, z: 15 }, material: "ABS", quantity: 1, unitCost: 2.1, sources: ["S2"], tolerance: 0.2 },
    { id: "C-02", name: "LiFePO4 cell 3.2V", shape: "cylinder", size: { width: 26, height: 65 }, position: { x: 30, y: 0, z: 15 }, material: "LiFePO4 cell", quantity: 1, unitCost: 4.2, sources: ["S1"], make: "buy", supplier: "Cell supplier", connects: [{ to: "C-03", signal: "VBAT+" }] },
    { id: "C-03", name: "Charge controller PCB", shape: "box", size: { width: 40, depth: 30, height: 2 }, position: { x: -30, y: 0, z: 5 }, material: "FR4", quantity: 1, unitCost: 1.8, make: "buy", connects: [{ to: "C-04", signal: "LED+" }] },
    { id: "C-04", name: "Diffuser", shape: "box", size: { width: 110, depth: 110, height: 80 }, position: { x: 0, y: 0, z: 70 }, material: "polycarbonate", quantity: 1, unitCost: 1.5 },
    { id: "C-05", name: "Solar lid panel", shape: "box", size: { width: 120, depth: 120, height: 4 }, position: { x: 0, y: 0, z: 112 }, material: "monocrystalline PV", quantity: 1, unitCost: 3.9, sources: ["S1"], make: "buy" },
  ],
  claims: [{ text: "LiFePO4 tolerates 2000+ cycles", level: "research-supported", sources: ["S1"] }],
  limitations: ["Hinge wear not assessed"], validationRequired: ["Drop test from 1 m", "Charge cycle test"], complexity: { score: 2, reason: "few parts" },
};
const dome = {
  id: "D2", name: "Fixed dome lantern", identity: "A sealed glass sphere with the panel as its cap",
  concept: "Blown borosilicate sphere, panel bonded on top.",
  function: "A cap-mounted panel charges a cell in a weighted foot.",
  architecture: "sealed borosilicate globe with bonded cap cell module and weighted steel foot",
  components: [
    { id: "C-01", name: "Steel foot", shape: "cylinder", size: { width: 90, height: 20 }, position: { x: 0, y: 0, z: 10 }, material: "steel", quantity: 1 },
    { id: "C-02", name: "Glass globe", shape: "sphere", size: { width: 140 }, position: { x: 0, y: 0, z: 90 }, material: "borosilicate glass", quantity: 1, unitCost: 6 },
    { id: "C-03", name: "Cap module", shape: "cylinder", size: { width: 60, height: 15 }, position: { x: 0, y: 0, z: 168 }, material: "aluminium 6061", quantity: 1, unitCost: 3 },
  ],
  limitations: ["Glass breakage"], validationRequired: ["Thermal shock test"], complexity: { score: 3, reason: "glass work" },
};
const strip = {
  id: "D3", name: "Wearable strip light", identity: "A flexible strap with a cell pack",
  concept: "Silicone strap, flexible PV, LED strip.",
  function: "Worn on a pack strap; flexible panel charges a pouch cell.",
  architecture: "flexible silicone strap carrying flexible pv film and li-ion pouch with led strip",
  components: [
    { id: "C-01", name: "Silicone strap", shape: "box", size: { width: 300, depth: 40, height: 4 }, position: { x: 0, y: 0, z: 2 }, material: "silicone", quantity: 1, unitCost: 1.2 },
    { id: "C-02", name: "Pouch cell", shape: "box", size: { width: 50, depth: 30, height: 6 }, position: { x: 0, y: 0, z: 7 }, material: "Li-ion cell", quantity: 1, unitCost: 3.5, make: "buy" },
  ],
  complexity: { score: 2, reason: "" },
};

function project() {
  const store = AtelierStore.createIsolated();
  const created = store.create({
    title: "Solar Lantern",
    brief: "An off-grid lantern charged by sunlight, with a battery, for camping.",
    inputs: [
      { id: "I1", kind: "photo", name: "sketch.jpg", method: "vision model", findings: "a box lantern with a hinged top" },
      { id: "I2", kind: "pdf", name: "datasheet.pdf" },
    ],
    sources: [{ id: "S1", title: "LiFePO4 datasheet", url: "https://example.org/ds.pdf", kind: "datasheet" }, { id: "S2", title: "ABS housing quote", kind: "supplier" }, { id: "S9", title: "Paywalled study", inaccessible: true }],
  });
  assert.ok(created.ok);
  return { store, id: created.project.id };
}

test("inputs count as inspected only with a method and findings — a file name is not inspection", () => {
  const { store, id } = project();
  const inputs = store.get(id)!.inputs;
  assert.deepEqual(inputs.map((i) => i.inspected), [true, false]);
});

test("three genuinely different directions are accepted; a cosmetic variation is refused", () => {
  const { store, id } = project();
  const added = store.addDirections(id, [folding, dome, strip]);
  assert.ok(added.ok, added.ok ? "" : added.reason);
  const variant = { ...folding, id: "D4", name: "Folding panel lantern (blue)", identity: "Same, blue" };
  const refused = store.addDirections(id, [variant]);
  assert.equal(refused.ok, false);
  assert.match((refused as { reason: string }).reason, /cosmetic variations, not different architectures: D1 and D4/);
  assert.equal(store.latest(store.get(id)!).directions.length, 3, "nothing was added");
});

test("BOM, mass and cost are calculated from the parts; unknown costs stay unknown", () => {
  const { store, id } = project();
  store.addDirections(id, [folding, dome, strip]);
  const d2 = store.direction(store.get(id)!, "D2")!;
  const bom = billOfMaterials(d2);
  assert.deepEqual(bom.uncosted, ["C-01"], "the steel foot has no price");
  assert.equal(bom.totalCost, 9);
  const footMass = bom.rows[0].mass!;
  assert.ok(Math.abs(footMass - Math.PI * 45 * 45 * 20 / 1000 * 7.85) < 0.2, `steel foot mass ${footMass} g`);
});

test("every design file is written and read back from its bytes; STEP is refused, not faked", () => {
  const { store, id } = project();
  store.addDirections(id, [folding, dome, strip]);
  const r = store.exportFiles(id, "D1", [...ATELIER_FORMATS, "step"]);
  assert.ok(r.ok);
  for (const f of r.files) assert.equal(f.verification.ok, true, `${f.format}: ${JSON.stringify(f.verification.checks.filter((c) => !c.ok))}`);
  assert.deepEqual(r.refused.map((x) => x.format), ["step"]);
  assert.match(r.refused[0].reason, /B-rep CAD kernel/);
  const stl = parseStl(r.files.find((f) => f.format === "stl")!.bytes);
  assert.ok(Math.abs(stl.bounds.max.z - 114) < 0.01, "the lid's top is at 114 mm");
});

test("interference is detected between parts that occupy the same space", () => {
  const { store, id } = project();
  store.addDirections(id, [folding, dome, strip]);
  // The cell (Ø26 × 65 at z 15) pokes through the 30 mm base into the diffuser above.
  const hits = interferences(store.direction(store.get(id)!, "D1")!.components);
  assert.ok(hits.some((h) => [h.a, h.b].sort().join() === "C-01,C-02"));
  assert.ok(hits.some((h) => [h.a, h.b].sort().join() === "C-02,C-04"));
});

test("changing one component propagates to the BOM, drawings, models and dossier — and the old version stays", async () => {
  const { store, id } = project();
  store.addDirections(id, [folding, dome, strip]);
  const before = store.latest(store.get(id)!).version;
  const changed = store.updateComponent(id, "D1", "C-02", { size: { width: 18, height: 40 }, name: "LiFePO4 cell 18650-class", unitCost: 3.1 });
  assert.ok(changed.ok, changed.ok ? "" : changed.reason);
  const p = store.get(id)!;
  assert.equal(store.latest(p).version, before + 1);
  assert.deepEqual(store.latest(p).changed, ["C-02"]);
  assert.equal(p.versions.find((v) => v.version === before)!.directions[0].components[1].size.width, 26, "the previous version is unchanged");
  const d = store.direction(p, "D1")!;
  const files = store.exportFiles(id, "D1", ["svg-orthographic", "gltf"]);
  assert.ok(files.ok);
  const svg = new TextDecoder().decode(files.files[0].bytes);
  assert.ok(svg.includes("C-02 LiFePO4 cell 18650-class"), "the drawing callout follows");
  const wb = await exportArtifact(bomWorkbook(p, d, store.latest(p).version), "xlsx");
  assert.equal(wb.verification.ok, true, JSON.stringify(wb.verification.checks));
  const doc = await exportArtifact(dossierDocument(p, d, store.latest(p).version), "docx");
  assert.equal(doc.verification.ok, true, JSON.stringify(doc.verification.checks));
  assert.ok(new TextDecoder().decode((await exportArtifact(dossierDocument(p, d, store.latest(p).version), "md")).bytes).includes("Ø18 × 40 mm"));
});

test("evidence is not promoted: research + calculation, no higher; safety domains flagged for qualified review", () => {
  const { store, id } = project();
  store.addDirections(id, [folding, dome, strip]);
  const p = store.get(id)!;
  const a1 = assess(p, store.direction(p, "D1")!);
  assert.equal(a1.level, "calculated", a1.why.join("; "));
  assert.ok(a1.safety.some((s) => s.domain === "electrical"), "a battery means an electrical review");
  const a3 = assess(p, store.direction(p, "D3")!);
  assert.equal(a3.level, "conceptual", "no sources: conceptual, whatever was calculated");
  const files = store.exportFiles(id, "D2", [...ATELIER_FORMATS]);
  assert.ok(files.ok);
  const a2 = assess(p, store.direction(p, "D2")!, files.files.map((f) => f.verification));
  assert.notEqual(a2.level, "simulated");
  assert.notEqual(a2.level, "physically-tested");
});

test("fork and combine make new directions; originals untouched", () => {
  const { store, id } = project();
  store.addDirections(id, [folding, dome, strip]);
  const fork = store.derive(id, ["D2"], { name: "Dome with folding cap", architecture: "sealed borosilicate globe with a hinged folding solar cap" });
  assert.ok(fork.ok, fork.ok ? "" : fork.reason);
  const combo = store.derive(id, ["D1", "D3"], { name: "Lantern with detachable strap" });
  assert.ok(combo.ok, combo.ok ? "" : combo.reason);
  assert.deepEqual(combo.direction.derivedFrom, ["D1", "D3"]);
  assert.ok(combo.direction.components.some((c) => c.id === "C-01-D3"), "IDs stay unique when combining");
  assert.equal(store.direction(store.get(id)!, "D1")!.components.length, 5);
});

test("the review deck and dossier are real files that pass read-back", async () => {
  const { store, id } = project();
  store.addDirections(id, [folding, dome, strip]);
  store.select(id, "D1");
  const p = store.get(id)!;
  const deck = await exportArtifact(reviewDeck(p, store.latest(p).directions, "D1", store.latest(p).version), "pptx");
  assert.equal(deck.verification.ok, true, JSON.stringify(deck.verification.checks));
  const pdf = await exportArtifact(dossierDocument(p, store.direction(p, "D1")!, store.latest(p).version), "pdf");
  assert.equal(pdf.verification.ok, true, JSON.stringify(pdf.verification.checks));
});
