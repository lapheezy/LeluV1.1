/**
 * ==========================================================
 * LÉLU — PLANET TEXTURES, OFF THE CRITICAL PATH
 *
 * DebugPlanet generated three 1024² procedural maps synchronously inside
 * useMemo on mount: measured 1.8 s of main-thread time on the cold boot
 * (the largest single block of it), repeated on every remount.
 *
 * Now each mount gets its CanvasTexture immediately and the SAME texture is
 * filled in place when the pixels arrive, so the material's `map` never
 * changes identity (no shader recompile) and nothing in the scene graph is
 * rebuilt. Pixels are generated once per session — in a worker when one is
 * available, otherwise on the main thread at idle time — and reused by every
 * later mount. The pixels are identical to the synchronous version.
 * ==========================================================
 */
import { CanvasTexture } from "three";

import { cityLightsPixels, cloudPixels, earthSurfacePixels } from "./PlanetTextures";
import type { PlanetTextureKind } from "./planetTextures.worker";

const MAIN_THREAD: Record<PlanetTextureKind, (size: number) => Uint8ClampedArray> = {
  earth: earthSurfacePixels,
  clouds: cloudPixels,
  cityLights: cityLightsPixels,
};

const cache = new Map<string, Promise<Uint8ClampedArray>>();
const pending = new Map<number, { resolve: (p: Uint8ClampedArray) => void; reject: (e: Error) => void }>();
let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./planetTextures.worker.ts", import.meta.url), { type: "module", name: "lelu-planet-textures" });
    worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; pixels?: Uint8ClampedArray; error?: string }>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if (event.data.ok && event.data.pixels) job.resolve(event.data.pixels);
      else job.reject(new Error(event.data.error ?? "planet texture worker failed"));
    };
    worker.onerror = () => {
      workerBroken = true;
      worker?.terminate();
      worker = null;
      for (const [id, job] of pending) {
        pending.delete(id);
        job.reject(new Error("worker-crashed"));
      }
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

function onIdle(run: () => void): void {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 2000 });
  else setTimeout(run, 0);
}

function onMainThread(kind: PlanetTextureKind, size: number): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) =>
    onIdle(() => {
      try {
        resolve(MAIN_THREAD[kind](size));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }),
  );
}

/** The pixels for one map, generated once per session. */
export function planetPixels(kind: PlanetTextureKind, size: number): Promise<Uint8ClampedArray> {
  const key = `${kind}:${size}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const w = getWorker();
  const work: Promise<Uint8ClampedArray> = w
    ? new Promise<Uint8ClampedArray>((resolve, reject) => {
        const id = (seq += 1);
        pending.set(id, { resolve, reject });
        w.postMessage({ id, kind, size });
      }).catch(() => onMainThread(kind, size)) // a crashed worker must not lose the planet
    : onMainThread(kind, size);
  cache.set(key, work);
  work.catch(() => cache.delete(key));
  return work;
}

/**
 * A texture that is usable now and becomes the procedural map as soon as
 * its pixels exist. `placeholder` is a CSS colour painted first (the ocean,
 * so the planet is never invisible while its surface is generated).
 */
export function createPlanetTexture(kind: PlanetTextureKind, size: number, placeholder?: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx && placeholder) {
    ctx.fillStyle = placeholder;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  void planetPixels(kind, size)
    .then((pixels) => {
      if (!ctx) return;
      const image = ctx.createImageData(size, size);
      image.data.set(pixels);
      ctx.clearRect(0, 0, size, size);
      ctx.putImageData(image, 0, 0);
      texture.needsUpdate = true;
    })
    .catch((error) => console.warn(`[planet] ${kind} texture could not be generated`, error));
  return texture;
}
