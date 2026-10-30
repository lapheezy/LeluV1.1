/**
 * LÉLU 3D FORGE — operator CLI. Same MeshyForge service, store and ledger
 * as /api/forge; nothing here is a second implementation.
 *
 *   tsx scripts/forge-character.ts status
 *   tsx scripts/forge-character.ts plan-base            plan the Phase D base job (spends nothing)
 *   tsx scripts/forge-character.ts plan-multiview       plan the multi-view base job (spends nothing)
 *   tsx scripts/forge-character.ts approve <jobId>      submit it (spends credits)
 *   tsx scripts/forge-character.ts reject <jobId> [reason]  decline a planned job; its record is kept
 *   tsx scripts/forge-character.ts watch <jobId>        follow to completion, download, inspect
 *   tsx scripts/forge-character.ts rig <baseJobId> [--height=1.75] [--approve]
 *   tsx scripts/forge-character.ts animate <rigJobId> <name>=<actionId>... [--approve]
 *   tsx scripts/forge-character.ts slot <slot> <jobId>  promote a validated job (base | rig | animation:<name>)
 *   tsx scripts/forge-character.ts inspect <file.glb>   run the GLB inspector on any file
 *   tsx scripts/forge-character.ts library [search]     Meshy's animation catalogue (free)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { inspectGlb } from "../src/core/forge/GlbInspector.ts";
import { ForgeStore, type CharacterSlot, type ForgeJob } from "../plugins/forgeStore.ts";
import { ForgeError, MeshyForge } from "../plugins/meshyForge.ts";

const CHARACTER = process.env.FORGE_CHARACTER ?? "lelu_character";

/**
 * Phase D base request. ref11 is the only reference that is full-length,
 * a true A-pose, unhooded and on a plain background — the pose rigging
 * wants and the head the modular outfit system needs. Single-image, not
 * multi-image: the side and three-quarter views (ref12, ref13) wear a hood
 * ref11 does not, and the only view-consistent set (ref14+ref13+ref12)
 * would bake the hood into the head.
 */
const BASE_REQUEST = {
  image_url: "ref:ref11_front_apose_B",
  ai_model: "meshy-7.1",
  should_texture: true,
  enable_pbr: true,
  texture_resolution: "2k",
  pose_mode: "a-pose",
  should_remesh: true,
  topology: "triangle",
  target_polycount: 60_000,
  image_enhancement: false,
  target_formats: ["glb", "fbx"],
  multi_view_thumbnails: true,
};

/**
 * Multi-view base request. The only references that show the SAME look
 * from several angles at full length are the hooded outfit-B set:
 * ref14 (front, A-pose — first, as meshy-7.1 reads image 1 as the front),
 * ref13 (three-quarter front) and ref12 (left side). There is no back
 * view of this look: ref09 is unhooded, braided and cropped at the thigh,
 * so it would contradict the hood and the legs. Meshy infers the back.
 * geometry_resolution stays "standard" (2K *Ultra geometry* is a separate,
 * +5-credit setting); texture_resolution "2k" is the texture map size.
 * image_enhancement is off so Meshy keeps the references' own look.
 */
const MULTIVIEW_REQUEST = {
  image_urls: ["ref:ref14_front_apose_hooded_B", "ref:ref13_three_quarter_hooded_B", "ref:ref12_left_side_hooded_B"],
  ai_model: "meshy-7.1",
  geometry_resolution: "standard",
  should_texture: true,
  enable_pbr: true,
  texture_resolution: "2k",
  pose_mode: "a-pose",
  should_remesh: true,
  topology: "triangle",
  target_polycount: 60_000,
  save_pre_remeshed_model: true,
  image_enhancement: false,
  target_formats: ["glb", "fbx"],
  multi_view_thumbnails: true,
};

const store = new ForgeStore(process.env.FORGE_ASSET_ROOT ?? path.join(process.cwd(), "leluverse", "assets"));
const forge = new MeshyForge({ store, readEnv: (name) => process.env[name] });

