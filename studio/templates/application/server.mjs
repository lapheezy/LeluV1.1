/**
 * Pulse Board backend — a real HTTP API with disk persistence.
 *
 * Node built-ins only. `createApiServer()` is exported so the test suite
 * can start it on an ephemeral port; running the file starts it for the
 * user (and for the studio's preview proxy).
 */

import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LANES = ["todo", "doing", "done"];
const MAX_TITLE = 120;
const MAX_BODY = 16 * 1024;

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Body too large."));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("Body must be JSON."));
      }
    });
    req.on("error", reject);
  });
}

function normalizeTitle(raw) {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

export function validateTask(input, { partial = false } = {}) {
  const errors = [];
  if (!partial || input.title !== undefined) {
    const title = normalizeTitle(input.title);
    if (title.length < 3) errors.push("A task title needs at least 3 characters.");
    if (title.length > MAX_TITLE) errors.push(`A task title is at most ${MAX_TITLE} characters.`);
  }
  if (input.lane !== undefined && !LANES.includes(input.lane)) {
    errors.push(`Lane must be one of ${LANES.join(", ")}.`);
  }
  return errors;
}

export function statsFor(tasks) {
  const byLane = { todo: 0, doing: 0, done: 0 };
  for (const task of tasks) byLane[task.lane] += 1;
  const total = tasks.length;
  return {
    total,
    byLane,
    donePercent: total === 0 ? 0 : Math.round((byLane.done / total) * 100),
  };
}

export function createApiServer(options = {}) {
  const dataFile = options.dataFile ?? path.join(HERE, "data", "tasks.json");
  const root = options.root ?? HERE;

  const load = () => {
    try {
      const parsed = JSON.parse(readFileSync(dataFile, "utf8"));
      return Array.isArray(parsed.tasks) ? parsed.tasks : [];
    } catch {
      return [];
    }
  };
  let tasks = load();
  let counter = tasks.reduce((max, task) => Math.max(max, Number(task.id) || 0), 0);

  const save = () => {
    mkdirSync(path.dirname(dataFile), { recursive: true });
    writeFileSync(dataFile, `${JSON.stringify({ tasks }, null, 2)}\n`, "utf8");
  };

  const serveStatic = (req, res, urlPath) => {
    const relative = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
    const full = path.resolve(root, relative);
    if (!full.startsWith(path.resolve(root) + path.sep) && full !== path.resolve(root)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (!existsSync(full)) {
      res.writeHead(404, { "content-type": "text/plain" }).end(`Not found: ${relative}`);
      return;
    }
    const ext = path.extname(full);
    const type =
      ext === ".html" ? "text/html; charset=utf-8"
        : ext === ".css" ? "text/css; charset=utf-8"
          : ext === ".js" ? "text/javascript; charset=utf-8"
            : ext === ".png" ? "image/png"
              : "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(readFileSync(full));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = (req.method ?? "GET").toUpperCase();
    const route = url.pathname;

    try {
      if (route === "/api/health" && method === "GET") {
        json(res, 200, { ok: true, service: "pulse-board", tasks: tasks.length });
        return;
      }

      if (route === "/api/tasks" && method === "GET") {
        const lane = url.searchParams.get("lane");
        const visible = lane ? tasks.filter((task) => task.lane === lane) : tasks;
        json(res, 200, { tasks: visible });
        return;
      }

      if (route === "/api/tasks" && method === "POST") {
        const body = await readBody(req);
        const errors = validateTask(body);
        if (errors.length > 0) {
          json(res, 400, { ok: false, errors });
          return;
        }
        counter += 1;
        const task = {
          id: counter,
          title: normalizeTitle(body.title),
          lane: LANES.includes(body.lane) ? body.lane : "todo",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        tasks = [...tasks, task];
        save();
        json(res, 201, { ok: true, task });
        return;
      }

      const match = /^\/api\/tasks\/(\d+)$/.exec(route);
      if (match && method === "PATCH") {
        const body = await readBody(req);
        const errors = validateTask(body, { partial: true });
        if (errors.length > 0) {
          json(res, 400, { ok: false, errors });
          return;
        }
        const id = Number(match[1]);
        const current = tasks.find((task) => task.id === id);
        if (!current) {
          json(res, 404, { ok: false, errors: ["No task with that id."] });
          return;
        }
        const next = {
          ...current,
          ...(body.title !== undefined ? { title: normalizeTitle(body.title) } : {}),
          ...(body.lane !== undefined ? { lane: body.lane } : {}),
          updatedAt: new Date().toISOString(),
        };
        tasks = tasks.map((task) => (task.id === id ? next : task));
        save();
        json(res, 200, { ok: true, task: next });
        return;
      }

      if (match && method === "DELETE") {
        const id = Number(match[1]);
        if (!tasks.some((task) => task.id === id)) {
          json(res, 404, { ok: false, errors: ["No task with that id."] });
          return;
        }
        tasks = tasks.filter((task) => task.id !== id);
        save();
        json(res, 200, { ok: true, deleted: id });
        return;
      }

      if (route === "/api/tasks" && method === "DELETE") {
        const removed = tasks.length;
        tasks = [];
        save();
        json(res, 200, { ok: true, removed });
        return;
      }

      if (route === "/api/stats" && method === "GET") {
        json(res, 200, { ok: true, ...statsFor(tasks) });
        return;
      }

      if (route.startsWith("/api/")) {
        json(res, 404, { ok: false, errors: [`No API route ${method} ${route}`] });
        return;
      }

      if (method === "GET" || method === "HEAD") {
        serveStatic(req, res, route);
        return;
      }

      json(res, 405, { ok: false, errors: [`${method} is not allowed here.`] });
    } catch (error) {
      json(res, 400, { ok: false, errors: [error instanceof Error ? error.message : String(error)] });
    }
  });

  return server;
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const port = Number(process.env.PORT ?? 5300);
  const server = createApiServer({
    dataFile: process.env.PULSE_DATA ?? path.join(HERE, "data", "tasks.json"),
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`pulse-board backend listening on http://127.0.0.1:${port}`);
  });
}
