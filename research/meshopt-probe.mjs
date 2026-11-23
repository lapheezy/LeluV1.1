#!/usr/bin/env node
/**
 * LÉLU 2 — meshoptimizer probe
 *
 * Verifies that the acquired meshoptimizer JS/WASM build runs offline in this
 * workspace, and measures what simplification actually recovers on a controlled
 * mesh. Nothing here is attributed to the golden-ratio work: this is the
 * "ordinary mesh optimisation" baseline the report compares against.
 *
 *   node research/meshopt-probe.mjs [--glb artifacts/lelu2/…/x.glb]
 */
import { readFileSync } from "node:fs";

const { MeshoptSimplifier } = await import("./sources/meshoptimizer/js/meshopt_simplifier.js");
await MeshoptSimplifier.ready;

/** Sine-displaced grid: a known triangle count, a known shape. */
function grid(n) {
  const pos = [];
  const idx = [];
  for (let y = 0; y <= n; y++)
    for (let x = 0; x <= n; x++) pos.push(x / n, Math.sin(x * 0.45) * 0.08, y / n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const a = y * (n + 1) + x, b = a + 1, c = a + n + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

const t0 = performance.now();
const { positions, indices } = grid(48);
const target = Math.floor((indices.length * 0.5) / 3) * 3;

const t1 = performance.now();
// The second return value is the achieved relative error, not a count: the
// simplified index array is the result (meshoptimizer's own .d.ts).
const [simplified, resultError] = MeshoptSimplifier.simplify(indices, positions, 3, target, 0.01);
const t2 = performance.now();

const sourceCount = indices.length;
console.log(
  JSON.stringify(
    {
      supported: MeshoptSimplifier.supported,
      sourceTriangles: sourceCount / 3,
      simplifiedTriangles: simplified.length / 3,
      achievedRatio: Number((simplified.length / sourceCount).toFixed(4)),
      resultRelativeError: Number(resultError.toExponential(3)),
      targetRatio: 0.5,
      simplifyMs: Number((t2 - t1).toFixed(1)),
      bytesBefore: sourceCount * 4,
      bytesAfter: simplified.length * 4,
    },
    null,
    2,
  ),
);
console.log(`mesh built in ${(t1 - t0).toFixed(1)} ms`);

if (process.argv.includes("--glb")) {
  const path = process.argv[process.argv.indexOf("--glb") + 1];
  const bytes = readFileSync(path);
  console.log(`GLB ${path}: ${(bytes.length / 1e6).toFixed(2)} MB — meshoptimizer loaded beside it without touching it`);
}
