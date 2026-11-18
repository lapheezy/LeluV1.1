// Mission 5 WP07 — render a GLB from several cameras with the offline Blender toolchain.
//
//   node -e 'import("./scripts/asre/render.mjs").then(m=>m.renderViews({glb:"a.glb",outDir:"out"}))'
//
// Uses services/asre-reconstruct/blender_render.py (Cycles CPU, no display, no GPU).
// Blender is discovered the same way the server discovers it: LELU_BLENDER_BIN,
// or the setup.sh toolchain under LELU_TOOLS (default /opt/lelu-tools).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(ROOT, "services/asre-reconstruct/blender_render.py");

export function blenderBin() {
  if (process.env.LELU_BLENDER_BIN) return process.env.LELU_BLENDER_BIN;
  const tools = process.env.LELU_TOOLS || "/opt/lelu-tools";
  const candidate = path.join(tools, "blender-4.2.23-linux-x64", "blender");
  return existsSync(candidate) ? candidate : null;
}

function runBlender(jobFile, timeoutMs) {
  const bin = blenderBin();
  if (!bin) throw new Error("Blender is not available: set LELU_BLENDER_BIN or install the setup.sh toolchain");
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["--background", "--factory-startup", "--python", SCRIPT, "--", jobFile], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (d) => (log += d.toString()));
    child.stderr.on("data", (d) => (log += d.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(log);
      else reject(new Error(`Blender render failed (exit ${code})\n${log.slice(-1500)}`));
    });
  });
}

/**
 * Render `glb` from each requested camera.
 * Returns one report per view: { view, png, triangles, render_seconds, bounds }.
 */
export async function renderViews({
  glb,
  outDir,
  views = ["front", "side", "back", "three-quarter"],
  resolution = [512, 512],
  samples = 16,
  wireframe = false,
  prefix = "",
  background,
  /** Frame only these GLB node names (component close-ups). */
  focus,
  /** Explicit framing in Blender Z-up: { center: [x,y,z], radius } — identical cameras for before/after. */
  camera,
  /** Add a floor plane, for a readable silhouette and a contact shadow. */
  ground = false,
  /** Blender view transform: "Standard" | "AgX" | "Filmic". */
  viewTransform,
  /** "classes": shade by the material class in the vertex-colour alpha. */
  materials,
  /** OpenImageDenoise on the final image. */
  denoise = false,
  /** Wireframe edge width in pixels. */
  wirePx,
  /** Orthographic camera. */
  ortho = false,
  /** Components to leave out of the render. */
  hide,
  /** "studio" | "neutral" | "warm". */
  lighting,
  timeoutMs = 600_000,
}) {
  mkdirSync(outDir, { recursive: true });
  const reports = [];
  for (const view of views) {
    const stem = `${prefix}${view}${wireframe ? "-wireframe" : ""}`;
    const output = path.join(outDir, `${stem}.png`);
    const job = {
      inputs: [path.resolve(glb)],
      output,
      resolution,
      samples,
      view,
      wireframe,
      ...(background ? { background } : {}),
      ...(focus ? { focus } : {}),
      ...(camera ? { camera } : {}),
      ...(ground ? { ground: true } : {}),
      ...(viewTransform ? { view_transform: viewTransform } : {}),
      ...(materials ? { materials } : {}),
      ...(denoise ? { denoise: true } : {}),
      ...(wirePx ? { wire_px: wirePx } : {}),
      ...(ortho ? { ortho: true } : {}),
      ...(hide ? { hide } : {}),
      ...(lighting ? { lighting } : {}),
    };
    const jobFile = path.join(outDir, `${stem}.job.json`);
    writeFileSync(jobFile, JSON.stringify(job, null, 1));
    await runBlender(jobFile, timeoutMs);
    const report = JSON.parse(readFileSync(`${output}.json`, "utf8"));
    reports.push({ view, wireframe, png: output, ...report });
  }
  return reports;
}

/* CLI: node scripts/asre/render.mjs <glb> <outDir> [views,comma,separated] */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [glb, outDir, viewList] = process.argv.slice(2);
  if (!glb || !outDir) {
    console.error("usage: node scripts/asre/render.mjs <glb> <outDir> [front,side,back,three-quarter]");
    process.exit(2);
  }
  const views = viewList ? viewList.split(",") : undefined;
  renderViews({ glb, outDir, views })
    .then((r) => console.log(JSON.stringify(r.map((x) => ({ view: x.view, png: path.basename(x.png), triangles: x.triangles, seconds: x.render_seconds })), null, 1)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
