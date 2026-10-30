/**
 * ==========================================================
 * LÉLU
 * AVATAR 3D RECONSTRUCTOR — saved photo → true textured GLB
 *
 * The saved avatar reference is a 2D image. This module is the
 * external conversion pipeline the avatar system was missing:
 *
 *   SAVED REFERENCE (AvatarStore / IndexedDB)
 *     → 3D Forge (/api/forge): stored as a reference, then an
 *       image-to-3d job — the server holds the Meshy key, polls
 *       the task, downloads and inspects the GLB
 *     → fetch the inspected GLB from the Forge asset store
 *     → persist ArrayBuffer in IndexedDB ("lelu-avatar-3d")
 *     → LeluV2Presence loads it as the LIVE 3D LÉLU
 *
 * Every stage emits REAL AgentEventBus events (tool_started /
 * tool_progress / tool_result / tool_failed) so the Workspace
 * and Executive Runtime observe actual progress — never a
 * simulated bar. Success is only reported after the GLB bytes
 * are downloaded AND persisted; failure is reported honestly.
 *
 * API key: MESHY_API_KEY, read by the server only. The page never
 * sees it (it used to: this module called Meshy from the browser).
 * ==========================================================
 */

import AgentEventBus from "../agent/AgentEvents";
import ForgeClient from "../forge/ForgeClient";

/* ----------------------------- types ---------------------------------- */

export type ReconstructionStatus =
  | { state: "idle" }
  | { state: "running"; progress: number; note: string }
  | { state: "succeeded"; taskId: string; finishedAt: number }
  | { state: "failed"; error: string; finishedAt: number };

interface StoredModel {
  /** Raw GLB bytes — loadable directly by THREE.GLTFLoader.parse. */
  glb: ArrayBuffer;
  /** Fingerprint of the reference image this model was built from. */
  fingerprint: string;
  taskId: string;
  createdAt: number;
}

export type ReconstructionListener = (status: ReconstructionStatus, hasStored: boolean) => void;

/* --------------------------- IndexedDB -------------------------------- */

const DB = "lelu-avatar-3d";
const STORE = "models";
const KEY = "reconstructed";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function readStored(): Promise<StoredModel | null> {
  try {
    const db = await openDb();
    return await new Promise<StoredModel | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as StoredModel | undefined) ?? null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

async function writeStored(model: StoredModel): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(model, KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("IndexedDB write failed"));
    };
  });
}

async function clearStored(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // best-effort cleanup
  }
}

/** Stable fingerprint of the source image so a stale GLB for an OLD
 *  reference is never presented as the current avatar. */
export function fingerprintOf(dataUrl: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  // Sample stride keeps this O(n/13) on multi-MB data URLs.
  for (let i = 0; i < dataUrl.length; i += 13) {
    h1 = (h1 ^ dataUrl.charCodeAt(i)) >>> 0;
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (h2 + dataUrl.charCodeAt(i) * (i + 1)) >>> 0;
  }
  return `${h1.toString(16)}-${h2.toString(16)}-${dataUrl.length}`;
}

/* ------------------------------ service ------------------------------- */

/** The Forge character the saved-avatar references and jobs are filed under. */
const AVATAR_CHARACTER = "saved_avatar";
const MAX_WAIT_MS = 12 * 60 * 1000;

class Avatar3DReconstructorImpl {
  private static instance: Avatar3DReconstructorImpl | null = null;

  private listeners = new Set<ReconstructionListener>();
  private status: ReconstructionStatus = { state: "idle" };
  private stored: StoredModel | null = null;
  private running = false;

  private constructor() {
    void readStored().then((model) => {
      this.stored = model;
      this.notify();
    });
  }

  public static getInstance(): Avatar3DReconstructorImpl {
    if (!Avatar3DReconstructorImpl.instance) {
      Avatar3DReconstructorImpl.instance = new Avatar3DReconstructorImpl();
    }
    return Avatar3DReconstructorImpl.instance;
  }

  public getStatus(): ReconstructionStatus {
    return this.status;
  }

  public isRunning(): boolean {
    return this.running;
  }

  /** Whether a reconstructed GLB exists for the CURRENT reference. */
  public hasStoredFor(fingerprint: string): boolean {
    return this.stored?.fingerprint === fingerprint;
  }

  /** Raw GLB bytes of the reconstructed model (null if none/stale). */
  public async getModelFor(fingerprint: string): Promise<ArrayBuffer | null> {
    if (!this.stored || this.stored.fingerprint !== fingerprint) return null;
    return this.stored.glb;
  }

