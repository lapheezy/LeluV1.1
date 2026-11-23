/**
 * LÉLU ASRE — NRE schema, Morton ordering, fusion and the .lnre container.
 * Pure numerical tests: no network, no model, no Blender.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import {
  SparseVoxelGrid,
  decodeGrid,
  encodeGrid,
  encodeGridV1,
  iou,
  mortonDecode,
  mortonEncode,
  noisyOr,
  NreFormatError,
  sha256Hex,
  type Observation,
  type Vec3,
} from "../src/core/asre/nre";

const spec = { resolution: 0.00625, origin: [0, 0, 0] as Vec3, dims: [64, 64, 64] as Vec3, coordinateSystem: "y-up-right-handed" as const };

function obs(id: string, confidence: number, provenance: Observation["provenance"] = "OBSERVED", fingerprint = `fp-${id}`): Observation {
  return { id, capturedAt: 1_700_000_000_000, source: "test", modality: "voxel-grid", provenance, confidence, parameters: { k: 1 }, fingerprint, lineage: [] };
}

/** Deterministic sparse scatter (LCG): exactly `n` distinct cells. */
function scatter(n: number, seed = 7, dim = 64): Vec3[] {
  const out = new Map<number, Vec3>();
  let s = seed;
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) >>> 16) % dim;
  while (out.size < n) {
    const c: Vec3 = [next(), next(), next()];
    out.set(mortonEncode(...c), c);
  }
  return [...out.values()];
}

test("morton: encode/decode is a bijection on the 16-bit lattice and orders Z-curve", () => {
  for (const c of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1023, 1024, 1025], [65535, 65535, 65535], [12345, 54321, 777]] as Vec3[]) {
    assert.deepEqual(mortonDecode(mortonEncode(...c)), c);
  }
  assert.equal(mortonEncode(1, 0, 0), 1);
  assert.equal(mortonEncode(0, 1, 0), 2);
  assert.equal(mortonEncode(0, 0, 1), 4);
  assert.equal(mortonEncode(1, 1, 1), 7);
  assert.equal(mortonEncode(2, 0, 0), 8);
  assert.ok(mortonEncode(65535, 65535, 65535) < Number.MAX_SAFE_INTEGER);
  assert.throws(() => mortonEncode(-1, 0, 0), RangeError);
  assert.throws(() => mortonEncode(65536, 0, 0), RangeError);
});

test("sha256 matches the standard test vectors", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex("a".repeat(1000)), "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
});

test("confidence fusion: 0.55 ⊕ 0.80 = 0.91 (noisy-OR)", () => {
  assert.equal(Number(noisyOr([0.55, 0.8]).toFixed(10)), 0.91);
  const g = new SparseVoxelGrid(spec);
  g.fuse(obs("a", 0.55), [[1, 2, 3]]);
  g.fuse(obs("b", 0.8), [[1, 2, 3]]);
  assert.equal(Number(g.get(1, 2, 3)!.confidence.toFixed(10)), 0.91);
});

test("repeated identical observations do not raise confidence", () => {
  const g = new SparseVoxelGrid(spec);
  const first = g.fuse(obs("a", 0.55), [[1, 1, 1]]);
  assert.equal(first.added, 1);
  // same evidence again, even under a new id: same fingerprint → refused
  const again = g.fuse(obs("a-again", 0.55, "OBSERVED", "fp-a"), [[1, 1, 1]]);
  assert.equal(again.duplicate, true);
  assert.equal(g.get(1, 1, 1)!.confidence, 0.55);
  assert.equal(g.getObservations().length, 1);
  // repeating the same observation index on a cell is a no-op too
  assert.equal(g.addEvidence(1, 1, 1, 0, 0.55), false);
  assert.equal(g.get(1, 1, 1)!.confidence, 0.55);
});

test("original observations remain unchanged during accumulation", () => {
  const g = new SparseVoxelGrid(spec);
  const o = obs("orig", 0.6);
  const snapshot = JSON.stringify(o);
  g.fuse(o, scatter(50));
  g.fuse(obs("other", 0.7), scatter(50, 99));
  assert.equal(JSON.stringify(o), snapshot);
  const stored = g.getObservations()[0];
  assert.ok(Object.isFrozen(stored));
  assert.throws(() => {
    (stored as { confidence: number }).confidence = 1;
  }, TypeError);
});

