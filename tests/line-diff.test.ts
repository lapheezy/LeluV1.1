/**
 * ==========================================================
 * LÉLU — THE WORKSPACE DIFF SHOWS WHAT ACTUALLY CHANGED
 *
 * CATEGORY: unit. The real plugins/lineDiff.ts used by both engineer
 * adapters. Measured before (self-improvement run 11): edits at lines 60
 * and 590 of an 837-line file were reported "+531/-523", one block cut
 * off at 8,000 characters — her change could not be seen in it.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { lineChangeCounts, unifiedPatch } from "../plugins/lineDiff";

const file = Array.from({ length: 837 }, (_, i) => `line ${i + 1}`);

test("two small edits far apart are two small hunks, not one 500-line block", () => {
  const after = [...file];
  after[59] = "line 60 — edited";
  after.splice(590, 0, "inserted after 590", "and another");
  const before = file.join("\n");
  const next = after.join("\n");
  assert.deepEqual(lineChangeCounts(before, next), { added: 3, removed: 1 });
  const patch = unifiedPatch("src/x.tsx", before, next);
  const hunks = patch.split("\n").filter((line) => line.startsWith("@@"));
  assert.deepEqual(hunks, ["@@ -57,7 +57,7 @@", "@@ -588,6 +588,8 @@"]);
  assert.match(patch, /\n-line 60\n\+line 60 — edited\n/);
  assert.match(patch, /\n line 590\n\+inserted after 590\n\+and another\n line 591\n/);
  assert.ok(!patch.includes("truncated"));
});

test("additions, removals and identical files", () => {
  assert.deepEqual(lineChangeCounts("", "a\nb"), { added: 2, removed: 0 });
  assert.deepEqual(lineChangeCounts("a\nb\nc", ""), { added: 0, removed: 3 });
  assert.deepEqual(lineChangeCounts("a\nb\nc", "a\nb\nc"), { added: 0, removed: 0 });
  // A file cut down (the measured destruction case) shows every lost line.
  const long = Array.from({ length: 192 }, (_, i) => `t${i}`).join("\n");
  assert.deepEqual(lineChangeCounts(long, Array.from({ length: 57 }, (_, i) => `t${i}`).join("\n")), { added: 0, removed: 135 });
  assert.equal(unifiedPatch("a.ts", "", "x\ny"), "--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1,2 @@\n+x\n+y");
});

test("the hunks rebuild the new file from the old one", () => {
  // Apply the patch to `before` and check it yields `after` exactly.
  const before = file.slice(0, 200);
  const after = [...before];
  after.splice(10, 2);
  after[100] = "changed";
  after.push("tail");
  const patch = unifiedPatch("f", before.join("\n"), after.join("\n")).split("\n").slice(2);
  const result: string[] = [];
  let cursor = 0;
  for (const line of patch) {
    const header = /^@@ -(\d+),(\d+) /.exec(line);
    if (header) {
      const start = Number(header[2]) === 0 ? Number(header[1]) : Number(header[1]) - 1;
      while (cursor < start) result.push(before[cursor++]);
      continue;
    }
    if (line.startsWith(" ")) { result.push(line.slice(1)); cursor += 1; }
    else if (line.startsWith("-")) cursor += 1;
    else if (line.startsWith("+")) result.push(line.slice(1));
  }
  while (cursor < before.length) result.push(before[cursor++]);
  assert.deepEqual(result, after);
});
