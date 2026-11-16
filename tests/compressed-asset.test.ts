/**
 * Immutable Forge assets are served from a once-made gzip copy — lossless,
 * never compressed on the request path, and never for a range request.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const dir = mkdtempSync(path.join(tmpdir(), "lelu-gz-"));
process.env.LELU_GZIP_CACHE_DIR = path.join(dir, "cache");
const { acceptsGzip, ensureGzipCopy, selectAssetBody, MIN_COMPRESS_BYTES } = await import("../plugins/compressedAsset.ts");

const glb = path.join(dir, "model.glb");
const bytes = Buffer.alloc(MIN_COMPRESS_BYTES * 2);
for (let i = 0; i < bytes.length; i++) bytes[i] = i % 7 === 0 ? i & 255 : 0;
writeFileSync(glb, bytes);

test("Accept-Encoding parsing honours q=0", () => {
  assert.equal(acceptsGzip("gzip, deflate, br"), true);
  assert.equal(acceptsGzip("br;q=1, gzip;q=0"), false);
  assert.equal(acceptsGzip(undefined), false);
});

test("first request is uncompressed, later ones get the identical bytes gzipped", async () => {
  const first = selectAssetBody(glb, { "accept-encoding": "gzip" });
  assert.equal(first.encoding, null, "no request waits on compression");
  assert.equal(first.vary, true);
  await ensureGzipCopy(glb);
  const second = selectAssetBody(glb, { "accept-encoding": "gzip" });
  assert.equal(second.encoding, "gzip");
  assert.ok(second.size < bytes.length);
  assert.deepEqual(gunzipSync(readFileSync(second.path)), bytes, "lossless");
});

test("range requests and clients without gzip get the original file", async () => {
  await ensureGzipCopy(glb);
  assert.equal(selectAssetBody(glb, { "accept-encoding": "gzip", range: "bytes=0-99" }).encoding, null);
  assert.equal(selectAssetBody(glb, { "accept-encoding": "identity" }).encoding, null);
});

test("small files and non-model files are left alone", () => {
  const small = path.join(dir, "tiny.glb");
  writeFileSync(small, Buffer.alloc(1024));
  assert.deepEqual(selectAssetBody(small, { "accept-encoding": "gzip" }), { path: small, size: 1024, encoding: null, vary: false });
  const png = path.join(dir, "big.png");
  writeFileSync(png, bytes);
  assert.equal(selectAssetBody(png, { "accept-encoding": "gzip" }).encoding, null);
});
