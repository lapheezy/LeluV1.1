#!/usr/bin/env node
/**
 * Runtime facts for the engineering runtime's read-only "inspect" operation.
 *
 * WHY THIS EXISTS
 *
 * `inspect` was the command `node --version && bun --version && pwd`. The
 * engineering API refuses any command containing a shell metacharacter
 * (plugins/commandSafety.ts) — `&&` included — because the string it hands to
 * `shell: true` must be exactly one whitelisted operation. So the one
 * read-only, level-2 operation always failed with "Command refused: it
 * contains the shell metacharacter \"&\"", and the interface could not prove
 * the runtime could execute anything at all.
 *
 * The safety rule stays as strict as it was; the command obeys it instead.
 * One process prints the same facts, and every line is a real measurement.
 *
 *   node scripts/inspect-runtime.mjs
 */

import { execFileSync } from "node:child_process";

const lines = [`node ${process.version}`];

try {
  const bun = execFileSync("bun", ["--version"], {
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  lines.push(`bun ${bun || "(reported no version)"}`);
} catch {
  lines.push("bun (not available)");
}

lines.push(`cwd ${process.cwd()}`);
lines.push(`platform ${process.platform} ${process.arch}`);

console.log(lines.join("\n"));
