/**
 * ==========================================================
 * LÉLU 3D FORGE — HTTP SURFACE
 *
 * The same-origin routes the browser (and LÉLU's tools) use.
 * The credential stays in MeshyForge; nothing here returns a
 * key, a key's length, or a resolved reference image.
 *
 *   GET  /api/forge/status                  configured?, credential NAME, usage
 *   GET  /api/forge/balance                 Meshy credits (free call)
 *   GET  /api/forge/characters/<c>          manifest, identity, references, jobs
 *   GET  /api/forge/characters/<c>/active   files the Cosmos should load
 *   POST /api/forge/characters/<c>/slots    { slot, jobId } — promote a validated job
 *   GET  /api/forge/jobs?character=<c>      the ledger
 *   POST /api/forge/jobs                    { character, kind, body, purpose, approve }
 *   GET  /api/forge/jobs/<id>               one job (refreshes it if still running)
 *   POST /api/forge/jobs/<id>/approve       spend the credits
 *   POST /api/forge/jobs/<id>/reject        decline a planned job
 *   GET  /api/forge/animations/library      Meshy's action catalogue (free)
 *   GET  /api/forge/library                 every finished, inspected asset
 *   GET  /api/forge/placements              assets placed in the Cosmos
 *   POST /api/forge/placements              { jobId, label?, position?, rotationY?, height? }
 *   POST /api/forge/placements/<id>/update  move / resize / attach to a bone / detach
 *   POST /api/forge/placements/<id>/remove  take it out of the Cosmos (asset is kept)
 *   POST /api/forge/characters/<c>/look     { look } — switch look (null = rig/base)
 *   POST /api/forge/characters/<c>/wear     { slot, worn } — put a wearable on / take it off (hood up/down)
 *   POST /api/forge/jobs/<id>/adopt         { index, id, view, … } — a reviewed generated view becomes a reference
 *   GET  /api/forge/assets/<path>           a stored output (GLB, texture, preview)
 *
 *   World engine (plugins/worldEngine.ts) — environments and their objects:
 *   GET  /api/forge/world                              current environment, its objects, all environments
 *   POST /api/forge/world/enter                        { id }
 *   POST /api/forge/world/environments                 { name, kind, description, settings, sandboxOf? }
 *   POST /api/forge/world/environments/<id>/update     { name?, description?, settings? }
 *   GET  /api/forge/world/environments/<id>/history    versions
 *   POST /api/forge/world/environments/<id>/restore    { version }
 *   POST /api/forge/world/environments/<id>/promote    { approve: true } — sandbox over its source
 *   POST /api/forge/world/objects                      built-in shape { shape, color, …, physics? }
 *   POST /api/forge/world/objects/<id>/modify          { primitive?, physics?, environmentId? }
 *   POST /api/forge/world/settled                      { positions: {id: [x,y,z]} } — physics came to rest
 *   GET|POST /api/forge/world/improvements             the improvement log
 *   POST /api/forge/world/generate                     { description, name?, kind?, items?, seed?, radius?,
 *                                                        environmentId?, replace?, enter? } — furnished room
 *   POST /api/forge/world/groups/<group>/remove        { environmentId? } — a whole generated piece
 *   GET  /api/forge/world/avatar[/<character>]         ?environment= — where LÉLU stands, facing, mood
 *   POST /api/forge/world/avatar[/<character>]         { position?, facing?, towards?, mood?, environmentId? }
 *
 * Writes refuse cross-origin callers: these routes spend
 * credits that belong to whoever runs the server.
 * ==========================================================
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { crossOrigin, readBody, type ConnectLikeReq, type ConnectLikeRes } from "./modelApi.ts";
import { ForgeStore, type CharacterSlot, type ForgeJob } from "./forgeStore.ts";
import { buildRecords, type ReferenceClassification, type ReferenceRecord } from "./forgeReferences.ts";
import { ForgeError, MeshyForge, type EnvReader } from "./meshyForge.ts";
import { WorldEngine } from "./worldEngine.ts";

type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

const MOUNT = "/api/forge";

const MIME: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".fbx": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
};

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function sendError(res: ConnectLikeRes, error: unknown): void {
  if (error instanceof ForgeError) {
    sendJson(res, { ok: false, error: error.message, details: error.details }, error.status);
    return;
  }
  sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
}

/** Connect strips the mount path; the standalone server's router does not. Accept both. */
function routeOf(url: string): { route: string; query: URLSearchParams } {
  const [rawPath, rawQuery = ""] = url.split("?");
  const route = rawPath.startsWith(MOUNT) ? rawPath.slice(MOUNT.length) || "/" : rawPath || "/";
  return { route, query: new URLSearchParams(rawQuery) };
}

