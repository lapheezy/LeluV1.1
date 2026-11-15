/**
 * Mission 15 — the build engine.
 *
 * These are the claims the framework makes, checked against the same pure
 * functions the tools call: determinism, validated parameters, relationships
 * that recompute, stable identity, a transformation that really points one
 * axis at another, and routing from words to the right builder.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILDERS,
  buildCabin,
  buildGearbox,
  buildMolecule,
  findBuilder,
  modifyProgram,
  parseModification,
  type BuildProgram,
} from "../src/core/creative/kit/build";
import { normalizeVisualSpec } from "../src/core/creative/kit/VisualArtifacts";
import { alignY } from "../src/core/creative/kit/build/BuildTypes";
import { compileDirect } from "../src/core/creative/kit/DirectCompiler";

const gearbox = () => {
  const r = buildGearbox({});
  assert.ok(r.ok && r.program, "the default gearbox builds");
  return r.program!;
};

/* ------------------------------ determinism ------------------------------ */

test("equivalent parameters produce the identical program, twice", () => {
  const a = buildGearbox({ teethOut: 32 });
  const b = buildGearbox({ teethOut: 32 });
  assert.ok(a.ok && b.ok);
  assert.equal(JSON.stringify(a.program), JSON.stringify(b.program), "same input, byte-identical output");
  const cabinA = buildCabin({ storeys: 2, bays: 4 });
  const cabinB = buildCabin({ bays: 4, storeys: 2 });
  assert.ok(cabinA.ok && cabinB.ok);
  assert.equal(JSON.stringify(cabinA.program), JSON.stringify(cabinB.program), "parameter order does not matter");
});

test("every part id is unique and stable across rebuilds", () => {
  const first = gearbox();
  const second = gearbox();
  const ids = first.parts.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate component ids");
  assert.deepEqual(first.parts.map((p) => p.id), second.parts.map((p) => p.id), "ids do not shuffle between builds");
  for (const part of first.parts) assert.ok(first.layers.some((l) => l.id === part.layer), `${part.id} belongs to a declared layer`);
  for (const layer of first.layers) for (const id of layer.parts) assert.ok(ids.includes(id), `${layer.id} lists a real part`);
});

/* ---------------------------- validation -------------------------------- */

test("parameters outside a builder's surface are refused, not clipped", () => {
  const tooMany = buildGearbox({ module: 0.9 });
  assert.equal(tooMany.ok, false, "a 0.9 m module is refused");
  assert.ok(tooMany.rejected.some((r) => r.key === "module"));
  const unknown = buildGearbox({ wingspan: 4 });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.rejected.some((r) => r.key === "wingspan" && /not a parameter/.test(r.reason)));
  const badChoice = buildMolecule({ molecule: "unobtainium" });
  assert.equal(badChoice.ok, false);
});

test("step parameters snap to their declared step", () => {
  const r = buildGearbox({ teethOut: 31.6 });
  assert.ok(r.ok && r.program);
  assert.equal(r.program!.params.teethOut, 32, "teeth are whole numbers");
});

/* --------------------------- relationships ------------------------------ */

test("gear geometry follows from teeth and module (dependants computed)", () => {
  const program = gearbox();
  const moduleM = Number(program.params.module);
  const teethIn = Number(program.params.teethIn);
  const teethOut = Number(program.params.teethOut);
  const r1 = (moduleM * teethIn) / 2;
  const r2 = (moduleM * teethOut) / 2;
  const driver = program.parts.find((p) => p.id === "gear-driver")!;
  const output = program.parts.find((p) => p.id === "gear-output")!;
  assert.equal(driver.size.radius, r1, "driver pitch radius = module × teeth / 2");
  assert.equal(output.size.radius, r2, "output pitch radius = module × teeth / 2");
  const inputShaft = program.parts.find((p) => p.id === "shaft-input")!;
  const outputShaft = program.parts.find((p) => p.id === "shaft-output")!;
  const idler = program.parts.find((p) => p.id === "shaft-idler");
  const idlerRadius = (moduleM * Number(program.params.teethIdler)) / 2;
  const expected = idler ? r1 + idlerRadius + idlerRadius + r2 : r1 + r2;
  assert.ok(Math.abs(outputShaft.position[0] - inputShaft.position[0] - expected) < 1e-9, "shafts sit at the summed pitch radii");
  assert.equal(program.derived.find((d) => d.label === "Ratio")?.value, `${(teethOut / teethIn).toFixed(2)} : 1`);
});

