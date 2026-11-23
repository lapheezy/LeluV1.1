/**
 * LÉLU M25 Complete — register the finished looks in the EXISTING Forge wardrobe.
 *
 *   npx tsx scripts/foundry/m25c-wardrobe.ts [--only=<look>,<look>,items]
 *
 * Pause 2 (2026-11-20): the catsuit and the coat are registered WITHOUT hair and bag; their
 * hairstyles (Meshy, fitted to her head) and purses are wardrobe items of their own, skinned on
 * her skeleton, each naming the look it comes with (withLooks). --only limits what is registered
 * (a look whose GLB is not on this machine is skipped, never registered from stale bytes).
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
import { existsSync } from "node:fs";
import { ForgeStore, type ForgeJob } from "../../plugins/forgeStore.ts";
import { MeshyForge } from "../../plugins/meshyForge.ts";

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
    glb: "artifacts/foundry/m25c/steps/look6-bronze_velocity.glb",
    purpose: "M25-complete pause 2: copper catsuit (Meshy multi-image 01a1f557-8601, rigging 01a1f55c-2b02) with her face on a closed skull, no headpiece, no built hair and no bag: its hairstyle (hair_copper_coils) and lotus bag are wardrobe items",
    parents: { previousJob: "v037_look_bronze_velocity", head: "camo_repaired", hair: "wardrobe item hair_copper_coils" },
  },
  {
    id: "rose_gold_sovereign",
    glb: "artifacts/foundry/m25c/steps/look7-rose_gold_sovereign.glb",
    purpose: "M25-complete pause 2: copper-rose coat (Meshy multi-image 01a1f557-7acf, rigging 01a1f55c-13eb) with her face on a closed skull, no headpiece, no built hair, no bag; its boots replaced by the open-toe copper spiral stilettos (Meshy 01a1f6a2-9861, from the owner's heel reference); hairstyle hair_rose_gold_waves and linework bag are wardrobe items",
    parents: { previousJob: "v038_look_rose_gold_sovereign", head: "camo_repaired", hair: "wardrobe item hair_rose_gold_waves", shoes: "v045_multi-image-to-3d_shoes_worn_spiral" },
  },
  {
    id: "home_laidback3",
    glb: "artifacts/foundry/m25c/steps/look2-home_laidback3.glb",
    purpose: "M25-complete Home / Laidback 3: hoodie, crop top, printed sweats, slippers from the user's turnaround sheets (Meshy i2i 01a1f555-e3fc/01a1f556-d8f4, multi-image 01a1f557-92e7, rigging 01a1f55c-3ab4) with her face and the look's own hair",
    parents: { head: "camo_repaired", hair: "generated from the look's reference" },
  },
];

/** Pause 2: pieces of their own, exported on her skeleton (the client binds them to her live bones). */
const ITEMS = [
  { id: "hair_copper_coils", name: "Copper coil curls", category: "hair", bone: "Head", withLooks: ["bronze_velocity"],
    glb: "artifacts/foundry/m25c/steps/item-hair_copper_coils.glb",
    purpose: "Hairstyle: waist-length curls with copper coils (Meshy multi-image 01a1f5d7-1660 from the catsuit's own photographs), mannequin removed, fitted to her head, skinned Head/Neck/Spine02" },
  { id: "hair_rose_gold_waves", name: "Slicked rose-gold waves", category: "hair", bone: "Head", withLooks: ["rose_gold_sovereign"],
    glb: "artifacts/foundry/m25c/steps/item-hair_rose_gold_waves.glb",
    purpose: "Hairstyle: slicked crown and long waves (Meshy multi-image from the coat's own photographs, v043), mannequin removed, fitted to her head, skinned Head/Neck/Spine02" },
  { id: "bronze_lotus_bag", name: "Bronze lotus bag", category: "bag", bone: "RightHand", withLooks: ["bronze_velocity"],
    glb: "artifacts/foundry/m25c/steps/item-bronze_lotus_bag.glb",
    purpose: "Purse: the lotus bag (Meshy 01a1f564-7973) held in her right hand, skinned 100% RightHand" },
  { id: "rose_gold_bag", name: "Rose-gold linework bag", category: "bag", bone: "RightHand", withLooks: ["rose_gold_sovereign"],
    glb: "artifacts/foundry/m25c/steps/item-rose_gold_bag.glb",
    purpose: "Purse: the linework bag (Meshy 01a1f564-7cb3) held in her right hand, skinned 100% RightHand" },
];

const only = (/--only=([\w,_-]+)/.exec(process.argv.join(" "))?.[1] ?? "").split(",").filter(Boolean);
const wanted = (id: string) => !only.length || only.includes(id);

/** A finished Forge job for a file (found by checksum, else created), as plugins/blenderStage.ts writes them. */
function jobFor(id: string, glb: string, purpose: string, request: Record<string, unknown>, folder: string): ForgeJob {
  const bytes = new Uint8Array(readFileSync(path.join(ROOT, glb)));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const existing = store.jobs(character).find((j) => j.character === character && j.output?.files.some((f) => f.sha256 === digest));
  if (existing) return existing;
  const dir = store.newVersionDir(character, "meshes", folder);
  const files = [store.writeOutput(dir, "lelu.glb", "model", bytes)];
  const now = Date.now();
  const job = {
    id: `fj_${now.toString(36)}_${createHash("sha1").update(id + now).digest("hex").slice(0, 6)}`,
    character, kind: "blender", purpose, request: { ...request, source: glb },
    requestKey: `m25c-${folder}:${digest.slice(0, 16)}`, estimatedCredits: 0, status: "SUCCEEDED", meshyTaskId: null,
    progress: 100, consumedCredits: 0, error: null, identityLock: null, createdAt: now, updatedAt: now, submittedAt: now,
    finishedAt: now, output: { dir: store.relative(dir), files }, validation: inspectGlb(bytes),
  } as ForgeJob;
  store.saveJob(job);
  store.logEvent(character, { type: "blender_succeeded", jobId: job.id, item: id, dir: job.output!.dir, verdict: job.validation?.verdict ?? null });
  return job;
}

const results: Array<Record<string, unknown>> = [];
for (const look of LOOKS) {
  if (!wanted(look.id)) continue;
  if (!existsSync(path.join(ROOT, look.glb))) {
    results.push({ look: look.id, skipped: `${look.glb} is not on this machine` });
    continue;
  }
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
if (wanted("items")) {
  const forge = new MeshyForge({ store, readEnv: () => undefined });
  for (const item of ITEMS) {
    if (!existsSync(path.join(ROOT, item.glb))) {
      results.push({ item: item.id, skipped: `${item.glb} is not on this machine` });
      continue;
    }
    const job = jobFor(item.id, item.glb, item.purpose, { item: item.id }, `item_${item.id}`);
    const { item: registered } = forge.addWardrobeItem(character, { id: item.id, name: item.name, category: item.category, slot: item.category, jobId: job.id, bone: item.bone, withLooks: item.withLooks });
    results.push({ item: item.id, jobId: job.id, bone: registered.bone, withLooks: item.withLooks, verdict: job.validation?.verdict });
  }
  // dress her current look again so its own pieces go on
  const current = store.manifest(character).currentLook;
  if (current) results.push({ dressed: forge.dressOutfit(character, { look: current }).dressed });
}
console.log(JSON.stringify(results, null, 1));
