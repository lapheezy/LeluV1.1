#!/usr/bin/env node
/**
 * LÉLU — MISSION 5.8 — RENDER A SET OF GLBs FROM IDENTICAL CAMERAS
 *
 *   node scripts/asre/m58-render.mjs --dir artifacts/mission58/before --out artifacts/mission58/before
 *                                    [--views front,side,back,three-quarter] [--size 720] [--samples 48]
 *                                    [--closeups] [--wire] [--glb base]
 *
 * Every image is produced by the offline Blender toolchain (Cycles CPU) on the
 * GLB that was actually written, so the pixels come from the geometry, not
 * from a mock-up. Framing for the close-ups is taken from the FIRST run's
 * camera (or an explicit camera.json) so a before/after pair is shot from the
 * same position.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderViews } from "./render.mjs";

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const has = (n) => argv.includes(`--${n}`);
const DIR = path.resolve(flag("dir", "artifacts/mission58/before"));
const OUT = path.resolve(flag("out", DIR));
const SIZE = Number(flag("size", "720"));
const SAMPLES = Number(flag("samples", "48"));
const ONLY = flag("glb", null);
const WIRE = has("wire");
mkdirSync(OUT, { recursive: true });

const VIEWS = flag("views", "front,side,back,three-quarter").split(",");
const CLOSEUPS = has("closeups") || flag("closeups", null) !== null;
/** node names per close-up (the GLB has one node per component). */
const CLOSEUP_SETS = {
  face: ["head", "face", "hair"],
  hands: ["hands"],
  feet: ["feet"],
};

const glbs = readdirSync(DIR)
  .filter((f) => f.endsWith(".glb") && (!ONLY || f === ONLY))
  .sort();
if (!glbs.length) {
  console.error(`no GLB in ${DIR}`);
  process.exit(2);
}

/** Cameras, in Blender Z-up coordinates, derived once from the first GLB and reused. */
const cameraFile = path.join(DIR, "cameras.json");
let cameras = existsSync(cameraFile) ? JSON.parse(readFileSync(cameraFile, "utf8")) : null;

const report = [];
for (const glb of glbs) {
  const label = glb.replace(/\.glb$/, "");
  const prefix = `${label}${WIRE ? "-wire" : ""}-`;
  // Full body: let Blender frame the bounds (identical for every character).
  for (const view of VIEWS) {
    const [r] = await renderViews({
      glb: path.join(DIR, glb),
      outDir: OUT,
      views: [view],
      resolution: [SIZE, SIZE],
      samples: SAMPLES,
      wireframe: WIRE,
      prefix,
      ground: true,
      viewTransform: "AgX",
    });
    report.push({ label, kind: "full", view, png: path.basename(r.png), triangles: r.triangles, seconds: r.render_seconds, camera: r.camera_blender_zup });
    if (view === VIEWS[0] && !cameras) {
      // Derive the close-up cameras from this first full-body render.
      const b = r.bounds_blender_zup;
      const [lx, ly, lz] = b.min, [hx, hy, hz] = b.max;
      const h = hz - lz;
      const headZ = hz - h * 0.085;
      const handsZ = lz + h * 0.6;
      const feetZ = lz + h * 0.03;
      cameras = {
        face: { center: [0, 0, headZ], radius: h * 0.16 },
        hands: { center: [0, -0.02, handsZ], radius: h * 0.11 },
        feet: { center: [0, 0.03, feetZ], radius: h * 0.1 },
        full: { center: [(lx + hx) / 2, (ly + hy) / 2, (lz + hz) / 2], radius: Math.hypot(hx - lx, hy - ly, hz - lz) / 2 },
      };
      writeFileSync(cameraFile, JSON.stringify(cameras, null, 1));
    }
  }
  if (CLOSEUPS) {
    const wanted = (flag("closeup", "face,hands,feet") || "").split(",");
    for (const [name, objects] of Object.entries(CLOSEUP_SETS)) {
      if (!wanted.includes(name)) continue;
      for (const view of (flag("closeup-views", "front,side,three-quarter") || "").split(",")) {
        const [r] = await renderViews({
          glb: path.join(DIR, glb),
          outDir: OUT,
          views: [view],
          resolution: [SIZE, SIZE],
          samples: SAMPLES,
          prefix: `${prefix}${name}-`,
          ground: false,
          focus: objects,
          viewTransform: "AgX",
        });
        report.push({ label, kind: name, view, png: path.basename(r.png), triangles: r.triangles, seconds: r.render_seconds, focused: r.focused });
      }
    }
  }
  console.log(`${label}: ${report.filter((x) => x.label === label).length} renders`);
}

writeFileSync(path.join(OUT, WIRE ? "renders-wire.json" : CLOSEUPS ? "renders-closeups.json" : "renders.json"), JSON.stringify({ generatedAt: new Date().toISOString(), dir: DIR, size: SIZE, samples: SAMPLES, renders: report }, null, 1));
console.log(`\n${report.length} images -> ${path.relative(process.cwd(), OUT)}`);
