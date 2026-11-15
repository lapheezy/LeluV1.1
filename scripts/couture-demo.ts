/**
 * ==========================================================
 * LÉLU — COUTURE DEMONSTRATION RUN
 *
 * Builds the haute-couture garment, a five-textile comparison
 * and a cantilever drape test, renders each to PNG with the CPU
 * renderer, and writes the measured evidence beside them.
 *
 * Run: npx tsx scripts/couture-demo.ts
 * ==========================================================
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { drapeBenchmark } from "../src/core/couture/cloth";
import { buildGarment, garmentRenderParts, seamReport, type BuiltGarment } from "../src/core/couture/garment";
import { cutOutline, draftPattern, notchPositions, netOutline } from "../src/core/couture/pattern";
import { findMaterial, searchMaterials } from "../src/core/couture/textiles";
import { framingCamera, renderCells, renderPng, renderPatternSheet, renderSheet, type Camera, type FlatPiece, type RenderPart } from "./lib/render-png";

const OUT = join(process.cwd(), "artifacts", "couture");
mkdirSync(OUT, { recursive: true });

const log: string[] = [];
const say = (line: string) => { log.push(line); console.log(line); };

function toRenderParts(g: BuiltGarment, mannequin: boolean): RenderPart[] {
  return garmentRenderParts(g, { includeMannequin: mannequin }).map((p) => ({
    id: p.id,
    positions: p.mesh.positions,
    indices: p.mesh.indices,
    material: {
      baseColor: p.material.visual.baseColor,
      roughness: p.material.visual.roughness,
      metallic: p.material.visual.metallic,
      sheen: p.material.visual.sheen,
      sheenColor: p.material.visual.sheenColor,
      transmission: p.material.visual.transmission,
      opacity: 1,
    },
    opacity: p.id === "mannequin" ? 1 : Math.max(0.25, p.opacity * (1 - p.material.visual.transmission * 0.5)),
    thin: p.thin,
  }));
}

const allPositions = (parts: RenderPart[]) => parts.map((p) => p.positions);

const COUTURE_STYLE = {
  category: "gown" as const,
  neckline: "sweetheart" as const,
  sleeves: "none" as const,
  length: "floor" as const,
  silhouette: "fit-and-flare" as const,
  darts: true,
  waistSeam: true,
};

/* ---------------- pattern sheet ---------------- */

const pattern = draftPattern(COUTURE_STYLE, {});
const flat: FlatPiece[] = pattern.pieces.map((p) => ({
  id: p.id,
  net: netOutline(p).map((q) => [q.x, q.y] as [number, number]),
  cut: cutOutline(p).map((q) => [q.x, q.y] as [number, number]),
  grainline: { a: [p.grainline.a.x, p.grainline.a.y], b: [p.grainline.b.x, p.grainline.b.y] },
  notches: notchPositions(p).map((n) => [n.x, n.y] as [number, number]),
}));
const sheet = renderPatternSheet(flat, { width: 1500, height: 950, columns: 4 });
writeFileSync(join(OUT, "pattern-sheet.png"), sheet.png);
say(`pattern: ${pattern.pieces.length} pieces, ${pattern.seams.length} seams, ${pattern.checks.filter((c) => c.ok).length}/${pattern.checks.length} checks passed`);
for (const seam of seamReport(pattern)) say(`  seam ${seam.id}: ${seam.a} ↔ ${seam.b} (${seam.lengthA} / ${seam.lengthB} mm)`);

/* ---------------- demonstration A: haute couture ---------------- */

const couture = buildGarment({
  name: "Aurelia — sculpted velvet and organza gown",
  style: COUTURE_STYLE,
  material: "velvet-silk",
  // One cloth shell. A second all-over sheer layer was tried and hid the velvet
  // completely, so the organza is a skirt-only translucent shell instead.
  layers: [{ material: "velvet-silk", role: "shell", offsetMm: 0 }],
  sculptural: [
    { kind: "translucent-shell", material: "silk-organza", params: { zStartMm: -180, zEndMm: -900, spanDeg: 300, waves: 5, amplitudeMm: 26, offsetMm: 62 } },
    { kind: "rib-cage", material: "metallic-lame", params: { vertical: 1, count: 11, outwardMm: 5, zStartMm: 220, zEndMm: -140, tubeMm: 3.4, spanDeg: 236 } },
    { kind: "standing-collar", material: "silk-mikado", params: { heightMm: 66, flareMm: 18, gapDeg: 30 } },
    { kind: "modular-panels", material: "velvet-silk", params: { count: 8, flareMm: 150, gapDeg: 12, zStartMm: -320, zEndMm: -820, crownMm: 30 } },
  ],
  pleats: { count: 24, depthMm: 26, direction: "knife" },
  rows: 36,
  cols: 112,
  steps: 70,
  iterations: 10,
  seed: 21,
});

