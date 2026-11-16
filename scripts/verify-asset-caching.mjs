/**
 * LÉLU — PRODUCTION CACHE POLICY, CHECKED AGAINST REAL RESPONSES
 *
 * The runtime (`server.ts`) is the production asset server. This script
 * asks it the questions a phone actually asks, and checks the answer:
 *
 *   1. the app shell revalidates (`no-cache`) and answers a repeat with
 *      304 and no body;
 *   2. a content-hashed build asset is `immutable` for a year;
 *   3. nothing that a deploy can change is served `immutable` — the
 *      service worker script, the manifest, the avatar art, the models;
 *   4. every file carries an ETag, and a conditional request is a 304;
 *   5. a model answers Range with 206 and the right bytes, refuses an
 *      impossible range with 416, and ignores a stale If-Range;
 *   6. HEAD answers with the real Content-Length and no body.
 *
 * Evidence goes to docs/evidence/asset-caching/<stamp>/http.json.
 * Usage: node scripts/verify-asset-caching.mjs [baseUrl]
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync, truncateSync, mkdirSync as mkdir } from "node:fs";
import path from "node:path";

const BASE = (process.argv[2] ?? "http://127.0.0.1:4173/").replace(/\/?$/, "/");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.join("docs", "evidence", "asset-caching", stamp);
mkdirSync(OUT, { recursive: true });

const checks = [];
const evidence = {};

function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function head(url, headers = {}) {
  const res = await fetch(url, { method: "HEAD", headers });
  return { status: res.status, headers: Object.fromEntries(res.headers) };
}

async function get(url, headers = {}) {
  const res = await fetch(url, { headers });
  const body = await res.arrayBuffer();
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers),
    bytes: body.byteLength,
  };
}

/** A content-hashed bundle, picked from the real build. */
function hashedAsset() {
  try {
    const file = readdirSync("dist/assets").find((name) => /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(name));
    return file ? `assets/${file}` : null;
  } catch {
    return null;
  }
}

const MODEL = "models/cache-probe.glb";

/**
 * A model-sized fixture, made here and removed afterwards, so the range
 * checks are reproducible without shipping a 49 MB placeholder in dist
 * (which a real deploy would serve). 12 MB is enough to exercise every
 * range path and keeps the evidence cheap.
 */
function ensureModelFixture() {
  if (existsSync(path.join("dist", MODEL))) return false;
  mkdir(path.join("dist", "models"), { recursive: true });
  const file = path.join("dist", MODEL);
  writeFileSync(file, "");
  truncateSync(file, 12 * 1024 * 1024);
  return true;
}

