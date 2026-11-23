/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — SERVER API (zero spend, local only)
 *
 *   GET  /api/foundry/status                 hardware, engines, licences, projects
 *   GET  /api/foundry/technologies            the audited decision matrix
 *   GET  /api/foundry/references              the 39-photograph library
 *   GET  /api/foundry/shots                   the 13 benchmark shots, planned from measured landmarks
 *   GET  /api/foundry/projects                every Foundry project
 *   POST /api/foundry/projects                { id, name?, subject? }
 *   GET  /api/foundry/projects/<id>            record + immutable version summaries
 *   POST /api/foundry/projects/<id>/versions   { sourceGlb, label, operation, triangles? }
 *   POST /api/foundry/projects/<id>/restore    { version } → a NEW version
 *   GET  /api/foundry/projects/<id>/verify     re-hash every stored model
 *   GET  /api/foundry/projects/<id>/versions/<v>/glb
 *   POST /api/foundry/render                  { project, shots, version?, samples? } → PNGs + comparisons
 *   POST /api/foundry/compare                 { project, version?, shot } → the measured comparison
 *   POST /api/foundry/chat                    { message } → the operation it mapped to, executed
 *   GET  /api/foundry/assets/<path>           renders, GLBs, JSON
 *
 * Every route answers with what actually happened. A render that fails says so
 * and its Blender log stays beside the image; a comparison that cannot be made
 * says "not measurable" instead of inventing a score.
 * ==========================================================
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { crossOrigin, readBody, type ConnectLikeReq, type ConnectLikeRes } from "./modelApi.ts";
import { planExecution, probeHardware, summariseHardware, type HardwareProfile } from "../src/core/asre/foundry/capabilities.ts";
import { TECHNOLOGIES, auditLicences, chooseEngine, technologyBrief } from "../src/core/asre/foundry/technologies.ts";
import { locateSources } from "../src/core/asre/foundry/sources.ts";
import { buildReferenceLibrary, describeLibrary, type ReferenceManifest } from "../src/core/asre/foundry/references.ts";
import { planShots, shotById } from "../src/core/asre/foundry/shots.ts";
import { addVersion, createProject, listProjects, listVersions, modelPath, readProject, readVersion, recordExport, recordRender, restoreVersion, verifyProject } from "../src/core/asre/foundry/project.ts";
import { foundryBlender, renderFoundryShot } from "../src/core/asre/foundry/render.ts";
import { bboxOf, compareRenderToReference, maskFromImage, type RenderComparison } from "../src/core/asre/foundry/compare.ts";
import { decodePng, type RgbaImage } from "../src/core/asre/image/png.ts";
import { interpretFoundryIntent, shotsForIntent, type FoundryIntent } from "../src/core/asre/foundry/intents.ts";

type EnvReader = (name: string) => string | undefined;
type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

const MOUNT = "/api/foundry";
const MIME: Record<string, string> = { ".png": "image/png", ".glb": "model/gltf-binary", ".json": "application/json", ".svg": "image/svg+xml" };

