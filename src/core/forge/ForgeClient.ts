/**
 * ==========================================================
 * LÉLU 3D FORGE — BROWSER CLIENT
 *
 * The page's only route to Meshy is the same-origin Forge
 * (/api/forge, plugins/meshyForgeApi.ts), which holds the
 * credential, the ledger and the approval gate. This client
 * holds nothing secret: it plans, asks for approval, follows
 * progress and fetches finished, inspected outputs.
 * ==========================================================
 */

import type { ForgeJobKind } from "./MeshyCatalog";
import type { GlbReport } from "./GlbInspector";

export interface ForgeJobView {
  id: string;
  character: string;
  kind: ForgeJobKind;
  purpose: string;
  status: string;
  progress: number;
  estimatedCredits: number;
  consumedCredits: number | null;
  meshyTaskId: string | null;
  error: string | null;
  output: { dir: string; files: Array<{ role: string; file: string; bytes: number; sha256: string }> } | null;
  validation: GlbReport | null;
}

export interface ForgeStatus {
  configured: boolean;
  credential: string | null;
  usage: { jobs: number; estimatedCredits: number; consumedCredits: number; byStatus: Record<string, number> };
}

export interface ActiveModel {
  jobId: string;
  kind: string;
  file: string;
  verdict: GlbReport["verdict"] | null;
}

export interface ActiveCharacter {
  character: string;
  model: ActiveModel | null;
  animations: Record<string, ActiveModel | null>;
  assetBase: string;
}

const BASE = "/api/forge";
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELED", "rejected"]);

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; details?: string[] } & T;
  if (!res.ok || payload.ok === false) {
    const details = payload.details?.length ? ` (${payload.details.join("; ")})` : "";
    throw new Error(`${payload.error ?? `Forge request failed (HTTP ${res.status})`}${details}`);
  }
  return payload;
}

export const ForgeClient = {
  status: () => call<ForgeStatus>("/status"),

  character: (character: string) => call<Record<string, unknown>>(`/characters/${encodeURIComponent(character)}`),

  active: (character: string) => call<ActiveCharacter>(`/characters/${encodeURIComponent(character)}/active`),

  addReference: (character: string, id: string, dataUrl: string, classification: Record<string, unknown> = {}) =>
    call<{ reference: { id: string } }>(`/characters/${encodeURIComponent(character)}/references`, {
      method: "POST",
      body: { id, dataUrl, classification },
    }),

  /** Plan a job. Without `approve` it waits for approval and spends nothing. */
  request: (input: { character: string; kind: ForgeJobKind; body: Record<string, unknown>; purpose?: string; approve?: boolean }) =>
    call<{ reused: boolean; job: ForgeJobView }>("/jobs", { method: "POST", body: input }),

  approve: (jobId: string) => call<{ job: ForgeJobView }>(`/jobs/${encodeURIComponent(jobId)}/approve`, { method: "POST", body: {} }),

  reject: (jobId: string) => call<{ job: ForgeJobView }>(`/jobs/${encodeURIComponent(jobId)}/reject`, { method: "POST", body: {} }),

  job: (jobId: string) => call<{ job: ForgeJobView }>(`/jobs/${encodeURIComponent(jobId)}`),

  jobs: (character?: string) =>
    call<{ jobs: ForgeJobView[] }>(`/jobs${character ? `?character=${encodeURIComponent(character)}` : ""}`),

  approveSlot: (character: string, slot: string, jobId: string) =>
    call<{ manifest: unknown }>(`/characters/${encodeURIComponent(character)}/slots`, { method: "POST", body: { slot, jobId } }),

  assetUrl: (file: string) => `${BASE}/assets/${file.split("/").map(encodeURIComponent).join("/")}`,

  async assetBytes(file: string): Promise<ArrayBuffer> {
    const res = await fetch(ForgeClient.assetUrl(file));
    if (!res.ok) throw new Error(`Asset download failed (HTTP ${res.status}).`);
    return res.arrayBuffer();
  },

  /**
   * Follow a job until it finishes and its outputs are on disk. Each read
   * is one free status call that the server de-duplicates; the server's
   * own monitor keeps polling Meshy whether or not anyone is watching.
   */
  async waitFor(jobId: string, onProgress?: (job: ForgeJobView) => void, options: { intervalMs?: number; timeoutMs?: number } = {}): Promise<ForgeJobView> {
    const interval = options.intervalMs ?? 5_000;
    const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000);
    for (;;) {
      const { job } = await ForgeClient.job(jobId);
      onProgress?.(job);
      if (TERMINAL.has(job.status) && (job.status !== "SUCCEEDED" || job.output)) return job;
      if (job.status === "awaiting_approval" || job.status === "submit_uncertain") return job;
      if (Date.now() > deadline) throw new Error(`Job ${jobId} is still ${job.status} after the wait budget; it keeps running server-side.`);
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  },
};

export default ForgeClient;
