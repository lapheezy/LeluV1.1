/**
 * ==========================================================
 * LÉLUVERSE PHASE 1B — reference ingestion for LÉLU's character
 *
 * The owner's 15 Phase 1B images, classified by looking at each one
 * (Claude Code, 2026-10-30), copied into the character's asset folder by
 * the Forge (originals untouched, hashed, duplicates skipped), and the
 * identity reference proposed for the owner's approval.
 *
 * Usage: npx tsx scripts/forge/phase1b-references.ts <uploads-dir>
 * ==========================================================
 */

import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { assetRoot, ingestReferences } from "../../plugins/forge/forgeCore";

const uploads = process.argv[2];
if (!uploads) throw new Error("usage: phase1b-references.ts <uploads-dir>");
const root = assetRoot(process.cwd(), "characters", "lelu_character");
const src = (id: string) => path.join(uploads, `${id}-image.png`);

type Item = Parameters<typeof ingestReferences>[1][number];
const common = { width: 1024, height: 1536 };
const items: Item[] = [
  { source: src("945edce9"), file: "body-front-apose-hood.png", category: "B. body — front full body, A-pose, hood up", intendedUse: "primary geometry view for multi-image reconstruction (pose_mode a-pose)", quality: "clean studio render, plain dark background, whole figure in frame", reconstructionSuitability: "high", uses: ["geometry", "texture"], ...common },
  { source: src("d3b9a690"), file: "body-back-apose-hood.png", category: "B. body — back full body, A-pose, hood up", intendedUse: "back geometry view (hair volume, hood, harness, pants)", quality: "clean studio render, matches the front pose", reconstructionSuitability: "high", uses: ["geometry"], ...common },
  { source: src("ef41dba6"), file: "body-left-profile-hood.png", category: "B. body — left profile (head turned to camera), hood up", intendedUse: "side geometry view", quality: "clean render; arms down, not A-pose", reconstructionSuitability: "medium", uses: ["geometry"], ...common },
  { source: src("ca7ddcd8"), file: "body-three-quarter-hood.png", category: "B. body — three-quarter view, hood up", intendedUse: "three-quarter geometry view", quality: "clean render; arms slightly out", reconstructionSuitability: "high", uses: ["geometry"], ...common },
  { source: src("5040fa34"), file: "body-front-neutral-nohood.png", category: "B. body — front full body, neutral stance, no hood", intendedUse: "alternative front view without the hood (hair down, roses visible); single-image fallback", quality: "clean render; pink-highlighted hair fully visible", reconstructionSuitability: "high", uses: ["geometry", "design"], ...common },
  { source: src("ea4e68aa"), file: "face-front-closeup.png", category: "A. identity — front face and upper body, no hood", intendedUse: "PRIMARY facial identity reference (proposed); texture reference for the face", quality: "sharp, frontal, even light: eyes, brows, nose, lips, jaw, freckles, star marks, septum and lip piercings, bindi chain all visible", reconstructionSuitability: "high", uses: ["identity", "texture"], ...common },
  { source: src("1f4410bd"), file: "face-front-closeup-alt.png", category: "A. identity — front face and upper body, second render", intendedUse: "secondary identity check (same features, slightly different expression and crop)", quality: "sharp, frontal", reconstructionSuitability: "medium", uses: ["identity"], ...common },
  { source: src("235cb81a"), file: "hair-back.png", category: "C. hair — rear view", intendedUse: "rear hair design: curl density, pink and copper threading, roses, chains, crystal drops", quality: "sharp", reconstructionSuitability: "medium", uses: ["design", "texture"], ...common },
  { source: src("d32e1770"), file: "clothing-corset-top.png", category: "D. clothing — corset/top construction", intendedUse: "top design: camo print, straps, copper hardware, pendant placement", quality: "sharp close-up", reconstructionSuitability: "low", uses: ["design", "texture"], ...common },
  { source: src("85d558a4"), file: "clothing-shoulder-armor.png", category: "D. clothing — shoulder armor and upper-arm wraps", intendedUse: "shoulder armor design: rose ornament, copper plates, crystal drops", quality: "sharp close-up", reconstructionSuitability: "low", uses: ["design"], ...common },
  { source: src("0a3e6a8c"), file: "clothing-waist-harness.png", category: "D. clothing — waist and hip harness", intendedUse: "harness design: belts, rings, hanging straps, chains", quality: "sharp close-up", reconstructionSuitability: "low", uses: ["design"], ...common },
  { source: src("ab5161ab"), file: "clothing-cargo-pants-boots.png", category: "D. clothing — cargo pants and boots, front", intendedUse: "pants and boots design (lower body front)", quality: "sharp", reconstructionSuitability: "medium", uses: ["design", "texture"], ...common },
  { source: src("003c6f3b"), file: "clothing-platform-boots.png", category: "D. clothing — platform boots close-up", intendedUse: "boot design: camo leather, copper straps, crystal charms", quality: "sharp close-up", reconstructionSuitability: "low", uses: ["design"], ...common },
  { source: src("98514b0d"), file: "accessories-hands-forearm-armor.png", category: "E. accessories — hands, rings, nails, forearm armor", intendedUse: "hands and jewellery design: rings, hand chains, stiletto nails, tattoos, forearm cuffs", quality: "sharp close-up", reconstructionSuitability: "low", uses: ["design"], ...common },
  { source: src("bf28c9f8"), file: "accessories-signature-pendant.png", category: "E. accessories — LÉLU signature pendant", intendedUse: "the signature pendant: rose-quartz spheres, twisted copper, crystal drops", quality: "sharp product shot", reconstructionSuitability: "low", uses: ["design"], ...common },
];

const manifest = ingestReferences(root, items);
console.log(`${manifest.references.length} references stored, ${manifest.duplicatesSkipped.length} duplicate(s) skipped → ${path.relative(process.cwd(), root)}/references`);

// The identity lock: ONE primary face, proposed — the owner approves it.
const identityFile = path.join(root, "identity", "identity.json");
if (!existsSync(identityFile)) {
  const primary = manifest.references.find((ref) => ref.file === "face-front-closeup.png")!;
  const secondary = manifest.references.find((ref) => ref.file === "face-front-closeup-alt.png")!;
  writeFileSync(
    identityFile,
    `${JSON.stringify(
      {
        character: "LÉLU",
        status: "proposed — awaiting the owner's approval",
        primaryFaceReference: { file: `references/${primary.file}`, sha256: primary.sha256 },
        secondaryChecks: [{ file: `references/${secondary.file}`, sha256: secondary.sha256 }],
        preserve: [
          "eye shape and spacing (almond, slightly upturned outer corners, heavy lashes)",
          "eyebrow structure (full, softly arched)",
          "nose (straight bridge, rounded tip, septum ring)",
          "lips (full, defined cupid's bow, glossy deep rose; vertical lip piercing below the lower lip)",
          "cheekbones and jawline (high cheekbones, soft tapered jaw)",
          "deep brown skin with warm undertone",
          "facial markings: freckles across the cheeks, small star marks under the eyes, swirl markings at the temples",
          "forehead bindi chain with a pink crystal",
          "copper hoop earrings",
        ],
        mayChange: ["outfit", "hairstyle", "pose", "expression", "accessories"],
        rule: "Generated images are never promoted to identity references without the owner's approval.",
      },
      null,
      2,
    )}\n`,
  );
  console.log("identity reference proposed → identity/identity.json");
}