if (!couture.ok || !couture.garment) {
  say(`couture build FAILED: ${couture.reason}`);
  process.exit(1);
}
const g = couture.garment;
say(`garment A: ${g.name}`);
say(`  ${g.report.simulatedLayers} simulated layer(s), ${g.report.totalTriangles} triangles, ${g.report.totalMassG} g, ${g.report.simulationMs} ms solving`);
for (const layer of g.layers) {
  say(`  ${layer.id} ${layer.material.name}: ${layer.metrics ? `retention ${(layer.metrics.pleatRetention * 100).toFixed(0)}%, strain ${layer.metrics.maxStrainPct}%, residual ${layer.metrics.residualMm} mm, mass ${layer.massG} g, ${layer.note}` : layer.note}`);
}
for (const check of g.checks) say(`  ${check.ok ? "ok" : "CHECK FAILED"}: ${check.name} — ${check.detail}`);

const heroParts = toRenderParts(g, false);
const views: Array<{ name: string; az: number; el: number }> = [
  { name: "front", az: 0, el: 4 },
  { name: "three-quarter", az: 34, el: 6 },
  { name: "side", az: 90, el: 4 },
  { name: "back", az: 180, el: 4 },
];

const hero: Camera = framingCamera(allPositions(heroParts), 14, 5, 1.06);
const heroRender = renderPng(heroParts, hero, { width: 900, height: 1300, background: "#0b0910", floor: 0.42, supersample: 2, exposure: 1.05 });
writeFileSync(join(OUT, "couture-hero.png"), heroRender.png);
say(`rendered couture-hero.png ${heroRender.width}×${heroRender.height}`);

const viewCameras = views.map((v) => framingCamera(allPositions(heroParts), v.az, v.el, 1.04));
const viewsRender = renderSheet(heroParts, viewCameras, { width: 560, height: 820 }, 4, { background: "#0b0910", floor: 0.4, supersample: 2, exposure: 1.05 });
writeFileSync(join(OUT, "couture-views.png"), viewsRender.png);
say(`rendered couture-views.png ${viewsRender.width}×${viewsRender.height} (${views.map((v) => v.name).join(", ")})`);

/* ---------------- demonstration C: one garment, five textiles ---------------- */

const TEXTILES = ["silk-satin", "silk-organza", "technical-mesh", "leather-lambskin", "silk-chiffon"];
const comparison: Array<{ material: string; name: string; retention: number; strain: number; mass: number; residual: number; converged: boolean; parts: RenderPart[] }> = [];
for (const id of TEXTILES) {
  const built = buildGarment({
    name: `Textile study — ${id}`,
    style: COUTURE_STYLE,
    material: id,
    pleats: { count: 30, depthMm: 28, direction: "knife" },
    rows: 32,
    cols: 104,
    steps: 60,
    iterations: 10,
    seed: 21,
  });
  if (!built.ok || !built.garment) { say(`material ${id} failed: ${built.reason}`); continue; }
  const layer = built.garment.layers[0];
  comparison.push({
    material: id,
    name: layer.material.name,
    retention: layer.metrics?.pleatRetention ?? 1,
    strain: layer.metrics?.maxStrainPct ?? 0,
    mass: layer.massG,
    residual: layer.metrics?.residualMm ?? 0,
    converged: layer.metrics?.converged ?? false,
    parts: toRenderParts(built.garment, false),
  });
  say(`textile ${layer.material.name}: retention ${((layer.metrics?.pleatRetention ?? 1) * 100).toFixed(0)}%, strain ${layer.metrics?.maxStrainPct}%, residual ${layer.metrics?.residualMm} mm, mass ${layer.massG} g`);
}

