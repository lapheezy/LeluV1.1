/**
 * ==========================================================
 * LÉLU — BOOT GRAPH METER
 *
 * Answers one question with a number: how many JavaScript
 * requests must a cold boot complete before the app can render?
 *
 * It walks the STATIC import graph from the entry chunk, which is
 * exactly what a browser does before the first paint. Dynamic
 * imports (lazy panels) are deliberately NOT followed — those are
 * supposed to load when a panel opens, and a lazy import that the
 * static graph drags in is precisely the bug this measures.
 *
 * The preview proxy that fronts this workspace accepts a burst of
 * ~96 concurrent requests and answers the rest with 503 (measured:
 * 120 parallel fetches → 96×200, 24×503), so a boot graph of ~250
 * chunks does not merely start slowly: it cannot mount at all
 * there. On a phone it is the multi-second wait before anything
 * appears.
 *
 * Usage: node scripts/measure-boot-graph.mjs [dist-dir]
 * ==========================================================
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const dir = process.argv[2] ?? "dist";
const assets = join(dir, "assets");

function entryChunk() {
  const html = readFileSync(join(dir, "index.html"), "utf8");
  const match = html.match(/src="\/assets\/([^"]+\.js)"/) ?? html.match(/href="\/assets\/([^"]+\.js)"/);
  if (!match) throw new Error(`no entry chunk in ${dir}/index.html`);
  return match[1];
}

const STATIC_IMPORT = /(?:from|import)\s*"\.\/([^"]+\.js)"/g;

const seen = new Set();
const queue = [entryChunk()];
let bytes = 0;

while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const path = join(assets, file);
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    continue; // a chunk that does not exist is a missing file, counted separately
  }
  bytes += statSync(path).size;
  for (const [, dep] of source.matchAll(STATIC_IMPORT)) {
    if (!seen.has(dep)) queue.push(dep);
  }
}

const all = readdirSync(assets).filter((f) => f.endsWith(".js"));
const html = readFileSync(join(dir, "index.html"), "utf8");
const preloads = (html.match(/rel="modulepreload"/g) ?? []).length;

console.log(`BOOT GRAPH — ${dir}`);
console.log(`  entry chunk            ${entryChunk()}`);
console.log(`  modulepreload links    ${preloads}`);
console.log(`  chunks a cold boot     ${seen.size}`);
console.log(`  ...must fetch`);
console.log(`  bytes on the critical  ${(bytes / 1048576).toFixed(2)} MB`);
console.log(`  chunks emitted total   ${all.length}`);
console.log(`  entry is               ${((seen.size / Math.max(1, all.length)) * 100).toFixed(1)}% of the bundle at boot`);
console.log("");
console.log("  A lazy panel that appears in the boot graph is not lazy.");
