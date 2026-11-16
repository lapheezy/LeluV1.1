/**
 * LÉLU — run Creation Studio exports in a Web Worker (browser only).
 * Falls back to the main thread if a worker cannot start, and says so
 * in the console rather than failing the export.
 */

import { exportArtifact, type ExportResult } from "./StudioExport";
import type { ArtifactSpec, ExportFormat } from "./StudioTypes";

let worker: Worker | null = null;
let broken = false;
let seq = 0;
const pending = new Map<number, { resolve: (r: ExportResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (broken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./studioExport.worker.ts", import.meta.url), { type: "module", name: "lelu-studio-export" });
    worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: ExportResult; error?: string }>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if (event.data.ok && event.data.result) job.resolve(event.data.result);
      else job.reject(new Error(event.data.error ?? "export failed in the worker"));
    };
    worker.onerror = (event) => {
      console.warn("[Studio] export worker failed; exporting on the main thread instead.", event.message);
      broken = true;
      worker?.terminate();
      worker = null;
      for (const [id, job] of pending) { pending.delete(id); job.reject(new Error("worker-crashed")); }
    };
    return worker;
  } catch (error) {
    console.warn("[Studio] export worker unavailable; exporting on the main thread.", error);
    broken = true;
    return null;
  }
}

export async function exportOffMainThread(spec: ArtifactSpec, format: ExportFormat): Promise<ExportResult> {
  const w = getWorker();
  if (!w) return exportArtifact(spec, format);
  const id = (seq += 1);
  try {
    return await new Promise<ExportResult>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, spec, format });
    });
  } catch (error) {
    // A crashed worker must not lose the export; a writer error is real and is passed on.
    if (error instanceof Error && error.message === "worker-crashed") return exportArtifact(spec, format);
    throw error;
  }
}
