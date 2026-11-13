import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
const dir = process.argv[2] ?? "dist"; const assets = join(dir, "assets");
const html = readFileSync(join(dir, "index.html"), "utf8");
const entry = html.match(/src="\/assets\/([^"]+\.js)"/)[1];
const RE = /(?:from|import)\s*"\.\/([^"]+\.js)"/g;
const depth = new Map([[entry, 0]]); const q = [entry]; let raw = 0, gz = 0; const rows = [];
while (q.length) { const f = q.shift(); const src = readFileSync(join(assets, f), "utf8"); const s = statSync(join(assets,f)).size; const g = gzipSync(src).length; raw += s; gz += g; rows.push([s, g, depth.get(f), f]);
  for (const [, d] of src.matchAll(RE)) if (!depth.has(d)) { depth.set(d, depth.get(f) + 1); q.push(d); } }
rows.sort((a, b) => b[0] - a[0]);
console.log(`chunks ${rows.length} raw ${(raw/1024).toFixed(0)}KB gzip ${(gz/1024).toFixed(0)}KB maxDepth ${Math.max(...depth.values())}`);
for (const r of rows.slice(0, +(process.argv[3] ?? 25))) console.log(`${(r[0]/1024).toFixed(1).padStart(8)}KB ${(r[1]/1024).toFixed(1).padStart(7)}KBgz d${r[2]} ${r[3]}`);
