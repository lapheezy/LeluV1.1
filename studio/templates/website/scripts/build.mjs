/**
 * Aurora site build — real output, real checks.
 *
 * No bundler is required for a static site, so the build does the job a
 * deploy needs: copy what ships, verify every referenced local asset
 * exists, hash the output and write a manifest. A missing file fails the
 * build instead of shipping a broken page.
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

const SHIP = [
  "index.html",
  "styles.css",
  "src/logic.js",
  "src/site.js",
  "README.md",
  "tests/site.test.mjs",
  "scripts/build.mjs",
];

const failures = [];
for (const file of SHIP) {
  if (!existsSync(path.join(root, file))) failures.push(`missing source file: ${file}`);
}

const html = existsSync(path.join(root, "index.html")) ? readFileSync(path.join(root, "index.html"), "utf8") : "";
const referenced = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)]
  .map((match) => match[1])
  .filter((value) => !/^(https?:|mailto:|tel:|data:)/.test(value));
for (const file of referenced) {
  if (!existsSync(path.join(root, file))) failures.push(`index.html references a file that does not exist: ${file}`);
}

for (const required of ["<nav", "id=\"site-nav\"", "id=\"contact-form\"", "type=\"module\""]) {
  if (!html.includes(required)) failures.push(`index.html is missing ${required}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const manifest = { name: "aurora-site", builtAt: new Date().toISOString(), files: [], bytes: 0 };
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
const outputs = walk(dist);

console.log(
  `built aurora-site: ${outputs.length} files, ${(manifest.bytes / 1024).toFixed(1)} KB source, ` +
    `${referenced.length} referenced assets verified`,
);
