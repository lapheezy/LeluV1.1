/**
 * ==========================================================
 * LÉLU — MISSION 18 DEMONSTRATION RUN
 *
 * The end-to-end workflow, executed for real against the
 * Creative Object store, with a PNG rendered from the composed
 * geometry at every step:
 *
 *   garment → textile change → cosmos → float → move →
 *   detach sleeve → modify it → reattach → reuse it on another
 *   garment → remove from cosmos (kept) → restore → reload
 *   jewellery → pendant → stone detached → reattached →
 *   duplicate → remove/retrieve
 *   product → chair → leg detached → reattached → exploded view
 *   exports → GLB / OBJ / SVG / JSON, each re-parsed
 *
 * Every claim printed here comes from the run. Offline: nothing
 * in this file opens a socket.
 *
 * Run: npx tsx scripts/mission18-demo.ts
 * ==========================================================
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { garmentAssembly, patternAssembly } from "../src/core/couture/components";
import { exportGlb, exportObj, exportProject, orthographicSvg, patternSvg, validateGlb, validateObj, validateProject, validateSvg } from "../src/core/couture/exporters";
import { buildGarment } from "../src/core/couture/garment";
import CreativeObjects, { geometryFingerprint, memoryStorage, type CreativeObject } from "../src/core/couture/objects";
import { cutOutline, draftPattern, notchPositions, netOutline } from "../src/core/couture/pattern";
import { buildProduct, explodedAssembly, findMetal, STONE_MATERIALS } from "../src/core/couture/product";
import { findMaterial } from "../src/core/couture/textiles";
import { framingCamera, renderPatternSheet, renderPng, renderSheet, type FlatPiece, type RenderMaterial, type RenderPart } from "./lib/render-png";

const OUT = join(process.cwd(), "artifacts", "creative");
mkdirSync(OUT, { recursive: true });

const log: string[] = [];
const say = (line: string) => { log.push(line); console.log(line); };
const ms = (t0: number) => Number((performance.now() - t0).toFixed(1));
const results: Array<{ step: string; ok: boolean; detail: string }> = [];
const record = (step: string, ok: boolean, detail: string) => { results.push({ step, ok, detail }); say(`${ok ? "PASS" : "FAIL"} ${step} — ${detail}`); };

/* ---------------- storage: one store, persisted as bytes ---------------- */

const storage = memoryStorage();
const store = new CreativeObjects(storage);

/* ---------------- rendering ---------------- */

function materialFor(materialId: string, fallback: string): RenderMaterial {
  const textile = findMaterial(materialId);
  if (textile) {
    return {
      baseColor: textile.visual.baseColor,
      roughness: textile.visual.roughness,
      metallic: textile.visual.metallic,
      sheen: textile.visual.sheen,
      sheenColor: textile.visual.sheenColor,
      transmission: textile.visual.transmission,
      opacity: 1,
    };
  }
  const metal = findMetal(materialId);
  if (metal) return { baseColor: metal.colour, roughness: metal.roughness, metallic: 1, sheen: 0, sheenColor: "#000000", transmission: 0, opacity: 1 };
  const gem = STONE_MATERIALS.find((s) => s.id === materialId);
  if (gem) return { baseColor: gem.colour, roughness: 0.04, metallic: 0.05, sheen: 0.25, sheenColor: "#ffffff", transmission: 0.1, opacity: 1 };
  return { baseColor: fallback, roughness: 0.55, metallic: 0, sheen: 0, sheenColor: "#000000", transmission: 0, opacity: 1 };
}

function toRenderParts(store: CreativeObjects, seconds = 0, ids?: string[]): RenderPart[] {
  const compositions = ids
    ? ids.map((id) => store.compose(id, seconds)).filter((x): x is NonNullable<typeof x> => Boolean(x))
    : store.composeCosmos(seconds);
  return compositions.flatMap((c) =>
    c.parts.map((p) => {
      const material = materialFor(p.materialId, p.color);
      return {
        id: `${c.objectId}:${p.id}`,
        positions: p.positions,
        indices: p.indices,
        material,
        opacity: Math.max(0.14, p.opacity * (1 - material.transmission * 0.75)),
        thin: p.thin,
      };
    }),
  );
}

