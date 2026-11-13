/**
 * ==========================================================
 * LÉLU — PRE-COMPRESSED IMMUTABLE ASSETS
 *
 * Her approved 3D model is a 49.5 MB GLB, and every new device downloads
 * all of it before she appears. About half of it is geometry and morph
 * targets that compress well: measured gzip -9 49.5 MB → 32.6 MB, in
 * 1.9 s of CPU, once.
 *
 * The edge (Caddy `encode`) does not compress `model/gltf-binary` by
 * default, and compressing 50 MB per request would burn CPU on a small
 * VPS anyway. Forge version folders are never rewritten, so the
 * compressed copy is made ONCE per file (keyed by path, size and mtime),
 * kept on disk, and served from there with Content-Encoding: gzip. A
 * proxy in front passes an already-encoded response through untouched.
 *
 * The first request for a file is served uncompressed while its gzip copy
 * is written in the background, so no request ever waits on compression.
 * Lossless: the browser receives byte-identical GLB data.
 * ==========================================================
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, constants } from "node:zlib";

/** Below this, compression is not worth a cache file. */
export const MIN_COMPRESS_BYTES = 256 * 1024;

const COMPRESSIBLE = new Set([".glb", ".gltf", ".fbx", ".bin", ".obj"]);

const inFlight = new Map<string, Promise<void>>();

export function gzipCacheDir(): string {
  return process.env.LELU_GZIP_CACHE_DIR || path.join(process.cwd(), ".cache", "asset-gzip");
}

function cachePathFor(file: string, size: number, mtimeMs: number): string {
  const key = createHash("sha256").update(`${path.resolve(file)}\0${size}\0${Math.floor(mtimeMs)}`).digest("hex").slice(0, 32);
  return path.join(gzipCacheDir(), `${key}.gz`);
}

export function isCompressibleAsset(file: string, size: number): boolean {
  return size >= MIN_COMPRESS_BYTES && COMPRESSIBLE.has(path.extname(file).toLowerCase());
}

/** Write the gzip copy once (deduplicated), atomically via a temp file. */
export function ensureGzipCopy(file: string): Promise<void> {
  const stat = statSync(file);
  const target = cachePathFor(file, stat.size, stat.mtimeMs);
  if (existsSync(target)) return Promise.resolve();
  const running = inFlight.get(target);
  if (running) return running;
  const work = (async () => {
    mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    try {
      await pipeline(createReadStream(file), createGzip({ level: constants.Z_BEST_COMPRESSION }), createWriteStream(temp));
      renameSync(temp, target);
    } catch (error) {
      try {
        unlinkSync(temp);
      } catch {
        /* nothing written */
      }
      throw error;
    }
  })().finally(() => inFlight.delete(target));
  inFlight.set(target, work);
  return work;
}

/** The ready gzip copy for this file, or null (and start making one). */
export function readyGzipCopy(file: string): { path: string; size: number } | null {
  const stat = statSync(file);
  if (!isCompressibleAsset(file, stat.size)) return null;
  const target = cachePathFor(file, stat.size, stat.mtimeMs);
  if (existsSync(target)) return { path: target, size: statSync(target).size };
  ensureGzipCopy(file).catch((error) => console.warn("[asset-gzip] could not compress", path.basename(file), String(error)));
  return null;
}

export function acceptsGzip(acceptEncoding: unknown): boolean {
  const value = Array.isArray(acceptEncoding) ? acceptEncoding.join(",") : String(acceptEncoding ?? "");
  return value
    .toLowerCase()
    .split(",")
    .some((part) => {
      const [name, ...params] = part.trim().split(";");
      if (name.trim() !== "gzip") return false;
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return !q || Number(q.slice(2)) > 0;
    });
}

/**
 * Choose what to send for an immutable asset: the gzip copy when the
 * client accepts it and the copy exists, otherwise the file itself.
 * Range requests always get the original bytes (ranges refer to them).
 */
export function selectAssetBody(
  file: string,
  headers: { "accept-encoding"?: unknown; range?: unknown },
): { path: string; size: number; encoding: "gzip" | null; vary: boolean } {
  const size = statSync(file).size;
  const compressible = isCompressibleAsset(file, size);
  if (!compressible) return { path: file, size, encoding: null, vary: false };
  if (headers.range || !acceptsGzip(headers["accept-encoding"])) {
    return { path: file, size, encoding: null, vary: true };
  }
  const copy = readyGzipCopy(file);
  if (!copy) return { path: file, size, encoding: null, vary: true };
  return { path: copy.path, size: copy.size, encoding: "gzip", vary: true };
}
