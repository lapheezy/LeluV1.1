/**
 * ==========================================================
 * LÉLU ASRE — SERVER API (server only, zero spend)
 *
 *   GET  /api/asre/status              toolchain: Blender, Python worker, weights
 *   POST /api/asre/reconstruct         { images: [{ view, imageBase64 | image }] | image | imageBase64,
 *                                        engine?: auto|silhouette|triposr, resolution?, heightMeters?, render? }
 *                                      → job (plugins/asreJobs.ts): hypotheses → selected geometry
 *                                        → NRE + GLB + coverage (+ render) → Forge intake
 *   GET  /api/asre/jobs                every job, newest first
 *   GET  /api/asre/jobs/<id>           job state, every intermediate result so far,
 *                                      and which observation would help most next
 *   POST /api/asre/jobs/<id>/cancel    stop it (a running Python worker is killed)
 *   POST /api/asre/jobs/<id>/retry     run a failed/cancelled/interrupted job again
 *   POST /api/asre/jobs/<id>/observe   { view, imageBase64 | image } → incremental refinement job
 *   POST /api/asre/character           { patch?, render? } → a variation of the
 *                                      persistent character; reports regenerated
 *                                      vs reused components
 *   GET  /api/asre/assets/<path>       GLB / PNG / JSON produced above
 *
 * Forge intake (plugins/asreForge.ts) — finished geometry lives in the
 * existing 3D Forge ledger as job kind "asre"; its files, placement and
 * Blender export use the Forge's own routes (/api/forge/assets,
 * /api/forge/placements, /api/forge/jobs/<id>/export):
 *   GET  /api/asre/forge                  ASRE assets in the Forge, newest first
 *   GET  /api/asre/forge/<jobId>/history  version chain, oldest first
 *   POST /api/asre/forge/import           { name, glbBase64 } → inspected Forge job
 *   POST /api/asre/forge/<jobId>/edit     { edit: { translate, scale, rotateY, tint, ground, center } }
 *                                         → a NEW version; the source is never touched
 *
 * Everything runs locally: no paid API, no account, no key. When a
 * local tool is missing the status says so and the job fails with
 * that reason — it never pretends a step ran.
 * ==========================================================
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { crossOrigin, readBody, type ConnectLikeReq, type ConnectLikeRes } from "./modelApi.ts";
import { AsreJobError, AsreJobManager, type AsreRuntime, type ImageInput, type SucceededHook } from "./asreJobs.ts";
import { AsreForge, AsreForgeError } from "./asreForge.ts";
import { ForgeStore } from "./forgeStore.ts";
import type { ViewName } from "../src/core/asre/reconstruct/silhouette.ts";

type EnvReader = (name: string) => string | undefined;
type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

const MOUNT = "/api/asre";
const MIME: Record<string, string> = { ".glb": "model/gltf-binary", ".png": "image/png", ".json": "application/json" };


function send(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

/** The local toolchain behind the job manager (Python workers, Blender), loaded lazily. */
export function localRuntime(): AsreRuntime {
  const rt = () => import("../scripts/asre/runtime.ts");
  return {
    async available() {
      const r = await rt();
      const env = r.workerEnv();
      const weights = path.join(env.HF_HOME ?? "", "hub", "models--stabilityai--TripoSR");
      return { triposr: existsSync(r.asrePython()) && existsSync(path.join(env.LELU_TRIPOSR_SRC ?? "", "tsr")) && existsSync(weights), blender: Boolean(r.blenderRunner()) };
    },
    async runWorker(script, job, timeoutMs, signal) {
      return (await rt()).runWorker(script, job, timeoutMs, signal);
    },
    async ingest(dir, options) {
      return (await import("../scripts/asre/triposr-ingest.ts")).ingest(dir, options);
    },
    async triposrHypotheses(trDir, wpDir) {
      return (await import("../scripts/asre/triposr-hypotheses.ts")).triposrHypotheses(trDir, wpDir);
    },
    async render(glb, png) {
      const r = await rt();
      if (!r.blenderRunner()) return null;
      return (await r.renderGlb({ inputs: [glb], output: png, resolution: [512, 512], samples: 16 })).output;
    },
  };
}

