/**
 * ==========================================================
 * LÉLU 3D FORGE — command line (the owner's, and Claude Code's)
 *
 *   npx tsx scripts/forge/forge.ts status
 *   npx tsx scripts/forge/forge.ts plan-character        # LÉLU Phase 1B: base model + rig (no spend)
 *   npx tsx scripts/forge/forge.ts approve <job> <name>  # a person approves the spend
 *   npx tsx scripts/forge/forge.ts run <job>             # runs ONE approved job
 *   npx tsx scripts/forge/forge.ts library <words>       # Meshy's animation library (free)
 *
 * LÉLU uses the same core through her forge.* tools (/api/forge/*).
 * ==========================================================
 */

import path from "node:path";
import { approveJob, assetRoot, creditsSpent, loadLedger, planJob, saveLedger } from "../../plugins/forge/forgeCore";
import { animationLibrary, meshyConfigured } from "../../plugins/forge/meshyClient";
import { runJob } from "../../plugins/forge/forgeRunner";
import { readFileSync } from "node:fs";

const projectRoot = process.cwd();
const [command, ...args] = process.argv.slice(2);
const ledger = loadLedger(projectRoot);

function show(): void {
  for (const job of ledger.jobs) {
    console.log(`${job.id}  ${job.state.padEnd(17)} ${job.workflow.padEnd(18)} est ${job.estimatedCredits} cr${job.consumedCredits !== undefined ? `, spent ${job.consumedCredits}` : ""}  ${job.purpose}${job.error ? `\n    error: ${job.error}` : ""}`);
  }
  console.log(`\n${ledger.jobs.length} job(s); credits spent so far: ${creditsSpent(ledger)}; MESHY_API_KEY on this server: ${meshyConfigured() ? "set" : "NOT SET"}`);
}

if (command === "status" || !command) {
  show();
} else if (command === "plan-character") {
  const root = assetRoot(projectRoot, "characters", "lelu_character");
  const asset = path.relative(projectRoot, root);
  const refs = JSON.parse(readFileSync(path.join(root, "manifests", "references.json"), "utf8")) as { references: Array<{ file: string; sha256: string }> };
  const hashOf = (file: string) => {
    const ref = refs.references.find((item) => item.file === file);
    if (!ref) throw new Error(`reference ${file} not ingested`);
    return ref.sha256;
  };
  const views = ["body-front-apose-hood.png", "body-back-apose-hood.png", "body-left-profile-hood.png", "body-three-quarter-hood.png"];
  const textureRefs = ["face-front-closeup.png", "body-front-apose-hood.png"];
  const base = planJob(ledger, {
    asset,
    workflow: "multi-image-to-3d",
    purpose: "LÉLU base character: textured full-body model in A-pose from 4 consistent views",
    params: {
      ai_model: "meshy-7.1",
      image_urls: views.map((file) => `ref:references/${file}`),
      texture_image_urls: textureRefs.map((file) => `ref:references/${file}`),
      should_texture: true,
      enable_pbr: true,
      texture_resolution: "2k",
      pose_mode: "a-pose",
      topology: "triangle",
      target_polycount: 100000,
      target_formats: ["glb", "fbx"],
      multi_view_thumbnails: true,
      alpha_thumbnail: true,
    },
    referenceHashes: [...views, ...textureRefs].map(hashOf),
    plannedBy: "Claude Code (owner's Phase 1B directive)",
  });
  const rig = planJob(ledger, {
    asset,
    workflow: "rigging",
    purpose: "LÉLU skeleton: auto-rig of the base character (includes walking and running clips)",
    params: { height_meters: 1.75 },
    referenceHashes: [],
    dependsOn: [base.job.id],
    plannedBy: "Claude Code (owner's Phase 1B directive)",
  });
  saveLedger(projectRoot, ledger);
  for (const { job, reused } of [base, rig]) console.log(`${reused ? "already planned" : "planned"}: ${job.id} ${job.workflow} — est ${job.estimatedCredits} credits — ${job.state}`);
  console.log("Nothing has been spent. Approve with: npx tsx scripts/forge/forge.ts approve <job> <your name>");
} else if (command === "approve") {
  const [id, ...name] = args;
  const job = approveJob(ledger, id, name.join(" "));
  saveLedger(projectRoot, ledger);
  console.log(`approved ${job.id} (${job.estimatedCredits} credits estimated) by ${job.approvedBy}`);
} else if (command === "run") {
  const job = await runJob(args[0], {
    projectRoot,
    onProgress: (current) => console.log(`  ${current.id} ${current.state} ${current.progress ?? 0}%`),
  });
  console.log(JSON.stringify({ id: job.id, state: job.state, consumedCredits: job.consumedCredits, outputs: job.outputs, error: job.error, validation: job.validation }, null, 2));
} else if (command === "library") {
  const items = await animationLibrary({ search: args.join(" ") || undefined });
  for (const item of items.slice(0, 60)) console.log(JSON.stringify(item));
} else {
  console.log("commands: status | plan-character | approve <job> <name> | run <job> | library <words>");
}
