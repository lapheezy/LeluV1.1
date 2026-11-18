/**
 * LÉLU — feature understanding (PCI-FR 1.0, WP05).
 *
 * These tests read the REAL artifacts the perception engine produced from her
 * committed references (artifacts/pci-fr-1.0/features). If those files are
 * absent or malformed, the cognition layer has nothing honest to reason about,
 * and the tests say so rather than passing on synthetic data.
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import FeatureUnderstanding, {
  classifyOutcome,
  compare,
  decompose,
  describe,
  loadObservation,
  missingInformation,
  recommendStrategy,
  relationsOf,
  retrieveSimilar,
  ReplicationMemory,
  similarity,
  uncertainty,
  type FeatureObservationSet,
} from "../src/core/perception/FeatureUnderstanding";

const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "artifacts/pci-fr-1.0/features");

function load(name: string): FeatureObservationSet {
  const file = path.join(DIR, `${name}.features.json`);
  assert.ok(existsSync(file), `missing perception artifact ${file} — run scripts/perception/lelu_perception.py`);
  return loadObservation(JSON.parse(readFileSync(file, "utf8")) as Parameters<typeof loadObservation>[0]);
}

test("a reference's perception artifact carries every feature with location, confidence, source and evidence", () => {
  const face = load("ref10_face_primary");
  assert.equal(face.schema, "lelu.perception.features/1");
  const landmarks = face.features.find((f) => f.id === "landmarks");
  assert.ok(landmarks, "no landmarks");
  assert.equal(landmarks.measurements.count, 478);
  assert.equal(landmarks.geometry.points?.length, 478);
  assert.ok(landmarks.confidence > 0 && landmarks.confidence <= 1);
  assert.equal(landmarks.provenance, "observed");
  assert.equal(landmarks.source, "ref10_face_primary");
  assert.ok(Object.keys(landmarks.evidence).length > 0, "landmarks carry no evidence");

  for (const feature of face.features) {
    assert.ok(feature.source.length > 0, `${feature.id} has no source image`);
    assert.ok(feature.confidence >= 0 && feature.confidence <= 1, `${feature.id} confidence ${feature.confidence} out of range`);
    assert.ok(["observed", "inferred"].includes(feature.provenance), `${feature.id} provenance missing`);
  }
});

test("proportions, hairline and baby hairs are real measurements, not placeholders", () => {
  const face = load("ref10_face_primary");
  const proportions = face.features.find((f) => f.id === "proportions");
  assert.ok(proportions);
  assert.equal(proportions.measurements.count, 14);
  assert.ok(Number(proportions.measurements.eye_aspect_R) > 0.2);
  assert.ok(Number(proportions.measurements.interocular_over_face) > 0.5);

  const hairline = face.features.find((f) => f.id === "hairline");
  assert.ok(hairline && (hairline.geometry.points?.length ?? 0) > 20, "hairline too short to be a curve");

  const strands = face.features.filter((f) => f.component === "baby_hair");
  for (const strand of strands) {
    assert.equal(strand.geometry.points?.length, 2, "a strand must have a root and a tip");
    assert.ok(Number(strand.measurements.length_px) > 0);
    assert.ok(Number(strand.measurements.angle_deg) >= -180 && Number(strand.measurements.angle_deg) <= 180);
  }
});

test("she describes what she measured, component by component", () => {
  const text = describe(load("ref10_face_primary"));
  assert.match(text, /478 landmarks/);
  assert.match(text, /14 proportions/);
  assert.match(text, /hairline/);
  assert.match(text, /ref10_face_primary/);
  assert.match(text, /confidence/i);
});

test("she can split the subject into parts and follow the relationships between them", () => {
  const face = load("ref10_face_primary");
  const parts = decompose(face);
  const labels = parts.map((part) => part.component);
  for (const expected of ["face", "hair", "baby_hair", "jewelry", "garment"] as const) {
    assert.ok(labels.includes(expected), `no ${expected} component`);
  }
  assert.ok(parts.every((part) => part.ids.length > 0 && part.confidence >= 0 && part.confidence <= 1));

  const relations = relationsOf(face);
  assert.ok(relations.length >= 3, "relationships between components were not recorded");
  assert.ok(relations.some((r) => r.type === "mirrored_about" || r.type === "symmetric_pair"));
  assert.ok(relationsOf(face, "hairline").length >= 1, "hairline participates in no relationship");
});

test("uncertainty is stated with reasons, worst first", () => {
  const notes = uncertainty(load("ref10_face_primary"), 0.8);
  assert.ok(notes.length > 0, "a real photograph always leaves something uncertain");
  for (let i = 1; i < notes.length; i += 1) assert.ok(notes[i - 1].confidence <= notes[i].confidence);
  assert.ok(notes.every((note) => note.reason.length > 10));
});

test("comparing two references yields normalised deltas, not adjectives", () => {
  const a = load("ref10_face_primary");
  const b = load("ref08_face_upper_body");
  const comparison = compare(a, b);
  assert.equal(comparison.reference, "ref10_face_primary");
  assert.equal(comparison.candidate, "ref08_face_upper_body");
  assert.ok(comparison.proportions.length >= 10);
  // The same character photographed at a different framing: the ratios agree to
  // a few percent (measured 2.6 %), well inside the 8 % deviation the current
  // 3-D rig shows against her own reference.
  assert.ok(comparison.meanRelativeProportionError !== null);
  assert.ok(comparison.meanRelativeProportionError < 0.05, `proportion error ${comparison.meanRelativeProportionError}`);
  assert.ok(Object.values(comparison.counts).every((entry) => entry.reference >= 0));
});

test("she retrieves the most similar previous observation by proportion vector", () => {
  const query = load("ref10_face_primary");
  const library = [load("ref08_face_upper_body"), load("face-front-closeup-alt"), load("ref07_signature_pendant")];
  const ranked = retrieveSimilar(query, library, 3);
  assert.ok(ranked.length >= 2);
  assert.equal(ranked[0].source, "face-front-closeup-alt", "the near-identical close-up should rank first");
  assert.ok(ranked[0].similarity > 0.99);
  assert.ok(ranked[0].similarity >= ranked[ranked.length - 1].similarity);
  assert.equal(similarity(query, query), 1);
});

test("an accessory photograph honestly reports that it has no face", () => {
  const pendant = load("ref07_signature_pendant");
  const missing = missingInformation(pendant);
  assert.ok(missing.some((entry) => entry.component === "face"), "no mention of the absent face");
  const beads = pendant.features.filter((feature) => feature.kind === "bead");
  assert.ok(beads.length >= 8, `only ${beads.length} beads detected`);
  assert.ok(beads.every((bead) => (bead.geometry.radius ?? 0) > 0));
  const strategy = recommendStrategy(pendant).map((entry) => entry.component);
  assert.ok(strategy.includes("jewelry"));
  assert.ok(!strategy.includes("face"), "a strategy was recommended for a face that was never seen");
});

test("a garment photograph recommends panel-and-seam reconstruction", () => {
  const garment = load("ref06_torso_corset_A");
  const panels = garment.features.filter((feature) => feature.kind === "panel");
  assert.ok(panels.length >= 3, `only ${panels.length} panels segmented`);
  const recommendation = recommendStrategy(garment).find((entry) => entry.component === "garment");
  assert.ok(recommendation);
  assert.match(recommendation!.strategy, /seam/);
  assert.match(recommendation!.because, /panel/);
});

test("she learns from replication outcomes and refuses to claim improvement she cannot measure", () => {
  const memory = new ReplicationMemory();
  memory.record({ id: "wp06-a", reference: "ref10_face_primary", at: 1, strategy: "landmark mesh", metrics: { nme: 0.006 }, outcome: "succeeded", notes: [] });
  memory.record({ id: "wp06-b", reference: "ref10_face_primary", at: 2, strategy: "guess", metrics: { nme: 0.02 }, outcome: "failed", notes: ["no correspondence check"] });
  memory.record({ id: "wp06-c", reference: "ref07_signature_pendant", at: 3, strategy: "bead layout", metrics: { nme: null }, outcome: "failed", notes: ["beads merged with skin"] });

  assert.equal(memory.all().length, 3);
  assert.equal(memory.best("nme")?.id, "wp06-a");
  assert.equal(memory.failed().length, 2);
  assert.ok(memory.lessons().some((lesson) => /no correspondence check/.test(lesson)));

  const good = classifyOutcome({ strategy: "landmark mesh", metric: "nme", before: 0.0155, after: 0.006 }, 0.2);
  assert.equal(good.outcome, "succeeded");
  assert.ok(good.improvement !== null && good.improvement > 0.6);

  const unmeasurable = classifyOutcome({ strategy: "bead layout", metric: "nme", before: 0.0155, after: null }, 0.2);
  assert.equal(unmeasurable.outcome, "failed");
  assert.equal(unmeasurable.improvement, null);
  assert.match(unmeasurable.note, /no claim is made/);
});

test("the module is usable the way the app imports it", () => {
  assert.equal(typeof FeatureUnderstanding.loadObservation, "function");
  assert.equal(typeof FeatureUnderstanding.describe, "function");
  assert.equal(typeof FeatureUnderstanding.ReplicationMemory, "function");
});
