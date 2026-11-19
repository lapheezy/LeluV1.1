/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — CLI
 *
 *   npx tsx scripts/foundry/run.ts status
 *   npx tsx scripts/foundry/run.ts technologies
 *   npx tsx scripts/foundry/run.ts references
 *   npx tsx scripts/foundry/run.ts plan
 *   npx tsx scripts/foundry/run.ts render --shots face-close-up,profile [--samples 24]
 *   npx tsx scripts/foundry/run.ts benchmark [--samples 32] [--only face-close-up]
 *   npx tsx scripts/foundry/run.ts verify
 *   npx tsx scripts/foundry/run.ts chat "render her profile"
 *
 * The CLI is the reproducible path the report cites: every artifact under
 * artifacts/foundry is written by one of these commands.
 * ==========================================================
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { planExecution, probeHardware, summariseHardware } from "../../src/core/asre/foundry/capabilities.ts";
import { TECHNOLOGIES, auditLicences, chooseEngine, technologyBrief } from "../../src/core/asre/foundry/technologies.ts";
import { buildReferenceLibrary, describeLibrary, type ReferenceManifest } from "../../src/core/asre/foundry/references.ts";
import { planShots, shotById } from "../../src/core/asre/foundry/shots.ts";
import { addVersion, createProject, listProjects, listVersions, modelPath, readProject, readVersion, recordRender, restoreVersion, verifyProject } from "../../src/core/asre/foundry/project.ts";
import { foundryBlender, renderFoundryShot } from "../../src/core/asre/foundry/render.ts";
import { bboxOf, compareRenderToReference, maskFromImage, type RenderComparison } from "../../src/core/asre/foundry/compare.ts";
import { decodePng, type RgbaImage } from "../../src/core/asre/image/png.ts";
import { interpretFoundryIntent, shotsForIntent } from "../../src/core/asre/foundry/intents.ts";
import { inspectGlb, summariseInspection } from "../../src/core/asre/foundry/meshy.ts";
import { describeSources, locateSources } from "../../src/core/asre/foundry/sources.ts";
import { reconcile } from "../../src/core/asre/foundry/reconcile.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIFACTS = path.join(ROOT, "artifacts/foundry");
const STORE = path.join(ARTIFACTS, "store");
const METRICS = path.join(ROOT, "artifacts/lelu2/m23/youth/metrics-youth.json");
const HAIR = path.join(ROOT, "artifacts/lelu2/m23/youth/baby-hair-youth.json");
const MANIFEST = path.join(ROOT, "artifacts/lelu2/m231/reference-measurements.json");
const REFERENCES = path.join(ROOT, "reference-39");
const MODEL = path.join(ROOT, "artifacts/lelu2/m23/youth/lelu2-m23-youth-head.glb");
const FULL_MODEL = path.join(ROOT, "artifacts/lelu2/m23/youth/lelu2-m23-youth.glb");
/** The LÉLU character the project already owns (Meshy body + rig + head swap). */
const MESHY_MODEL = path.resolve(ROOT, "../leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb");

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const write = (rel: string, value: unknown) => {
  const file = path.join(ARTIFACTS, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
  return file;
};
const metrics = () => {
  try {
    return JSON.parse(readFileSync(METRICS, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};
const hair = () => {
  try {
    return JSON.parse(readFileSync(HAIR, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};
const decode = (file: string): RgbaImage => decodePng(new Uint8Array(readFileSync(file)), { inflate: (b) => new Uint8Array(inflateSync(b)) });

/** Compare, but refuse the number when the two framings are not comparable. */
function compare(renderFile: string, shotId: string): { comparison: RenderComparison; reference: string } | null {
  const shot = shotById(planShots((metrics() ?? {}) as never), shotId);
  if (!shot?.reference) return null;
  const reference = path.join(REFERENCES, shot.reference);
  if (!existsSync(reference) || !existsSync(renderFile)) return null;
  const render = decode(renderFile);
  const ref = decode(reference);
  const report = compareRenderToReference({ render, reference: ref, metrics: metrics(), hair: hair() });
  const aspect = (b: [number, number, number, number] | null) => (b ? (b[2] - b[0]) / Math.max(1, b[3] - b[1]) : 0);
  const aa = aspect(bboxOf(maskFromImage(render)));
  const ab = aspect(bboxOf(maskFromImage(ref)));
  if (aa > 0 && ab > 0 && Math.abs(aa - ab) / ab > 0.35) {
    report.notes.push(`framing differs: render aspect ${aa.toFixed(2)} vs reference ${ab.toFixed(2)} — no silhouette verdict is claimed`);
    report.verdict = "unknown";
  }
  return { comparison: report, reference: shot.reference };
}

function ensureProject(): { projectId: string; versionId: string } {
  const projectId = "lelu";
  if (!listProjects(STORE).some((p) => p.id === projectId)) createProject(STORE, { id: projectId, name: "LÉLU", subject: "lelu-canonical" });
  const source = existsSync(FULL_MODEL) ? FULL_MODEL : MODEL;
  if (!existsSync(source)) throw new Error(`no built model at ${source} — run: npm run m23:youth`);
  const digest = sha256(readFileSync(source));
  const existing = listVersions(STORE, projectId).find((v) => v.model.sha256 === digest);
  if (existing) return { projectId, versionId: existing.id };
  const m = metrics();
  const version = addVersion(STORE, projectId, {
    sourceGlb: source,
    label: "2.3.1 youth identity pass (reference-measured)",
    operation: "import",
    triangles: typeof m?.triangles === "number" ? m.triangles : null,
    spec: { variant: "youth", identity: String(m?.identity ?? "lelu-canonical"), foundation: m?.foundation ?? null, metricsPath: path.relative(ROOT, METRICS) },
    notes: ["imported from the m23:youth build; the store copied the bytes and hashed them"],
  });
  return { projectId, versionId: version.id };
}

async function cmdStatus() {
  const hardware = probeHardware();
  const audit = auditLicences();
  const brief = technologyBrief();
  const file = write("hardware.json", { hardware, summary: summariseHardware(hardware), audit, brief, blenderScript: path.join(ROOT, "scripts/blender/lelu_foundry_render.py") });
  console.log(summariseHardware(hardware));
  console.log(`Blender: ${foundryBlender() ?? "NOT FOUND"}`);
  console.log(`Engines: human=${chooseEngine("human-from-photos", Boolean(hardware.gpu)).chosen?.id} render=${chooseEngine("render", Boolean(hardware.gpu)).chosen?.id} prop=${chooseEngine("prop-from-photo", Boolean(hardware.gpu)).chosen?.id}`);
  console.log(`Licences: ${audit.adopt} adopted / ${audit.optional} optional / ${audit.reject} rejected; violations: ${audit.violations.length}`);
  for (const reason of audit.violations) console.log(`  VIOLATION ${reason}`);
  console.log(`Wrote ${path.relative(ROOT, file)}`);
}

function cmdTechnologies() {
  const audit = auditLicences();
  const file = write("licenses.json", { verifiedOn: "2026-11-19", technologies: TECHNOLOGIES, audit, brief: technologyBrief() });
  for (const t of TECHNOLOGIES) console.log(`${t.decision.padEnd(8)} ${t.id.padEnd(18)} commercial=${t.commercial.padEnd(10)} account=${t.account ? "yes" : "no "} ${t.codeLicense}`);
  console.log(`\n${audit.adopt} adopted, ${audit.optional} optional, ${audit.reject} rejected; ${audit.violations.length} policy violation(s)`);
  console.log(`Wrote ${path.relative(ROOT, file)}`);
}

function cmdSources() {
  const set = locateSources({ root: ROOT, workspace: path.resolve(ROOT, "..") });
  const file = write("sources.json", set);
  console.log(describeSources(set));
  for (const c of set.conflicts) console.log(`\nconflict ${c.component} (${c.between.join(" vs ")}): ${c.resolution}`);
  console.log(`\nWrote ${path.relative(ROOT, file)}`);
}

function cmdMeshyIngest() {
  if (!existsSync(MESHY_MODEL)) throw new Error(`the Meshy character is not at ${MESHY_MODEL}`);
  const { projectId } = ensureProject();
  const inspection = inspectGlb(MESHY_MODEL);
  const existing = listVersions(STORE, projectId).find((v) => v.model.sha256 === inspection.sha256);
  const version = existing ?? addVersion(STORE, projectId, {
    sourceGlb: MESHY_MODEL,
    label: "Meshy LÉLU baseline (the owned character, bytes unchanged)",
    operation: "import",
    triangles: inspection.counts.triangles,
    spec: {
      source: "meshy",
      authority: { identity: "photographs", geometry: "meshy", scaffold: "cc0" },
      heightM: inspection.heightM,
      joints: inspection.counts.joints,
      morphTargets: inspection.counts.morphTargets,
      textures: inspection.textures.map((t) => `${t.width}x${t.height} ${t.mimeType}`),
      provenance: "fj_mvvfg2o3_ebd9c0 body → fj_mvvnf4v9_1ded97 rig → fj_mvvnvqa1_b5672e head → fj_mvwaqbim_55226d head swap",
    },
    notes: [
      `immutable baseline: ${inspection.sha256}`,
      "the original file in leluverse/ is never written by the Foundry; corrections become new versions",
      "renders of this version keep the shipped PBR textures (materials:false) so the comparison is about the asset",
    ],
  });
  console.log(`${existing ? "already present as" : "ingested as"} ${version.id} (${version.model.sha256.slice(0, 16)}) in ${projectId}`);
  for (const v of listVersions(STORE, projectId)) console.log(`  ${v.id} ${v.label}`);
}

function cmdReconcile() {
  const inspection = existsSync(MESHY_MODEL) ? inspectGlb(MESHY_MODEL) : null;
  const result = reconcile({ inspection, metrics: metrics(), hair: hair(), meshyRenders: "artifacts/foundry/meshy/renders", foundryRenders: "artifacts/foundry/benchmark" });
  const file = write("meshy/reconciliation.json", result);
  for (const v of result.verdicts) console.log(`${String(v.priority).padStart(2)} ${v.component.padEnd(18)} ${v.decision.padEnd(10)} authority=${v.authority.padEnd(12)} applied=${v.applied}`);
  console.log(`\n${result.counts.preserve} preserve, ${result.counts.deform} deform, ${result.counts.rebuild} rebuild, ${result.counts.supplement} supplement. Wrote ${path.relative(ROOT, file)}`);
}

function cmdMeshy() {
  if (!existsSync(MESHY_MODEL)) throw new Error(`the Meshy character is not at ${MESHY_MODEL}`);
  const inspection = inspectGlb(MESHY_MODEL);
  const provenance = [
    path.resolve(path.dirname(MESHY_MODEL), "../v001_rigging_01a18f4e/provenance.json"),
    path.resolve(path.dirname(MESHY_MODEL), "report.json"),
  ].filter((f) => existsSync(f));
  const file = write("meshy/inspection.json", {
    inspectedAt: new Date().toISOString(),
    relative: path.relative(path.resolve(ROOT, ".."), MESHY_MODEL),
    inspection,
    provenance: provenance.map((f) => ({ file: path.relative(path.resolve(ROOT, ".."), f), content: JSON.parse(readFileSync(f, "utf8")) })),
    siblingVersions: ["v004_headswap_mvvnvqa1", "v002_headswap_mvvnvqa1", "v003_headswap_mvvnvqa1"].map((d) => {
      const glb = path.resolve(path.dirname(MESHY_MODEL), "..", d, "lelu.glb");
      return existsSync(glb) ? { dir: d, bytes: readFileSync(glb).length, sha256: sha256(readFileSync(glb)) } : null;
    }).filter(Boolean),
  });
  console.log(summariseInspection(inspection));
  console.log(`sha256 ${inspection.sha256}`);
  console.log(`textures: ${inspection.textures.map((t) => `${t.width}×${t.height} ${t.mimeType} ${(t.bytes / 1024).toFixed(0)} KB`).join(", ") || "none"}`);
  console.log(`materials: ${inspection.materials.join(", ") || "none"}`);
  console.log(`clips: ${inspection.animations.length}, joints: ${inspection.counts.joints}, shape keys: ${inspection.counts.morphTargets}`);
  console.log(`Wrote ${path.relative(ROOT, file)}`);
}

function cmdReferences() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as ReferenceManifest;
  const library = buildReferenceLibrary(manifest);
  const verified = library.records.map((r) => {
    const file = path.join(REFERENCES, r.collection, r.file);
    const actual = existsSync(file) ? sha256(readFileSync(file)) : null;
    return { file: r.file, recorded: r.sha256, actual, ok: actual === r.sha256 };
  });
  const file = write("references.json", { summary: describeLibrary(library), library, verified: verified.filter((v) => v.ok).length, unverified: verified.filter((v) => !v.ok) });
  console.log(describeLibrary(library));
  console.log(`Hashes verified against reference-39: ${verified.filter((v) => v.ok).length}/${verified.length}`);
  console.log(`Specification sheets: ${library.specSheets.join(", ")}`);
  console.log(`Wrote ${path.relative(ROOT, file)}`);
}

function cmdPlan() {
  const shots = planShots((metrics() ?? {}) as never);
  const hardware = probeHardware();
  const file = write("shots.json", {
    subject: "lelu",
    source: path.relative(ROOT, METRICS),
    shots: shots.map((s) => ({ ...s, plan: planExecution({ id: `render:${s.id}`, need: "cpu", ramGb: 2, minutes: 2 }, hardware) })),
  });
  for (const s of shots) console.log(`${String(s.index).padStart(2)} ${s.id.padEnd(22)} ${s.view.padEnd(14)} ${s.resolution.join("×")} ${s.camera ? "explicit" : "measured bounds"}  ${s.proves}`);
  console.log(`Wrote ${path.relative(ROOT, file)}`);
}

function cmdVerify() {
  const { projectId } = ensureProject();
  const verification = verifyProject(STORE, projectId);
  const file = write("verification.json", verification);
  for (const v of verification.versions) console.log(`${v.ok ? "OK  " : "FAIL"} ${v.id} ${v.bytes} bytes ${v.actual.slice(0, 12)}`);
  console.log(`Wrote ${path.relative(ROOT, file)}`);
}

async function renderShots(ids: string[], samples?: number) {
  const { projectId, versionId } = ensureProject();
  const all = planShots((metrics() ?? {}) as never);
  const chosen = ids.map((id) => {
    const shot = shotById(all, id);
    if (!shot) throw new Error(`no shot "${id}"`);
    return shot;
  });
  const hardware = probeHardware();
  const outDir = path.join(ARTIFACTS, "benchmark");
  mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const shot of chosen) {
    const plan = planExecution({ id: `render:${shot.id}`, need: "cpu", ramGb: 2, minutes: 2 }, hardware);
    console.log(`… ${shot.id} (${shot.view}, ${shot.resolution.join("×")}, ${samples ? Math.min(samples, shot.samples) : shot.samples} samples)`);
    const render = await renderFoundryShot({ glb: FULL_MODEL, outDir, shot, plan, sampleCap: samples });
    if (render.ok && render.png) console.log(`  ok ${render.seconds}s → ${path.relative(ROOT, render.png)}`);
    else console.log(`  FAILED ${render.error}`);
    const found = render.ok && render.png ? compare(render.png, shot.id) : null;
    if (render.ok && render.png) recordRender(STORE, projectId, versionId, { shot: shot.id, png: render.png, seconds: render.seconds, camera: render.report?.camera_blender_zup ?? null, comparison: found?.comparison ?? null });
    results.push({
      shot: shot.id,
      title: shot.title,
      proves: shot.proves,
      ok: render.ok,
      png: render.png ? path.relative(ROOT, render.png) : null,
      seconds: render.seconds,
      error: render.error,
      plan: render.plan,
      camera: render.report?.camera_blender_zup ?? null,
      render: render.report,
      comparison: found?.comparison ?? null,
      reference: found?.reference ?? null,
    });
  }
  return { projectId, versionId, results, hardware };
}

async function renderMeshy(ids: string[], samples?: number) {
  const hardware = probeHardware();
  const all = planShots((metrics() ?? {}) as never);
  const outDir = path.join(ARTIFACTS, "meshy/renders");
  mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const id of ids) {
    const shot = shotById(all, id);
    if (!shot) throw new Error(`no shot "${id}"`);
    const plan = planExecution({ id: `render:${shot.id}`, need: "cpu", ramGb: 3, minutes: 4 }, hardware);
    // WP07: identical camera and lighting. The CC0 benchmark's own camera is
    // read back from its render report and forced onto this asset, so a framing
    // difference can never be mistaken for a geometry difference.
    const cc0Report = path.join(ARTIFACTS, `benchmark/${shot.id}.png.json`);
    let identical = shot;
    if (existsSync(cc0Report)) {
      const report = JSON.parse(readFileSync(cc0Report, "utf8")) as { camera_blender_zup?: { center: number[]; radius: number; lens_mm?: number } };
      const cam = report.camera_blender_zup;
      if (cam) identical = { ...shot, camera: { center: cam.center as [number, number, number], radius: cam.radius }, lens: cam.lens_mm ?? shot.lens };
    }
    console.log(`… meshy ${shot.id} (${shot.view}, ${shot.resolution.join("×")}, ${samples ? Math.min(samples, shot.samples) : shot.samples} samples)`);
    // materials:false keeps the Meshy PBR textures exactly as shipped — the
    // comparison is about geometry and texture, not about the foundry's shaders.
    const render = await renderFoundryShot({ glb: MESHY_MODEL, outDir, shot: identical, plan, sampleCap: samples, materials: false, restPose: true, exclude: ["Icosphere"] });
    if (render.ok && render.png) console.log(`  ok ${render.seconds}s → ${path.relative(ROOT, render.png)}`);
    else console.log(`  FAILED ${render.error}`);
    results.push({ shot: shot.id, ok: render.ok, png: render.png ? path.relative(ROOT, render.png) : null, seconds: render.seconds, error: render.error, camera: render.report?.camera_blender_zup ?? null, triangles: render.report?.triangles ?? null, render: render.report });
  }
  const file = write("meshy/renders.json", { generatedAt: new Date().toISOString(), model: path.relative(ROOT, MESHY_MODEL), sha256: sha256(readFileSync(MESHY_MODEL)), materials: "as shipped (no foundry shader pass)", restPose: true, results });
  console.log(`\n${results.filter((r) => r.ok).length} rendered, ${results.filter((r) => !r.ok).length} failed. Wrote ${path.relative(ROOT, file)}`);
  return results;
}

async function cmdBenchmark(samples?: number, only?: string) {
  const ids = only ? only.split(",") : planShots((metrics() ?? {}) as never).map((s) => s.id);
  const run = await renderShots(ids, samples);
  const report = {
    generatedAt: new Date().toISOString(),
    project: run.projectId,
    version: run.versionId,
    hardware: run.hardware,
    blender: foundryBlender(),
    metricsSource: path.relative(ROOT, METRICS),
    model: path.relative(ROOT, FULL_MODEL),
    shots: run.results,
    rendered: run.results.filter((r) => r.ok).length,
    failed: run.results.filter((r) => !r.ok).length,
  };
  const file = write("benchmark/report.json", report);
  console.log(`\n${report.rendered} rendered, ${report.failed} failed. Wrote ${path.relative(ROOT, file)}`);
  for (const r of run.results) {
    const c = r.comparison;
    console.log(`${r.ok ? "OK  " : "FAIL"} ${r.shot.padEnd(22)} ${c ? `${c.verdict.padEnd(8)} ${c.silhouette.usable ? `IoU ${c.silhouette.iou.toFixed(3)}` : "silhouette not measurable"}` : ""}`);
  }
}

function chat(message: string) {
  const intent = interpretFoundryIntent(message);
  const { projectId, versionId } = ensureProject();
  console.log(`operation=${intent.operation} shots=${shotsForIntent(intent).join(",") || "—"} (${intent.because.join("; ") || "no keyword"})`);
  if (intent.operation === "explain") {
    const version = readVersion(STORE, projectId, versionId);
    console.log(`Version ${version.id}: validation ${version.validation?.verdict ?? "unvalidated"}; ${version.renders.length} render(s). ${version.validation?.notes?.join(" ") ?? ""}`);
    return;
  }
  if (intent.operation === "restore") {
    if (!intent.version) return console.log("Name the version to restore.");
    const v = restoreVersion(STORE, projectId, intent.version);
    return console.log(`Restored ${intent.version} as ${v.id}; nothing deleted.`);
  }
  if (intent.operation === "versions") {
    for (const v of listVersions(STORE, projectId)) console.log(`${v.id} ${v.label} — ${v.validation?.verdict ?? "unvalidated"}`);
    return;
  }
  console.log("This CLI answers render/benchmark/versions/restore/explain; the API (/api/foundry/chat) answers the whole vocabulary in the app.");
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "status":
    await cmdStatus();
    break;
  case "technologies":
    cmdTechnologies();
    break;
  case "references":
    cmdReferences();
    break;
  case "meshy":
    cmdMeshy();
    break;
  case "sources":
    cmdSources();
    break;
  case "reconcile":
    cmdReconcile();
    break;
  case "meshy-ingest":
    cmdMeshyIngest();
    break;
  case "plan":
    cmdPlan();
    break;
  case "verify":
    cmdVerify();
    break;
  case "render":
    await renderShots((arg("shots") ?? "face-close-up,portrait-front").split(","), arg("samples") ? Number(arg("samples")) : undefined);
    break;
  case "benchmark":
    await cmdBenchmark(arg("samples") ? Number(arg("samples")) : undefined, arg("only"));
    break;
  case "meshy-render":
    await renderMeshy((arg("shots") ?? "face-close-up,portrait-front,profile").split(","), arg("samples") ? Number(arg("samples")) : undefined);
    break;
  case "chat":
    chat(rest.join(" ") || arg("message") || "");
    break;
  case "projects":
    for (const p of listProjects(STORE)) console.log(`${p.id} head=${p.head} versions=${p.versions.length}`);
    break;
  case "model":
    console.log(modelPath(STORE, rest[0] ?? "lelu").file);
    break;
  default:
    console.log("usage: status | technologies | references | meshy | meshy-ingest | sources | reconcile | plan | render --shots a,b [--samples n] | benchmark [--only id] [--samples n] | verify | projects | model | chat \"…\"");
    if (command) process.exitCode = 2;
}
