/**
 * ==========================================================
 * LÉLU 2.3 — EVIDENCE FOR THE CONVERSATION
 *
 * Reads what the builds actually produced and emits the blocks a chat can draw:
 * the face before and after, the head in three-quarter, the baby-hair overlay,
 * the measured change between them, and the commit they belong to.
 *
 * Two outputs, both generated from the same blocks:
 *
 *   artifacts/lelu2/research/evidence-m23.json   the fenced `evidence` payload
 *   artifacts/lelu2/research/evidence-m23.md     the same evidence as markdown
 *
 * and the images it cites are copied into `public/lelu2-evidence/`, because a
 * chat can only render a URL — a block that points at a repo path no surface can
 * load is not evidence delivery. The mapping lives in
 * `publicEvidencePath()`, so it cannot drift from what the renderer expects.
 *
 *   npx tsx scripts/lelu2/evidence.ts
 * ==========================================================
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { execFileSync } from "node:child_process";
import {
  evidenceFence,
  evidenceImages,
  evidenceToMarkdown,
  mapEvidenceImages,
  publicEvidencePath,
  type EvidenceBlock,
  type Measurement,
} from "../../src/core/cognition/research/evidence.ts";

const PUBLIC_DIR = "public/lelu2-evidence";
const OUT = "artifacts/lelu2/research";

const commit = (() => {
  try {
    return execFileSync("git", ["-c", "safe.directory=*", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
})();

interface Metrics {
  variant: string;
  head: { heightMm: number; widthMm: number; widthToHeight: number; jawToCheek: number; chinToJaw: number; cheekShareOfHead: number };
  face: { chinMmL: number; eyeToChinMm: number; crownToChinMm: number; lowerThirdShare: number; cheekWidthMm: number; jawWidthMm: number; chinWidthMm: number; jawToCheek: number; chinToJaw: number };
  eyes: { spacingMm: number };
  babyHair: {
    count: number;
    byRegion: Record<string, number>;
    lengthMm: { min: number; median: number; max: number };
    rootThicknessMm: { min: number; max: number };
    curvaturePerM: { median: number };
    hairline: { coveragePct: number; medianRootAboveBrowMm: number };
    collision: Record<string, number>;
  } | null;
  youth: { enabled: boolean; chinLiftMm: number; jawNarrowMm: number; mouthLiftMm: number };
}

function readMetrics(variant: string): Metrics | null {
  const path = `artifacts/lelu2/m23/${variant}/metrics-${variant}.json`;
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Metrics;
}

const before = readMetrics("baseline");
const after = readMetrics("youth");
if (!before || !after) {
  console.error("run `npx tsx scripts/asre/lelu2/baby-hair.ts --variant baseline|youth` first");
  process.exit(1);
}

const mm = (v: number) => `${v.toFixed(1)} mm`;
const pct = (v: number) => `${(v * 100).toFixed(1)} %`;

const blocks: EvidenceBlock[] = [];
const dir = (variant: string) => `artifacts/lelu2/m23/${variant}`;

const faceBefore = `${dir("baseline")}/lelu2-m23-baseline-face-front.png`;
const faceAfter = `${dir("youth")}/lelu2-m23-youth-face-front.png`;
const headBefore = `${dir("baseline")}/lelu2-m23-baseline-head-three-quarter.png`;
const headAfter = `${dir("youth")}/lelu2-m23-youth-head-three-quarter.png`;
const overlay = `${dir("youth")}/baby-hair-youth.svg`;

if (existsSync(faceBefore) && existsSync(faceAfter)) {
  blocks.push({
    kind: "compare",
    title: "Her face, same camera: without → with the youth pass",
    before: { src: faceBefore, alt: "Her face before the youth pass", caption: "2.3 paint fixes, no youth pass", commit: commit || undefined },
    after: { src: faceAfter, alt: "Her face after the youth pass", caption: "youth pass: lower face shorter, jaw narrower, cheeks fuller", commit: commit || undefined },
    note: `Eye line → chin ${mm(before.face.eyeToChinMm)} → ${mm(after.face.eyeToChinMm)}; the chin is ${mm(after.face.chinMmL)} above the floor.`,
    measurements: [
      { label: "eye → chin", value: +after.face.eyeToChinMm.toFixed(1), unit: "mm", delta: `${(after.face.eyeToChinMm - before.face.eyeToChinMm).toFixed(1)} mm`, source: "metrics-youth.json → face.eyeToChinMm" },
      { label: "jaw / cheek", value: +after.face.jawToCheek.toFixed(3), delta: `${(after.face.jawToCheek - before.face.jawToCheek).toFixed(3)}`, source: "face fractions" },
      { label: "cheek share of head", value: pct(after.head.cheekShareOfHead), delta: `${((after.head.cheekShareOfHead - before.head.cheekShareOfHead) * 100).toFixed(1)} pts` },
    ],
  });
}

if (existsSync(headBefore) && existsSync(headAfter)) {
  blocks.push({
    kind: "compare",
    title: "Head, three-quarter view",
    before: { src: headBefore, alt: "Head before", caption: "without the youth pass", commit: commit || undefined },
    after: { src: headAfter, alt: "Head after", caption: "with the youth pass", commit: commit || undefined },
  });
}

const overlayPng = "artifacts/lelu2/research/baby-hair-overlay.png";
if (existsSync(overlayPng) && after.babyHair) {
  blocks.push({
    kind: "image",
    src: overlayPng,
    alt: "Baby hair placement overlay, rasterised from the strand records",
    caption: `Placement of all ${after.babyHair.count} strands in the front view, with her eye line (1578 mm) and hairline band visible. Front strands sit ~45 mm above the eyes: the hairline is high and the strands are 7–35 mm long, which is the sparse-forehead defect this overlay exposes.`,
    commit: commit || undefined,
  });
}

if (existsSync(overlay)) {
  blocks.push({
    kind: "image",
    src: overlay,
    alt: "Baby hair placement overlay",
    caption: after.babyHair
      ? `${after.babyHair.count} strands: ${after.babyHair.byRegion.front ?? 0} front, ${(after.babyHair.byRegion["temple-left"] ?? 0) + (after.babyHair.byRegion["temple-right"] ?? 0)} temples, ${(after.babyHair.byRegion["sideburn-left"] ?? 0) + (after.babyHair.byRegion["sideburn-right"] ?? 0)} sideburns, ${after.babyHair.byRegion.flyaway ?? 0} flyaways · hairline coverage ${after.babyHair.hairline.coveragePct.toFixed(0)} %`
      : "baby hair placement",
    commit: commit || undefined,
    measurements: after.babyHair
      ? [
          { label: "strands", value: after.babyHair.count },
          { label: "length", value: `${after.babyHair.lengthMm.min.toFixed(1)}–${after.babyHair.lengthMm.max.toFixed(1)}`, unit: "mm" },
          { label: "root Ø", value: `${after.babyHair.rootThicknessMm.min.toFixed(2)}–${after.babyHair.rootThicknessMm.max.toFixed(2)}`, unit: "mm" },
          { label: "skin collisions", value: after.babyHair.collision.penetrating ?? 0 },
        ]
      : undefined,
  });
}



const rows: Measurement[] = [
  { label: "eye → chin", value: +after.face.eyeToChinMm.toFixed(1), unit: "mm", delta: `${(after.face.eyeToChinMm - before.face.eyeToChinMm).toFixed(1)} mm` },
  { label: "lower third share", value: pct(after.face.lowerThirdShare), delta: `${((after.face.lowerThirdShare - before.face.lowerThirdShare) * 100).toFixed(1)} pts` },
  { label: "jaw width", value: +after.face.jawWidthMm.toFixed(1), unit: "mm", delta: `${(after.face.jawWidthMm - before.face.jawWidthMm).toFixed(1)} mm` },
  { label: "chin width", value: +after.face.chinWidthMm.toFixed(1), unit: "mm", delta: `${(after.face.chinWidthMm - before.face.chinWidthMm).toFixed(1)} mm` },
  { label: "chin / jaw", value: +after.face.chinToJaw.toFixed(3), delta: `${(after.face.chinToJaw - before.face.chinToJaw).toFixed(3)}` },
  { label: "baby hair strands", value: after.babyHair?.count ?? 0, delta: `${(after.babyHair?.count ?? 0) - (before.babyHair?.count ?? 0)}` },
  { label: "hairline coverage", value: pct(after.babyHair?.hairline.coveragePct ?? 0), delta: `${((after.babyHair?.hairline.coveragePct ?? 0) - (before.babyHair?.hairline.coveragePct ?? 0)).toFixed(0)} pts` },
];
blocks.push({
  kind: "measure",
  title: "What changed, measured on the mesh",
  rows,
  note: "Every value is read from the build's own metrics file, not typed in. Widths are measured at fixed fractions of the FACE (chin → eye line), so a lifted chin cannot silently re-sample a different part of the jaw.",
});

if (commit) blocks.push({ kind: "commit", sha: commit, subject: "LÉLU 2.3 — youth pass, baby-hair system, evidence in chat" });

/* --------------------------- publish the assets --------------------------- */

mkdirSync(PUBLIC_DIR, { recursive: true });
mkdirSync(OUT, { recursive: true });
const published = mapEvidenceImages(blocks, (image) => {
  const publicPath = publicEvidencePath(image.src);
  const target = `${PUBLIC_DIR}/${basename(publicPath)}`;
  if (existsSync(image.src)) copyFileSync(image.src, target);
  return { ...image, src: publicPath, hiRes: publicPath };
});

writeFileSync(`${OUT}/evidence-m23.json`, JSON.stringify(blocks, null, 1));
writeFileSync(`${OUT}/evidence-m23.md`, `${evidenceToMarkdown(blocks)}\n`);
writeFileSync(`${OUT}/evidence-m23.fence.txt`, `${evidenceFence(published)}\n`);

const images = evidenceImages(published);
console.log(`evidence: ${published.length} blocks, ${images.length} images → ${OUT}/evidence-m23.json`);
for (const image of images) console.log(`  ${existsSync(image.src.replace("/lelu2-evidence/", `${PUBLIC_DIR}/`)) ? "copied" : "MISSING"} ${image.src}`);
console.log(`fence → ${OUT}/evidence-m23.fence.txt`);