test("changing the output gear moves the shaft and lengthens the housing", () => {
  const before = gearbox();
  const result = modifyProgram(before, { teethOut: Number(before.params.teethOut) + 8 });
  assert.ok(result.ok && result.program, result.reason);
  const after = result.program!;
  const housingBefore = before.parts.find((p) => p.id === "housing-base")!.size.width!;
  const housingAfter = after.parts.find((p) => p.id === "housing-base")!.size.width!;
  assert.ok(housingAfter > housingBefore, "the housing grew with the wider gear");
  const outputBefore = before.parts.find((p) => p.id === "shaft-output")!.position[0];
  const outputAfter = after.parts.find((p) => p.id === "shaft-output")!.position[0];
  assert.notEqual(outputAfter, outputBefore, "the output shaft moved to the new centre distance");
  assert.ok(result.changes.some((line) => /Output teeth/.test(line)), "the change is reported by parameter");
  assert.ok(result.changes.some((line) => /Centre distance/.test(line)), "the dependent distance is reported too");
});

test("an idler changes direction, not ratio", () => {
  const withIdler = gearbox();
  const without = modifyProgram(withIdler, { teethIdler: 0 });
  assert.ok(without.ok && without.program);
  const ratioWith = withIdler.derived.find((d) => d.label === "Ratio")!.value;
  const ratioWithout = without.program!.derived.find((d) => d.label === "Ratio")!.value;
  assert.equal(ratioWith, ratioWithout, "ratio is teethOut ÷ teethIn either way");
  assert.equal(without.program!.parts.filter((p) => p.id.startsWith("gear-idler")).length, 0, "the idler is gone");
});

test("a modification that changes nothing is refused", () => {
  const before = gearbox();
  const same = modifyProgram(before, { teethOut: before.params.teethOut });
  assert.equal(same.ok, false);
  assert.match(same.reason ?? "", /nothing changed/i);
});

/* ------------------------- words → parameters --------------------------- */

test("a sentence maps to parameter changes, and says what it cannot do", () => {
  const program = gearbox();
  const bigger = parseModification("make the output gear bigger", program);
  assert.equal(bigger.changes.teethOut, Number(program.params.teethOut) + 4);
  const noIdler = parseModification("remove the idler", program);
  assert.equal(noIdler.changes.teethIdler, 0);
  const rpm = parseModification("spin it at 3000 rpm", program);
  assert.equal(rpm.changes.inputRpm, 3000);

  const cabin = buildCabin({}).program!;
  const roof = parseModification("make the roof steeper", cabin);
  assert.equal(roof.changes.roofPitch, Number(cabin.params.roofPitch) + 10);
  const storey = parseModification("add another floor", cabin);
  assert.equal(storey.changes.storeys, Number(cabin.params.storeys) + 1);
  const nonsense = parseModification("make the gear bigger", cabin);
  assert.equal(Object.keys(nonsense.changes).length, 0, "a cabin has no gear to enlarge");
  assert.ok(nonsense.unsupported.length > 0, "and the mismatch is reported");
});

/* ----------------------------- geometry --------------------------------- */

