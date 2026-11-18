// LÉLU — fixed-camera evidence renders of one GLB.
//
//   node scripts/asre/lelu-render.mjs <glb> <outDir> [--set full|close|wire|all] [--size 800] [--samples 32]
//
// Every camera here is a NUMBER, not something the geometry decides, so the
// same shot can be taken of the "before" and the "after" GLB and compared
// pixel for pixel. Coordinates are Blender Z-up (glTF +Y up becomes +Z, glTF
// +Z front becomes −Y). Framing is taken from her reference joints (1.70 m,
// head joint at 1.547 m, pelvis 0.921 m, left hand at x 0.433 m).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderViews } from "./render.mjs";

export const LELU_SHOTS = {
  full: [
    { name: "full-front", view: "front", camera: { center: [0, 0, 0.88], radius: 1.0 }, ground: true },
    { name: "full-back", view: "back", camera: { center: [0, 0, 0.88], radius: 1.0 }, ground: true },
    { name: "full-side", view: "side", camera: { center: [0, 0, 0.88], radius: 1.0 }, ground: true },
    { name: "full-three-quarter", view: "three-quarter", camera: { center: [0, 0, 0.88], radius: 1.0 }, ground: true },
  ],
  close: [
    { name: "face-front", view: "front", camera: { center: [0, -0.03, 1.565], radius: 0.15 } },
    { name: "face-three-quarter", view: "three-quarter", camera: { center: [0, -0.03, 1.565], radius: 0.15 } },
    { name: "hair-back", view: "back", camera: { center: [0, 0, 1.40], radius: 0.40 } },
    { name: "hair-side", view: "side", camera: { center: [0, 0, 1.40], radius: 0.40 } },
    { name: "torso-front", view: "front", camera: { center: [0, 0, 1.17], radius: 0.36 } },
    { name: "torso-side", view: "side", camera: { center: [0, 0, 1.17], radius: 0.36 } },
    { name: "pelvis-front", view: "front", camera: { center: [0, 0, 0.88], radius: 0.30 } },
    { name: "pelvis-back", view: "back", camera: { center: [0, 0, 0.88], radius: 0.30 } },
    { name: "pelvis-side", view: "side", camera: { center: [0, 0, 0.88], radius: 0.30 } },
    { name: "legs-front", view: "front", camera: { center: [0, 0, 0.50], radius: 0.50 }, ground: true },
    { name: "hands-left", view: "front", camera: { center: [0.43, -0.12, 1.06], radius: 0.13 } },
    { name: "hands-left-three-quarter", view: "three-quarter", camera: { center: [0.43, -0.12, 1.06], radius: 0.13 } },
    { name: "feet-front", view: "front", camera: { center: [0, -0.05, 0.13], radius: 0.30 }, ground: true },
    { name: "feet-three-quarter", view: "three-quarter", camera: { center: [0, -0.05, 0.13], radius: 0.30 }, ground: true },
  ],
  wire: [
    { name: "full-front", view: "front", camera: { center: [0, 0, 0.88], radius: 1.0 }, wireframe: true },
    { name: "face-front", view: "front", camera: { center: [0, -0.03, 1.565], radius: 0.15 }, wireframe: true },
    { name: "pelvis-front", view: "front", camera: { center: [0, 0, 0.88], radius: 0.30 }, wireframe: true },
    { name: "hands-left", view: "front", camera: { center: [0.43, -0.12, 1.06], radius: 0.13 }, wireframe: true },
  ],
};

export async function renderLelu({ glb, outDir, set = "all", size = 800, samples = 32, prefix = "", materials = "classes", denoise = true }) {
  mkdirSync(outDir, { recursive: true });
  const sets = set === "all" ? ["full", "close", "wire"] : set.split(",");
  const out = [];
  for (const s of sets)
    for (const shot of LELU_SHOTS[s]) {
      const [r] = await renderViews({
        glb,
        outDir,
        views: [shot.view],
        prefix: `${prefix}${shot.name}--`,
        resolution: [size, size],
        samples,
        camera: shot.camera,
        ground: !!shot.ground,
        wireframe: !!shot.wireframe,
        viewTransform: "AgX",
        ...(materials && materials !== "none" ? { materials } : {}),
        denoise: denoise && !shot.wireframe,
      });
      out.push({ shot: shot.name, set: s, png: path.basename(r.png), triangles: r.triangles, seconds: r.render_seconds });
      console.log(`${s.padEnd(5)} ${shot.name.padEnd(26)} ${r.render_seconds}s`);
    }
  writeFileSync(path.join(outDir, `${prefix}renders.json`), JSON.stringify({ glb: path.basename(glb), size, samples, renders: out }, null, 1));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [glb, outDir] = process.argv.slice(2);
  const opt = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 ? process.argv[i + 1] : d;
  };
  if (!glb || !outDir) {
    console.error("usage: node scripts/asre/lelu-render.mjs <glb> <outDir> [--set full,close,wire|all] [--size 800] [--samples 32]");
    process.exit(2);
  }
  renderLelu({ glb, outDir, set: opt("set", "all"), size: +opt("size", 800), samples: +opt("samples", 32), prefix: opt("prefix", ""), materials: opt("materials", "classes"), denoise: opt("denoise", "1") !== "0" }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
