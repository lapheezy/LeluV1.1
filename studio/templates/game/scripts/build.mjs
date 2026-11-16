/**
 * Rift Runner build. The game must run offline, so the build verifies the
 * vendored three.js module and every shipped file before writing dist/.
 * No CDN is allowed: a game that needs the network to start is not a
 * preview this studio can honestly show.
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

const SHIP = ["index.html", "styles.css", "src/logic.js", "src/main.js", "README.md"];
const OPTIONAL = ["assets/character-card.png"];

for (const file of [...SHIP, "vendor/three.module.js", "tests/game.test.mjs"]) {
  if (!existsSync(path.join(root, file))) failures.push(`missing: ${file}`);
}

const threePath = path.join(root, "vendor", "three.module.js");
if (existsSync(threePath)) {
  const size = statSync(threePath).size;
  if (size < 500_000) failures.push(`vendor/three.module.js is only ${size} bytes — not a complete module`);
}

const main = existsSync(path.join(root, "src/main.js")) ? readFileSync(path.join(root, "src/main.js"), "utf8") : "";
if (!main.includes("../vendor/three.module.js")) {
  failures.push("src/main.js does not import the vendored three.js module");
}
if (/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(main)) {
  failures.push("src/main.js loads a network URL; the game must run offline");
}

for (const required of ["import * as THREE", "createState", "requestAnimationFrame", "CapsuleGeometry"]) {
  if (!main.includes(required)) failures.push(`src/main.js is missing ${required}`);
}

let logic = null;
try {
  logic = await import(new URL("../src/logic.js", import.meta.url));
} catch (error) {
  failures.push(`src/logic.js does not load: ${error.message}`);
}
for (const fn of ["createState", "step", "isBlocked", "interact", "questLabel"]) {
  if (!logic || typeof logic[fn] !== "function") failures.push(`logic.js does not export ${fn}()`);
}

const html = existsSync(path.join(root, "index.html")) ? readFileSync(path.join(root, "index.html"), "utf8") : "";
for (const required of ["id=\"quest\"", "id=\"shards\"", "id=\"dialogue\"", "data-move=\"up\"", "src/main.js"]) {
  if (!html.includes(required)) failures.push(`index.html is missing ${required}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const manifest = { name: "rift-runner-3d", builtAt: new Date().toISOString(), files: [], bytes: 0 };
const ship = [...SHIP, "vendor/three.module.js", ...OPTIONAL.filter((file) => existsSync(path.join(root, file)))];
for (const file of ship) {
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
  `built rift-runner-3d: ${walk(dist).length} files, ${(manifest.bytes / 1024 / 1024).toFixed(2)} MB, ` +
    `three.js ${(statSync(threePath).size / 1024 / 1024).toFixed(2)} MB verified, ` +
    `${OBSTACLE_COUNT(logic)} obstacles / ${SHARD_COUNT(logic)} shards in the real world`,
);

function OBSTACLE_COUNT(module) {
  return module?.OBSTACLES?.length ?? 0;
}
function SHARD_COUNT(module) {
  return module?.SHARDS?.length ?? 0;
}