  public subscribe(listener: ReconstructionListener): () => void {
    this.listeners.add(listener);
    listener(this.status, this.stored !== null);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async removeStored(): Promise<void> {
    await clearStored();
    this.stored = null;
    this.notify();
  }

  private notify(): void {
    const hasStored = this.stored !== null;
    for (const listener of this.listeners) {
      try {
        listener(this.status, hasStored);
      } catch (error) {
        console.error("[Lélu Avatar3D] listener threw (contained)", error);
      }
    }
  }

  private setStatus(next: ReconstructionStatus): void {
    this.status = next;
    this.notify();
  }

  /**
   * Reconstruct the given saved reference image into a true textured
   * GLB. Resolves with the task id only after the model is DOWNLOADED
   * and PERSISTED; rejects with an honest reason otherwise.
   */
  public async reconstruct(referenceImage: string): Promise<string> {
    if (this.running) throw new Error("A 3D reconstruction is already running.");
    if (!referenceImage) throw new Error("No saved reference image to reconstruct.");

    const taskId = `avatar-3d-${Date.now()}`;
    const bus = AgentEventBus.getInstance();
    const fingerprint = fingerprintOf(referenceImage);

    this.running = true;
    this.setStatus({ state: "running", progress: 1, note: "Sending reference to the 3D Forge…" });
    bus.emit({
      type: "tool_started",
      taskId,
      tool: "avatar-reconstruction",
      label: "True 3D reconstruction of saved avatar",
    });

    try {
      const status = await ForgeClient.status();
      if (!status.configured) {
        throw new Error("MESHY_API_KEY is not set on the server — add it to the server environment to enable true 3D reconstruction.");
      }

      // 1 — store the image as a reference (de-duplicated by content), then
      // ask for the job. The person pressed "reconstruct": that is the approval.
      const refId = `avatar_${fingerprint.replace(/[^a-z0-9]/gi, "").slice(0, 40).toLowerCase()}`;
      await ForgeClient.addReference(AVATAR_CHARACTER, refId, referenceImage, {
        category: "body",
        view: "front full-body",
        intendedUse: "Saved avatar reference",
        uses: ["geometry", "texture"],
      });
      const { job } = await ForgeClient.request({
        character: AVATAR_CHARACTER,
        kind: "image-to-3d",
        purpose: "Saved avatar presence",
        approve: true,
        body: {
          image_url: `ref:${refId}`,
          ai_model: "meshy-6",
          topology: "triangle",
          target_polycount: 30_000,
          texture_resolution: "2k",
          pose_mode: "a-pose",
          target_formats: ["glb"],
          image_enhancement: false,
        },
      });

      // 2 — follow the server's job (it polls Meshy and downloads the outputs).
      const finished = await ForgeClient.waitFor(
        job.id,
        (current) => {
          const pct = Math.min(99, Math.max(5, Math.round(current.progress || 5)));
          this.setStatus({ state: "running", progress: pct, note: `Forge job ${current.status} · ${pct}%` });
          bus.emit({ type: "tool_progress", taskId, tool: "avatar-reconstruction", progress: pct / 100, note: current.status });
        },
        { timeoutMs: MAX_WAIT_MS },
      );
      if (finished.status !== "SUCCEEDED" || !finished.output) {
        throw new Error(finished.error ?? `3D Forge job ended as ${finished.status}.`);
      }
      const model = finished.output.files.find((f) => f.role === "model");
      if (!model) throw new Error("The finished job has no GLB.");
      if (finished.validation && !finished.validation.verdict.meshValid) {
        throw new Error(`The returned model failed inspection: ${finished.validation.problems.join("; ")}`);
      }

      // 3 — fetch the inspected GLB from the server's asset store.
      this.setStatus({ state: "running", progress: 100, note: "Downloading GLB…" });
      const glb = await ForgeClient.assetBytes(model.file);
      if (glb.byteLength < 1024) throw new Error("Downloaded GLB is implausibly small — rejecting.");

      // 4 — persist locally so every future session boots with the SAME model.
      const meshyTaskId = finished.meshyTaskId ?? finished.id;
      await writeStored({ glb, fingerprint, taskId: meshyTaskId, createdAt: Date.now() });
      this.stored = await readStored();

      this.setStatus({ state: "succeeded", taskId: meshyTaskId, finishedAt: Date.now() });
      bus.emit({
        type: "tool_result",
        taskId,
        tool: "avatar-reconstruction",
        result: `True 3D model reconstructed and stored (${Math.round(glb.byteLength / 1024)} KB GLB).`,
      });
      bus.emit({
        type: "visual_created",
        taskId,
        label: "LÉLU true-3D reconstruction",
      });
      return meshyTaskId;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: "failed", error: reason, finishedAt: Date.now() });
      bus.emit({ type: "tool_failed", taskId, tool: "avatar-reconstruction", error: reason });
      throw error;
    } finally {
      this.running = false;
    }
  }
}

/** Public API type (keeps consumers decoupled from the impl class name). */
export type Avatar3DReconstructorApi = Avatar3DReconstructorImpl;

const Avatar3DReconstructor = Avatar3DReconstructorImpl;
export default Avatar3DReconstructor;