test("alignY points a +Y cylinder along any direction", () => {
  // The reference is three.js's own XYZ composition, written out.
  const rotate = (euler: [number, number, number], v: [number, number, number]) => {
    const [x, y, z] = euler.map((d) => (d * Math.PI) / 180);
    const [c1, c2, c3] = [Math.cos(x), Math.cos(y), Math.cos(z)];
    const [s1, s2, s3] = [Math.sin(x), Math.sin(y), Math.sin(z)];
    const m = [
      [c2 * c3, -c2 * s3, s2],
      [c1 * s3 + s1 * s2 * c3, c1 * c3 - s1 * s2 * s3, -s1 * c2],
      [s1 * s3 - c1 * s2 * c3, s1 * c3 + c1 * s2 * s3, c1 * c2],
    ];
    return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
  };
  const directions: Array<[number, number, number]> = [
    [0, 1, 0],
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, -1],
    [0.3, 0.8, -0.5],
    [-0.7, 0.2, 0.66],
  ];
  for (const d of directions) {
    const len = Math.hypot(...d);
    const unit = d.map((n) => n / len) as [number, number, number];
    const got = rotate(alignY(d), [0, 1, 0]);
    for (let i = 0; i < 3; i += 1) {
      assert.ok(Math.abs(got[i] - unit[i]) < 1e-6, `${d.join(",")} → ${got.map((n) => n.toFixed(3)).join(",")} vs ${unit.join(",")}`);
    }
  }
});

test("water's two bonds are 104.5° apart", () => {
  const water = buildMolecule({ molecule: "water" }).program!;
  const o = water.parts.find((p) => p.id === "atom-O")!.position;
  const h1 = water.parts.find((p) => p.id === "atom-H1")!.position;
  const h2 = water.parts.find((p) => p.id === "atom-H2")!.position;
  const v1 = [h1[0] - o[0], h1[1] - o[1], h1[2] - o[2]];
  const v2 = [h2[0] - o[0], h2[1] - o[1], h2[2] - o[2]];
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const angle = (Math.acos(dot / (Math.hypot(...v1) * Math.hypot(...v2))) * 180) / Math.PI;
  assert.ok(Math.abs(angle - 104.5) < 0.5, `measured ${angle.toFixed(2)}°`);
  assert.equal(water.parts.filter((p) => p.layer === "bonds").length, 2);
});

/* --------------------------- three domains ------------------------------ */

test("three domains build, each with layers and steps of its own", () => {
  const programs: BuildProgram[] = [gearbox(), buildCabin({ storeys: 2 }).program!, buildMolecule({ molecule: "benzene" }).program!];
  assert.deepEqual([...new Set(programs.map((p) => p.domain))].sort(), ["architecture", "mechanical", "science"]);
  for (const program of programs) {
    assert.equal(program.kind, "build");
    assert.ok(program.parts.length >= 5, `${program.domain} has real parts`);
    assert.ok(program.layers.length >= 3, `${program.domain} has layers`);
    assert.ok(program.steps.length >= 3, `${program.domain} explains itself in steps`);
    assert.ok(program.derived.length >= 3, `${program.domain} reports its relationships`);
    assert.equal(program.scene.objects.length, program.parts.length, "the scene is the assembly, object for object");
    assert.ok(program.scene.objects.length <= 400, "within the renderer's object limit");
    for (const step of program.steps) for (const id of step.focus) assert.ok(program.parts.some((p) => p.id === id), `${step.id} points at a real part`);
  }
});

test("a build can carry the page it was informed by", () => {
  const program = buildGearbox({}).program!;
  program.sources = [{ url: "https://en.wikipedia.org/wiki/Gear_train", title: "Gear train", used: "ratio from teeth counts", basis: "verified" }];
  const spec = normalizeVisualSpec({ medium: "scene3d", program: { ...program.scene, build: program } }, program.title);
  assert.ok(spec.ok);
  const stored = (spec as { spec: { program: { build?: BuildProgram } } }).spec.program.build!;
  assert.equal(stored.sources?.length, 1, "the citation survives normalisation, so the card can show it");
  assert.equal(stored.sources?.[0].basis, "verified");
});

