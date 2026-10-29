/**
 * LÉLU — TEST FILES STAY OUT OF THE PRODUCTION BUNDLE
 *
 * SourceAccess's build-time snapshot used to glob /tests/**, which
 * emitted every test file as a production chunk (74 of them). The
 * built-output check is scripts/verify-no-tests-in-bundle.mjs; this is
 * the fast source-level guard so the glob cannot quietly return.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

test("SourceAccess snapshot does not glob the tests/ directory", () => {
  const code = read("src/core/selfdev/SourceAccess.ts");
  const globs = [...code.matchAll(/import\.meta\.glob\(\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(globs.length > 0, "expected SourceAccess to still declare its snapshot globs");
  assert.ok(globs.includes("/src/**/*.ts"), "src/ must stay in the snapshot");
  for (const g of globs) {
    assert.ok(!g.startsWith("/tests"), `snapshot must not bundle tests: found ${g}`);
  }
});

test("no source file under src/ globs the tests/ directory into the bundle", async () => {
  const { execSync } = await import("node:child_process");
  let hits = "";
  try {
    hits = execSync(`grep -rnE 'import\\.meta\\.glob\\(\\s*"/tests' src/`, { cwd: ROOT, encoding: "utf8" });
  } catch {
    hits = ""; // grep exits 1 when nothing matches
  }
  assert.equal(hits.trim(), "", `test files would be bundled by: ${hits}`);
});

test("the built-output check is wired as an npm script", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["verify:bundle"], "node scripts/verify-no-tests-in-bundle.mjs");
});