export function createAsreApi(readEnv: EnvReader, options: { root?: string; runtime?: AsreRuntime; onSucceeded?: SucceededHook | null; forgeStore?: ForgeStore | null } = {}) {
  const root = path.resolve(options.root || readEnv("LELU_ASRE_ROOT") || path.join(process.cwd(), "leluverse", "assets", "asre"));
  const runtime = options.runtime ?? localRuntime();
  // The SAME Forge store the Forge API uses (passed in by vite.config/server.ts);
  // ForgeStore is stateless over its disk ledger, so a store on the same root is equivalent.
  const forgeStore = options.forgeStore === null ? null : (options.forgeStore ?? new ForgeStore(readEnv("FORGE_ASSET_ROOT") || path.join(process.cwd(), "leluverse", "assets")));
  const forge = forgeStore ? new AsreForge(forgeStore) : null;
  const intake: SucceededHook | null =
    options.onSucceeded !== undefined
      ? options.onSucceeded
      : forge
        ? (job) => {
            const parentForge = job.parentJobId ? (manager.get(job.parentJobId)?.result?.forgeJobId ?? null) : null;
            return forge.fileReconstruction(job, (rel) => new Uint8Array(readFileSync(path.join(root, rel))), parentForge).id;
          }
        : null;
  const manager = new AsreJobManager({ root, runtime, onSucceeded: intake });
  let characterCache: unknown = null;

  const inside = (p: string) => {
    const abs = path.resolve(root, p);
    return abs === root || abs.startsWith(root + path.sep) ? abs : null;
  };

  async function status() {
    const rt = await import("../scripts/asre/runtime.ts");
    const py = rt.asrePython();
    const env = rt.workerEnv();
    const weights = path.join(env.HF_HOME ?? "", "hub", "models--stabilityai--TripoSR");
    return {
      blender: Boolean(rt.blenderRunner()),
      python: existsSync(py) ? py : null,
      triposrSource: existsSync(path.join(env.LELU_TRIPOSR_SRC ?? "", "tsr")) ? env.LELU_TRIPOSR_SRC : null,
      triposrWeights: existsSync(weights),
      engines: { silhouette: true, triposr: (await runtime.available()).triposr },
      spend: "zero: local CPU only, no paid API, no account, no key",
      setup: "services/asre-reconstruct/setup.sh",
    };
  }

  async function character(body: Record<string, unknown>) {
    const C = await import("../src/core/asre/character/CharacterSpec.ts");
    const B = await import("../src/core/asre/character/build.ts");
    const { writeGlb } = await import("../src/core/asre/gltf/GlbWriter.ts");
    const { inspectGlb } = await import("../src/core/forge/GlbInspector.ts");
    const cache = (characterCache ??= new B.ComponentCache()) as InstanceType<typeof B.ComponentCache>;
    const spec = C.withChanges(C.BASE_CHARACTER, (body.patch ?? {}) as Parameters<typeof C.withChanges>[1]);
    const build = B.buildCharacter(spec, cache);
    const glb = writeGlb(B.glbParts(build, B.DEFAULT_LATTICE.resolution, spec), { extras: { identity: spec.identity.id } });
    const report = inspectGlb(glb);
    const id = randomUUID().slice(0, 8);
    const dir = path.join(root, "character");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${id}.glb`), glb);
    let render: string | null = null;
    if (body.render) {
      const rt = await import("../scripts/asre/runtime.ts");
      if (rt.blenderRunner()) render = path.relative(root, (await rt.renderGlb({ inputs: [path.join(dir, `${id}.glb`)], output: path.join(dir, `${id}.png`), resolution: [384, 512], samples: 16 })).output);
    }
    return { identity: spec.identity.id, glb: `character/${id}.glb`, render, regenerated: build.regenerated, recolored: build.recolored, reused: build.reused, buildMs: Math.round(build.ms), meshValid: report.verdict.meshValid, triangles: report.geometry.triangles };
  }

  const json = async (req: ConnectLikeReq) => {
    try {
      return JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>;
    } catch {
      throw new AsreJobError("the request body is not JSON");
    }
  };

  /** { view?, imageBase64 | image } → bytes; a path must stay inside the asset root. */
  function imageOf(o: Record<string, unknown>): ImageInput | null {
    const view = (typeof o.view === "string" ? o.view : "front") as ViewName;
    if (typeof o.imageBase64 === "string" && o.imageBase64) return { view, bytes: new Uint8Array(Buffer.from(o.imageBase64.replace(/^data:[^,]*,/, ""), "base64")) };
    if (typeof o.image === "string" && o.image) {
      const file = inside(o.image);
      if (!file || !existsSync(file)) return null;
      return { view, bytes: new Uint8Array(readFileSync(file)) };
    }
    return null;
  }

  async function handle(req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    const raw = (req.url ?? "").split("?")[0];
    const route = raw.startsWith(MOUNT) ? raw.slice(MOUNT.length) || "/" : raw || "/";
    const parts = route.split("/").filter(Boolean).map(decodeURIComponent);
    if (method !== "GET" && crossOrigin(req)) return send(res, { ok: false, error: "Cross-origin ASRE requests are refused." }, 403);
    try {
      if (method === "GET" && parts[0] === "status") return send(res, { ok: true, ...(await status()) });
      if (method === "POST" && parts[0] === "reconstruct") {
        const body = await json(req);
        const list = Array.isArray(body.images) ? (body.images as Array<Record<string, unknown>>) : [{ view: body.view ?? "front", image: body.image, imageBase64: body.imageBase64 }];
        const images = list.map(imageOf);
        if (images.some((im) => !im)) return send(res, { ok: false, error: "each image must be imageBase64 or a path inside the ASRE asset root" }, 400);
        const job = await manager.reconstruct(images as ImageInput[], {
          engine: typeof body.engine === "string" ? (body.engine as never) : "auto",
          resolution: typeof body.resolution === "number" ? body.resolution : undefined,
          heightMeters: typeof body.heightMeters === "number" ? body.heightMeters : undefined,
          render: body.render === true,
        });
        return send(res, { ok: true, job }, 202);
      }
      if (method === "GET" && parts[0] === "jobs" && !parts[1]) return send(res, { ok: true, jobs: manager.list() });
      if (parts[0] === "jobs" && parts[1]) {
        if (method === "GET" && !parts[2]) {
          const job = manager.get(parts[1]);
          if (!job) return send(res, { ok: false, error: `no job ${parts[1]}` }, 404);
          return send(res, { ok: true, job });
        }
        if (method === "POST" && parts[2] === "cancel") return send(res, { ok: true, job: manager.cancel(parts[1]) });
        if (method === "POST" && parts[2] === "retry") return send(res, { ok: true, job: await manager.retry(parts[1]) }, 202);
        if (method === "POST" && parts[2] === "observe") {
          const image = imageOf(await json(req));
          if (!image) return send(res, { ok: false, error: "the view image must be imageBase64 or a path inside the ASRE asset root" }, 400);
          return send(res, { ok: true, job: await manager.observe(parts[1], image) }, 202);
        }
      }
      if (parts[0] === "forge") {
        if (!forge) return send(res, { ok: false, error: "no Forge store is configured" }, 503);
        const pub = (j: ReturnType<AsreForge["assets"]>[number]) => ({ ...j, request: j.request });
        if (method === "GET" && !parts[1]) return send(res, { ok: true, assets: forge.assets().map(pub) });
        if (method === "POST" && parts[1] === "import") {
          const body = await json(req);
          if (typeof body.glbBase64 !== "string" || !body.glbBase64) return send(res, { ok: false, error: "glbBase64 is required" }, 400);
          const bytes = new Uint8Array(Buffer.from(body.glbBase64.replace(/^data:[^,]*,/, ""), "base64"));
          const job = forge.importGlb(bytes, typeof body.name === "string" ? body.name : "import.glb");
          return send(res, { ok: job.status === "SUCCEEDED", job, error: job.error ?? undefined }, job.status === "SUCCEEDED" ? 201 : 422);
        }
        if (method === "GET" && parts[1] && parts[2] === "history") return send(res, { ok: true, history: forge.history(parts[1]) });
        if (method === "POST" && parts[1] && parts[2] === "edit") {
          const body = await json(req);
          return send(res, { ok: true, job: forge.edit(parts[1], (body.edit ?? {}) as never) }, 201);
        }
      }
      if (method === "POST" && parts[0] === "character") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>;
        return send(res, { ok: true, ...(await character(body)) });
      }
      if (method === "GET" && parts[0] === "assets") {
        const file = inside(parts.slice(1).join("/"));
        const mime = file ? MIME[path.extname(file)] : undefined;
        if (!file || !mime || !existsSync(file)) return send(res, { ok: false, error: "not found" }, 404);
        res.statusCode = 200;
        res.setHeader("Content-Type", mime);
        res.end(readFileSync(file) as unknown as string);
        return;
      }
      next();
    } catch (e) {
      if (e instanceof AsreJobError || e instanceof AsreForgeError) return send(res, { ok: false, error: e.message }, e.status);
      const status = (e as { status?: unknown })?.status;
      if (typeof status === "number" && status >= 400 && status < 600) return send(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, status);
      send(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  return {
    root,
    manager,
    forge,
    handle,
    attach(middlewares: { use: (path: string, h: Handler) => void }) {
      middlewares.use(MOUNT, (req, res, next) => void handle(req, res, next));
    },
  };
}
