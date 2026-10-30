/**
 * ==========================================================
 * LÉLU 3D FORGE — MESHY CLIENT (server side only)
 *
 * The documented Meshy endpoints the Forge uses (docs.meshy.ai, read
 * 2026-10-30), with the key read from the server's MESHY_API_KEY. It is
 * never sent to, or readable from, the browser. MESHY_API_URL may point
 * at another base URL (tests use a local stand-in server).
 *
 *   POST/GET /openapi/v1/multi-image-to-3d   1–4 views → textured model
 *   POST/GET /openapi/v1/image-to-3d         one image → textured model
 *   POST/GET /openapi/v1/rigging             textured humanoid → skeleton
 *   POST/GET /openapi/v1/animations          rig + library action(s) → clips
 *   GET      /openapi/v1/animations/library  the action library (free)
 *
 * Creating a task is NEVER retried automatically: a POST that timed out
 * may have created (and charged for) a task. Reading one is retried.
 * ==========================================================
 */

import type { ForgeWorkflow } from "./forgeCore";

export class MeshyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when it is not known whether the request took effect. */
    readonly uncertain = false,
  ) {
    super(message);
  }
}

export interface MeshyTask {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";
  progress?: number;
  consumed_credits?: number;
  task_error?: { message?: string } | null;
  model_urls?: Record<string, string>;
  thumbnail_url?: string;
  texture_urls?: Array<Record<string, string>>;
  result?: Record<string, unknown> | null;
  [key: string]: unknown;
}

const PATHS: Record<Exclude<ForgeWorkflow, "remesh">, string> = {
  "multi-image-to-3d": "/openapi/v1/multi-image-to-3d",
  "image-to-3d": "/openapi/v1/image-to-3d",
  rigging: "/openapi/v1/rigging",
  animation: "/openapi/v1/animations",
};

export function meshyConfigured(): boolean {
  return Boolean(process.env.MESHY_API_KEY?.trim());
}

function base(): string {
  return (process.env.MESHY_API_URL?.trim() || "https://api.meshy.ai").replace(/\/+$/, "");
}

function headers(): Record<string, string> {
  const key = process.env.MESHY_API_KEY?.trim();
  if (!key) throw new MeshyError("MESHY_API_KEY is not set on the server, so no Meshy request can be made.", 0);
  return { authorization: `Bearer ${key}`, "content-type": "application/json" };
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { message?: string };
    return parsed.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

/** Create a task; returns its id. Not retried (see above). */
export async function createTask(workflow: ForgeWorkflow, body: Record<string, unknown>, timeoutMs = 120_000): Promise<string> {
  if (workflow === "remesh") throw new MeshyError("Remesh is not wired yet.", 0);
  let response: Response;
  try {
    response = await fetch(`${base()}${PATHS[workflow]}`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof MeshyError) throw error;
    throw new MeshyError(`The create request did not complete (${String((error as Error).message ?? error)}); a task may or may not have been created.`, 0, true);
  }
  if (!response.ok) throw new MeshyError(`Meshy refused the ${workflow} request (${response.status}): ${await readError(response)}`, response.status);
  const data = (await response.json()) as { result?: string };
  if (!data.result) throw new MeshyError(`Meshy accepted the ${workflow} request but returned no task id.`, response.status, true);
  return data.result;
}

/** Read a task; transient failures (network, 429, 5xx) are retried with backoff. */
export async function getTask(workflow: ForgeWorkflow, id: string, attempts = 4): Promise<MeshyTask> {
  if (workflow === "remesh") throw new MeshyError("Remesh is not wired yet.", 0);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${base()}${PATHS[workflow]}/${encodeURIComponent(id)}`, { headers: headers(), signal: AbortSignal.timeout(60_000) });
      if (response.ok) return (await response.json()) as MeshyTask;
      const message = await readError(response);
      if (response.status !== 429 && response.status < 500) throw new MeshyError(`Reading ${workflow} task ${id} failed (${response.status}): ${message}`, response.status);
      lastError = new MeshyError(`(${response.status}) ${message}`, response.status);
    } catch (error) {
      if (error instanceof MeshyError && error.status && error.status !== 429 && error.status < 500) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** The animation library (free): optionally filtered by words or category. */
export async function animationLibrary(query: { search?: string; category?: string } = {}): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.category) params.set("category", query.category);
  const response = await fetch(`${base()}/openapi/v1/animations/library?${params}`, { headers: headers(), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new MeshyError(`Reading the animation library failed (${response.status}): ${await readError(response)}`, response.status);
  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : ((data as { result?: Array<Record<string, unknown>> }).result ?? []);
}

/** Download a provider output (signed URLs expire: done as soon as a task succeeds). */
export async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`Downloading ${url.split("?")[0]} failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
