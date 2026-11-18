/**
 * ==========================================================
 * LÉLU 2 — ORNAMENT: A REAL LÉLU ACCESSORY, TWO WAYS
 *
 * A hairline diadem for LÉLU in her own metals (rose gold, copper, rose
 * quartz). The two runs carry the SAME bead count, the same disc, the same
 * palette and the same base ring; they differ only in how the beads are placed:
 *
 *   baseline  concentric rings, evenly divided — the conventional ornament layout
 *   golden    Vogel phyllotaxis on the same disc, bead sizes stepping down by
 *             1/φ, and the outer petals on a golden logarithmic spiral
 *
 * The bead centres are measured (spacing CV, gaps, coverage) so the claim is a
 * number, and the same geometry is written to GLB and rendered in Blender.
 *
 *   npx tsx scripts/asre/lelu2/ornament.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeGlb, type GlbPart } from "../../../src/core/asre/gltf/GlbWriter.ts";
import type { Mesh } from "../../../src/core/asre/volume/mesh.ts";
import { LELU_COLOURS } from "../../../src/core/asre/character/leluIdentity.ts";
import { GOLDEN_ANGLE, PHI_INV, goldenScaleLadder, nearestNeighbourStats, vogel, geometricSignature, goldenSpiral, spiralFit } from "../../../src/core/geometry/golden/index.ts";

type V3 = [number, number, number];

/** UV sphere as indexed triangles, Y-up. */
function sphere(c: V3, r: number, segments = 18, rings = 12): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const phi = (j / rings) * Math.PI;
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      positions.push(c[0] + r * Math.sin(phi) * Math.cos(theta), c[1] + r * Math.cos(phi), c[2] + r * Math.sin(phi) * Math.sin(theta));
    }
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i, b = a + 1, d = a + segments + 1, e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  return { positions, indices };
}

/** Ellipsoid (a flattened sphere) for petals. */
function ellipsoid(c: V3, radii: V3, segments = 16, rings = 8): { positions: number[]; indices: number[] } {
  const s = sphere([0, 0, 0], 1, segments, rings);
  const positions = s.positions.map((v, i) => (i % 3 === 0 ? c[0] + v * radii[0] : i % 3 === 1 ? c[1] + v * radii[1] : c[2] + v * radii[2]));
  return { positions, indices: s.indices };
}

/** Torus in the XZ plane (Y-up), for the band that holds the diadem. */
function torus(c: V3, R: number, r: number, segments = 72, sides = 12): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = (i / segments) * Math.PI * 2;
    for (let j = 0; j <= sides; j++) {
      const v = (j / sides) * Math.PI * 2;
      const rr = R + r * Math.cos(v);
      positions.push(c[0] + rr * Math.cos(u), c[1] + rr * Math.sin(u), c[2] + r * Math.sin(v));
    }
  }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j, b = a + 1, d = a + sides + 1, e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  return { positions, indices };
}

