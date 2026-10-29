#!/usr/bin/env node
/**
 * LÉLU — the production bundle must not contain test files.
 *
 * Scans the real build output (default: dist/) after `npm run build`.
 * Fails if any emitted file is named like a test chunk, or if any
 * emitted file carries test-file source (node:test imports or the raw
 * text of a file under tests/).
 *
 * Usage: node scripts/verify-no-tests-in-bundle.mjs [distDir]
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const dist = process.argv[2] ?? "dist";
if (!existsSync(dist)) {
  console.error(`FAIL: ${dist}/ does not exist — run \`npm run build\` first.`);
  process.exit(1);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const NAME = /\.test[-.][^/]*\.(js|mjs|cjs)$/;
const CONTENT = [/from\s*["']node:test["']/, /from\s*\\?["']\.\.\/tests\/support\//];

const offenders = [];
let scanned = 0;
for (const file of walk(dist)) {
  scanned++;
  const rel = relative(dist, file);
  if (NAME.test(rel)) { offenders.push(`${rel} (test-named chunk)`); continue; }
  if (!/\.(js|mjs|cjs)$/.test(rel)) continue;
  const text = readFileSync(file, "utf8");
  const hit = CONTENT.find((re) => re.test(text));
  if (hit) offenders.push(`${rel} (contains ${hit})`);
}

if (offenders.length > 0) {
  console.error(`FAIL: ${offenders.length} test artefact(s) in ${dist}/ (${scanned} files scanned):`);
  for (const o of offenders.slice(0, 20)) console.error(`  - ${o}`);
  if (offenders.length > 20) console.error(`  … and ${offenders.length - 20} more`);
  process.exit(1);
}
console.log(`PASS: no test files in ${dist}/ (${scanned} files scanned).`);
