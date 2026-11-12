/**
 * ==========================================================
 * LÉLU — STATIC GRAPH MAPPER (source level)
 *
 * measure-boot-graph.mjs counts what the BUILT app fetches.
 * This answers the question that number cannot: WHICH source
 * modules are in that graph, who pulls each one in, and where
 * the cycles are.
 *
 * Rules, mirroring the bundler:
 *   - `import x from "y"`, `export … from "y"` and bare
 *     `import "y"` are STATIC edges and are followed.
 *   - `import type` / `export type` are erased at build time
 *     and are NOT edges.
 *   - `import("y")` is dynamic and is NOT followed. A module
 *     reachable only through dynamic imports is off the boot
 *     graph, which is exactly what Phase C/D want to prove.
 *
 * Usage:
 *   node scripts/map-static-graph.mjs                 # summary
 *   node scripts/map-static-graph.mjs --files 60      # biggest modules
 *   node scripts/map-static-graph.mjs --why <substr>  # chain to a module
 *   node scripts/map-static-graph.mjs --graph out.json
 * ==========================================================
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";

const ROOT = resolve(process.cwd());
const ENTRY = "src/main.tsx";

const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];
const ALIASES = [
  ["@/", "src/"],
  ["@core/", "src/core/"],
  ["@app/", "src/app/"],
];

/** Strip comments and strings so import-like text inside them is ignored. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, '""');
}

const STATIC_FROM =
  /(?:^|[\n;{}])\s*(?:import|export)\s+(?!type\b)(?:[\s\S]*?)\bfrom\s*["']([^"']+)["']/g;
const BARE_IMPORT = /(?:^|[\n;{}])\s*import\s*["']([^"']+)["']/g;

function specifiers(source) {
  const body = code(source);
  const found = new Set();
  for (const rx of [STATIC_FROM, BARE_IMPORT]) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(body))) found.add(m[1]);
  }
  return [...found];
}

function resolveSpecifier(from, spec) {
  let base;
  if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else {
    const alias = ALIASES.find(([prefix]) => spec.startsWith(prefix));
    if (!alias) {
      // bare package specifier — node_modules, not a source module
      return { external: spec };
    }
    base = resolve(ROOT, alias[1] + spec.slice(alias[0].length));
  }

  for (const ext of ["", ...EXTENSIONS]) {
    for (const candidate of [base + ext, resolve(base, "index" + ext)]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return { file: candidate };
    }
  }
  return { missing: spec };
}

// ---- walk ---------------------------------------------------------------

const files = new Map(); // abs path -> { bytes, imports: [abs], externals: Set, via: importer }
const externals = new Map(); // package -> bytes unknown, referenced-count
const queue = [resolve(ROOT, ENTRY)];
files.set(queue[0], { bytes: 0, imports: [], externals: new Set(), via: null });

while (queue.length) {
  const file = queue.pop();
  const record = files.get(file);
  const source = readFileSync(file, "utf8");
  record.bytes = Buffer.byteLength(source);

  for (const spec of specifiers(source)) {
    const result = resolveSpecifier(file, spec);
    if (result.external) {
      record.externals.add(result.external);
      externals.set(result.external, (externals.get(result.external) ?? 0) + 1);
      continue;
    }
    if (result.missing) continue;
    if (!files.has(result.file)) {
      files.set(result.file, { bytes: 0, imports: [], externals: new Set(), via: file });
      queue.push(result.file);
    }
    record.imports.push(result.file);
  }
}

// ---- cycles -------------------------------------------------------------

const cycles = [];
const state = new Map(); // 0 unvisited, 1 on stack, 2 done
const stack = [];

function dfs(file) {
  state.set(file, 1);
  stack.push(file);
  for (const dep of files.get(file)?.imports ?? []) {
    const seen = state.get(dep) ?? 0;
    if (seen === 1) {
      const from = stack.indexOf(dep);
      cycles.push(stack.slice(from).concat(dep));
    } else if (seen === 0) dfs(dep);
  }
  stack.pop();
  state.set(file, 2);
}

dfs(resolve(ROOT, ENTRY));

// ---- report -------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? true);
};

const rel = (abs) => relative(ROOT, abs).split(sep).join("/");
const fileList = [...files.entries()]
  .map(([abs, r]) => ({ path: rel(abs), abs, ...r }))
  .sort((a, b) => b.bytes - a.bytes);

const totalBytes = fileList.reduce((n, f) => n + f.bytes, 0);

if (flag("--graph")) {
  const out = {
    entry: ENTRY,
    files: Object.fromEntries(
      fileList.map((f) => [f.path, { bytes: f.bytes, via: f.via ? rel(f.via) : null }]),
    ),
    cycles,
  };
  const { writeFileSync } = await import("node:fs");
  writeFileSync(flag("--graph"), JSON.stringify(out, null, 2));
}

/**
 * Knockout ranking: for each module on the graph, how many bytes leave the
 * boot graph if it (and everything reachable only through it) stops being a
 * static import? That is the size of the prize for deferring it.
 */
