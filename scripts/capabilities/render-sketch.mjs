/** Render the drawing LÉLU's direct sketch makes for a request, through her real drawing export. node scripts/capabilities/render-sketch.mjs "<request>" <out.png> */
import { writeFile } from "node:fs/promises";
import { launch } from "../evolution/harness.mjs";
const [request, out] = process.argv.slice(2);
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
await p.goto("http://127.0.0.1:5173/world-lab.html", { waitUntil: "load" });
const b64 = await p.evaluate(async (request) => {
  const { compileDirect } = await import("/src/core/creative/kit/DirectCompiler.ts");
  const plan = compileDirect(request);
  const step = plan.steps.find((s) => s.tool === "studio.create");
  const { exportDrawing } = await import("/src/core/creative/kit/VisualArtifacts.ts");
  const file = await exportDrawing({ kind: "drawing", title: step.args.title, scene: step.args.scene }, "png");
  let bin = ""; file.bytes.forEach((x) => (bin += String.fromCharCode(x)));
  return btoa(bin);
}, request);
await writeFile(out, Buffer.from(b64, "base64"));
await b.close();
