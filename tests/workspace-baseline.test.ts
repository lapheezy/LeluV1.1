/**
 * ==========================================================
 * LÉLU — A COPY'S CHANGES ARE HERS, NOT WHAT THE PROJECT GAINED SINCE
 *
 * CATEGORY: unit + integration. The pure rule (workspaceBaseline.ts), then
 * the real Node engineering adapter on a throwaway project directory:
 * copy, change the copy AND the real project, diff, apply.
 *
 * Measured in self-improvement runs 27–28: evidence files and fixes added
 * to the real project after her copy was made were listed as files she had
 * deleted or modified — JPEG bytes inlined into her context — and an apply
 * would have deleted them and reverted the fixes.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyChanges, isBinary } from "../plugins/workspaceBaseline";
import { createNodeEngineerAdapter } from "../plugins/nodeAdapters";

const map = (entries: Record<string, string>) => new Map(Object.entries(entries));

test("the rule: hers against the baseline; what only the real project did is not hers; both sides changed is flagged", () => {
  const baseline = map({ "a.ts": "1", "b.ts": "1", "gone.ts": "1", "shared.ts": "1" });
  const copy = map({ "a.ts": "2", "b.ts": "1", "new.ts": "9", "shared.ts": "3" });
  const real = map({ "a.ts": "1", "b.ts": "7", "gone.ts": "1", "shared.ts": "5", "evidence.jpg": "x" });
  assert.deepEqual(classifyChanges(copy, baseline, real), [
    { path: "a.ts", status: "modified", realChangedSince: false },
    { path: "gone.ts", status: "deleted", realChangedSince: false },
    { path: "new.ts", status: "added", realChangedSince: false },
    { path: "shared.ts", status: "modified", realChangedSince: true },
  ]);
  // b.ts changed only in the real project, evidence.jpg was only added there: neither is hers.
  // Without a baseline (an old copy) it is copy vs now, as before.
  assert.equal(classifyChanges(copy, null, real).find((c) => c.path === "evidence.jpg")?.status, "deleted");
  assert.equal(isBinary(new Uint8Array([0xff, 0xd8, 0x00, 0x10])), true);
  assert.equal(isBinary(new TextEncoder().encode("const x = 1;\n")), false);
});

test("the real adapter: diff lists only her edit, never inlines binary, and apply refuses to overwrite newer real work", async () => {
  const project = mkdtempSync(path.join(tmpdir(), "lelu-baseline-"));
  const cwd = process.cwd();
  try {
    mkdirSync(path.join(project, "src"), { recursive: true });
    writeFileSync(path.join(project, "src", "store.ts"), "export const EDGE = 12;\n");
    writeFileSync(path.join(project, "src", "other.ts"), "export const OTHER = 1;\n");
    process.chdir(project);
    const adapter = createNodeEngineerAdapter("test");
    await adapter.createWorkspace("ws");
    const copyRoot = path.join(project, ".lelu-sandbox", "ws");
    assert.ok(existsSync(path.join(copyRoot, ".lelu-baseline.json")), "the copy records what it was made from");

    // Her change, in the copy.
    writeFileSync(path.join(copyRoot, "src", "store.ts"), "export const EDGE = 48;\n");
    // Meanwhile the real project gains a binary evidence file and a fix elsewhere.
    mkdirSync(path.join(project, "docs"), { recursive: true });
    writeFileSync(path.join(project, "docs", "capture.jpg"), Buffer.from([0xff, 0xd8, 0x00, 0x01, 0x02]));
    writeFileSync(path.join(project, "src", "other.ts"), "export const OTHER = 2; // a later fix\n");

    const diff = await adapter.diffWorkspace("ws", true);
    assert.deepEqual(diff.map((c) => `${c.status} ${c.path}`), ["modified src/store.ts"], JSON.stringify(diff));
    assert.match(diff[0].patch ?? "", /-export const EDGE = 12;\n\+export const EDGE = 48;/);

    const applied = await adapter.applyWorkspace("ws", []);
    assert.deepEqual(applied, ["src/store.ts"]);
    assert.equal(readFileSync(path.join(project, "src", "store.ts"), "utf8"), "export const EDGE = 48;\n");
    assert.equal(readFileSync(path.join(project, "src", "other.ts"), "utf8"), "export const OTHER = 2; // a later fix\n", "the later fix survives");
    assert.ok(existsSync(path.join(project, "docs", "capture.jpg")), "the evidence file survives");

    // Both sides change the same file: refused, nothing written.
    writeFileSync(path.join(copyRoot, "src", "other.ts"), "export const OTHER = 3;\n");
    const conflicted = await adapter.diffWorkspace("ws", true);
    assert.equal(conflicted.find((c) => c.path === "src/other.ts")?.realChangedSince, true);
    await assert.rejects(adapter.applyWorkspace("ws", ["src/other.ts"]), /changed in the real project after this copy was made/);
    assert.equal(readFileSync(path.join(project, "src", "other.ts"), "utf8"), "export const OTHER = 2; // a later fix\n");

    // A binary file of hers is counted, never inlined.
    writeFileSync(path.join(copyRoot, "src", "icon.png"), Buffer.from([0x89, 0x50, 0x00, 0x47]));
    const withBinary = await adapter.diffWorkspace("ws", true);
    const icon = withBinary.find((c) => c.path === "src/icon.png");
    assert.equal(icon?.binary, true);
    assert.equal(icon?.patch, "(binary file — contents not shown)");
  } finally {
    process.chdir(cwd);
    rmSync(project, { recursive: true, force: true });
  }
});
