/**
 * ==========================================================
 * LÉLU
 * AVATAR 3D RECONSTRUCTOR — saved photo → true textured GLB
 *
 * The saved avatar reference is a 2D image. This module is the
 * external conversion pipeline the avatar system was missing:
 *
 *   SAVED REFERENCE (AvatarStore / IndexedDB)
 *     → Meshy Image-to-3D API  (data-URI in, task id out)
 *     → poll task until SUCCEEDED
 *     → download model_urls.glb
 *     → persist ArrayBuffer in IndexedDB ("lelu-avatar-3d")
 *     → LeluV2Presence loads it as the LIVE 3D LÉLU
 *
 * Every stage emits REAL AgentEventBus events (tool_started /
 * tool_progress / tool_result / tool_failed) so the Workspace
 * and Executive Runtime observe actual progress — never a
 * simulated bar. Success is only reported after the GLB bytes
 * are downloaded AND persisted; failure is reported honestly.
 *
 * API key: VITE_MESHY_API_KEY (optional provider). An optional
 * VITE_MESHY_API_BASE_URL can route calls through a proxy if a
 * deployment blocks direct browser access.
 * ==========================================================
 */

import env from "../Environment";
import AgentEventBus from "../agent/AgentEvents";
import { endpoint } from "../Endpoints";

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

const MESHY_BASE_DEFAULT = endpoint("meshy");
const POLL_INTERVAL_MS = 5_000;
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

    const apiKey = env.meshyApiKey;
    if (!apiKey) {
      throw new Error(
        "VITE_MESHY_API_KEY is not set — add a Meshy API key (Settings → Environment) to enable true 3D reconstruction.",
      );
    }

    const base = this.baseUrl();
    const taskId = `avatar-3d-${Date.now()}`;
    const bus = AgentEventBus.getInstance();
    const fingerprint = fingerprintOf(referenceImage);

    this.running = true;
    this.setStatus({ state: "running", progress: 1, note: "Submitting reference to Meshy…" });
    bus.emit({
      type: "tool_started",
      taskId,
      tool: "avatar-reconstruction",
      label: "True 3D reconstruction of saved avatar",
    });

    try {
      // 1 — create the task (data URI accepted directly).
      const createRes = await fetch(`${base}/openapi/v1/image-to-3d`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image_url: referenceImage,
          ai_model: "meshy-6",
          topology: "triangle",
          target_polycount: 30_000,
          texture_resolution: "2k",
          pose_mode: "a-pose",
          target_formats: ["glb"],
          image_enhancement: false,
        }),
      });
      if (!createRes.ok) {
        const body = await createRes.text().catch(() => "");
        throw new Error(`Meshy task creation failed (HTTP ${createRes.status}): ${body.slice(0, 240)}`);
      }
      const created = (await createRes.json()) as { result?: string };
      const meshyTaskId = created.result;
      if (!meshyTaskId) throw new Error("Meshy did not return a task id.");

      // 2 — poll until SUCCEEDED (real progress from the provider).
      const startedAt = Date.now();
      let glbUrl: string | null = null;
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        await this.sleep(POLL_INTERVAL_MS);
        const pollRes = await fetch(`${base}/openapi/v1/image-to-3d/${meshyTaskId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!pollRes.ok) continue; // transient — keep polling within budget
        const task = (await pollRes.json()) as {
          status?: string;
          progress?: number;
          model_urls?: { glb?: string };
        };
        const pct = Math.min(99, Math.max(5, Math.round(task.progress ?? 10)));
        this.setStatus({
          state: "running",
          progress: pct,
          note: `Meshy task ${task.status ?? "…"} · ${pct}%`,
        });
        bus.emit({
          type: "tool_progress",
          taskId,
          tool: "avatar-reconstruction",
          progress: pct / 100,
          note: task.status,
        });

        if (task.status === "SUCCEEDED" && task.model_urls?.glb) {
          glbUrl = task.model_urls.glb;
          break;
        }
        if (task.status === "FAILED" || task.status === "CANCELED") {
          throw new Error(`Meshy reconstruction ${task.status.toLowerCase()} for task ${meshyTaskId}.`);
        }
      }
      if (!glbUrl) throw new Error("Reconstruction timed out before the model was ready.");

      // 3 — download the actual GLB bytes (success ≠ integration until
      // the bytes are really here).
      this.setStatus({ state: "running", progress: 100, note: "Downloading GLB…" });
      const glbRes = await fetch(glbUrl);
      if (!glbRes.ok) throw new Error(`GLB download failed (HTTP ${glbRes.status}).`);
      const glb = await glbRes.arrayBuffer();
      if (glb.byteLength < 1024) throw new Error("Downloaded GLB is implausibly small — rejecting.");

      // 4 — persist locally so every future session boots with the SAME model.
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

  private baseUrl(): string {
    try {
      const raw =
        (
          (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
        )["VITE_MESHY_API_BASE_URL"];
      return typeof raw === "string" && raw.trim() ? raw.trim().replace(/\/$/, "") : MESHY_BASE_DEFAULT;
    } catch {
      return MESHY_BASE_DEFAULT;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Public API type (keeps consumers decoupled from the impl class name). */
export type Avatar3DReconstructorApi = Avatar3DReconstructorImpl;

const Avatar3DReconstructor = Avatar3DReconstructorImpl;
export default Avatar3DReconstructor;
