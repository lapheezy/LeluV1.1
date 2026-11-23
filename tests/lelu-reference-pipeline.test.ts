/**
 * LÉLU's reference-anatomy pipeline: the guarantees the renders depend on.
 *
 * Needs the CC0 library (node scripts/asre/fetch-cc0.mjs plus the
 * makehuman mh-core checkout); skips when it is not installed.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { loopSubdivideOnce, edgeStats } from "../src/core/asre/reference/surface";
import { clipSurface, thicken } from "../src/core/asre/reference/garment";
import { sweep } from "../src/core/asre/reference/sweep";
import { writeGlb } from "../src/core/asre/gltf/GlbWriter";
import { inspectGlb } from "../src/core/forge/GlbInspector";

const HAVE_CC0 = existsSync("resources/cc0/makehuman/mh-core/makehuman/data/3dobjs/base.obj");

/* ---------------- building blocks: no assets needed ---------------- */

function octahedron() {
  const positions = new Float32Array([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]);
  const indices = new Uint32Array([0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5]);
  return { positions, indices };
}

test("Loop subdivision keeps a closed surface closed and quadruples it", () => {
  const o = octahedron();
  const r = loopSubdivideOnce(o.indices, [{ data: o.positions, stride: 3 }]);
  assert.equal(r.indices.length, o.indices.length * 4);
  const e = edgeStats(r.indices);
  assert.equal(e.boundary, 0);
  assert.equal(e.nonManifold, 0);
});

test("a cut sheet thickened with rolled hems is a closed 2-manifold", () => {
  const o = octahedron();
  const normals = o.positions.slice();
  // keep the upper half: one boundary loop around the equator
  const sheet = clipSurface(o.positions, normals, o.indices, (_x, y) => -y - 0.3);
  assert.ok(edgeStats(sheet.indices).boundary > 0);
  const solid = thicken(sheet.positions, sheet.indices, 0.05);
  const e = edgeStats(solid.indices);
  assert.equal(e.boundary, 0, "the hem must close every open edge");
  assert.equal(e.nonManifold, 0);
});

test("a swept strap is closed", () => {
  const m = sweep([[0, 0, 0], [0.1, 0, 0], [0.2, 0.05, 0]], { profile: "rect", width: 0.01, height: 0.002 });
  assert.deepEqual(edgeStats(m.indices).boundary, 0);
});

test("compact 16-bit vertex colours round-trip through the GLB inspector", () => {
  const o = octahedron();
  const colors = new Float32Array((o.positions.length / 3) * 4).fill(0.5);
  const glb = writeGlb([{ name: "o", mesh: { ...o, colors } }], { compactColors: true });
  const r = inspectGlb(glb) as unknown as { problems: string[] };
  assert.deepEqual(r.problems, []);
});

/* ---------------- her pipeline: needs the CC0 library ---------------- */

test("LÉLU: one closed skin, closed garments, full coverage, IoU 1", { skip: !HAVE_CC0 && "CC0 reference library not installed" }, async () => {
  const { loadReference } = await import("../scripts/asre/cc0-anatomy");
  const { leluCanon } = await import("../src/core/asre/character/leluIdentity");
  const { leluWardrobe, leluCurls, bodySurface, BODY_LABEL, faceLandmarks } = await import("../src/core/asre/reference/provider");
  const spec = leluCanon();
  loadReference({ height: spec.body.height, targets: spec.anatomy.targets, hairStyles: [spec.hair.style], eyes: true, teeth: true });

  // her skin, welded across regions, is closed
  const b = bodySurface(spec);
  assert.equal(edgeStats(b.indices).boundary, 0);
  assert.equal(edgeStats(b.indices).nonManifold, 0);

  // every garment is a closed solid and its occupancy is local
  const w = leluWardrobe(spec);
  for (const g of [w.top, w.bottom, w.shoes]) {
    assert.equal(edgeStats(g.mesh.indices).boundary, 0);
    assert.ok(g.f(g.lo[0] + 0.005, g.lo[1] + 0.005, g.lo[2] + 0.005) > 0, "a garment must not occupy its whole box");
  }

  // pelvis, crotch and seat are covered: every skin vertex there has cloth over it
  const pel = w.landmarks.crotchY as number;
  const cloth = [w.top, w.bottom];
  let n = 0, covered = 0;
  for (let t = 0; t < b.labels.length; t += 7) {
    if (b.labels[t] !== BODY_LABEL.pelvis && b.labels[t] !== BODY_LABEL.legs) continue;
    const v = b.indices[3 * t];
    const x = b.positions[3 * v], y = b.positions[3 * v + 1], z = b.positions[3 * v + 2];
    if (y < pel - 0.05 || y > pel + 0.2) continue;
    n++;
    for (let d = 0.0015; d < 0.12; d += 0.003) {
      const px = x + b.normals[3 * v] * d, py = y + b.normals[3 * v + 1] * d, pz = z + b.normals[3 * v + 2] * d;
      if (cloth.some((g) => g.f(px, py, pz) < 0)) {
        covered++;
        break;
      }
    }
  }
  assert.ok(n > 100);
  assert.equal(covered, n, `pelvis/crotch/seat: ${n - covered} of ${n} skin samples bare`);

  // hair is strands, long, and closed
  const c = leluCurls(spec)!;
  assert.ok(c.stats.meanLength > 0.35);
  assert.equal(edgeStats(c.mesh.indices).boundary, 0);

  // her lid margins were found on both eyes, and her lips below her nose
  const lm = faceLandmarks(spec);
  for (const e of lm.eyes) assert.ok(e.upper.length > 10 && e.lower.length > 10);
  assert.ok(lm.mouth[1] < lm.noseTip[1] - 0.015);
});

test("LÉLU: per-component occupancy equals the whole-object build", { skip: !HAVE_CC0 && "CC0 reference library not installed" }, async () => {
  const { loadReference } = await import("../scripts/asre/cc0-anatomy");
  const { leluCanon } = await import("../src/core/asre/character/leluIdentity");
  const { buildCharacter, buildWholeObject, codesIou, ComponentCache, DEFAULT_LATTICE, occupancyCodes } = await import("../src/core/asre/character/build");
  const spec = leluCanon();
  loadReference({ height: spec.body.height, targets: spec.anatomy.targets, hairStyles: [spec.hair.style], eyes: true, teeth: true });
  const parts = occupancyCodes(buildCharacter(spec, new ComponentCache(), DEFAULT_LATTICE), DEFAULT_LATTICE);
  const whole = buildWholeObject(spec, DEFAULT_LATTICE);
  assert.equal(codesIou(parts, whole.codes), 1);
});