async function main() {
  const fixtureCreated = ensureModelFixture();
  /* ---------------------------------------------------------------- */
  /* the app shell                                                     */
  /* ---------------------------------------------------------------- */
  const shell = await head(BASE);
  evidence.shell = shell;
  check("app shell is not cached without revalidation", shell.headers["cache-control"] === "no-cache", shell.headers["cache-control"]);
  check("app shell carries an ETag", Boolean(shell.headers.etag), shell.headers.etag);

  const shellConditional = await get(BASE, { "If-None-Match": shell.headers.etag ?? "" });
  evidence.shellConditional = shellConditional;
  check("repeat shell request is a 304", shellConditional.status === 304, `status ${shellConditional.status}`);
  check("a 304 carries no body", shellConditional.bytes === 0, `${shellConditional.bytes} bytes`);

  /* ---------------------------------------------------------------- */
  /* a content-hashed bundle may be immutable                          */
  /* ---------------------------------------------------------------- */
  const asset = hashedAsset();
  if (!asset) {
    check("a content-hashed bundle exists in dist/assets", false, "no hashed file found");
  } else {
    const hashed = await head(BASE + asset);
    evidence.hashedAsset = { asset, ...hashed };
    check(
      "content-hashed bundle is immutable for a year",
      /\bimmutable\b/.test(hashed.headers["cache-control"] ?? "") && /max-age=31536000/.test(hashed.headers["cache-control"] ?? ""),
      `${asset}: ${hashed.headers["cache-control"]}`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* nothing a deploy can change may be immutable                      */
  /* ---------------------------------------------------------------- */
  const mutable = [
    ["the service worker script", "sw.js"],
    ["the web manifest", "manifest.webmanifest"],
    ["the avatar art", "avatar/lelu/earthy/body.webp"],
    ["the avatar rig", "avatar/lelu/earthy/rig.json"],
  ];
  evidence.mutable = {};
  for (const [label, rel] of mutable) {
    const res = await head(BASE + rel);
    evidence.mutable[rel] = res;
    const cc = res.headers["cache-control"] ?? "";
    check(`${label} is not served immutable`, !/\bimmutable\b/.test(cc), `${rel}: ${cc}`);
    check(`${label} revalidates`, /no-cache|must-revalidate|max-age=0/.test(cc), `${rel}: ${cc}`);
    check(`${label} carries an ETag`, Boolean(res.headers.etag), `${rel}: ${res.headers.etag}`);
  }

  /* the avatar art specifically: a new look must be able to replace it */
  const avatar = await head(BASE + "avatar/lelu/earthy/body.webp");
  const avatarConditional = await get(BASE + "avatar/lelu/earthy/body.webp", {
    "If-None-Match": avatar.headers.etag ?? "",
  });
  evidence.avatarConditional = avatarConditional;
  check("unchanged avatar art costs a 304, not a re-download", avatarConditional.status === 304 && avatarConditional.bytes === 0, `status ${avatarConditional.status}, ${avatarConditional.bytes} bytes`);

  /* the service worker must never be served from an immutable entry */
  const sw = await head(BASE + "sw.js");
  check("the service worker can be updated on an installed phone", sw.headers["cache-control"] === "no-cache", String(sw.headers["cache-control"]));

  /* ---------------------------------------------------------------- */
  /* the model: ranges, resume, validators                             */
  /* ---------------------------------------------------------------- */
  const modelHead = await head(BASE + MODEL);
  evidence.modelHead = modelHead;
  if (modelHead.status !== 200) {
    check(`a model asset is present at ${MODEL}`, false, `status ${modelHead.status} — create one to test ranges`);
  } else {
    const total = Number(modelHead.headers["content-length"]);
    check("model advertises range support", modelHead.headers["accept-ranges"] === "bytes", String(modelHead.headers["accept-ranges"]));
    check("HEAD reports the real length", Number.isFinite(total) && total > 0, `${total} bytes`);

    const firstKb = await get(BASE + MODEL, { Range: "bytes=0-1023" });
    evidence.rangeFirstKb = { status: firstKb.status, headers: firstKb.headers, bytes: firstKb.bytes };
    check("a range request is 206, not the whole file", firstKb.status === 206, `status ${firstKb.status}`);
    check("a range request returns only the asked bytes", firstKb.bytes === 1024, `${firstKb.bytes} bytes`);
    check("Content-Range names the slice", firstKb.headers["content-range"] === `bytes 0-1023/${total}`, String(firstKb.headers["content-range"]));

    const tail = await get(BASE + MODEL, { Range: "bytes=-100" });
    check("a suffix range resumes from the end", tail.status === 206 && tail.bytes === 100, `status ${tail.status}, ${tail.bytes} bytes`);

    const resume = await get(BASE + MODEL, { Range: `bytes=${total - 1024}-` });
    check("an open-ended range resumes to the end", resume.status === 206 && resume.bytes === 1024, `status ${resume.status}, ${resume.bytes} bytes`);

    const impossible = await get(BASE + MODEL, { Range: `bytes=${total + 10}-` });
    check("an impossible range is 416 with the real size", impossible.status === 416 && impossible.headers["content-range"] === `bytes */${total}`, `status ${impossible.status}, ${impossible.headers["content-range"]}`);

    const staleIfRange = await get(BASE + MODEL, { Range: "bytes=0-1023", "If-Range": '"not-the-current-model"' });
    check("a stale If-Range gets the full current file", staleIfRange.status === 200 && staleIfRange.bytes === total, `status ${staleIfRange.status}, ${staleIfRange.bytes} bytes`);

    const freshIfRange = await get(BASE + MODEL, { Range: "bytes=0-1023", "If-Range": modelHead.headers.etag ?? "" });
    check("a matching If-Range gets the slice", freshIfRange.status === 206 && freshIfRange.bytes === 1024, `status ${freshIfRange.status}, ${freshIfRange.bytes} bytes`);

    const modelConditional = await get(BASE + MODEL, { "If-None-Match": modelHead.headers.etag ?? "" });
    check("an unchanged model is a 304, not 49 MB again", modelConditional.status === 304 && modelConditional.bytes === 0, `status ${modelConditional.status}, ${modelConditional.bytes} bytes`);

    const modelType = modelHead.headers["content-type"];
    check("the model has a real content type", modelType === "model/gltf-binary", String(modelType));
  }

  /* ---------------------------------------------------------------- */
  /* untouched behaviour                                               */
  /* ---------------------------------------------------------------- */
  const missingAsset = await get(BASE + "assets/does-not-exist.js");
  check("a missing bundle is still a 404, not the shell", missingAsset.status === 404, `status ${missingAsset.status}`);

  const spa = await get(BASE + "some/deep/route");
  check("an app route still returns the shell", spa.status === 200 && (spa.headers["content-type"] ?? "").startsWith("text/html"), `status ${spa.status}`);

  if (fixtureCreated) rmSync(path.join("dist", MODEL), { force: true });

  const pass = checks.filter((c) => c.pass).length;
  const summary = { stamp, base: BASE, pass, total: checks.length, checks, evidence };
  writeFileSync(path.join(OUT, "http.json"), JSON.stringify(summary, null, 2));
  console.log(`\n${pass}/${checks.length} cache-policy checks passed — evidence in ${OUT}/http.json`);
  process.exit(pass === checks.length ? 0 : 1);
}

main().catch((error) => {
  console.error("verify-asset-caching failed:", error);
  process.exit(1);
});