async function jsonBody(req: ConnectLikeReq): Promise<Record<string, unknown>> {
  const raw = (await readBody(req)).toString("utf8");
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ForgeError("Body must be a JSON object.");
  return parsed as Record<string, unknown>;
}

/** A job as the browser sees it: inline image data in the request is shortened to its size. */
function publicJob(job: ForgeJob): ForgeJob {
  const shorten = (value: unknown): unknown => {
    if (typeof value === "string" && value.startsWith("data:")) return `[inline image, ${value.length} chars]`;
    if (Array.isArray(value)) return value.map(shorten);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shorten(v)]));
    return value;
  };
  return { ...job, request: shorten(job.request) as Record<string, unknown> };
}

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

/**
 * Ingest one uploaded image as a reference. Classification is supplied by
 * the caller (a person, or LÉLU after looking at it); the server measures,
 * hashes and de-duplicates. An exact duplicate returns the existing record.
 */
function ingestUpload(store: ForgeStore, character: string, body: Record<string, unknown>): ReferenceRecord {
  const match = DATA_URL.exec(String(body.dataUrl ?? ""));
  if (!match) throw new ForgeError("dataUrl must be a base64 PNG, JPEG or WebP data URL.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.byteLength > 20 * 1024 * 1024) throw new ForgeError("Meshy accepts images up to 20 MB.");
  const c = (body.classification ?? {}) as Partial<ReferenceClassification>;
  const id = String(body.id ?? "");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new ForgeError("id must be lowercase letters, digits, _ or -.");
  const existing = store.references(character);
  const [record] = buildRecords(
    [
      {
        classification: {
          id,
          sourceName: String(c.sourceName ?? `${id}${EXT[match[1]]}`),
          category: c.category ?? "body",
          view: c.view ?? "unspecified",
          outfitVariant: c.outfitVariant ?? "unspecified",
          intendedUse: c.intendedUse ?? "",
          uses: Array.isArray(c.uses) && c.uses.length ? c.uses : ["geometry", "texture"],
          notes: c.notes,
        },
        file: "",
        bytes,
      },
    ],
    existing,
  );
  if (record.duplicateOf) return existing.find((r) => r.id === record.duplicateOf) as ReferenceRecord;
  if (existing.some((r) => r.id === id)) throw new ForgeError(`Reference id "${id}" is taken by different content.`, 409);
  record.file = store.relative(store.storeReferenceFile(character, id, EXT[match[1]], bytes));
  store.saveReferences(character, [...existing, record]);
  store.logEvent(character, { type: "reference_ingested", id, sha256: record.metrics.sha256, nearDuplicateOf: record.nearDuplicateOf });
  return record;
}

export function createMeshyForgeApi(readEnv: EnvReader, options: { assetRoot?: string; poll?: boolean } = {}) {
  // || not ??: the Vite env reader returns "" for unset keys, which would put the store at the repo root.
  const root = options.assetRoot || readEnv("FORGE_ASSET_ROOT") || path.join(process.cwd(), "leluverse", "assets");
  const forge = new MeshyForge({ store: new ForgeStore(root), readEnv });
  const world = new WorldEngine(forge.store);
  if (options.poll !== false) forge.startPolling();

  async function handle(req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    const { route, query } = routeOf(req.url ?? "");
    const parts = route.split("/").filter(Boolean).map(decodeURIComponent);

    if (method !== "GET" && crossOrigin(req)) {
      sendJson(res, { ok: false, error: "Cross-origin Forge requests are refused." }, 403);
      return;
    }

    try {
      if (method === "GET" && route === "/status") {
        sendJson(res, {
          ok: true,
          configured: forge.configured(),
          credential: forge.credentialSource(),
          prefixedCredentialWarning: forge.credentialSource()?.startsWith("VITE_")
            ? "The Meshy key is stored under a VITE_ name, which Vite's dev server exposes to the browser. Rename it to MESHY_API_KEY."
            : null,
          usage: forge.store.usage(),
        });
        return;
      }
      if (method === "GET" && route === "/balance") {
        sendJson(res, { ok: true, ...(await forge.balance()) });
        return;
      }
      if (method === "GET" && route === "/animations/library") {
        sendJson(res, { ok: true, library: await forge.animationLibrary(Object.fromEntries(query)) });
        return;
      }

      if (method === "GET" && route === "/library") {
        sendJson(res, { ok: true, assets: forge.library() });
        return;
      }
      if (parts[0] === "placements") {
        if (method === "GET" && parts.length === 1) {
          sendJson(res, { ok: true, placements: forge.store.placements() });
          return;
        }
        if (method === "POST" && parts.length === 1) {
          const body = await jsonBody(req);
          const placement = forge.place({ ...body, jobId: String(body.jobId ?? ""), environmentId: body.environmentId ?? world.state().current });
          if (!placement.attach) world.touched(placement.environmentId, `placed ${placement.label}`);
          sendJson(res, { ok: true, placement }, 201);
          return;
        }
        if (method === "POST" && parts[2] === "update") {
          const placement = forge.updatePlacement(parts[1], await jsonBody(req));
          if (!placement.attach) world.touched(placement.environmentId, `moved ${placement.label}`);
          sendJson(res, { ok: true, placement });
          return;
        }
        if (method === "POST" && parts[2] === "remove") {
          const placement = forge.unplace(parts[1]);
          if (!placement.attach) world.touched(placement.environmentId, `removed ${placement.label}`);
          sendJson(res, { ok: true, placement });
          return;
        }
      }

      if (parts[0] === "world") {
        const [, a, b, c] = parts;
        if (method === "GET" && !a) return sendJson(res, { ok: true, ...world.state() });
        if (method === "POST" && a === "enter") return sendJson(res, { ok: true, ...world.enter(String((await jsonBody(req)).id ?? "")) });
        if (a === "environments") {
          if (method === "POST" && !b) return sendJson(res, { ok: true, environment: world.createEnvironment(await jsonBody(req)) }, 201);
          if (method === "POST" && b && c === "update") return sendJson(res, { ok: true, environment: world.updateEnvironment(b, await jsonBody(req)) });
          if (method === "GET" && b && c === "history") return sendJson(res, { ok: true, history: world.history(b) });
          if (method === "POST" && b && c === "restore") return sendJson(res, { ok: true, environment: world.restore(b, Number((await jsonBody(req)).version)) });
          if (method === "POST" && b && c === "promote") return sendJson(res, { ok: true, environment: world.promote(b, (await jsonBody(req)).approve === true) });
        }
        if (method === "POST" && a === "generate") return sendJson(res, { ok: true, ...world.generateEnvironment(await jsonBody(req)) }, 201);
        if (a === "objects") {
          if (method === "POST" && !b) return sendJson(res, { ok: true, object: world.createObject(await jsonBody(req)) }, 201);
          if (method === "POST" && b && c === "modify") return sendJson(res, { ok: true, object: world.modifyObject(b, await jsonBody(req)) });
        }
        if (method === "POST" && a === "groups" && b && c === "remove") {
          const body = await jsonBody(req);
          const envId = typeof body.environmentId === "string" && body.environmentId ? body.environmentId : world.state().current;
          return sendJson(res, { ok: true, removed: world.removeGroup(envId, b) });
        }
        if (a === "avatar") {
          const character = b || "lelu_character";
          if (method === "GET") return sendJson(res, { ok: true, avatar: world.avatar(character, query.get("environment") ?? undefined) });
          if (method === "POST") return sendJson(res, { ok: true, avatar: world.setAvatar(character, await jsonBody(req)) });
        }
        if (method === "POST" && a === "settled") {
          const positions = ((await jsonBody(req)).positions ?? {}) as Record<string, unknown>;
          let envId: string | undefined;
          for (const [id, pos] of Object.entries(positions)) {
            if (Array.isArray(pos) && pos.length === 3 && pos.every((n) => typeof n === "number" && Number.isFinite(n))) {
              envId = forge.updatePlacement(id, { position: pos }).environmentId;
            }
          }
          if (Object.keys(positions).length) world.touched(envId, "physics settled");
          return sendJson(res, { ok: true });
        }
        if (a === "improvements") {
          if (method === "GET") return sendJson(res, { ok: true, improvements: world.improvements() });
          if (method === "POST") return sendJson(res, { ok: true, improvement: world.recordImprovement((await jsonBody(req)) as never) }, 201);
        }
      }

      if (parts[0] === "characters" && parts[1]) {
        const character = parts[1];
        if (method === "GET" && parts.length === 2) {
          forge.store.characterDir(character);
          sendJson(res, {
            ok: true,
            character,
            manifest: forge.store.manifest(character),
            identity: forge.store.identity(character),
            identityCheck: forge.store.verifyIdentity(character),
            references: forge.store.references(character),
            jobs: forge.store.jobs(character).map(publicJob),
            usage: forge.store.usage(character),
          });
          return;
        }
        if (method === "GET" && parts[2] === "active") {
          forge.store.characterDir(character);
          sendJson(res, { ok: true, ...forge.activeCharacter(character), assetBase: `${MOUNT}/assets/` });
          return;
        }
        if (method === "POST" && parts[2] === "references") {
          sendJson(res, { ok: true, reference: ingestUpload(forge.store, character, await jsonBody(req)) }, 201);
          return;
        }
        if (method === "POST" && parts[2] === "wear") {
          const body = await jsonBody(req);
          sendJson(res, { ok: true, placements: forge.wear(character, String(body.slot ?? ""), body.worn !== false) });
          return;
        }
        if (method === "POST" && parts[2] === "look") {
          const body = await jsonBody(req);
          const manifest = forge.setLook(character, typeof body.look === "string" && body.look ? body.look : null);
          sendJson(res, { ok: true, manifest });
          return;
        }
        if (method === "POST" && parts[2] === "slots") {
          const body = await jsonBody(req);
          const manifest = forge.approveSlot(character, String(body.slot) as CharacterSlot, String(body.jobId));
          sendJson(res, { ok: true, manifest });
          return;
        }
      }

      if (parts[0] === "jobs") {
        if (parts.length === 1 && method === "GET") {
          const character = query.get("character");
          const jobs = character ? forge.store.jobs(character) : forge.store.allJobs();
          sendJson(res, { ok: true, jobs: jobs.map(publicJob), usage: forge.store.usage(character ?? undefined) });
          return;
        }
        if (parts.length === 1 && method === "POST") {
          const body = await jsonBody(req);
          const result = await forge.request({
            character: String(body.character ?? ""),
            kind: String(body.kind ?? ""),
            body: (body.body ?? {}) as Record<string, unknown>,
            purpose: typeof body.purpose === "string" ? body.purpose : "",
            approve: body.approve === true,
            parentJobId: typeof body.parentJobId === "string" ? body.parentJobId : undefined,
          });
          sendJson(res, { ok: true, reused: result.reused, job: publicJob(result.job) }, result.reused ? 200 : 201);
          return;
        }
        const id = parts[1];
        if (id && parts.length === 2 && method === "GET") {
          const job = forge.store.job(id);
          if (!job) throw new ForgeError(`No job ${id}.`, 404);
          sendJson(res, { ok: true, job: publicJob(forge.configured() ? await forge.refresh(id) : job) });
          return;
        }
        if (id && parts[2] === "approve" && method === "POST") {
          const body = await jsonBody(req);
          sendJson(res, { ok: true, job: publicJob(await forge.approve(id, { resubmitUncertain: body.resubmitUncertain === true })) });
          return;
        }
        if (id && parts[2] === "adopt" && method === "POST") {
          const body = await jsonBody(req);
          const reference = forge.adoptView(id, Number(body.index ?? 0), {
            id: String(body.id ?? ""),
            view: String(body.view ?? "unspecified"),
            outfitVariant: typeof body.outfitVariant === "string" ? body.outfitVariant : undefined,
            intendedUse: typeof body.intendedUse === "string" ? body.intendedUse : undefined,
            notes: typeof body.notes === "string" ? body.notes : undefined,
          });
          sendJson(res, { ok: true, reference }, 201);
          return;
        }
        if (id && parts[2] === "reject" && method === "POST") {
          const body = await jsonBody(req);
          sendJson(res, { ok: true, job: publicJob(forge.reject(id, typeof body.reason === "string" ? body.reason : "")) });
          return;
        }
      }

      if (parts[0] === "assets" && method === "GET") {
        const file = forge.store.safeAssetPath(parts.slice(1).join("/"));
        if (!file || !existsSync(file) || !statSync(file).isFile()) {
          sendJson(res, { ok: false, error: "No such asset." }, 404);
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
        res.setHeader("Content-Length", String(statSync(file).size));
        // Version folders are never rewritten, so an asset URL's bytes never change.
        res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
        const pipeTarget = res as unknown as NodeJS.WritableStream;
        if (typeof (pipeTarget as { write?: unknown }).write === "function") {
          createReadStream(file).pipe(pipeTarget);
        } else {
          const { readFileSync } = await import("node:fs");
          res.end(readFileSync(file) as unknown as string);
        }
        return;
      }

      next();
    } catch (error) {
      sendError(res, error);
    }
  }

  return {
    forge,
    attach(host: { use: (path: string, handler: Handler) => void }): void {
      host.use(MOUNT, (req, res, next) => {
        void handle(req, res, next);
      });
    },
  };
}
