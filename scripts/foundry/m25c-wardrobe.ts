/**
 * LÉLU M25 Complete — register the finished looks in the EXISTING Forge wardrobe.
 *
 *   npx tsx scripts/foundry/m25c-wardrobe.ts
 *
 * No second wardrobe system: each assembled look becomes a Forge "blender"
 * job (same record shape as plugins/blenderStage.ts writes), stored with
 * ForgeStore.newVersionDir/writeOutput, inspected with the Forge's own
 * GlbInspector, and approved into a `look:<id>` slot with the same checks as
 * MeshyForge.approveSlot. dressOutfit / wardrobeView then list and switch them.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inspectGlb } from "../../src/core/forge/GlbInspector.ts";
import { ForgeStore, type ForgeJob } from "../../plugins/forgeStore.ts";

const ROOT = process.cwd();
const store = new ForgeStore(process.env.FORGE_ASSET_ROOT ?? path.join(ROOT, "leluverse", "assets"));
const character = "lelu_character";

const LOOKS = [
  {
    id: "camo_repaired",
    glb: "artifacts/foundry/m25c/steps/s3-shoulders.glb",
    purpose: "M25-complete: the original Meshy outfit (corset, camo, cargo, boots) with mouth cavity seated, lip surface smoothed, ringlets kept off jewellery, shoulders unfolded",
    parents: { foundryVersion: "v0005", meshyRig: "fj_mvwaqbim_55226d" },
  },
  {
    id: "bronze_velocity",
    glb: "artifacts/foundry/m25c/steps/look-bronze_velocity-bag.glb",
    purpose: "M25-complete Outfit A: copper exosculpt catsuit (Meshy multi-image 01a1f513 + rigging 01a1f519) worn with LÉLU's own head; handbag a separate RightHand object",
    parents: { meshyTasks: ["01a1f513-b64d-7005-ace7-4b019ca9aee6", "01a1f519-f5fa-71e6-937c-2c70e8c88f4e"], head: "camo_repaired" },
  },
  {
    id: "rose_gold_sovereign",
    glb: "artifacts/foundry/m25c/steps/look-rose_gold_sovereign-unfold.glb",
    purpose: "M25-complete Outfit B: copper-rose tailored coat (Meshy image-to-image 01a1f527/01a1f528, multi-image 01a1f529, rigging 01a1f52e) worn with LÉLU's own head; skirt unfolded",
    parents: { meshyTasks: ["01a1f527-94b1-71dc-98f9-b9426adc3164", "01a1f528-8190-721d-9035-eea6c9618b26", "01a1f529-837a-75b2-af99-98c9183ca6c0", "01a1f52e-c467-76fd-aced-07accb6bb9f7"], head: "camo_repaired" },
  },
];

const results = [];
for (const look of LOOKS) {
  const bytes = new Uint8Array(readFileSync(path.join(ROOT, look.glb)));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const existing = store.jobs(character).find((j) => j.character === character && j.output?.files.some((f) => f.sha256 === digest));
  let job: ForgeJob;
  if (existing) {
    job = existing;
  } else {
    const dir = store.newVersionDir(character, "meshes", `look_${look.id}`);
    const files = [store.writeOutput(dir, "lelu.glb", "model", bytes)];
    const now = Date.now();
    job = {
      id: `fj_${now.toString(36)}_${createHash("sha1").update(look.id + now).digest("hex").slice(0, 6)}`,
      character,
      kind: "blender",
      purpose: look.purpose,
      request: { look: look.id, source: look.glb, ...look.parents },
      requestKey: `m25c-look:${look.id}:${digest.slice(0, 16)}`,
      estimatedCredits: 0,
      status: "SUCCEEDED",
      meshyTaskId: null,
      progress: 100,
      consumedCredits: 0,
      error: null,
      identityLock: null,
      createdAt: now,
      updatedAt: now,
      submittedAt: now,
      finishedAt: now,
      output: { dir: store.relative(dir), files },
      validation: inspectGlb(bytes),
    } as ForgeJob;
    store.saveJob(job);
    store.logEvent(character, { type: "blender_succeeded", jobId: job.id, look: look.id, dir: job.output!.dir, verdict: job.validation?.verdict ?? null });
  }
  const v = job.validation!;
  const problems = [...(v.ok ? [] : v.problems), ...(v.verdict.meshValid ? [] : ["Mesh did not validate."])];
  if (problems.length) {
    results.push({ look: look.id, jobId: job.id, approved: false, problems });
    continue;
  }
  store.setActive(character, `look:${look.id}`, job.id);
  results.push({ look: look.id, jobId: job.id, approved: true, dir: job.output!.dir, sha256: digest, verdict: v.verdict });
}
console.log(JSON.stringify(results, null, 1));
