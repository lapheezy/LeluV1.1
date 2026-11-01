/**
 * Pulse Board build. The frontend is static; the backend is imported and
 * checked as a module before anything ships, so a syntax error in the API
 * fails the build rather than the first user request.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const failures = [];

const SHIP = ["index.html", "styles.css", "src/app.js", "README.md"];
const SERVER = "server.mjs";

for (const file of [...SHIP, SERVER, "tests/api.test.mjs"]) {
  if (!existsSync(path.join(root, file))) failures.push(`missing source file: ${file}`);
}

let backend = null;
try {
  backend = await import(new URL(`../${SERVER}`, import.meta.url));
} catch (error) {
  failures.push(`the backend module does not load: ${error.message}`);
}
if (!backend || typeof backend.createApiServer !== "function") {
  failures.push("server.mjs does not export createApiServer()");
}
if (!backend || typeof backend.statsFor !== "function") {
  failures.push("server.mjs does not export statsFor()");
}

const serverSource = existsSync(path.join(root, SERVER)) ? readFileSync(path.join(root, SERVER), "utf8") : "";
for (const route of ["/api/tasks", "/api/stats", "/api/health"]) {
  if (!serverSource.includes(route)) failures.push(`the backend does not serve ${route}`);
}

const html = existsSync(path.join(root, "index.html")) ? readFileSync(path.join(root, "index.html"), "utf8") : "";
for (const required of ["id=\"task-form\"", "data-lane=\"todo\"", "data-lane=\"doing\"", "data-lane=\"done\"", "src/app.js"]) {
  if (!html.includes(required)) failures.push(`index.html is missing ${required}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const manifest = { name: "pulse-board", builtAt: new Date().toISOString(), files: [], bytes: 0 };
for (const file of SHIP) {
  const content = readFileSync(path.join(root, file));
  const target = path.join(dist, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  manifest.files.push({
    path: file,
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex").slice(0, 16),
  });
  manifest.bytes += content.byteLength;
}
writeFileSync(path.join(dist, "build.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

console.log(
  `built pulse-board: ${walk(dist).length} files, ${(manifest.bytes / 1024).toFixed(1)} KB, ` +
    `backend imports and serves ${["/api/tasks", "/api/stats", "/api/health"].length} checked routes`,
);
