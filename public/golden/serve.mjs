#!/usr/bin/env node
/**
 * Serve the Golden Geometry visualisation at the server root.
 *
 *   node public/golden/serve.mjs [port]
 *
 * `/`            → public/golden/index.html
 * `/node_modules` → the project's installed Three.js (not a copy)
 * everything else → the repository root
 */
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PAGE = path.join(ROOT, "public/golden/index.html");
const PORT = Number(process.argv[2] ?? 3002);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".css": "text/css",
};

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = url === "/" ? PAGE : path.join(ROOT, url);
  const resolved = path.resolve(file);
  if (!resolved.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      res.writeHead(302, { location: "/" }).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(resolved)] ?? "application/octet-stream", "cache-control": "no-store" });
    createReadStream(resolved).pipe(res);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, "0.0.0.0", () => console.log(`golden geometry visualisation on http://0.0.0.0:${PORT}/`));
