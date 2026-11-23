/** M15.3 WP04: which WebGL capabilities this browser exposes (parallel shader compile, renderer string). */
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
console.log(JSON.stringify(await p.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const i = gl.getExtension("WEBGL_debug_renderer_info");
  return { renderer: i ? gl.getParameter(i.UNMASKED_RENDERER_WEBGL) : null, parallel: Boolean(gl.getExtension("KHR_parallel_shader_compile")) };
})));
await b.close();