function send(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function fileBytes(res: ConnectLikeRes, file: string): void {
  const bytes = readFileSync(file);
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
  res.setHeader("Content-Length", String(bytes.length));
  res.setHeader("Cache-Control", "no-store");
  (res as ConnectLikeRes & { end: (b?: string | Uint8Array) => void }).end(bytes);
}

export interface FoundryApiOptions {
  root?: string;
  metricsPath?: string;
  hairPath?: string;
  referenceRoot?: string;
  manifestPath?: string;
  env?: NodeJS.ProcessEnv;
}

export function createFoundryApi(readEnv: EnvReader, options: FoundryApiOptions = {}) {
  const cwd = process.cwd();
  // The SAME store the CLI writes (scripts/foundry/run.ts → artifacts/foundry/store).
  // An empty env var must not become the process cwd (path.resolve("") == cwd).
  const root = path.resolve(options.root || readEnv("LELU_FOUNDRY_ROOT") || path.join(cwd, "artifacts", "foundry", "store"));
  const metricsPath = options.metricsPath ?? path.join(cwd, "artifacts/lelu2/m23/youth/metrics-youth.json");
  const hairPath = options.hairPath ?? path.join(cwd, "artifacts/lelu2/m23/youth/baby-hair-youth.json");
  const referenceRoot = options.referenceRoot ?? path.join(cwd, "reference-39");
  const manifestPath = options.manifestPath ?? path.join(cwd, "artifacts/lelu2/m231/reference-measurements.json");

  let hardwareCache: { at: number; value: HardwareProfile } | null = null;
  function hardware(): HardwareProfile {
    const now = Date.now();
    if (!hardwareCache || now - hardwareCache.at > 60_000) hardwareCache = { at: now, value: probeHardware(options.env ?? process.env) };
    return hardwareCache.value;
  }
  function metrics(): Record<string, unknown> | null {
    try {
      return JSON.parse(readFileSync(metricsPath, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  function hair(): Record<string, unknown> | null {
    try {
      return JSON.parse(readFileSync(hairPath, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  function library() {
    try {
      return buildReferenceLibrary(JSON.parse(readFileSync(manifestPath, "utf8")) as ReferenceManifest);
    } catch {
      return null;
    }
  }
  function shots() {
    return planShots((metrics() ?? {}) as unknown as Parameters<typeof planShots>[0]);
  }
  function inside(rel: string): string | null {
    const abs = path.resolve(root, rel);
    return abs === root || abs.startsWith(root + path.sep) ? abs : null;
  }

  const json = async (req: ConnectLikeReq): Promise<Record<string, unknown>> => {
    try {
      return JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>;
    } catch {
      throw new Error("the request body is not JSON");
    }
  };

  function status() {
    const hw = hardware();
    return {
      hardware: {
        ...hw,
        summary: summariseHardware(hw),
        ramGb: hw.totalRamGb,
        vramGb: hw.gpu?.vramGb ?? 0,
      },
      blender: Boolean(foundryBlender(options.env ?? process.env)),
      blenderScript: path.join(cwd, "scripts/blender/lelu_foundry_render.py"),
      engines: [chooseEngine("human-from-photos", Boolean(hw.gpu)), chooseEngine("render", Boolean(hw.gpu)), chooseEngine("prop-from-photo", Boolean(hw.gpu))].map((c) => ({
        kind: c.kind,
        chosen: c.chosen?.name ?? null,
        reason: c.reason,
        blocked: c.blocked.map((b) => b.id),
      })),
      licences: auditLicences(),
      brief: technologyBrief(),
      references: library() ? describeLibrary(library()!) : "no reference manifest found",
      shots: shots().length,
      projects: listProjects(root).map((p) => ({ id: p.id, name: p.name, head: p.head, versions: p.versions.length })),
      spend: "zero — local Blender, local reconstruction, no account, no paid API",
    };
  }

  function comparisonFor(renderPath: string, shotId: string): { comparison: RenderComparison; reference: string } | null {
    const shot = shotById(shots(), shotId);
    if (!shot?.reference) return null;
    const reference = path.join(referenceRoot, shot.reference);
    if (!existsSync(reference) || !existsSync(renderPath)) return null;
    const read = (file: string): RgbaImage => decodePng(new Uint8Array(readFileSync(file)), { inflate: (b) => new Uint8Array(inflateSync(b)) });
    const render = read(renderPath);
    const ref = read(reference);
    const report = compareRenderToReference({ render, reference: ref, metrics: metrics(), hair: hair() });
    // A close-up and a full portrait cannot be compared by normalised silhouette;
    // saying so is more useful than a number that measures the crop.
    const ra = bboxOf(maskFromImage(render));
    const rb = bboxOf(maskFromImage(ref));
    const aspect = (b: [number, number, number, number] | null) => (b ? (b[2] - b[0]) / Math.max(1, b[3] - b[1]) : 0);
    const aa = aspect(ra), ab = aspect(rb);
    if (aa > 0 && ab > 0 && Math.abs(aa - ab) / ab > 0.35) {
      report.notes.push(`framing differs: render aspect ${aa.toFixed(2)} vs reference ${ab.toFixed(2)} — the silhouette score is not a fair comparison and the verdict is withheld`);
      report.verdict = "unknown";
    }
    return { comparison: report, reference: shot.reference };
  }

  interface RenderOne {
    shot: string;
    ok: boolean;
    url: string | null;
    file: string | null;
    error: string | null;
    seconds: number;
    plan: string;
    report: Record<string, unknown> | null;
    comparison: RenderComparison | null;
  }

  async function renderShots(body: Record<string, unknown>): Promise<{ version: string; results: RenderOne[]; rendered: number; failed: number }> {
    const projectId = String(body.project ?? "lelu");
    const project = readProject(root, projectId);
    if (!project.head) throw new Error(`project "${projectId}" has no versions — add one before rendering`);
    const { version, file: glb } = modelPath(root, projectId, typeof body.version === "string" ? body.version : undefined);
    const all = shots();
    const requested = Array.isArray(body.shots) && body.shots.length ? (body.shots as string[]).map(String) : ["face-close-up", "portrait-front"];
    if (requested.length > 4) throw new Error("at most four shots per request: a synchronous render is for review, the CLI is for the full benchmark");
    const chosen = requested.map((id) => {
      const shot = shotById(all, id);
      if (!shot) throw new Error(`no shot "${id}" (have ${all.map((s) => s.id).join(", ")})`);
      return shot;
    });
    const hw = hardware();
    const outDir = path.join(root, "renders", projectId, version.id);
    mkdirSync(outDir, { recursive: true });
    const results: RenderOne[] = [];
    for (const shot of chosen) {
      const plan = planExecution({ id: `render:${shot.id}`, need: "cpu", ramGb: 2, minutes: 2 }, hw);
      const render = await renderFoundryShot({ glb, outDir, shot, plan, env: options.env ?? process.env, sampleCap: typeof body.samples === "number" ? body.samples : undefined });
      let comparison: RenderComparison | null = null;
      if (render.ok && render.png) {
        comparison = comparisonFor(render.png, shot.id)?.comparison ?? null;
        recordRender(root, projectId, version.id, { shot: shot.id, png: render.png, seconds: render.seconds, camera: render.report?.camera_blender_zup ?? null, comparison });
        if (comparison) {
          const current = readVersion(root, projectId, version.id);
          current.validation = {
            verdict: comparison.verdict,
            landmarks: comparison.landmarks,
            hair: comparison.hair,
            notes: comparison.notes,
            validatedAt: new Date().toISOString(),
          };
          writeFileSync(path.join(root, "projects", projectId, "versions", version.id, "record.json"), `${JSON.stringify(current, null, 1)}\n`);
        }
      }
      results.push({
        shot: shot.id,
        ok: render.ok,
        url: render.ok ? `/api/foundry/assets/renders/${projectId}/${version.id}/${shot.id}.png` : null,
        file: render.png,
        error: render.error,
        seconds: render.seconds,
        plan: render.plan.backend,
        report: render.report,
        comparison,
      });
    }
    return { version: version.id, results, rendered: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }

  function compareShot(body: Record<string, unknown>) {
    const projectId = String(body.project ?? "lelu");
    const project = readProject(root, projectId);
    const versionId = typeof body.version === "string" && body.version ? body.version : project.head;
    if (!versionId) throw new Error(`project "${projectId}" has no versions`);
    const version = readVersion(root, projectId, versionId);
    const shotId = String(body.shot ?? "face-close-up");
    const stored = version.renders.find((r) => r.shot === shotId);
    if (!stored) throw new Error(`version ${versionId} has no "${shotId}" render yet — render it first`);
    const found = comparisonFor(path.join(root, "projects", projectId, stored.file), shotId);
    if (!found) throw new Error(`shot "${shotId}" has no reference photograph available`);
    return { project: projectId, version: versionId, shot: shotId, ...found };
  }

  function answer(intent: FoundryIntent, body: Record<string, unknown>): string {
    const projectId = String(body.project ?? "lelu");
    const project = (() => {
      try {
        return readProject(root, projectId);
      } catch {
        return null;
      }
    })();
    switch (intent.operation) {
      case "status": {
        const s = status();
        return `${s.hardware.summary}. Blender ${s.blender ? "is" : "is NOT"} available. ${s.references}. Adopted: ${s.brief.adopted.join("; ")}. Refused: ${s.brief.rejected.map((r) => `${r.id} (${r.why})`).join("; ")}.`;
      }
      case "references": {
        const lib = library();
        if (!lib) return "No reference manifest is present, so I cannot claim anything about the photographs.";
        const scales = lib.records.filter((r) => r.scale).length;
        return `${describeLibrary(lib)} ${scales} file(s) carry a pixel→millimetre estimate (all low confidence: a single photograph has perspective). Specification sheets: ${lib.specSheets.map((s) => s.replace(/\.png$/, "")).join(", ")}.`;
      }
      case "research": {
        const audit = auditLicences();
        return `${audit.total} candidates audited: ${audit.adopt} adopted, ${audit.optional} optional, ${audit.reject} rejected. Commercial-clean: ${audit.commercialOk.join(", ")}. Restricted or unlicensed: ${audit.restricted.join(", ") || "none"}. Gated behind an account: ${audit.gated.join(", ") || "none"}.${audit.violations.length ? ` POLICY VIOLATIONS: ${audit.violations.join("; ")}` : ""}`;
      }
      case "versions": {
        if (!project) return `There is no Foundry project "${projectId}" yet.`;
        const versions = listVersions(root, projectId);
        return `${projectId}: head ${project.head}, ${versions.length} immutable version(s) — ${versions.map((v) => `${v.id} ${v.label} (${v.triangles?.toLocaleString() ?? "?"} tris, ${v.validation?.verdict ?? "unvalidated"})`).join("; ")}.`;
      }
      case "restore": {
        if (!intent.version) return "Name the version to restore (for example v0001).";
        const restored = restoreVersion(root, projectId, intent.version);
        return `Restored ${intent.version} as new version ${restored.id}. The original is untouched.`;
      }
      case "export": {
        if (!project?.head) return `There is nothing to export in "${projectId}" yet.`;
        const { version, file } = modelPath(root, projectId, intent.version ?? undefined);
        const outDir = path.join(root, "exports");
        mkdirSync(outDir, { recursive: true });
        const target = path.join(outDir, `${projectId}-${version.id}.glb`);
        writeFileSync(target, readFileSync(file));
        recordExport(root, projectId, version.id, "glb", path.relative(root, target));
        return `Exported ${projectId} ${version.id} as GLB: /api/foundry/assets/exports/${projectId}-${version.id}.glb. OBJ/FBX/BLEND go through the existing Forge Blender export gate (asre.export), not a second exporter.`;
      }
      case "explain": {
        if (!project?.head) return `There is no version to explain in "${projectId}".`;
        const version = readVersion(root, projectId, project.head);
        const failedRenders = version.renders.length === 0 ? "no render has been recorded for this version, so nothing has been visually verified" : `${version.renders.length} render(s) recorded`;
        const outside = Array.isArray((version.validation?.landmarks as Array<{ status?: string; feature?: string }>) ?? [])
          ? ((version.validation?.landmarks as Array<{ status?: string; feature?: string }>) ?? []).filter((l) => l.status === "outside").map((l) => l.feature)
          : [];
        return `Version ${version.id} ("${version.label}"): validation ${version.validation?.verdict ?? "unvalidated"} — ${failedRenders}.${outside.length ? ` Features outside tolerance: ${outside.join(", ")}.` : ""} ${
          version.validation?.notes?.join(" ") ?? ""
        } A failure is preserved with its log beside the image; it is never replaced by a claim.`;
      }
      default:
        return "";
    }
  }

  async function handle(req: ConnectLikeReq, res: ConnectLikeRes, _next: () => void): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    const raw = (req.url ?? "").split("?")[0];
    const route = raw.startsWith(MOUNT) ? raw.slice(MOUNT.length) || "/" : raw || "/";
    const parts = route.split("/").filter(Boolean).map(decodeURIComponent);
    if (method !== "GET" && crossOrigin(req)) return send(res, { ok: false, error: "Cross-origin Foundry requests are refused." }, 403);
    try {
      if (method === "GET" && parts[0] === "status") return send(res, { ok: true, ...status() });
      if (method === "GET" && parts[0] === "technologies") return send(res, { ok: true, technologies: TECHNOLOGIES, audit: auditLicences(), brief: technologyBrief() });
      if (method === "GET" && parts[0] === "references") {
        const lib = library();
        if (!lib) return send(res, { ok: false, error: `no reference manifest at ${manifestPath}` }, 404);
        return send(res, { ok: true, library: lib, summary: describeLibrary(lib) });
      }
      if (method === "GET" && parts[0] === "shots") return send(res, { ok: true, shots: shots(), metrics: metricsPath });
      // The three sources, and the owned Meshy character they are ordered around.
      if (method === "GET" && parts[0] === "sources") {
        return send(res, { ok: true, ...locateSources({ root: cwd, workspace: path.resolve(cwd, "..") }) });
      }
      if (method === "GET" && parts[0] === "meshy") {
        const dir = path.join(path.dirname(root), "meshy");
        const read = (name: string) => {
          const file = path.join(dir, name);
          return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
        };
        const provenance = path.resolve(cwd, "../leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb");
        return send(res, {
          ok: true,
          found: existsSync(provenance),
          location: path.relative(path.resolve(cwd, ".."), provenance),
          inspection: read("inspection.json"),
          blender: read("blender.json"),
          reconciliation: read("reconciliation.json"),
          renders: read("renders.json"),
        });
      }
      if (method === "GET" && parts[0] === "reconcile") {
        const dir = path.join(path.dirname(root), "meshy");
        const stored = path.join(dir, "reconciliation.json");
        if (existsSync(stored)) return send(res, { ok: true, ...JSON.parse(readFileSync(stored, "utf8")) });
        return send(res, { ok: false, error: "run: npx tsx scripts/foundry/run.ts reconcile" }, 404);
      }
      if (parts[0] === "projects") {
        if (!parts[1]) {
          if (method === "GET") return send(res, { ok: true, projects: listProjects(root), root });
          if (method === "POST") {
            const body = await json(req);
            const created = createProject(root, { id: String(body.id ?? ""), name: typeof body.name === "string" ? body.name : undefined, subject: typeof body.subject === "string" ? body.subject : undefined });
            return send(res, { ok: true, project: created }, 201);
          }
        }
        const projectId = parts[1];
        if (method === "GET" && !parts[2]) {
          const project = readProject(root, projectId);
          return send(res, { ok: true, project, versions: listVersions(root, projectId) });
        }
        if (method === "GET" && parts[2] === "verify") return send(res, { ok: true, verification: verifyProject(root, projectId) });
        if (method === "GET" && parts[2] === "versions" && parts[3] && parts[4] === "glb") {
          const { file } = modelPath(root, projectId, parts[3]);
          return fileBytes(res, file);
        }
        if (method === "POST" && parts[2] === "versions") {
          const body = await json(req);
          const sourceGlb = path.resolve(typeof body.sourceGlb === "string" ? body.sourceGlb : "");
          const version = addVersion(root, projectId, {
            sourceGlb,
            label: typeof body.label === "string" ? body.label : "imported model",
            operation: typeof body.operation === "string" ? body.operation : "import",
            triangles: typeof body.triangles === "number" ? body.triangles : null,
            spec: typeof body.spec === "object" && body.spec ? (body.spec as Record<string, unknown>) : {},
          });
          return send(res, { ok: true, version }, 201);
        }
        if (method === "POST" && parts[2] === "restore") {
          const body = await json(req);
          const version = restoreVersion(root, projectId, String(body.version ?? ""), Array.isArray(body.groups) ? (body.groups as string[]) : undefined);
          return send(res, { ok: true, version, project: readProject(root, projectId) }, 201);
        }
      }
      if (method === "POST" && parts[0] === "render") {
        const body = await json(req);
        const result = await renderShots(body);
        return send(res, { ok: true, ...result });
      }
      if (method === "POST" && parts[0] === "compare") {
        const result = compareShot(await json(req));
        return send(res, { ok: true, ...result });
      }
      if (method === "POST" && parts[0] === "chat") {
        const body = await json(req);
        const message = String(body.message ?? "");
        const intent = interpretFoundryIntent(message);
        const selected = shotsForIntent(intent);
        const wantsRender = ["render", "benchmark", "improve-face", "hair", "jewelry"].includes(intent.operation);
        let rendered: Awaited<ReturnType<typeof renderShots>> | undefined;
        if (wantsRender) {
          const projectId = String(body.project ?? "lelu");
          const project = readProject(root, projectId);
          if (!project.head) {
            return send(res, { ok: true, operation: intent.operation, intent, answer: `The Foundry project "${projectId}" has no model yet, so nothing was rendered. Add a version first.` });
          }
          const ids = intent.operation === "benchmark" ? shots().slice(0, 4).map((s) => s.id) : selected;
          rendered = await renderShots({ ...body, shots: ids });
        }
        const text = answer(intent, body);
        const renders = ["render", "benchmark", "improve-face", "hair", "jewelry"].includes(intent.operation);
        const operationNote = intent.because.length && !text ? ` Request mapped to ${intent.operation} by ${intent.because.join("; ")}.` : "";
        const renderNote = rendered ? ` Rendered ${rendered.rendered}, failed ${rendered.failed}: ${rendered.results.map((r) => `${r.shot}${r.ok ? ` ${r.seconds}s` : ` FAILED (${r.error})`}${r.comparison ? ` → ${r.comparison.verdict}` : ""}`).join("; ")}.` : "";
        const fallback = renders
          ? "No render was requested, so nothing was drawn."
          : `${intent.operation}: this operation is mapped but the Foundry has no executor for it yet, so nothing was changed.`;
        return send(res, {
          ok: true,
          operation: intent.operation,
          intent,
          answer: (text || fallback) + operationNote + renderNote,
          ...(rendered ? { rendered } : {}),
        });
      }
      if (method === "GET" && parts[0] === "assets") {
        const target = inside(parts.slice(1).join("/"));
        if (!target || !existsSync(target) || !statSync(target).isFile()) return send(res, { ok: false, error: "no such asset" }, 404);
        return fileBytes(res, target);
      }
      return send(res, { ok: false, error: `${MOUNT}${route} is not a Foundry route` }, 404);
    } catch (error) {
      return send(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  return {
    handle,
    attach(middlewares: { use: (path: string, handler: Handler) => void }) {
      middlewares.use(MOUNT, (req, res, next) => void handle(req, res, next));
    },
    root,
  };
}