if (flag("--impact")) {
  const entryAbs = resolve(ROOT, ENTRY);
  const reachableWithout = (cut) => {
    const seen = new Set([entryAbs]);
    const stack = [entryAbs];
    while (stack.length) {
      const file = stack.pop();
      for (const dep of files.get(file)?.imports ?? []) {
        if (dep === cut || seen.has(dep)) continue;
        seen.add(dep);
        stack.push(dep);
      }
    }
    return seen;
  };

  const results = fileList.map((f) => {
    const reachable = reachableWithout(f.abs);
    const freed = fileList.filter((g) => !reachable.has(g.abs));
    return {
      path: f.path,
      modules: freed.length,
      bytes: freed.reduce((n, g) => n + g.bytes, 0),
      sample: freed
        .filter((g) => g.path !== f.path)
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 4)
        .map((g) => g.path.replace(/^src\//, "").replace(/\.tsx?$/, "")),
    };
  });

  const limit = Number(flag("--impact")) || 20;
  console.log("DECOUPLING IMPACT — bytes freed if this module stops being static");
  for (const r of results.sort((a, b) => b.bytes - a.bytes).slice(0, limit)) {
    console.log(
      `  ${(r.bytes / 1024).toFixed(0).padStart(6)} KB  ${String(r.modules).padStart(4)} modules  ${r.path}`,
    );
    if (r.sample.length) console.log(`            frees: ${r.sample.join(", ")}`);
  }
  process.exit(0);
}

if (flag("--why")) {
  const needle = String(flag("--why"));
  const target = fileList.find((f) => f.path.includes(needle));
  if (!target) {
    console.log(`not on the boot graph: ${needle}`);
    process.exit(0);
  }
  const chain = [];
  let node = target.abs;
  const guard = new Set();
  while (node && !guard.has(node)) {
    guard.add(node);
    chain.unshift(rel(node));
    node = files.get(node)?.via;
  }
  console.log(`BOOT CHAIN → ${target.path} (${(target.bytes / 1024).toFixed(0)} KB)`);
  chain.forEach((p, i) => console.log(`${i === 0 ? "" : "  ".repeat(i) + "└ "}${p}`));
  console.log("");
  console.log("imported by:");
  const importers = fileList.filter((f) => f.imports.includes(target.abs));
  if (!importers.length) console.log("  (entry-adjacent)");
  for (const f of importers.sort((a, b) => b.bytes - a.bytes)) console.log(`  ${f.path}`);
  process.exit(0);
}

const byDir = new Map();
for (const f of fileList) {
  const dir = f.path.split("/").slice(0, 2).join("/");
  byDir.set(dir, (byDir.get(dir) ?? 0) + f.bytes);
}

console.log("STATIC BOOT GRAPH — source");
console.log(`  entry                  ${ENTRY}`);
console.log(`  source modules         ${fileList.length}`);
console.log(`  source bytes           ${(totalBytes / 1048576).toFixed(2)} MB`);
console.log(`  bare packages          ${externals.size}`);
console.log(`  import cycles          ${cycles.length}`);
console.log("");
console.log("  BY DIRECTORY (source bytes on the boot graph)");
for (const [dir, bytes] of [...byDir.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`    ${dir.padEnd(28)} ${(bytes / 1024).toFixed(0).padStart(6)} KB`);
}

const count = Number(flag("--files") ?? 30);
if (Number.isFinite(count) && !args.includes("--no-files")) {
  console.log("");
  console.log(`  BIGGEST BOOT MODULES (top ${count})`);
  for (const f of fileList.slice(0, count)) {
    console.log(`    ${(f.bytes / 1024).toFixed(0).padStart(6)} KB  ${f.path}`);
  }
}

if (!args.includes("--no-cycles") && cycles.length) {
  console.log("");
  console.log("  CYCLES (first 8)");
  for (const cycle of cycles.slice(0, 8)) {
    console.log(`    ${cycle.map(rel).join(" → ")}`);
  }
}

if (externals.size) {
  console.log("");
  console.log("  BARE PACKAGES BY REFERENCE COUNT");
  for (const [pkg, n] of [...externals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`    ${String(n).padStart(4)}×  ${pkg}`);
  }
}