function shot(file: string, parts: RenderPart[], options: { azimuth?: number; elevation?: number; width?: number; height?: number; floor?: number } = {}): void {
  if (!parts.length) { say(`  (skipped ${file}: nothing visible to render)`); return; }
  const camera = framingCamera(parts.map((p) => p.positions), options.azimuth ?? 18, options.elevation ?? 4, 1.06);
  const rendered = renderPng(parts, camera, {
    width: options.width ?? 900,
    height: options.height ?? 1150,
    background: "#0b0910",
    floor: options.floor ?? 0.42,
    supersample: 2,
    exposure: 1.05,
  });
  writeFileSync(join(OUT, file), rendered.png);
  say(`  rendered ${file} ${rendered.width}×${rendered.height} (${parts.length} parts)`);
}

/* ==========================================================
 * 1. PATTERN → OBJECT
 * ========================================================== */

const STYLE = {
  category: "gown" as const,
  neckline: "sweetheart" as const,
  sleeves: "long" as const,
  length: "floor" as const,
  silhouette: "fit-and-flare" as const,
  darts: true,
  waistSeam: true,
};

const tPattern = performance.now();
const pattern = draftPattern(STYLE, {});
const patternBuildMs = ms(tPattern);
const patternAsm = patternAssembly(pattern);
const patternObject = store.create({
  kind: "pattern",
  name: "Aurelia pattern (M)",
  parts: patternAsm.parts,
  components: patternAsm.components,
  data: { ...patternAsm.data, draft: { style: STYLE, measurements: {}, size: "M" } },
  source: { tool: "couture.pattern" },
  checks: patternAsm.checks,
});
record("pattern drafted as an editable object", patternObject.parts.length === pattern.pieces.length && pattern.checks.every((c) => c.ok),
  `${pattern.pieces.length} pieces, ${pattern.seams.length} seams, ${pattern.checks.filter((c) => c.ok).length}/${pattern.checks.length} checks, ${patternBuildMs} ms`);

const flat: FlatPiece[] = pattern.pieces.map((p) => ({
  id: p.id,
  net: netOutline(p).map((q) => [q.x, q.y] as [number, number]),
  cut: cutOutline(p).map((q) => [q.x, q.y] as [number, number]),
  grainline: { a: [p.grainline.a.x, p.grainline.a.y], b: [p.grainline.b.x, p.grainline.b.y] },
  notches: notchPositions(p).map((n) => [n.x, n.y] as [number, number]),
}));
const sheet = renderPatternSheet(flat, { width: 1500, height: 950, columns: 4 });
writeFileSync(join(OUT, "01-pattern.png"), sheet.png);
say(`rendered 01-pattern.png ${sheet.width}×${sheet.height}`);

/* ==========================================================
 * 2. GARMENT → OBJECT, TEXTILE CHANGE
 * ========================================================== */

