/**
 * ==========================================================
 * LÉLU ASRE — SERVER API (server only, zero spend)
 *
 *   GET  /api/asre/status              toolchain: Blender, Python worker, weights
 *   POST /api/asre/reconstruct         { image: <path under the asset root> | imageBase64 }
 *                                      → job: TripoSR CPU → analyses → hypotheses
 *                                        → NRE + GLB + coverage (+ renders)
 *   GET  /api/asre/jobs/<id>           job state, every intermediate result so far,
 *                                      and which observation would help most next
 *   POST /api/asre/character           { patch?, render? } → a variation of the
 *                                      persistent character; reports regenerated
 *                                      vs reused components
 *   GET  /api/asre/assets/<path>       GLB / PNG / JSON produced above
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

type EnvReader = (name: string) => string | undefined;
type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

const MOUNT = "/api/asre";
const MIME: Record<string, string> = { ".glb": "model/gltf-binary", ".png": "image/png", ".json": "application/json" };

export interface AsreJob {
  id: string;
  state: "queued" | "running" | "succeeded" | "failed";
  steps: Array<{ step: string; state: "running" | "done" | "failed"; ms?: number; note?: string }>;
  dir: string;
  createdAt: number;
  error?: string;
  results: Record<string, unknown>;
}

function send(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export function createAsreApi(readEnv: EnvReader, options: { root?: string } = {}) {
  const root = path.resolve(options.root || readEnv("LELU_ASRE_ROOT") || path.join(process.cwd(), "leluverse", "assets", "asre"));
  const jobs = new Map<string, AsreJob>();
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
      spend: "zero: local CPU only, no paid API, no account, no key",
      setup: "services/asre-reconstruct/setup.sh",
    };
  }

  async function runReconstruction(job: AsreJob, image: string): Promise<void> {
    const rt = await import("../scripts/asre/runtime.ts");
    const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      const s = { step: name, state: "running" as const, ms: 0 };
      job.steps.push(s);
      const t0 = Date.now();
      try {
        const r = await fn();
        Object.assign(s, { state: "done", ms: Date.now() - t0 });
        return r;
      } catch (e) {
        Object.assign(s, { state: "failed", ms: Date.now() - t0, note: e instanceof Error ? e.message.slice(0, 500) : String(e) });
        throw e;
      }
    };
    job.state = "running";
    try {
      const tr = path.join(job.dir, "triposr");
      job.results.triposr = (await step("triposr", () => rt.runWorker("triposr_worker.py", { image, out_dir: tr }))).result;
      job.results.analysis = (await step("analyses+hypotheses", () => rt.runWorker("analyze_worker.py", { image, triposr_dir: tr, out_dir: path.join(job.dir, "wp1") }))).result;
      const { ingest } = await import("../scripts/asre/triposr-ingest.ts");
      const canRender = Boolean((await status()).blender);
      job.results.ingest = await step("nre+glb+renders", () => ingest(tr, { render: canRender }));
      job.results.coverage = await step("coverage", async () => {
        const { decodeGrid } = await import("../src/core/asre/nre/serialize.ts");
        const { deflate } = await import("../scripts/asre/triposr-ingest.ts");
        const { assessCoverage } = await import("../src/core/asre/analysis/coverage.ts");
        const grid = decodeGrid(new Uint8Array(readFileSync(path.join(tr, "reconstruction.lnre"))), { codecs: [deflate] }).grid;
        // TripoSR conditioning camera sits on +X; Z is up in that frame
        return assessCoverage(grid, [1, 0, 0], [0, 0, 1]);
      });
      job.results.glb = path.relative(root, path.join(tr, "reconstruction.glb"));
      job.state = "succeeded";
    } catch (e) {
      job.state = "failed";
      job.error = e instanceof Error ? e.message.slice(0, 2000) : String(e);
    }
    writeFileSync(path.join(job.dir, "job.json"), JSON.stringify(job, null, 1));
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

  async function handle(req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    const raw = (req.url ?? "").split("?")[0];
    const route = raw.startsWith(MOUNT) ? raw.slice(MOUNT.length) || "/" : raw || "/";
    const parts = route.split("/").filter(Boolean).map(decodeURIComponent);
    if (method !== "GET" && crossOrigin(req)) return send(res, { ok: false, error: "Cross-origin ASRE requests are refused." }, 403);
    try {
      if (method === "GET" && parts[0] === "status") return send(res, { ok: true, ...(await status()) });
      if (method === "POST" && parts[0] === "reconstruct") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as { image?: string; imageBase64?: string };
        const id = randomUUID().slice(0, 12);
        const dir = path.join(root, "jobs", id);
        mkdirSync(dir, { recursive: true });
        let image: string | null = null;
        if (body.imageBase64) {
          image = path.join(dir, "input.png");
          writeFileSync(image, Buffer.from(body.imageBase64, "base64"));
        } else if (body.image) image = inside(body.image);
        if (!image || !existsSync(image)) return send(res, { ok: false, error: "image must be imageBase64 or a path inside the ASRE asset root" }, 400);
        const job: AsreJob = { id, state: "queued", steps: [], dir, createdAt: Date.now(), results: {} };
        jobs.set(id, job);
        void runReconstruction(job, image);
        return send(res, { ok: true, job: { id, state: job.state } }, 202);
      }
      if (method === "GET" && parts[0] === "jobs" && parts[1]) {
        const job = jobs.get(parts[1]);
        if (!job) return send(res, { ok: false, error: `no job ${parts[1]}` }, 404);
        return send(res, { ok: true, job: { ...job, dir: undefined } });
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
        res.end(readFileSync(file));
        return;
      }
      next();
    } catch (e) {
      send(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  return {
    root,
    jobs,
    handle,
    attach(middlewares: { use: (path: string, h: Handler) => void }) {
      middlewares.use(MOUNT, (req, res, next) => void handle(req, res, next));
    },
  };
}
