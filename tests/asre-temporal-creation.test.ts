/**
 * Mission 5 WP05 — temporal creation: every edit is a traceable operation
 * with a parent, snapshots are immutable, undo/redo/branch/restore work, and
 * the temporal engine (SnapshotStore) holds the character's history with
 * replay-verified diffs. Runs the mission's own example:
 *
 *   1 base → 2 hairstyle → 3 clothing → 4 body proportions
 *   → 5 restore the ORIGINAL hairstyle → 6 compare → 7 export the selection
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { AsreCharacterStore } from "../plugins/asreCharacters";
import { AsreForge } from "../plugins/asreForge";
import { ForgeStore } from "../plugins/forgeStore";
import { AsreJobManager, pngBytes, type AsreRuntime } from "../plugins/asreJobs";
import { inspectGlb } from "../src/core/forge/GlbInspector";

test("the mission's example: base → hair → clothing → body → restore hair → compare → export; history immutable", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "asre-t-")), forgeRoot = mkdtempSync(path.join(tmpdir(), "forge-"));
  try {
    const forge = new AsreForge(new ForgeStore(forgeRoot));
    const s = new AsreCharacterStore({ root, forge });
    const v1 = await s.create({ id: "mira", name: "Mira" });
    const v2 = await s.edit("mira", { hair: { style: "high-ponytail" }, materials: { hair: [0.55, 0.12, 0.08] } });
    const v3 = await s.edit("mira", { clothing: { top: "jacket", bottom: "skirt" } });
    const v4 = await s.edit("mira", { body: { height: 1.8, shoulderWidth: 0.44 } });
    // fingerprints of every file of v1..v4 before anything else happens
    const files = (v: string) => ["json", "glb"].map((e) => path.join(root, "characters", "mira", "versions", `${v}.${e}`));
    const before = new Map([v1, v2, v3, v4].flatMap((v) => files(v.id)).map((f) => [f, { bytes: readFileSync(f), mtime: statSync(f).mtimeMs }]));

    // 5: restore ONLY the hairstyle of v1 onto the current head
    const v5 = await s.restore("mira", v1.id, ["hair"]);
    assert.equal(v5.parentId, v4.id);
    assert.deepEqual(v5.spec.hair, v1.spec.hair);
    assert.deepEqual(v5.spec.materials.hair, v1.spec.materials.hair);
    assert.deepEqual(v5.spec.clothing, v4.spec.clothing, "clothing kept from the head");
    assert.deepEqual(v5.spec.body, v4.spec.body, "body kept from the head");
    assert.deepEqual(v5.build.regenerated, [], "the original hair geometry is reused from the cache, not rebuilt");
    assert.equal(v5.components.hair.key, v1.components.hair.key, "the restored hair is the original hair (same content key)");
    assert.equal(v5.components.hair.shapeSha, v1.components.hair.shapeSha, "byte-identical shape");
    assert.notEqual(v5.components.hair.geometrySha, v1.components.hair.geometrySha, "…placed on v4's taller head");
    assert.equal(v5.components.face.key, v1.components.face.key, "brows follow the hair colour back to v1's");
    assert.ok(v5.build.reused.includes("face") && v5.build.reused.includes("hair"), "v1's face and hair come straight from the cache");

    // 6: compare
    const c51 = await s.compare("mira", v1.id, v5.id);
    const by = Object.fromEntries(c51.components.map((d) => [d.id, d.change]));
    assert.equal(by.hair, "moved", "same hair shape, on a head that moved with the taller body");
    assert.equal(by.face, "moved");
    assert.equal(by.torso, "geometry");
    assert.equal(by["clothing.top"], "geometry");
    assert.ok(c51.specChanges.includes("body.height") && !c51.specChanges.some((p) => p.startsWith("hair")));
    assert.ok(c51.geometry.iou > 0.3 && c51.geometry.iou < 1);
    const c45 = await s.compare("mira", v4.id, v5.id);
    assert.deepEqual(c45.components.filter((d) => d.change !== "same").map((d) => d.id).sort(), ["face", "hair"].sort());
    assert.match(c45.evidence, /GENERATED/);

    // undo / redo / branch
    await s.undo("mira");
    assert.equal(s.record("mira").head, v4.id);
    await s.redo("mira");
    assert.equal(s.record("mira").head, v5.id);
    const branch = await s.edit("mira", { hair: { style: "afro" } }, { base: v2.id, label: "what if: afro over v2" });
    assert.equal(branch.parentId, v2.id, "a branch from an earlier version");
    assert.deepEqual(branch.spec.clothing, v2.spec.clothing);
    await assert.rejects(() => s.redo("mira"), /nothing to redo/);
    await s.checkout("mira", v5.id);

    // 7: export the selected version (v5) through the Forge
    const exp = await s.export("mira", v5.id);
    const fj = forge.store.job(exp.forgeJobId)!;
    assert.equal(fj.kind, "asre");
    assert.equal(fj.validation!.verdict.meshValid, true);
    assert.equal(readFileSync(forge.store.absolute(fj.output!.files[0].file)).equals(readFileSync(s.glbFile("mira", v5.id))), true, "the Forge holds exactly the selected version's bytes");
    assert.equal(inspectGlb(new Uint8Array(readFileSync(s.glbFile("mira", v5.id)))).verdict.meshValid, true);

    // the temporal engine holds the whole tree; the head replays from diffs
    const tl = await s.timeline("mira");
    assert.equal(tl.snapshots.length, 6);
    assert.equal(tl.headReplayVerified, true);
    const snap = Object.fromEntries(tl.snapshots.map((x) => [x.version, x]));
    assert.deepEqual(snap.v0002.replaced, ["hair", "face"].filter((id) => snap.v0002.replaced.includes(id)));
    assert.ok(snap.v0002.added + snap.v0002.removed + snap.v0002.changed > 0);
    assert.equal(snap.v0006.parent, "v0002", "the branch is a branch in the snapshot tree too");
    assert.ok(snap.v0005.replaced.includes("hair"));

    // every earlier snapshot is byte-for-byte and mtime-for-mtime unchanged
    for (const [f, b] of before) {
      assert.equal(readFileSync(f).equals(b.bytes), true, `${f} unchanged`);
      assert.equal(statSync(f).mtimeMs, b.mtime, `${f} not rewritten`);
    }
    assert.deepEqual(s.verify("mira"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test("reconstruction lineage: confidence history across observations, without upgrading generated geometry", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "asre-t-"));
  const runtime: AsreRuntime = { available: async () => ({ triposr: false, blender: false }), runWorker: async () => ({ result: {} }), ingest: async () => ({}), triposrHypotheses: async () => ({}), render: async () => null };
  try {
    const m = new AsreJobManager({ root, runtime });
    // a box 24 wide, 30 deep, 40 tall, seen from the front then the right
    const view = (deep: boolean) => pngBytes(120, 120, (x, y) => (y >= 10 && y < 110 && Math.abs(x - 60) < (deep ? 37 : 30) ? [40, 90, 200, 255] : [255, 255, 255, 255]));
    const a = await m.settle((await m.reconstruct([{ view: "front", bytes: view(false) }], { resolution: 40 })).id);
    const b = await m.settle((await m.observe(a.id, { view: "right", bytes: view(true) })).id);
    const c = await m.settle((await m.observe(b.id, { view: "back", bytes: view(false) })).id);
    const lin = m.lineage(c.id);
    assert.deepEqual(lin.map((x) => x.id), [a.id, b.id, c.id]);
    assert.deepEqual(lin.map((x) => x.added), [null, "right", "back"]);
    // more views → more observed, less generated
    assert.ok(lin[1].evidence!.OBSERVED > lin[0].evidence!.OBSERVED);
    assert.ok(lin[2].evidence!.GENERATED < lin[0].evidence!.GENERATED);
    for (const x of lin.slice(1)) assert.equal(x.observation!.unaffectedVerified, true);
    // a duplicate view changes nothing
    const dup = await m.settle((await m.observe(c.id, { view: "back", bytes: view(false) })).id);
    assert.equal(dup.observation!.duplicate, true);
    assert.equal(dup.result!.grid.cells, c.result!.grid.cells);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