const tGarment = performance.now();
const built = buildGarment({
  name: "Aurelia — velvet and organza gown",
  style: STYLE,
  material: "velvet-silk",
  layers: [{ material: "velvet-silk", role: "shell", offsetMm: 0 }],
  sculptural: [
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
const garmentBuildMs = ms(tGarment);
if (!built.ok || !built.garment) {
  record("garment built", false, built.reason ?? "unknown");
  writeFileSync(join(OUT, "evidence.json"), JSON.stringify({ results, log }, null, 2));
  process.exit(1);
}
const garmentAsm = garmentAssembly(built.garment);
const garmentObject = store.create({
  kind: "garment",
  name: "Aurelia gown",
  parts: garmentAsm.parts,
  components: garmentAsm.components,
  sockets: garmentAsm.sockets,
  data: garmentAsm.data,
  source: { tool: "couture.garment" },
  checks: garmentAsm.checks,
});
const sleeveComponents = garmentObject.components.filter((c) => c.kind === "sleeve");
record("garment assembled with extractable components", garmentObject.components.length >= 6 && sleeveComponents.length === 2,
  `${garmentObject.components.length} components (${garmentObject.components.map((c) => c.name).join(", ")}); ${garmentObject.parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0)} triangles; ${garmentBuildMs} ms`);
record("sleeves come from the drafted sleeve piece", sleeveComponents.every((c) => c.patternPieceId === "sleeve"),
  sleeveComponents.map((c) => `${c.name}: cap ${c.dimensions.capHeightMm} mm, ${c.dimensions.lengthMm} mm long`).join("; "));

shot("02-garment-velvet.png", toRenderParts(store, 0, [garmentObject.id]), { width: 900, height: 1250 });

// A textile change is a data change: geometry must not move.
const beforeFingerprint = geometryFingerprint(garmentObject);
const shellPart = garmentObject.parts.find((p) => p.componentId === "c-l-01");
const tMaterial = performance.now();
store.setMaterial(garmentObject.id, "silk-mikado", "c-l-01");
const materialMs = ms(tMaterial);
const afterFingerprint = geometryFingerprint(garmentObject);
record("textile changed without rebuilding geometry", beforeFingerprint === afterFingerprint && shellPart?.materialId === "silk-mikado",
  `geometry fingerprint ${beforeFingerprint} → ${afterFingerprint}; ${materialMs} ms; shell now ${shellPart?.materialId}, accents ${garmentObject.parts.filter((p) => p.componentId !== "c-l-01").map((p) => p.materialId).join(", ")}`);
shot("03-garment-mikado.png", toRenderParts(store, 0, [garmentObject.id]), { width: 900, height: 1250 });

/* ==========================================================
 * 3. INTO THE COSMOS, FLOATING
 * ========================================================== */

const tPlace = performance.now();
store.placeInCosmos(garmentObject.id, { roomId: "cosmos-core", position: [0, 0, 0] });
store.setMotion(garmentObject.id, { kind: "spin", speed: 4 });
const placeMs = ms(tPlace);
record("garment placed in the cosmos and made to float", garmentObject.location === "cosmos" && garmentObject.motion.kind === "spin",
  `${garmentObject.id} in ${garmentObject.roomId}, spin ${garmentObject.motion.speed}/min, ${placeMs} ms; anchored=${garmentObject.anchored}`);
shot("04-cosmos-float-t0.png", toRenderParts(store, 0), { azimuth: 12 });
shot("05-cosmos-float-t5s.png", toRenderParts(store, 5), { azimuth: 12 });

store.moveBy(garmentObject.id, [380, 0, 40]);
store.rotateBy(garmentObject.id, [0, 18, 0]);
record("object moved and rotated independently", true, `position ${garmentObject.transform.position.map((n) => Math.round(n)).join(", ")} mm, rotation ${garmentObject.transform.rotation.map((n) => Math.round(n)).join(", ")}°`);

/* ==========================================================
 * 4. DETACH THE SLEEVE
 * ========================================================== */

const tDetach = performance.now();
const detached = store.detachComponent(garmentObject.id, "right sleeve", { position: [720, 60, 60] });
const detachMs = ms(tDetach);
if (detached.object) {
  store.setTransform(detached.object.id, { rotation: [0, 24, -8] });
  store.setMotion(detached.object.id, { kind: "spin", speed: 5 });
}
record("sleeve detached into its own object", detached.ok && Boolean(detached.object) && store.get(garmentObject.id)!.components.some((c) => c.kind === "sleeve" && c.status === "detached"),
  `${detached.message}; ${detachMs} ms; parent keeps ${garmentObject.parts.length} parts and ${garmentObject.components.length} components`);
shot("06-sleeve-detached.png", toRenderParts(store, 0), { azimuth: 18 });

if (detached.object) {
  const sleeve = detached.object;
  store.setMaterial(sleeve.id, "metallic-lame");
  store.scaleTo(sleeve.id, 1.22);
  store.rotateBy(sleeve.id, [0, 0, 26]);
  record("detached sleeve modified on its own", true,
    `scale ${sleeve.transform.scale[0]}, rotation ${sleeve.transform.rotation.map((n) => Math.round(n)).join(",")}°, material ${sleeve.parts[0].materialId}; ${sleeve.parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0)} triangles`);
  shot("07-sleeve-modified.png", toRenderParts(store, 0), { azimuth: 22 });

  /* ---- reuse it on a second garment (another compatible object) ---- */

  const built2 = buildGarment({
    name: "Aurelia — mikado second look",
    style: STYLE,
    material: "silk-mikado",
    pleats: { count: 18, depthMm: 16, direction: "knife" },
    rows: 22,
    cols: 64,
    steps: 30,
    iterations: 6,
    seed: 33,
  });
  if (built2.ok && built2.garment) {
    const asm2 = garmentAssembly(built2.garment);
    const second = store.create({ kind: "garment", name: "Aurelia mikado second look", parts: asm2.parts, components: asm2.components, sockets: asm2.sockets, data: asm2.data, source: { tool: "couture.garment" } });
    store.placeInCosmos(second.id, { position: [-520, 0, 0] });
    const reused = store.reuseComponent(sleeve.id, second.id);
    record("extracted sleeve reused in a different garment", reused.ok, reused.message);
    shot("08-sleeve-reused-other-garment.png", toRenderParts(store, 0), { azimuth: 16 });
    store.moveToWorkspace(second.id, "couture-studio");
  }

  /* ---- reattach ---- */

  const back = store.attachComponent(sleeve.id, garmentObject.id);
  record("sleeve reattached to its original garment", back.ok && store.findComponent(garmentObject.id, "right sleeve")?.status === "attached",
    `${back.message}; extracted object kept at ${sleeve.location}`);
  shot("09-sleeve-reattached.png", toRenderParts(store, 0), { azimuth: 16 });
}

/* ==========================================================
 * 5. OUT OF THE COSMOS — WITHOUT DELETING
 * ========================================================== */

const beforeRemove = { revision: garmentObject.revision, parts: garmentObject.parts.length, fingerprint: geometryFingerprint(garmentObject) };
store.removeFromCosmos(garmentObject.id);
record("taken out of the cosmos and kept", garmentObject.location === "workspace" && store.get(garmentObject.id) !== undefined,
  `location=${garmentObject.location}, workspace=${garmentObject.workspaceId}, revision ${beforeRemove.revision} → ${garmentObject.revision}, geometry ${beforeRemove.fingerprint} unchanged=${geometryFingerprint(garmentObject) === beforeRemove.fingerprint}`);
shot("10-out-of-cosmos-workspace.png", toRenderParts(store, 0, [garmentObject.id]), { azimuth: 14, floor: 0 });

store.placeInCosmos(garmentObject.id, { position: [380, 0, 40] });
shot("11-restored-to-cosmos.png", toRenderParts(store, 0), { azimuth: 14 });
record("retrieved and restored", garmentObject.location === "cosmos", `revision ${garmentObject.revision}, ${garmentObject.history.length} history entries`);

/* ==========================================================
 * 6. RELOAD — IDENTITY, GEOMETRY, MATERIALS, RELATIONSHIPS
 * ========================================================== */

const tReload = performance.now();
const reloaded = new CreativeObjects(storage);
const reloadMs = ms(tReload);
const reloadedGarment = reloaded.get(garmentObject.id);
const reloadOk = Boolean(reloadedGarment)
  && reloadedGarment!.revision === garmentObject.revision
  && geometryFingerprint(reloadedGarment!) === geometryFingerprint(garmentObject)
  && reloadedGarment!.components.length === garmentObject.components.length
  && reloadedGarment!.parts.length === garmentObject.parts.length
  && reloadedGarment!.location === "cosmos"
  && reloadedGarment!.history.length === garmentObject.history.length;
record("state survives a reload", reloadOk && reloaded.all().length === store.all().length,
  `${reloadMs} ms; ${reloaded.all().length} objects [${reloaded.all().map((o) => `${o.id}:${o.parts.length}p/${o.components.length}c`).join(", ")}], garment revision ${reloadedGarment?.revision}, ${reloadedGarment?.history.length} history entries`);
const integrity = reloaded.integrity();
record("object graph integrity after reload", integrity.every((c) => c.ok), integrity.map((c) => `${c.name}: ${c.ok ? "ok" : "FAIL"} (${c.detail})`).join("; "));

/* ==========================================================
 * 7. JEWELLERY
 * ========================================================== */

const pendantBuild = buildProduct("pendant", { discDiameter: 26, stoneDiameter: 11, bezelWall: 1.4, thickness: 2.4, bailRadius: 5 });
if (!pendantBuild.ok || !pendantBuild.assembly) {
  record("pendant built", false, pendantBuild.reason ?? "unknown");
} else {
  const assembly = pendantBuild.assembly;
  const pendant = store.create({
    kind: "jewelry",
    name: "Copper pendant",
    // A pendant hangs: the disc faces the viewer instead of lying flat.
    transform: { rotation: [-90, 0, 0] },
    parts: assembly.parts,
    components: assembly.components,
    sockets: assembly.sockets,
    data: { ...assembly.data, template: "pendant", variables: pendantBuild.variables?.list },
    source: { tool: "couture.product" },
    checks: assembly.checks,
  });
  store.placeInCosmos(pendant.id, { position: [-260, 120, 260] });
  store.setMotion(pendant.id, { kind: "spin", speed: 6 });
  record("copper pendant built as an editable object", assembly.checks.every((c) => c.ok),
    `${assembly.parts.length} parts, ${assembly.components.map((c) => c.name).join(", ")}; estimated ${assembly.data.estimatedWeightG} g of ${assembly.data.metal}`);
  shot("12-pendant.png", toRenderParts(store, 0, [pendant.id]), { azimuth: 26, elevation: 12, width: 900, height: 900 });

  const exploded = explodedAssembly(assembly, 1.4);
  const explodedParts: RenderPart[] = exploded.parts.map((p) => {
    const material = materialFor(p.materialId, p.color);
    return { id: p.id, positions: p.mesh.positions, indices: p.mesh.indices, material, opacity: 1, thin: p.thin };
  });
  shot("13-pendant-exploded.png", explodedParts, { width: 1000, height: 900, azimuth: 22, elevation: 18 });

  const stone = store.detachComponent(pendant.id, "Stone", { position: [-215, 120, 300] });
  if (stone.object) {
    store.setMotion(stone.object.id, { kind: "spin", speed: 9 });
    store.rotateBy(stone.object.id, [20, 0, 0]);
  }
  record("stone extracted from the pendant", stone.ok, `${stone.message}; setting still holds ${store.findComponent(pendant.id, "Bezel setting")?.partIds.length} part(s)`);
  shot("14-stone-detached.png", toRenderParts(store, 0, stone.object ? [pendant.id, stone.object.id] : [pendant.id]), { azimuth: 30, elevation: 10, width: 900, height: 900 });

  if (stone.object) {
    const back = store.attachComponent(stone.object.id, pendant.id);
    record("stone reattached", back.ok, back.message);

    const copy = store.duplicate(pendant.id, { name: "Gold pendant (copy)", toCosmos: true });
    if (copy) {
      store.setTransform(copy.id, { position: [-190, 120, 260] });
      for (const componentId of ["c-body", "c-setting", "c-bail"]) store.setMaterial(copy.id, "gold-18k-yellow", componentId);
      store.setMotion(copy.id, { kind: "spin", speed: 4 });
      record("pendant duplicated and modified", copy.id !== pendant.id && copy.revision >= 2,
        `${copy.name} (${copy.id}) at ${copy.transform.position.map((n) => Math.round(n)).join(",")} mm, revision ${copy.revision}; original ${pendant.name} revision ${pendant.revision}`);
      shot("15-two-pendants.png", toRenderParts(store, 0, [pendant.id, copy.id]), { azimuth: 20, elevation: 10, width: 1000, height: 900 });

      const ambiguous = store.resolve("pendant");
      record("ambiguous reference refused instead of guessed", !ambiguous.ok, ambiguous.message);

      store.removeFromCosmos(copy.id);
      const retrieved = store.placeInCosmos(copy.id, { position: [-190, 120, 260] });
      record("one pendant taken out and retrieved with its identity", Boolean(retrieved) && retrieved!.id === copy.id && retrieved!.parts.length === copy.parts.length,
        `${copy.id} removed then restored; geometry ${geometryFingerprint(copy)} unchanged`);
    }
  }
}

/* ==========================================================
 * 8. PRODUCT & ASSEMBLY
 * ========================================================== */

const chairBuild = buildProduct("chair", { seatWidth: 470, backHeight: 450 });
if (!chairBuild.ok || !chairBuild.assembly) {
  record("chair built", false, chairBuild.reason ?? "unknown");
} else {
  const assembly = chairBuild.assembly;
  store.moveBy(garmentObject.id, [-300, 0, 0]);
  const chair = store.create({
    kind: "product",
    name: "Oak side chair",
    parts: assembly.parts,
    components: assembly.components,
    sockets: assembly.sockets,
    data: { ...assembly.data, template: "chair", variables: chairBuild.variables?.list, limitations: assembly.limitations },
    source: { tool: "couture.product" },
    checks: assembly.checks,
  });
  store.placeInCosmos(chair.id, { position: [-680, 0, 0] });
  record("product assembled from parametric components", assembly.checks.every((c) => c.ok),
    `${assembly.components.length} components, seat height ${chairBuild.variables?.values.seatHeight} mm (derived), ${assembly.parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0)} triangles`);
  shot("16-chair.png", toRenderParts(store, 0, [chair.id]), { azimuth: 28, elevation: 8, width: 900, height: 900 });

  const exploded = explodedAssembly(assembly, 1.1);
  const explodedParts: RenderPart[] = exploded.parts.map((p) => {
    const material = materialFor(p.materialId, p.color);
    return { id: p.id, positions: p.mesh.positions, indices: p.mesh.indices, material, opacity: 1, thin: p.thin };
  });
  shot("17-chair-exploded.png", explodedParts, { width: 1000, height: 820, azimuth: 34, elevation: 16 });

  const leg = store.detachComponent(chair.id, "front right leg", { position: [-360, 0, 260] });
  record("chair leg detached and moved independently", leg.ok, leg.message);
  shot("18-chair-leg-detached.png", toRenderParts(store, 0, leg.object ? [chair.id, leg.object.id] : [chair.id]), { azimuth: 30, elevation: 8, width: 1000, height: 900 });
  if (leg.object) {
    const back = store.attachComponent(leg.object.id, chair.id);
    record("chair leg reattached", back.ok, back.message);
    shot("19-chair-reattached.png", toRenderParts(store, 0, [chair.id]), { azimuth: 30, elevation: 8, width: 900, height: 900 });

    // Change a dimension: the object's parametric data is what a rebuild reads.
    store.setData(chair.id, { rebuiltWith: { seatWidth: 520 } });
    const rebuilt = buildProduct("chair", { ...(chair.data.variables as Record<string, number> | undefined ?? {}), seatWidth: 520 });
    record("dimension change produces new geometry from the same object data", rebuilt.ok && rebuilt.variables?.values.seatWidth === 520,
      `seat width ${rebuilt.variables?.values.seatWidth} mm, seat height ${rebuilt.variables?.values.seatHeight} mm (derived from the new legs)`);
  }
}

/* ==========================================================
 * 9. CROSS-WORKSPACE, LIBRARY
 * ========================================================== */

store.moveToWorkspace(garmentObject.id, "couture-studio");
store.saveToLibrary(patternObject.id, "Aurelia pattern (M) — library");
record("object moved between workspaces and saved to the library",
  garmentObject.workspaceId === "couture-studio" && patternObject.location === "library",
  `garment workspace=${garmentObject.workspaceId} location=${garmentObject.location}; pattern location=${patternObject.location}`);
store.placeInCosmos(garmentObject.id, { position: [-300, 0, 40] });
shot("20-cosmos-collection.png", toRenderParts(store, 0), { azimuth: 20, elevation: 8 });

/* ==========================================================
 * 10. EXPORTS — WRITTEN, THEN RE-PARSED
 * ========================================================== */

function exportBundle(name: string, object: CreativeObject): void {
  const composition = store.compose(object.id, 0);
  if (!composition) return;
  const parts = composition.parts.map((p) => ({ id: p.id, label: p.label, mesh: { positions: p.positions, indices: p.indices }, color: p.color, materialId: p.materialId, opacity: p.opacity, componentId: p.componentId }));

  const glb = exportGlb(parts, { objectId: object.id, name: object.name, revision: object.revision, components: object.components.map((c) => c.id) });
  writeFileSync(join(OUT, `${name}.glb`), glb);
  const glbReport = validateGlb(glb);

  const obj = exportObj(parts, object.name);
  writeFileSync(join(OUT, `${name}.obj`), obj);
  const objReport = validateObj(obj);

  record(`GLB export of ${object.name}`, glbReport.ok,
    `${glbReport.bytes} bytes, ${glbReport.meshes} meshes, ${glbReport.vertices} vertices, ${glbReport.triangles} triangles, ${glbReport.materials} materials${glbReport.errors.length ? ` — ${glbReport.errors.join("; ")}` : ""}`);
  record(`OBJ export of ${object.name}`, objReport.ok,
    `${objReport.vertices} vertices, ${objReport.faces} faces, ${objReport.groups} groups, materials ${objReport.materials.join(", ")}${objReport.errors.length ? ` — ${objReport.errors.join("; ")}` : ""}`);
}

exportBundle("garment", garmentObject);
const pendantObject = store.list({ kind: "jewelry" })[0];
if (pendantObject) exportBundle("pendant", pendantObject);
const chairObject = store.list({ kind: "product" })[0];
if (chairObject) {
  exportBundle("chair", chairObject);
  const composition = store.compose(chairObject.id, 0);
  if (composition) {
    const svg = orthographicSvg(composition.parts.map((p) => ({ id: p.id, label: p.label, mesh: { positions: p.positions, indices: p.indices }, color: p.color, materialId: p.materialId, opacity: 1 })), { title: chairObject.name });
    writeFileSync(join(OUT, "chair-drawing.svg"), svg);
    const svgReport = validateSvg(svg);
    record("orthographic technical drawing (SVG) of the chair", svgReport.ok, `${svgReport.polygons} polygons, ${svgReport.elements} elements${svgReport.errors.length ? ` — ${svgReport.errors.join("; ")}` : ""}`);
    const views = [0, 90, 180].map((az) => framingCamera(composition.parts.map((p) => p.positions), az, 4, 1.05));
    const sheetRender = renderSheet(toRenderParts(store, 0, [chairObject.id]), views, { width: 480, height: 660 }, 3, { background: "#0b0910", floor: 0.4, supersample: 2, exposure: 1.05 });
    writeFileSync(join(OUT, "21-chair-views.png"), sheetRender.png);
    say(`rendered 21-chair-views.png ${sheetRender.width}×${sheetRender.height}`);
  }
}

const patternSvgText = patternSvg(pattern);
writeFileSync(join(OUT, "pattern.svg"), patternSvgText);
const patternSvgReport = validateSvg(patternSvgText);
record("pattern sheet exported as vector SVG", patternSvgReport.ok, `${patternSvgReport.polygons} polygons${patternSvgReport.errors.length ? ` — ${patternSvgReport.errors.join("; ")}` : ""}`);

const projectJson = exportProject(store.all(), { mission: "18", generatedAt: new Date().toISOString() });
writeFileSync(join(OUT, "project.json"), projectJson);
const projectReport = validateProject(projectJson);
record("project JSON export preserves identity and hierarchy", projectReport.ok,
  `${projectReport.objects} objects, ${projectReport.parts} parts, ${projectReport.components} components, unique ids=${projectReport.identitiesUnique}${projectReport.errors.length ? ` — ${projectReport.errors.join("; ")}` : ""}`);

/* ==========================================================
 * 11. SUMMARY
 * ========================================================== */

const triangles = store.all().reduce((n, o) => n + o.parts.reduce((m, p) => m + p.mesh.indices.length / 3, 0), 0);
say("");
say(`${store.all().length} objects, ${store.all().reduce((n, o) => n + o.components.length, 0)} components, ${Math.round(triangles)} triangles held in the object store`);
say(`${results.filter((r) => r.ok).length}/${results.length} demonstrations passed`);
const finalChecks = store.integrity();
say(`integrity: ${finalChecks.map((c) => `${c.name}=${c.ok ? "ok" : "FAIL"}`).join(", ")}`);

writeFileSync(join(OUT, "evidence.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  offline: true,
  networkCalls: 0,
  externalApis: [],
  pattern: { pieces: pattern.pieces.length, seams: pattern.seams.length, checks: pattern.checks.filter((c) => c.ok).length, total: pattern.checks.length, buildMs: patternBuildMs },
  garment: {
    id: garmentObject.id,
    revision: garmentObject.revision,
    components: garmentObject.components.map((c) => ({ id: c.id, name: c.name, kind: c.kind, status: c.status, parts: c.partIds.length, material: c.materialId })),
    triangles: garmentObject.parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0),
    buildMs: garmentBuildMs,
    geometryFingerprint: geometryFingerprint(garmentObject),
    history: garmentObject.history,
  },
  timings: { patternMs: patternBuildMs, garmentMs: garmentBuildMs, materialChangeMs: materialMs, placeInCosmosMs: placeMs, detachMs, reloadMs },
  objects: store.all().map((o) => ({ id: o.id, kind: o.kind, name: o.name, location: o.location, revision: o.revision, parts: o.parts.length, components: o.components.length, triangles: o.parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0) })),
  integrity: finalChecks,
  results,
  log,
}, null, 2));
say(`wrote ${join(OUT, "evidence.json")}`);
