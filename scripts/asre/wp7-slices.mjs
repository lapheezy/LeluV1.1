#!/usr/bin/env node
/**
 * Mission 5 WP07 — draw the numerical record.
 *
 * The reconstruction's internal representation is per-cell evidence, so the
 * honest picture of it is the voxel plane itself: one canvas per axis, coloured
 * by evidence class (OBSERVED / INFERRED / GENERATED / INTERPOLATED), with
 * boundary cells marked. Rendered from /api/asre/jobs/<id>/slice output that
 * wp7-e2e.mjs already recorded — no new measurement, just a picture of it.
 *
 *   node scripts/asre/wp7-slices.mjs <slices.json> <outDir>
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [slicesFile, outDir] = process.argv.slice(2);
if (!slicesFile || !outDir) {
  console.error("usage: node scripts/asre/wp7-slices.mjs <02-slices.json> <outDir>");
  process.exit(2);
}
const slices = JSON.parse(readFileSync(slicesFile, "utf8"));
mkdirSync(outDir, { recursive: true });

const COLORS = {
  OBSERVED: "#34d399",
  INFERRED: "#60a5fa",
  GENERATED: "#f472b6",
  INTERPOLATED: "#fbbf24",
  UNKNOWN: "#475569",
};

const page = await chromium.launch().then((b) => b.newPage({ viewport: { width: 1600, height: 720 }, deviceScaleFactor: 2 }));
const written = [];
for (const [axis, slice] of Object.entries(slices)) {
  if (!slice || slice.error) continue;
  const w = slice.size[0];
  const h = slice.size[1];
  const cell = Math.max(2, Math.floor(560 / Math.max(w, h)));
  const html = `<!doctype html><html><body style="margin:0;background:#0b1020;font-family:ui-sans-serif,system-ui,sans-serif;color:#e2e8f0">
  <div style="padding:18px 22px">
    <div style="font-size:20px;font-weight:600">Numerical record — ${axis.toUpperCase()} plane ${slice.index}</div>
    <div style="font-size:13px;color:#94a3b8;margin-top:4px">${w}×${h} cells · depth ${slice.depth} · drawn at ${cell}px/cell</div>
    <canvas id="c" width="${w * cell}" height="${h * cell}" style="margin-top:14px;border:1px solid #1e293b;border-radius:6px"></canvas>
    <div style="margin-top:12px;font-size:13px">
      ${Object.entries(slice.counts ?? {})
        .map(([k, v]) => `<span style="margin-right:14px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${COLORS[k] ?? "#475569"};margin-right:5px"></span>${k} ${v}</span>`)
        .join("")}
      <span style="margin-left:10px;color:#94a3b8">bright edge = boundary cell</span>
    </div>
  </div>
  <script>
    const cells = ${JSON.stringify(slice.cells)};
    const colors = ${JSON.stringify(COLORS)};
    const cell = ${cell};
    const ctx = document.getElementById("c").getContext("2d");
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    for (const c of cells) {
      ctx.globalAlpha = c.boundary ? 1 : 0.32 + 0.6 * Math.max(0, Math.min(1, c.confidence ?? 0));
      ctx.fillStyle = colors[c.cls] ?? "#475569";
      ctx.fillRect(c.u * cell, c.v * cell, cell, cell);
      if (c.boundary) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(c.u * cell, c.v * cell, cell, Math.max(1, Math.floor(cell / 4)));
      }
    }
    ctx.globalAlpha = 1;
  </script></body></html>`;
  await page.setContent(html);
  const canvas = page.locator("#c");
  const file = path.join(outDir, `numerical-${axis}.png`);
  await canvas.screenshot({ path: file });
  written.push({ axis, file, cells: slice.cells.length, counts: slice.counts });
}
await page.context().browser()?.close();

// a small SVG version too, so the picture survives without the PNG
const svgParts = Object.entries(slices)
  .filter(([, s]) => s && !s.error)
  .map(([axis, s]) => {
    const w = s.size[0];
    const h = s.size[1];
    const r = (560 / Math.max(w, h)).toFixed(2);
    const rects = s.cells
      .map((c) => `<rect x="${(c.u * r).toFixed(1)}" y="${(c.v * r).toFixed(1)}" width="${r}" height="${r}" fill="${COLORS[c.cls] ?? "#475569"}" fill-opacity="${(c.boundary ? 1 : 0.32 + 0.6 * Math.max(0, Math.min(1, c.confidence ?? 0))).toFixed(2)}"/>`)
      .join("");
    return `<g transform="translate(0,0)"><text x="0" y="-6" fill="#94a3b8" font-size="12">${axis.toUpperCase()}</text>${rects}</g>`;
  })
  .join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="580" height="600" style="background:#0b1020">${svgParts}</svg>`;
writeFileSync(path.join(outDir, "numerical.svg"), svg);

console.log(JSON.stringify({ written, svg: path.join(outDir, "numerical.svg") }, null, 1));