function show(job: ForgeJob): void {
  const v = job.validation;
  console.log(
    [
      `job        ${job.id}  (${job.kind}${job.purpose ? ` — ${job.purpose}` : ""})`,
      `status     ${job.status}${job.progress ? ` ${job.progress}%` : ""}${job.meshyTaskId ? `  meshy=${job.meshyTaskId}` : ""}`,
      `credits    estimated ${job.estimatedCredits}, consumed ${job.consumedCredits ?? "—"}`,
      job.error ? `error      ${job.error}` : "",
      job.output ? `output     ${job.output.dir} (${job.output.files.length} files)` : "",
      v
        ? `inspection mesh=${v.verdict.meshValid} textured=${v.verdict.textured} rig=${v.verdict.rigValid} animated=${v.verdict.animated} ` +
          `verts=${v.geometry.vertices} tris=${v.geometry.triangles} joints=${v.rig.joints}` +
          (v.problems.length ? `\n           problems: ${v.problems.join("; ")}` : "") +
          (v.warnings.length ? `\n           warnings: ${v.warnings.join("; ")}` : "")
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function jobArg(index: number): string {
  const id = process.argv[index];
  if (!id) throw new ForgeError("Missing job id.");
  return id;
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  const approve = process.argv.includes("--approve");

  switch (command) {
    case "status": {
      console.log(`character  ${CHARACTER}`);
      console.log(`credential ${forge.credentialSource() ?? "MISSING — set MESHY_API_KEY in the server environment"}`);
      if (forge.configured()) {
        try {
          console.log(`balance    ${JSON.stringify(await forge.balance())}`);
        } catch (error) {
          console.log(`balance    unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const identity = store.verifyIdentity(CHARACTER);
      console.log(`identity   ${identity.ok ? `locked ${identity.lockHash?.slice(0, 16)} (verified)` : identity.problems.join("; ")}`);
      console.log(`references ${store.references(CHARACTER).length}`);
      console.log(`usage      ${JSON.stringify(store.usage(CHARACTER))}`);
      console.log(`active     ${JSON.stringify(store.manifest(CHARACTER).active)}`);
      for (const job of store.jobs(CHARACTER)) {
        console.log("");
        show(job);
      }
      return;
    }
    case "plan-base": {
      const { job, reused } = await forge.request({
        character: CHARACTER,
        kind: "image-to-3d",
        purpose: "Phase D base character (outfit B, unhooded, A-pose)",
        body: BASE_REQUEST,
        approve,
      });
      console.log(reused ? "Existing job for this exact request (no new spend):" : "Planned:");
      show(job);
      if (job.status === "awaiting_approval") console.log(`\nApprove with: tsx scripts/forge-character.ts approve ${job.id}`);
      return;
    }
    case "plan-multiview": {
      const { job, reused } = await forge.request({
        character: CHARACTER,
        kind: "multi-image-to-3d",
        purpose: "Multi-view base character (outfit B, hooded; ref14 front + ref13 three-quarter + ref12 side)",
        body: MULTIVIEW_REQUEST,
        approve,
      });
      console.log(reused ? "Existing job for this exact request (no new spend):" : "Planned:");
      show(job);
      if (job.status === "awaiting_approval") console.log(`\nApprove with: tsx scripts/forge-character.ts approve ${job.id}`);
      return;
    }
    case "approve":
      show(await forge.approve(jobArg(3), { resubmitUncertain: process.argv.includes("--resubmit-uncertain") }));
      return;
    case "reject":
      show(forge.reject(jobArg(3), process.argv.slice(4).join(" ")));
      return;
    case "watch": {
      const id = jobArg(3);
      for (;;) {
        const job = await forge.refresh(id);
        console.log(`${new Date().toISOString()}  ${job.status} ${job.progress}%${job.error ? `  (${job.error})` : ""}`);
        const done = job.status === "FAILED" || job.status === "CANCELED" || job.status === "rejected" || (job.status === "SUCCEEDED" && job.output);
        if (done || job.status === "awaiting_approval" || job.status === "submit_uncertain") {
          show(job);
          return;
        }
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
    case "rig": {
      const base = store.job(jobArg(3));
      if (!base?.meshyTaskId || base.status !== "SUCCEEDED") throw new ForgeError("Rigging needs a SUCCEEDED base job.");
      if (!base.validation?.verdict.textured) throw new ForgeError("Meshy rigs textured humanoid meshes only; this one is not textured.");
      if (base.validation.geometry.triangles > 300_000) throw new ForgeError("Over 300k faces: remesh before rigging.");
      const height = Number(/--height=([\d.]+)/.exec(process.argv.join(" "))?.[1] ?? 1.75);
      const { job } = await forge.request({
        character: CHARACTER,
        kind: "rigging",
        purpose: "Phase G humanoid rig",
        body: { input_task_id: base.meshyTaskId, height_meters: height },
        approve,
        parentJobId: base.id,
      });
      show(job);
      return;
    }
    case "animate": {
      const rig = store.job(jobArg(3));
      if (!rig?.meshyTaskId || rig.kind !== "rigging" || rig.status !== "SUCCEEDED") throw new ForgeError("Animation needs a SUCCEEDED rigging job.");
      const pairs = process.argv.slice(4).filter((a) => a.includes("=")).map((a) => a.split("="));
      for (const [name, actionId] of pairs) {
        const { job } = await forge.request({
          character: CHARACTER,
          kind: "animation",
          purpose: `Phase H motion: ${name}`,
          body: { rig_task_id: rig.meshyTaskId, action_id: Number(actionId) },
          approve,
          parentJobId: rig.id,
        });
        console.log(`\n[${name}]`);
        show(job);
      }
      return;
    }
    case "slot": {
      const manifest = forge.approveSlot(CHARACTER, process.argv[3] as CharacterSlot, jobArg(4));
      console.log(JSON.stringify(manifest.active, null, 2));
      return;
    }
    case "inspect": {
      const report = inspectGlb(new Uint8Array(readFileSync(jobArg(3))));
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    case "library":
      console.log(JSON.stringify(await forge.animationLibrary(process.argv[3] ? { search: process.argv[3] } : {}), null, 2));
      return;
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  }
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof ForgeError && error.details.length) for (const d of error.details) console.error(`  - ${d}`);
  process.exit(1);
});
