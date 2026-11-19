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
    glb: "artifacts/foundry/m25c/steps/look3-bronze_velocity-bag.glb",
    purpose: "M25-complete v2 Outfit A: copper catsuit rebuilt from the full-length photograph (Meshy i2i 01a1f555-ddca/01a1f556-d3a8, multi-image 01a1f557-8601, rigging 01a1f55c-2b02) with her face and the look's own hair; lotus handbag (01a1f564-7973) on RightHand",
    parents: { previousJob: "v015_look_bronze_velocity", head: "camo_repaired", hair: "generated from the look's reference" },
  },
  {
    id: "rose_gold_sovereign",
    glb: "artifacts/foundry/m25c/steps/look3-rose_gold_sovereign-bag.glb",
    purpose: "M25-complete v2 Outfit B: copper-rose coat rebuilt from the full-length photograph (Meshy i2i 01a1f555-d652/01a1f556-cefc, multi-image 01a1f557-7acf, rigging 01a1f55c-13eb) with her face and the look's own hair; linework handbag (01a1f564-7cb3) on RightHand",
    parents: { previousJob: "v016_look_rose_gold_sovereign", head: "camo_repaired", hair: "generated from the look's reference" },
  },
  {
    id: "home_laidback3",
    glb: "artifacts/foundry/m25c/steps/look2-home_laidback3.glb",
    purpose: "M25-complete Home / Laidback 3: hoodie, crop top, printed sweats, slippers from the user's turnaround sheets (Meshy i2i 01a1f555-e3fc/01a1f556-d8f4, multi-image 01a1f557-92e7, rigging 01a1f55c-3ab4) with her face and the look's own hair",
    parents: { head: "camo_repaired", hair: "generated from the look's reference" },
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