if (comparison.length) {
  const cells = comparison.map((c) => ({ parts: c.parts, camera: framingCamera(allPositions(c.parts), 12, 4, 1.05) }));
  const sheetRender = renderCells(cells, { width: 400, height: 660 }, cells.length, { background: "#0b0910", floor: 0.4, supersample: 2, exposure: 1.05 });
  writeFileSync(join(OUT, "textile-study.png"), sheetRender.png);
  say(`rendered textile-study.png ${sheetRender.width}×${sheetRender.height} (${comparison.map((c) => c.name).join(" · ")})`);
}

/* ---------------- cantilever drape test ---------------- */

const drape = TEXTILES.map((id) => {
  const material = findMaterial(id);
  return material ? { id, material, result: drapeBenchmark(material, { lengthMm: 320, widthMm: 200, steps: 110 }) } : null;
}).filter((x): x is NonNullable<typeof x> => Boolean(x) && !("error" in x!.result));

const drapeCells = drape.map(({ material, result }) => {
  if ("error" in result) return null;
  const part: RenderPart = {
    id: `drape-${material.id}`,
    positions: result.mesh.positions,
    indices: result.mesh.indices,
    material: {
      baseColor: material.visual.baseColor,
      roughness: material.visual.roughness,
      metallic: material.visual.metallic,
      sheen: material.visual.sheen,
      sheenColor: material.visual.sheenColor,
      transmission: material.visual.transmission,
      opacity: 1,
    },
    opacity: Math.max(0.35, 1 - material.visual.transmission * 0.45),
    thin: true,
  };
  // Side-on: the strip's length runs across the frame and its droop is vertical,
  // which is the whole point of a cantilever test.
  return { parts: [part], camera: framingCamera([result.mesh.positions], 90, 6, 1.02) };
}).filter((x): x is NonNullable<typeof x> => Boolean(x));

if (drapeCells.length) {
  const rendered = renderCells(drapeCells, { width: 430, height: 330 }, drapeCells.length, { background: "#14131a", floor: 0.4, supersample: 2, exposure: 1.1 });
  writeFileSync(join(OUT, "drape-test.png"), rendered.png);
  for (const { material, result } of drape) {
    if ("error" in result) continue;
    say(`drape ${material.name}: tip fell ${result.tipDropMm} mm of 320 mm (rigidity ${result.rigidity}) — bending ${material.physical?.bendingStiffness} mN·cm`);
  }
  say(`rendered drape-test.png ${rendered.width}×${rendered.height}`);
}

/* ---------------- material library sample ---------------- */

const library = searchMaterials({ limit: 60 });
say(`textile library: ${library.length} materials (${[...new Set(library.map((m) => m.category))].join(", ")})`);

/* ---------------- evidence ---------------- */

const evidence = {
  generatedAt: new Date().toISOString(),
  offline: true,
  externalApisUsed: [],
  pattern: {
    id: pattern.id,
    size: pattern.size,
    pieces: pattern.pieces.map((p) => ({ id: p.id, areaCm2: Math.round(p.areaMm2 / 100), cut: p.cut, onFold: p.onFold, seamAllowanceMm: p.seamAllowance })),
    seams: seamReport(pattern),
    checks: pattern.checks,
    fabric: g.report.fabric,
  },
  couture: {
    id: g.id,
    name: g.name,
    triangles: g.report.totalTriangles,
    massG: g.report.totalMassG,
    simulationMs: g.report.simulationMs,
    layers: g.layers.map((l) => ({
      id: l.id, role: l.role, material: l.material.name, simulated: l.simulated,
      areaCm2: Math.round(l.areaMm2 / 100), massG: l.massG, metrics: l.metrics, note: l.note,
    })),
    sculptural: g.sculptural.map((s) => ({ id: s.id, kind: s.kind, material: s.material, triangles: s.triangles, note: s.note })),
    checks: g.checks,
    notes: g.report.notes,
  },
  textileStudy: comparison.map((c) => ({ material: c.material, name: c.name, pleatRetention: c.retention, maxStrainPct: c.strain, massG: c.mass, residualMm: c.residual, converged: c.converged })),
  drapeTest: drape.map(({ material, result }) => ({
    material: material.id,
    name: material.name,
    tipDropMm: "error" in result ? null : result.tipDropMm,
    rigidity: "error" in result ? null : result.rigidity,
    bendingStiffness: material.physical?.bendingStiffness ?? null,
    gsm: material.physical?.gsm ?? null,
  })),
  log,
};
writeFileSync(join(OUT, "evidence.json"), JSON.stringify(evidence, null, 2));
say(`wrote ${join(OUT, "evidence.json")}`);
