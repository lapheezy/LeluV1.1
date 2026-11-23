// LÉLU WP04 validation renders: head ortho front/side, head three-quarter,
// extreme face close-up, hairline close-up, full body front/side/back, under
// neutral and alternate (warm) lighting, hair as native curves.
//   node scripts/asre/lelu-validate.mjs <glb> <hair.lhc> <outDir> [--size 900] [--samples 48]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderViews } from "./render.mjs";

export const VALIDATION_SHOTS = [
  { name: "head-ortho-front", view: "front", camera: { center: [0, -0.05, 1.55], radius: 0.26 }, ortho: true },
  { name: "head-ortho-side", view: "side", camera: { center: [0, -0.05, 1.55], radius: 0.26 }, ortho: true },
  { name: "head-three-quarter", view: "three-quarter", camera: { center: [0, -0.05, 1.55], radius: 0.24 } },
  { name: "face-extreme", view: "front", camera: { center: [0, -0.13, 1.565], radius: 0.075 } },
  { name: "hairline", view: "front", camera: { center: [0, -0.11, 1.63], radius: 0.05 } },
  { name: "body-front", view: "front", camera: { center: [0, 0, 0.88], radius: 1.0 }, ground: true },
  { name: "body-side", view: "side", camera: { center: [0, 0, 0.88], radius: 1.0 }, ground: true },
  { name: "body-back", view: "back", camera: { center: [0, 0, 0.88], radius: 1.0 }, ground: true },
];

const [glb, hair, outDir] = process.argv.slice(2);
const opt = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const size = +opt("size", 900), samples = +opt("samples", 48);
mkdirSync(outDir, { recursive: true });
const out = [];
for (const lighting of ["neutral", "warm"])
  for (const s of VALIDATION_SHOTS) {
    const [r] = await renderViews({ glb, outDir, views: [s.view], prefix: `${lighting}--${s.name}--`, resolution: [size, size], samples, camera: s.camera, ortho: !!s.ortho, ground: !!s.ground, lighting, materials: "classes", denoise: true, viewTransform: "AgX", hairCurves: hair });
    out.push({ lighting, shot: s.name, png: path.basename(r.png), seconds: r.render_seconds, triangles: r.triangles, hair_curves: r.hair_curves });
    console.log(`${lighting.padEnd(8)} ${s.name.padEnd(20)} ${r.render_seconds}s`);
  }
writeFileSync(path.join(outDir, "validation.json"), JSON.stringify({ glb: path.basename(glb), hair: path.basename(hair), size, samples, renders: out }, null, 1));