test("provenance classes stay distinguishable per cell", () => {
  const g = new SparseVoxelGrid(spec);
  g.fuse(obs("seen", 0.9, "OBSERVED"), [[0, 0, 0]]);
  g.fuse(obs("guess", 0.4, "SYNTHESIZED"), [[0, 0, 0], [5, 5, 5]]);
  assert.deepEqual(g.countByProvenance(), { OBSERVED: 1, INFERRED: 0, SYNTHESIZED: 2, INTERPOLATED: 0 });
  assert.equal(g.get(5, 5, 5)!.provenance, 4);
  assert.equal(g.get(0, 0, 0)!.provenance, 1 | 4);
});

test("sparse round-trip: 590/590 cells, IoU 1.0000, deterministic bytes", () => {
  const g = new SparseVoxelGrid(spec);
  const cells = scatter(590);
  g.fuse(obs("scan", 0.75), cells);
  g.fuse(obs("model", 0.5, "SYNTHESIZED"), cells.slice(0, 200).map(([x, y, z]) => ({ x, y, z, p: 0.123456789 })));
  assert.equal(g.size, 590);
  const bytes = encodeGrid(g);
  assert.deepEqual(encodeGrid(g), bytes, "same grid → same bytes");
  const { grid: back, migratedFrom } = decodeGrid(bytes);
  assert.equal(migratedFrom, null);
  assert.equal(back.size, 590);
  assert.equal(iou(g, back), 1);
  for (const [code, cell] of g.entries()) assert.deepEqual(back.getByCode(code), cell);
  assert.deepEqual(back.spec, g.spec);
  assert.deepEqual(back.getObservations(), g.getObservations());
  assert.deepEqual(encodeGrid(back), bytes, "decode → encode is byte-identical");
});

test("compressed container round-trips through a caller codec", () => {
  const codec = { name: "deflate-raw", compress: (b: Uint8Array) => new Uint8Array(deflateRawSync(b, { level: 9 })), decompress: (b: Uint8Array) => new Uint8Array(inflateRawSync(b)) };
  const g = new SparseVoxelGrid(spec);
  g.fuse(obs("scan", 0.75), scatter(590));
  const bytes = encodeGrid(g, { codec });
  assert.throws(() => decodeGrid(bytes), /codec/);
  assert.equal(iou(decodeGrid(bytes, { codecs: [codec] }).grid, g), 1);
});

test("corruption is detected and located", () => {
  const g = new SparseVoxelGrid(spec);
  g.fuse(obs("scan", 0.75), scatter(100));
  const bytes = encodeGrid(g);
  const flip = (at: number) => {
    const b = bytes.slice();
    b[at] ^= 0x40;
    return b;
  };
  const sectionOf = (b: Uint8Array) => {
    try {
      decodeGrid(b);
      return "none";
    } catch (e) {
      assert.ok(e instanceof NreFormatError);
      return e.section;
    }
  };
  assert.equal(sectionOf(flip(0)), "magic");
  assert.equal(sectionOf(flip(20)), "header");
  assert.equal(sectionOf(flip(bytes.length - 60)), "body");
  assert.equal(sectionOf(flip(bytes.length - 1)), "checksum");
  assert.equal(sectionOf(bytes.slice(0, bytes.length - 10)), "body");
});

test("schemaVersion 1 containers migrate safely to v2", () => {
  const g = new SparseVoxelGrid(spec);
  g.fuse(obs("seen", 0.55, "OBSERVED"), scatter(80));
  g.fuse(obs("seen2", 0.8, "OBSERVED"), scatter(80));
  g.fuse(obs("synth", 0.3, "SYNTHESIZED"), scatter(30, 3));
  const v1 = encodeGridV1(g);
  const { grid, migratedFrom, schemaVersion } = decodeGrid(v1);
  assert.equal(migratedFrom, 1);
  assert.equal(schemaVersion, 2);
  assert.equal(iou(grid, g), 1);
  for (const [code, cell] of g.entries()) {
    const m = grid.getByCode(code)!;
    assert.equal(m.confidence, cell.confidence);
    assert.equal(m.provenance, cell.provenance);
  }
  // and the migrated grid re-serializes as v2
  assert.equal(decodeGrid(encodeGrid(grid)).migratedFrom, null);
});

test("bounds, centroid and world coordinates are consistent", () => {
  const g = new SparseVoxelGrid({ ...spec, origin: [-0.2, 0, -0.2] });
  g.fuse(obs("a", 1), [[0, 0, 0], [9, 4, 1]]);
  assert.deepEqual(g.cellBounds(), { min: [0, 0, 0], max: [9, 4, 1] });
  const wb = g.worldBounds()!;
  assert.ok(Math.abs(wb.max[0] - (-0.2 + 10 * 0.00625)) < 1e-12);
  assert.deepEqual(g.worldToCell(g.worldCenter(9, 4, 1)), [9, 4, 1]);
  assert.deepEqual(g.centroid(), [4.5, 2, 0.5]);
});
