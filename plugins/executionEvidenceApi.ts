/**
 * ==========================================================
 * LÉLU — EXECUTION EVIDENCE API (shared middleware)
 *
 * The server's own copy of what really ran.
 *
 * The browser already knows: the activity card is built from the same events.
 * That was the gap Mission 6.1.7 closes — a tool could execute (or fail) and
 * the server log would show only model requests, so "it ran" could not be
 * checked after the tab closed.
 *
 *   POST /api/execution/events  → one line per lifecycle stage in the server log
 *
 * What this route deliberately does NOT do:
 *   · it does not trust the browser's claims — every record is sanitized, the
 *     free-text reason is re-redacted here, and no tool ARGUMENTS are accepted;
 *   · it does not create a second event system: the client forwards the
 *     records the dispatcher already emitted on the existing AgentEventBus;
 *   · it does not turn a record into a success by itself. A stage is logged as
 *     the stage it is, and an `unknown` outcome stays unknown.
 * ==========================================================
 */

import {
  formatExecutionLine,
  isExecutionRecord,
  sanitizeExecutionRecord,
} from "../src/core/tools/ExecutionEvidence.ts";

interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

interface ConnectLikeReq {
  method?: string;
  url?: string;
  on?: (event: string, listener: (chunk?: unknown) => void) => void;
  headers?: Record<string, string | string[] | undefined>;
}

type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

interface MiddlewareHost {
  use: (path: string, handler: Handler) => void;
}

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

/** A body large enough for a batch of stages, small enough not to be a weapon. */
const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENTS = 100;

function readBody(req: ConnectLikeReq): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: string[] = [];
    req.on?.("data", (chunk) => {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
      size += text.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Execution evidence body too large."));
        return;
      }
      chunks.push(text);
    });
    req.on?.("end", () => resolve(chunks.join("")));
    req.on?.("error", () => reject(new Error("Execution evidence body could not be read.")));
  });
}

/**
 * Keep the log honest about ordering: a stage that arrives twice for the same
 * execution is recorded once, so a retried POST cannot inflate a count.
 */
function dedupeKey(stage: string, executionId: string): string {
  return `${executionId}::${stage}`;
}

export function createExecutionEvidenceApi() {
  const seen = new Set<string>();

  return {
    attach(host: MiddlewareHost): void {
      host.use("/api/execution", (req, res, next) => {
        void (async () => {
          const url = req.url ?? "/";
          // The host router may or may not strip the mount prefix.
          if (!/(?:^|\/)events\/?$/.test(url.split("?")[0])) {
            next();
            return;
          }
          if ((req.method ?? "GET").toUpperCase() !== "POST") {
            sendJson(res, { ok: false, error: "POST only." }, 405);
            return;
          }
          // Same-origin only: another page must not be able to write a "ran"
          // line into this log.
          const origin = req.headers?.origin;
          const hostHeader = req.headers?.host;
          if (typeof origin === "string" && typeof hostHeader === "string") {
            try {
              if (new URL(origin).host !== hostHeader) {
                sendJson(res, { ok: false, error: "Cross-origin execution evidence is refused." }, 403);
                return;
              }
            } catch {
              sendJson(res, { ok: false, error: "Invalid origin." }, 400);
              return;
            }
          }

          let payload: unknown;
          try {
            payload = JSON.parse(await readBody(req));
          } catch (error) {
            sendJson(res, { ok: false, error: error instanceof Error ? error.message : "Unreadable body." }, 400);
            return;
          }

          const list = (payload as { events?: unknown })?.events;
          if (!Array.isArray(list)) {
            sendJson(res, { ok: false, error: "Expected { events: [...] }." }, 400);
            return;
          }

          let recorded = 0;
          let dropped = 0;
          for (const candidate of list.slice(0, MAX_EVENTS)) {
            if (!isExecutionRecord(candidate)) {
              dropped += 1;
              continue;
            }
            const record = sanitizeExecutionRecord(candidate);
            const key = dedupeKey(record.stage, record.executionId);
            if (seen.has(key)) {
              dropped += 1;
              continue;
            }
            seen.add(key);
            // Bound the set: evidence is a log, not a database.
            if (seen.size > 5_000) seen.clear();
            console.log(formatExecutionLine(record));
            recorded += 1;
          }

          sendJson(res, { ok: true, recorded, dropped });
        })().catch(() => {
          sendJson(res, { ok: false, error: "Execution evidence could not be recorded." }, 500);
        });
      });
    },
  };
}