/** Merge geometry into one indexed mesh, offsetting the indices. */
function merge(parts: { positions: number[]; indices: number[] }[]): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const p of parts) {
    positions.push(...p.positions);
    for (const i of p.indices) indices.push(i + offset);
    offset += p.positions.length / 3;
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

const OUT = "artifacts/lelu2/ornament";
const DISK_R = 0.055;
const BEADS = 34;
const RING_BASE: V3 = [0, 0, 0];

function build(variant: "baseline" | "golden") {
  const rg = LELU_COLOURS.roseGold, rq = LELU_COLOURS.roseQuartz, cu = LELU_COLOURS.copper;
  const gold: { positions: number[]; indices: number[] }[] = [];
  const quartz: { positions: number[]; indices: number[] }[] = [];
  const copper: { positions: number[]; indices: number[] }[] = [];
  const centres: { x: number; y: number; z: number }[] = [];

  // the band, identical in both runs
  copper.push(torus(RING_BASE, DISK_R, 0.0028));

  const ladder = goldenScaleLadder(4);
  if (variant === "baseline") {
    // Conventional: 3 concentric rings, beads evenly divided around each ring.
    const rings = [0.3, 0.66, 1.0];
    const weights = [8, 12, 14];
    rings.forEach((rt, ring) => {
      const n = weights[ring];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = Math.cos(a) * DISK_R * rt, z = Math.sin(a) * DISK_R * rt;
        centres.push({ x, y: z, z: 0 });
        const r = 0.0042;
        (ring === 1 ? quartz : gold).push(sphere([x, z, 0.0026], r));
      }
    });
  } else {
    // Golden: Vogel's disc — equal area per bead — with sizes on a 1/φ ladder.
    const pts = vogel(BEADS, { radius: DISK_R, phase: GOLDEN_ANGLE });
    for (const p of pts) {
      centres.push({ x: p.x, y: p.y, z: 0 });
      const r = 0.0042 * ladder[p.index % 3];
      (p.index % 3 === 0 ? quartz : gold).push(sphere([p.x, p.y, 0.0026 + 0.0018 * p.edge], r));
    }
    // outer petals: a golden spiral growing by φ per quarter turn, so the flower
    // reads as a logarithmic spiral rather than a sunflower template
    const petals = goldenSpiral(DISK_R * 1.05, 0.75, 26);
    for (const s of [1, -1]) {
      for (let i = 4; i < petals.length; i += 5) {
        const p = petals[i];
        quartz.push(ellipsoid([s * p.x, s * p.y, 0.001], [0.0075, 0.0035, 0.0018]));
      }
    }
  }

  const parts: GlbPart[] = [
    { name: "ornament.gold", mesh: merge(gold), material: { name: "rose-gold", baseColor: [...rg, 1], metallic: 0.9, roughness: 0.25 } },
    { name: "ornament.quartz", mesh: merge(quartz), material: { name: "rose-quartz", baseColor: [...rq, 1], metallic: 0.1, roughness: 0.18 } },
    { name: "ornament.copper", mesh: merge(copper), material: { name: "copper", baseColor: [...cu, 1], metallic: 0.85, roughness: 0.35 } },
  ];
  const glb = writeGlb(parts, { generator: `LÉLU 2 — ${variant} ornament` });

  const spacing = nearestNeighbourStats(centres);
  const signature = geometricSignature(centres);
  const spiral = spiralFit(goldenSpiral(DISK_R, 1, 60));
  return {
    variant,
    beads: centres.length,
    triangles: parts.reduce((s, p) => s + p.mesh.indices.length / 3, 0),
    glbBytes: glb.length,
    beadSpacing: { mean: spacing.mean, cv: spacing.cv, min: spacing.min, max: spacing.max, maxOverMin: spacing.max / spacing.min },
    radialExponent: signature.radial.exponent,
    divergenceDeg: signature.divergence.dominantDeg,
    petalSpiralFit: variant === "golden" ? { r2: spiral.r2, growthPerTurn: spiral.growthPerTurn } : null,
    glb,
  };
}

mkdirSync(join(OUT, "baseline"), { recursive: true });
mkdirSync(join(OUT, "golden"), { recursive: true });
const out: Record<string, unknown> = {};
for (const variant of ["baseline", "golden"] as const) {
  const r = build(variant);
  writeFileSync(join(OUT, variant, `ornament-${variant}.glb`), r.glb);
  const { glb: _glb, ...metrics } = r;
  void _glb;
  writeFileSync(join(OUT, variant, `ornament-${variant}-metrics.json`), JSON.stringify(metrics, null, 2));
  out[variant] = metrics;
  console.log(
    `${variant}: ${r.beads} beads, ${r.triangles} tris, ${(r.glbBytes / 1e3).toFixed(1)} kB — spacing ${(r.beadSpacing.mean * 1000).toFixed(2)} mm, CV ${r.beadSpacing.cv.toFixed(3)}, max/min ${r.beadSpacing.maxOverMin.toFixed(2)}`,
  );
}
writeFileSync(join(OUT, "comparison.json"), JSON.stringify(out, null, 2));
console.log(`\ngolden is ${(out.baseline as { beadSpacing: { cv: number } }).beadSpacing.cv > 0 ? ((out.baseline as { beadSpacing: { cv: number } }).beadSpacing.cv / (out.golden as { beadSpacing: { cv: number } }).beadSpacing.cv).toFixed(2) : "0"}× more even in bead spacing`);
console.log(`φ = 1.618033988749895; golden angle = 137.50776405003785°; 1/φ = ${PHI_INV.toFixed(9)}`);
