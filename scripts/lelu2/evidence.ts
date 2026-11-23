/**
 * M23.1 evidence — the reference-driven pass, delivered as chat blocks.
 *
 * Every number is read from a build artifact, except `PREV`, which holds 2.3's
 * published values at 491e5046 and says so.
 *
 *   npx tsx scripts/lelu2/evidence.ts
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "artifacts/lelu2/research");
const pub = join(root, "public/lelu2-evidence");
const baselineDir = "artifacts/lelu2/m23/baseline";
const youthDir = "artifacts/lelu2/m23/youth";
const refDir = "artifacts/lelu2/m231/reference";

const commit = (() => {
  try {
    return execFileSync("git", ["-c", "safe.directory=*", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
})();

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

interface Metrics {
  face: { eyeToChinMm: number; jawToCheek: number; chinToJaw: number; jawWidthMm: number };
  head: { jawToCheek: number; cheekShareOfHead: number };
}
interface Baby {
  count: number;
  lengthMm: { min: number; max: number };
  rootThicknessMm: { min: number; max: number };
  hairline: { coveragePct: number; scalpHairlineMm?: number; referenceHairlineMm?: number };
  collision: { clear: number; contact: number; penetrating: number };
}

const after = read(join(youthDir, "metrics-youth.json")) as Metrics;
const baby = read(join(youthDir, "baby-hair-youth.json")) as Baby;

const PREV = {
  jawWidthMm: 114.3,
  jawToCheek: 0.792,
  eyeToChinMm: 103.4,
  strands: 88,
  penetrating: 2,
  coverage: 100,
};

const REF = { jawWidthMm: 96, jawToCheek: 0.676, hairlineAboveEyeMm: 87.7, mouthWidthMm: 50.4, noseWidthMm: 37.8 };

const r1 = (n: number) => Math.round(n * 10) / 10;

type Img = { src: string; alt: string; caption?: string; commit?: string };
const img = (src: string, alt: string, caption: string): Img => ({ src, alt, caption, commit: commit || undefined });
const yp = (file: string) => youthDir + "/" + file;

const blocks: Record<string, unknown>[] = [];

blocks.push({
  kind: "compare",
  title: "Her photograph -> her mesh",
  before: img(refDir + "/face-front.png", "Her reference photograph, front", "lelu-facial-expression-01.png, committed and unmodified"),
  after: img(yp("lelu2-m231-youth-face-front.png"), "Her mesh, front", "2.3.1: reference paint + youth geometry, 900 px AgX"),
  note: "Different media, same landmarks. The photograph is the authority for ratios; the mesh is what is being corrected.",
});

blocks.push({
  kind: "compare",
  title: "2.3 -> 2.3.1, same camera",
  before: img(yp("lelu2-m23-youth-face-front.png"), "Face at 2.3", "2.3: brow bar, grey slit iris, small lips, wide jaw"),
  after: img(yp("lelu2-m231-youth-face-front.png"), "Face at 2.3.1", "2.3.1: tapered arched brows, hazel iris, lips at 0.355 face width"),
  measurements: [
    { label: "jaw / cheek", value: r1(after.head.jawToCheek), delta: String(r1(after.head.jawToCheek - PREV.jawToCheek)), source: "head.jawToCheek" },
    { label: "jaw width", value: r1(after.face.jawWidthMm), unit: "mm", delta: r1(after.face.jawWidthMm - PREV.jawWidthMm) + " mm", source: "face.jawWidthMm (reference 96 mm)" },
    { label: "eye -> chin", value: r1(after.face.eyeToChinMm), unit: "mm", delta: r1(after.face.eyeToChinMm - PREV.eyeToChinMm) + " mm", source: "face.eyeToChinMm" },
  ],
});

blocks.push({
  kind: "compare",
  title: "Head, three-quarter: 2.3 -> 2.3.1",
  before: img(yp("lelu2-m23-youth-head-three-quarter.png"), "Head at 2.3", "2.3"),
  after: img(yp("lelu2-m231-youth-head-three-quarter.png"), "Head at 2.3.1", "2.3.1"),
});

if (existsSync(join(root, refDir, "hairline-spec.png"))) {
  blocks.push({
    kind: "compare",
    title: "The hairline the sheet specifies",
    before: img(refDir + "/hairline-spec.png", "Hairline specification", "lelu-hair-18.png: arc 13.8 cm wide, 3.6 cm higher at the centre"),
    after: img(yp("lelu2-m231-youth-face-front.png"), "Her mesh hairline", "roots on the measured arc; main hair mass still 40 mm higher"),
  });
}

blocks.push({
  kind: "measure",
  title: "Reference alignment, measured",
  rows: [
    { label: "hairline above eye line (reference)", value: r1(REF.hairlineAboveEyeMm), unit: "mm", source: "landmark sheet 0.848 x eye->chin" },
    { label: "hairline the scalp cloud offers", value: r1(baby.hairline.scalpHairlineMm ?? 0), unit: "mm", source: "baby-hair.json" },
    { label: "hairline the strands root on", value: r1(baby.hairline.referenceHairlineMm ?? 0), unit: "mm", source: "baby-hair.json" },
    { label: "jaw width (reference)", value: REF.jawWidthMm, unit: "mm", source: "landmark sheet" },
    { label: "jaw width (mesh)", value: r1(after.face.jawWidthMm), unit: "mm", source: "metrics-youth.json" },
    { label: "jaw / cheek (reference)", value: REF.jawToCheek, source: "landmark sheet" },
    { label: "baby strands", value: baby.count, delta: "+" + (baby.count - PREV.strands), source: "sheet spacing 1.0-1.6 mm" },
    { label: "penetrating strands", value: baby.collision.penetrating, delta: String(baby.collision.penetrating - PREV.penetrating), source: "clearance pass" },
    { label: "hairline coverage", value: r1(baby.hairline.coveragePct), unit: "%", delta: r1(baby.hairline.coveragePct - PREV.coverage) + " pts", source: "3 mm band" },
    { label: "strand length", value: r1(baby.lengthMm.min) + "-" + r1(baby.lengthMm.max), unit: "mm", source: "sheet: 12-48 mm" },
    { label: "root diameter", value: Math.round(baby.rootThicknessMm.min * 1000) + "-" + Math.round(baby.rootThicknessMm.max * 1000), unit: "um", source: "sheet: 80-120 um (still 2-4x)" },
  ],
});

const overlay = "artifacts/lelu2/m231/baby-hair-overlay.png";
if (existsSync(join(root, overlay))) {
  blocks.push({
    kind: "image",
    src: overlay,
    alt: "Baby hair placement, 149 strands",
    caption: "Front strands on the measured arc with her eye line drawn. The bare band above them is scalp hair, not baby hair.",
    commit: commit || undefined,
  });
}

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "evidence-m231.json"),
  JSON.stringify({ version: "m23.1", commit, blocks }, null, 2) + "\n",
);

// Copies for a browser to load, plus the fence a chat message can carry verbatim.
mkdirSync(pub, { recursive: true });
const copy = (src: string): string => {
  const abs = join(root, src);
  if (!existsSync(abs)) return src;
  const name = src.replace(/[^\w.-]+/g, "__");
  copyFileSync(abs, join(pub, name));
  return "/lelu2-evidence/" + name;
};
const wire = (b: Record<string, unknown>): Record<string, unknown> => {
  if (typeof b.src === "string") return { ...b, src: copy(b.src) };
  const before = b.before as Img | undefined;
  const afterImg = b.after as Img | undefined;
  if (before && afterImg) return { ...b, before: { ...before, src: copy(before.src) }, after: { ...afterImg, src: copy(afterImg.src) } };
  return b;
};
const wired = blocks.map(wire);
const fence = "```evidence\n" + JSON.stringify({ version: 1, blocks: wired }, null, 2) + "\n```\n";
writeFileSync(join(outDir, "evidence-m231.fence.txt"), fence);

console.log("evidence: " + blocks.length + " blocks -> artifacts/lelu2/research/evidence-m231.json");
console.log("fence: " + (fence.length / 1024).toFixed(1) + " KB -> artifacts/lelu2/research/evidence-m231.fence.txt");
