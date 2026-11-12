/**
 * ==========================================================
 * LÉLU — BUNDLE AUDIT
 *
 * measure-boot-graph.mjs answers "what must a cold boot fetch".
 * This answers the rest of Phase A: what the whole build is
 * made of, how it is split, and which packages dominate it.
 *
 * It reads the built output only — no source assumptions — so
 * the numbers are the ones a browser would actually receive.
 *
 * Usage:
 *   node scripts/audit-bundle.mjs [dist]
 *   node scripts/audit-bundle.mjs dist --top 25
 *   node scripts/audit-bundle.mjs dist --packages
 * ==========================================================
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--")) ?? "dist";
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : Number(args[i + 1] ?? fallback);
};

const assets = join(dir, "assets");
const files = readdirSync(assets)
  .filter((f) => f.endsWith(".js"))
  .map((f) => {
    const path = join(assets, f);
    const bytes = statSync(path).size;
    const source = readFileSync(path, "utf8");
    const imports = [...source.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)].map((m) => m[1]);
    const dynamic = [...source.matchAll(/import\("\.\/([^"]+\.js)"\)/g)].map((m) => m[1]);
    return { name: f, bytes, imports, dynamic, source };
  });

const total = files.reduce((n, f) => n + f.bytes, 0);
const sorted = [...files].sort((a, b) => b.bytes - a.bytes);

// ---- size distribution --------------------------------------------------

const buckets = [
  [0, 1024, "<1 KB"],
  [1024, 4096, "1–4 KB"],
  [4096, 16384, "4–16 KB"],
  [16384, 65536, "16–64 KB"],
  [65536, 262144, "64–256 KB"],
  [262144, Infinity, ">256 KB"],
];

console.log(`BUNDLE AUDIT — ${dir}`);
console.log(`  chunks                 ${files.length}`);
console.log(`  bytes                  ${(total / 1048576).toFixed(2)} MB`);
console.log(`  median chunk           ${(sorted[Math.floor(sorted.length / 2)].bytes / 1024).toFixed(1)} KB`);
console.log("");
console.log("  SIZE DISTRIBUTION");
for (const [lo, hi, label] of buckets) {
  const inBucket = files.filter((f) => f.bytes >= lo && f.bytes < hi);
  const bytes = inBucket.reduce((n, f) => n + f.bytes, 0);
  const bar = "█".repeat(Math.round((inBucket.length / files.length) * 40));
  console.log(
    `    ${label.padEnd(9)} ${String(inBucket.length).padStart(5)} chunks  ${(bytes / 1024).toFixed(0).padStart(7)} KB  ${bar}`,
  );
}

// ---- fan-in / fan-out ---------------------------------------------------

const importers = new Map();
for (const f of files) {
  for (const dep of f.imports) importers.set(dep, (importers.get(dep) ?? 0) + 1);
}

const top = flag("--top", 15);
console.log("");
console.log(`  LARGEST CHUNKS (top ${top})`);
for (const f of sorted.slice(0, top)) {
  console.log(
    `    ${(f.bytes / 1024).toFixed(0).padStart(6)} KB  ${String(f.imports.length).padStart(3)} static deps  ${f.name}`,
  );
}

const shared = [...importers.entries()]
  .map(([name, n]) => ({ name, n, bytes: files.find((f) => f.name === name)?.bytes ?? 0 }))
  .sort((a, b) => b.n - a.n)
  .slice(0, 10);
console.log("");
console.log("  MOST SHARED CHUNKS (static importers)");
for (const s of shared) {
  console.log(`    ${String(s.n).padStart(4)}×  ${(s.bytes / 1024).toFixed(0).padStart(6)} KB  ${s.name}`);
}

// ---- package attribution ------------------------------------------------

if (args.includes("--packages")) {
  /*
   * Minified chunks do not name their packages, but they keep string
   * literals: package paths in source maps are absent, so this attributes by
   * the distinctive identifiers each library leaves behind. It is an
   * approximation and is labelled as one.
   */
  const signatures = [
    ["three", /THREE\.|WebGLRenderer|BufferGeometry/],
    ["@react-three/fiber", /useFrame|CanvasImpl|react-three-fiber/],
    ["@react-three/drei", /drei|OrbitControls|Html/],
    ["react-dom", /react-dom|createRoot/],
    ["framer-motion", /framer-motion|motionValue/],
    ["lucide-react", /lucide/],
    ["@supabase/supabase-js", /supabase/],
    ["react-router", /react-router/],
    ["fflate", /fflate/],
  ];
  console.log("");
  console.log("  PACKAGE ATTRIBUTION (by identifier signature, approximate)");
  for (const [pkg, rx] of signatures) {
    const hits = files.filter((f) => rx.test(f.source));
    const bytes = hits.reduce((n, f) => n + f.bytes, 0);
    console.log(`    ${pkg.padEnd(22)} ${String(hits.length).padStart(4)} chunks  ${(bytes / 1024).toFixed(0).padStart(7)} KB`);
  }
}

// ---- dynamic boundaries -------------------------------------------------

const dynamicTargets = new Set(files.flatMap((f) => f.dynamic));
const staticReachable = new Set();
const queue = [files.find((f) => f.name.startsWith("index-"))?.name].filter(Boolean);
while (queue.length) {
  const name = queue.pop();
  if (staticReachable.has(name)) continue;
  staticReachable.add(name);
  const file = files.find((f) => f.name === name);
  for (const dep of file?.imports ?? []) if (!staticReachable.has(dep)) queue.push(dep);
}

console.log("");
console.log("  BOUNDARIES");
console.log(`    dynamic import targets ${dynamicTargets.size}`);
console.log(`    static-reachable       ${staticReachable.size}`);
console.log(`    never statically loaded ${files.length - staticReachable.size}`);
