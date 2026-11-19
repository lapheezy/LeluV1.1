/**
 * LÉLU — she knows what was changed in her, and can repeat it.
 *
 * Git is the source (every coder's commits), the journal explains, playbooks
 * are runnable; the runner never spends credits without a named approval and
 * never runs anything outside scripts/.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { areaOf, commandFor, getRun, listChanges, readJournal, readPlaybooks, resolveArgs, startRun } from "../plugins/selfJournalApi.ts";
import { summariseChanges } from "../src/core/cognition/SelfChangeAwareness.ts";

const ROOT = process.cwd();

test("her change list is git itself: the newest commit, any author, is in it", () => {
  const head = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  const changes = listChanges(ROOT, 5);
  assert.ok(changes.length > 0);
  assert.ok(head.startsWith(changes[0].hash));
  assert.ok(changes[0].author && changes[0].subject && changes[0].areas.length > 0);
  assert.equal(areaOf("leluverse/assets/characters/lelu_character/meshes/v029_look_rose_gold_sovereign/lelu.glb"), "my body and outfits (3D assets)");
  assert.equal(areaOf("src/core/avatar/OutfitDirector.ts"), "my avatar and wardrobe behaviour");
});

test("journal entries are well-formed and name playbooks that exist", () => {
  const journal = readJournal(ROOT);
  const ids = new Set(readPlaybooks(ROOT).map((p) => p.id));
  assert.ok(journal.length >= 3);
  for (const j of journal) {
    assert.match(j.date, /^\d{4}-\d{2}-\d{2}$/, j.file);
    assert.ok(j.title.length > 5 && j.text.length > 100, j.file);
    for (const p of j.playbooks) assert.ok(ids.has(p), `${j.file} names missing playbook ${p}`);
  }
});

test("every playbook step is runnable or an explicit instruction, and its script exists", () => {
  for (const pb of readPlaybooks(ROOT)) {
    assert.ok(pb.id && pb.title && pb.why, pb.id);
    for (const s of pb.steps) {
      assert.ok(["blender", "python", "tsx", "meshy", "meshy-wait", "tool", "note"].includes(s.kind), `${pb.id}/${s.id}`);
      if (s.script) assert.ok(existsSync(path.join(ROOT, s.script)), `${pb.id}/${s.id}: ${s.script}`);
    }
    const spend = pb.steps.reduce((n, s) => n + (s.spend ?? 0), 0);
    assert.equal(pb.spendsCredits, spend, `${pb.id} declares its cost truthfully`);
  }
});

test("the runner refuses to spend credits without a named approval", () => {
  const pb = readPlaybooks(ROOT).find((p) => p.id === "new-look-from-photos")!;
  const run = startRun(ROOT, pb, { params: { look: "x", photo: "p.png", dir: "d", views: "left" } }, async () => ({ code: 0, out: "" }));
  assert.equal(run.status, "refused");
  assert.match(run.error ?? "", /approveSpend/);
  const half = startRun(ROOT, pb, { approveSpend: true, approvedBy: "" }, async () => ({ code: 0, out: "" }));
  assert.equal(half.status, "refused");
});

test("the runner only runs scripts under scripts/, without a shell, and threads outputs between steps", async () => {
  assert.throws(() => commandFor(ROOT, { id: "x", title: "x", kind: "python", script: "../etc/passwd" }, []), /scripts\//);
  assert.throws(() => commandFor(ROOT, { id: "x", title: "x", kind: "tool", script: "scripts/foundry/m25c_crop.py" }, []), /not executed/);
  assert.deepEqual(resolveArgs(["${dir}/a", "${task:front}"], { dir: "D" }, { front: { task: "T1" } }), ["D/a", "T1"]);
  assert.throws(() => resolveArgs(["${missing}"], {}, {}), /missing parameter/);

  const calls: string[][] = [];
  const pb = {
    id: "t", title: "t", why: "t", spendsCredits: 0,
    steps: [
      { id: "a", title: "a", kind: "python" as const, script: "scripts/foundry/m25c_crop.py", args: ["x"] },
      { id: "b", title: "b", kind: "python" as const, script: "scripts/foundry/m25c_crop.py", args: ["${task:a}"] },
      { id: "c", title: "c", kind: "note" as const, why: "look at it" },
    ],
  };
  const run = startRun(ROOT, pb, {}, async (argv) => { calls.push(argv); return { code: 0, out: "TASK abc-123\n" }; });
  for (let i = 0; i < 50 && getRun(run.id)!.status === "running"; i++) await new Promise((r) => setTimeout(r, 5));
  const done = getRun(run.id)!;
  assert.equal(done.status, "done");
  assert.deepEqual(calls[0], ["python3", "scripts/foundry/m25c_crop.py", "x"]);
  assert.deepEqual(calls[1], ["python3", "scripts/foundry/m25c_crop.py", "abc-123"]);
  assert.equal(done.steps[2].status, "instruction");
});

test("what she is told in every conversation names the change, its author and how to redo it", () => {
  const text = summariseChanges(
    [{ hash: "abcdef123456", author: "someone", date: "2026-11-19T10:00:00Z", subject: "fix her coat", body: "", areas: ["my body and outfits (3D assets)"] }],
    [{ file: "journal/x.md", date: "2026-11-19", title: "My coat", commits: [], playbooks: ["rebuild-looks"], text: "…" }],
  );
  assert.match(text, /someone: fix her coat/);
  assert.match(text, /playbook rebuild-looks/);
  assert.match(text, /never guess/);
});