test("the build payload survives artifact normalisation", () => {
  const program = buildCabin({ bays: 2 }).program!;
  const spec = normalizeVisualSpec({ medium: "scene3d", program: { ...program.scene, build: program } }, program.title);
  assert.ok(spec.ok, spec.ok ? "" : spec.reason);
  const stored = (spec as { spec: { program: { build?: BuildProgram } } }).spec.program;
  assert.ok(stored.build, "the build is kept beside the object list");
  assert.equal(stored.build!.builder, "cabin");
  assert.equal(stored.build!.parts.length, program.parts.length);
});

/* ---------------------------- the registry ------------------------------ */

test("a request resolves to the builder that can make it", () => {
  assert.equal(findBuilder("a gear train for a winch")?.id, "gearbox");
  assert.equal(findBuilder("a two-storey cabin")?.id, "cabin");
  assert.equal(findBuilder("benzene ring")?.id, "molecule");
  assert.equal(findBuilder("a spaceship")?.id, undefined, "nothing is invented for an unknown subject");
  assert.equal(new Set(BUILDERS.map((b) => b.domain)).size, 3);
});

test("words compile to real tool calls, with parameters", () => {
  const gear = compileDirect("/build gearbox teethOut=36");
  assert.ok(gear);
  assert.equal(gear.steps[0].tool, "creative.build");
  assert.equal((gear.steps[0].args.params as Record<string, unknown>).teethOut, 36);

  const cabin = compileDirect("build a 2-storey cabin with 4 bays");
  assert.ok(cabin);
  assert.equal(cabin.steps[0].tool, "creative.build");
  assert.equal(cabin.steps[0].args.builder, "cabin");

  const change = compileDirect("make the output gear bigger");
  assert.ok(change);
  assert.equal(change.steps[0].tool, "creative.modify");

  const explain = compileDirect("/explain cooling");
  assert.ok(explain);
  assert.equal(explain.steps[0].tool, "creative.inspect");
  assert.equal(explain.steps[0].args.topic, "cooling");

  const molecule = compileDirect("model a methane molecule");
  assert.ok(molecule);
  assert.equal(molecule.steps[0].args.builder, "molecule");
});

test("storeys, bays and size are read from the sentence", () => {
  const plan = compileDirect("design a cabin with 2 storeys and 4 bays");
  const params = plan!.steps[0].args.params as Record<string, unknown>;
  assert.equal(params.storeys, 2);
  assert.equal(params.bays, 4);
  const sized = compileDirect("build a cabin 7 by 5 m, 3 storeys, 2 bays");
  const sizedParams = sized!.steps[0].args.params as Record<string, unknown>;
  assert.equal(sizedParams.width, 7);
  assert.equal(sizedParams.depth, 5);
  assert.equal(sizedParams.storeys, 3);
  assert.equal(sizedParams.bays, 2);
  const built = buildCabin(sizedParams);
  assert.ok(built.ok && built.program);
  assert.equal(built.program!.derived.find((d) => d.label === "Windows")?.value, "6", "3 storeys × 2 bays");
});

test("tooth counts are read from the sentence, not assumed", () => {
  for (const sentence of [
    "build a gear train with 16 driver teeth and 30 output teeth",
    "build a gearbox with a 16-tooth driver and a 30-tooth output",
    "build a gearbox — driver: 16 teeth, output: 30 teeth, 2000 rpm",
  ]) {
    const plan = compileDirect(sentence);
    assert.ok(plan, sentence);
    const params = plan.steps[0].args.params as Record<string, unknown>;
    assert.equal(params.teethIn, 16, `${sentence} → driver`);
    assert.equal(params.teethOut, 30, `${sentence} → output`);
  }
  const spin = compileDirect("build a gearbox — driver: 16 teeth, output: 30 teeth, 2000 rpm");
  assert.equal((spin!.steps[0].args.params as Record<string, unknown>).inputRpm, 2000);
});
