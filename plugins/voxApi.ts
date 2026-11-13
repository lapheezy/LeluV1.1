/**
 * ==========================================================
 * LÉLU — VOXCPM2 WORKER ROUTES (app side of the speech worker)
 *
 * The heavy model runs in its own process (services/voxcpm, managed by
 * workerctl.py). This server only CHOOSES a READY worker through the
 * existing VoxcpmPool and relays bytes, so the worker can be restarted,
 * killed or moved to a GPU host without touching LÉLU CORE.
 *
 *   GET  /api/voice/vox/health  → { configured, available, chosen, snapshot }
 *   POST /api/voice/vox/speech  → audio/wav, or chunked PCM16 (`stream: true`,
 *                                 `response_format: "pcm"`), Content-Type
 *                                 `audio/L16;rate=<hz>;channels=1`
 *
 * Failure mapping: no worker configured → 503 `not-configured`; no READY
 * worker → 503 with the pool's reasons (LOADING / INITIALIZING / FAILED /
 * unreachable); worker 4xx/5xx → relayed status with its JSON; timeout →
 * 504. A worker that fails is put on the pool's cooldown.
 *
 * Cancellation: if the client disconnects (STOP), the upstream request is
 * aborted. For a streaming request the worker's next write fails and its
 * generator stops — generation really ends, not just playback.
 *
 * Timeouts scale with the text: CPU synthesis is ~4–5× slower than real
 * time (measured), so a fixed short timeout would kill every long reply.
 * ==========================================================
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { VoxcpmPool, parseVoxcpmWorkers, workerHeaders } from "../src/core/voice/gpuWorkers.ts";

type ReadEnv = (name: string) => string | undefined;
type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

const MAX_BODY = 65_536;
const MAX_CHARS = 900;

/** ≈ 0.07 s of speech per character × RTF 5, plus load slack; capped. */
export function speechTimeoutMs(chars: number): number {
  return Math.min(600_000, 30_000 + chars * 450);
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("body must be a JSON object");
        resolve(parsed as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export function createVoxApi(options: { readEnv?: ReadEnv; fetchImpl?: typeof fetch } = {}) {
  const read: ReadEnv = options.readEnv ?? ((name) => process.env[name]);
  const doFetch = options.fetchImpl ?? fetch;
  const pool = new VoxcpmPool(parseVoxcpmWorkers(read), { cooldownMs: 15_000 });

  async function health(): Promise<{ status: number; body: unknown }> {
    if (pool.list().length === 0) return { status: 200, body: { configured: false, available: false } };
    const chosen = await pool.select({ timeoutMs: 3000 });
    return { status: 200, body: { configured: true, available: Boolean(chosen), chosen, snapshot: pool.snapshot() } };
  }

  async function speech(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch (error) {
      json(res, 400, { ok: false, error: (error as Error).message });
      return;
    }
    const text = String(body.input ?? body.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) return json(res, 400, { ok: false, error: "`input` is empty" });
    if (text.length > MAX_CHARS) return json(res, 413, { ok: false, error: `input exceeds ${MAX_CHARS} characters` });
    const stream = body.stream === true;
    const format = stream ? "pcm" : String(body.response_format ?? "wav").toLowerCase();
    if (format !== "wav" && format !== "pcm") return json(res, 400, { ok: false, error: "response_format must be wav or pcm" });

    if (pool.list().length === 0) return json(res, 503, { ok: false, reason: "not-configured", error: "no VoxCPM2 worker is configured (VOXCPM_BASE_URL or VOXCPM_WORKERS)" });
    const chosen = await pool.select({ timeoutMs: 3000 });
    if (!chosen) return json(res, 503, { ok: false, reason: "no-ready-worker", error: "no VoxCPM2 worker is READY", snapshot: pool.snapshot() });
    const worker = pool.worker(chosen.worker);
    if (!worker) return json(res, 503, { ok: false, reason: "no-ready-worker", error: "chosen worker vanished" });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), speechTimeoutMs(text.length));
    // STOP: the page closes the request; the worker stops with it.
    res.on("close", () => {
      if (!res.writableFinished) controller.abort(new Error("client closed"));
    });

    let upstream: Response;
    try {
      upstream = await doFetch(`${worker.url}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...workerHeaders(worker) },
        body: JSON.stringify({ input: text, response_format: format, stream }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (controller.signal.aborted && String(controller.signal.reason).includes("client closed")) return;
      pool.markFailure(worker.id);
      const timedOut = String(controller.signal.reason ?? "").includes("timeout");
      if (!res.headersSent) json(res, timedOut ? 504 : 502, { ok: false, reason: timedOut ? "timeout" : "unreachable", error: (error as Error).message });
      return;
    }

    if (!upstream.ok || !upstream.body) {
      clearTimeout(timer);
      if (upstream.status >= 500) pool.markFailure(worker.id);
      const detail = await upstream.text().catch(() => "");
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
      res.end(detail);
      return;
    }

    pool.markSuccess(worker.id);
    res.statusCode = 200;
    for (const [name, value] of upstream.headers) {
      if (name === "content-type" || name.startsWith("x-lelu-")) res.setHeader(name, value);
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Lelu-Worker", worker.id);
    try {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) await new Promise((resolve) => res.once("drain", resolve));
      }
      res.end();
    } catch {
      // client closed (STOP) or worker died mid-stream: nothing more to send
      if (!res.writableEnded) res.end();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    pool,
    attach(middlewares: { use: (path: string, handler: Handler) => void }) {
      middlewares.use("/api/voice/vox/health", (req, res, next) => {
        if (req.method !== "GET") return next();
        health()
          .then(({ status, body }) => json(res, status, body))
          .catch((error: Error) => json(res, 500, { ok: false, error: error.message }));
      });
      middlewares.use("/api/voice/vox/speech", (req, res, next) => {
        if (req.method !== "POST") return next();
        speech(req, res).catch((error: Error) => {
          if (!res.headersSent) json(res, 500, { ok: false, error: error.message });
          else res.end();
        });
      });
    },
  };
}

export function voxApiPlugin(readEnv?: ReadEnv) {
  const api = createVoxApi({ readEnv });
  return {
    name: "vox-api",
    configureServer(server: { middlewares: { use: (path: string, handler: Handler) => void } }) {
      api.attach(server.middlewares);
    },
    configurePreviewServer(server: { middlewares: { use: (path: string, handler: Handler) => void } }) {
      api.attach(server.middlewares);
    },
  };
}
