/**
 * ==========================================================
 * LÉLU — SESSION 3C: ASSETS, FROM SESSION 3B
 *
 * The Studio owns no asset library. It reads Session 3B's forge ledger
 * (leluverse/forge/ledger.json) and its character references, and turns
 * them into the references a game project can consume.
 *
 * The ledger is the truth: a Meshy job in `awaiting_approval` is reported
 * as awaiting approval, never as a model on disk. That matters because a
 * game that says "uses the character GLB" while no GLB exists is a false
 * claim about the build.
 * ==========================================================
 */

import type { StudioAssetRef } from "./StudioProjectTypes.js";

interface ForgeJob {
  id?: string;
  asset?: string;
  workflow?: string;
  purpose?: string;
  state?: string;
  params?: Record<string, unknown>;
  dependsOn?: string[];
}

export interface ForgeLedger {
  jobs?: ForgeJob[];
}

/** Expected formats a job declares, so a run can look for the real file. */
function declaredFormats(job: ForgeJob): string[] {
  const formats = job.params?.target_formats;
  if (Array.isArray(formats)) return formats.map(String);
  if (job.workflow === "rigging") return ["glb", "fbx"];
  return ["glb"];
}

/**
 * Build asset references from the ledger, given the files that actually
 * exist under the character directory (relative paths, forward slashes).
 */
export function assetRefsFromLedger(
  ledger: ForgeLedger,
  existingFiles: readonly string[] = [],
): StudioAssetRef[] {
  const refs: StudioAssetRef[] = [];

  for (const job of ledger.jobs ?? []) {
    if (!job.id) continue;
    const formats = declaredFormats(job);
    // A format existing somewhere is not this job's output. The file must be
    // attributable to the job, or two completed jobs would both claim one
    // GLB — measured by a failing test on the first version of this.
    const produced = formats.filter((format) =>
      existingFiles.some(
        (file) => file.toLowerCase().endsWith(`.${format}`) && file.includes(job.id as string),
      ),
    );
    const isRig = job.workflow === "rigging";
    refs.push({
      id: job.id,
      source: "meshy",
      path: job.asset ?? "",
      kind: isRig ? "animation" : "model",
      state: job.state === "completed" && produced.length > 0 ? "present" : "awaiting_approval",
      jobId: job.id,
      note:
        job.state === "awaiting_approval"
          ? `${job.purpose ?? job.workflow ?? "3D job"} — planned, not run: no ${formats.join("/")} file exists yet.`
          : job.state === "completed" && produced.length === 0
            ? "The job reports completed but no declared output file is present."
            : job.purpose,
    });
  }

  /* Reference images are real files the character pipeline already owns. */
  const references = existingFiles.filter((file) => /\.(png|jpe?g|webp)$/i.test(file));
  if (references.length > 0) {
    refs.push({
      id: "lelu-character-references",
      source: "reference",
      path: "leluverse/assets/characters/lelu_character/references",
      kind: "texture",
      state: "present",
      note: `${references.length} reference image(s) available for textures and concept boards.`,
    });
  }

  return refs;
}

/** What a generated game may honestly claim to use right now. */
export function describeAssets(refs: readonly StudioAssetRef[]): string {
  if (refs.length === 0) return "No asset references are wired for this project.";
  const present = refs.filter((ref) => ref.state === "present");
  const pending = refs.filter((ref) => ref.state !== "present");
  const parts = [
    `${present.length} usable asset reference(s): ${present.map((ref) => ref.id).join(", ") || "none"}.`,
  ];
  if (pending.length > 0) {
    parts.push(
      `${pending.length} awaiting the pipeline: ${pending.map((ref) => ref.id).join(", ")}. ` +
        "These are NOT in the build — no model file exists for them yet.",
    );
  }
  return parts.join(" ");
}

/**
 * A game built before the Meshy jobs are approved must not claim a rigged
 * character. This returns the honest substitution it makes instead.
 */
export function fallbackCharacterAsset(): StudioAssetRef {
  return {
    id: "studio-character-fallback",
    source: "procedural",
    path: "assets/character-card.png",
    kind: "texture",
    state: "present",
    note:
      "Rigged GLB not available yet: the playable figure is procedural geometry using Session 3B's " +
      "character reference as its card texture.",
  };
}
