/**
 * ==========================================================
 * LÉLU ASRE — CLIENT (browser + tools)
 *
 * One typed wrapper over /api/asre and the Forge routes ASRE assets use,
 * shared by the Genesis spatial workspace and LÉLU's tools, so the UI and
 * her cognition call exactly the same endpoints. Every call returns the
 * server's own answer; nothing is simulated here.
 * ==========================================================
 */

import type { AsreJobView, EvidenceBreakdown } from "./contracts.ts";
import type { ComponentImpact, CharacterVersion, ComponentDiff, RestorableGroup, SpecPatch } from "./character/identity.ts";

export type Ok<T> = T & { ok: true };
export class AsreClientError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<Ok<T>> {
  const res = await fetch(url, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new AsreClientError(json.error ?? `HTTP ${res.status}`, res.status);
  return json as Ok<T>;
}

export interface AsreStatus {
  blender: boolean;
  python: string | null;
  triposrWeights: boolean;
  engines: { silhouette: boolean; triposr: boolean };
  spend: string;
}

export interface VersionSummary {
  id: string;
  parentId: string | null;
  label: string;
  createdAt: number;
  operation: string;
  regenerated: string[];
  recolored: string[];
  reused: number;
  buildMs: number;
  triangles: number;
  isHead: boolean;
  exportedAs: string | null;
}

export interface CharacterHistory {
  character: { id: string; name: string; head: string; redo: string[]; versions: string[]; exports: Record<string, string>; leluLook: string | null };
  versions: VersionSummary[];
}

export interface SliceCell {
  u: number;
  v: number;
  cls: keyof EvidenceBreakdown;
  confidence: number;
  boundary: boolean;
}

export interface ForgeAsset {
  id: string;
  character: string;
  kind: string;
  purpose: string;
  status: string;
  createdAt: number;
  error: string | null;
  output: { dir: string; files: Array<{ role: string; file: string; bytes: number; sha256: string }> } | null;
  validation: { verdict: { meshValid: boolean }; geometry: { triangles: number; vertices: number } } | null;
  request: Record<string, unknown>;
}

const A = "/api/asre";
const enc = encodeURIComponent;

export const AsreClient = {
  status: () => call<AsreStatus>("GET", `${A}/status`),

  /* reconstruction */
  reconstruct: (body: { images: Array<{ view: string; imageBase64?: string; image?: string }>; engine?: string; resolution?: number; heightMeters?: number; render?: boolean }) =>
    call<{ job: AsreJobView }>("POST", `${A}/reconstruct`, body),
  jobs: () => call<{ jobs: AsreJobView[] }>("GET", `${A}/jobs`),
  job: (id: string) => call<{ job: AsreJobView }>("GET", `${A}/jobs/${enc(id)}`),
  cancel: (id: string) => call<{ job: AsreJobView }>("POST", `${A}/jobs/${enc(id)}/cancel`, {}),
  retry: (id: string) => call<{ job: AsreJobView }>("POST", `${A}/jobs/${enc(id)}/retry`, {}),
  observe: (id: string, view: string, imageBase64: string) => call<{ job: AsreJobView }>("POST", `${A}/jobs/${enc(id)}/observe`, { view, imageBase64 }),
  lineage: (id: string) => call<{ lineage: Array<Record<string, unknown>> }>("GET", `${A}/jobs/${enc(id)}/lineage`),
  slice: (id: string, axis: "x" | "y" | "z", index: number) =>
    call<{ axis: string; index: number; size: [number, number]; depth: number; cells: SliceCell[]; counts: EvidenceBreakdown }>("GET", `${A}/jobs/${enc(id)}/slice?axis=${axis}&index=${index}`),

  /* characters */
  characters: () => call<{ characters: Array<CharacterHistory["character"] & { headSummary: VersionSummary }> }>("GET", `${A}/characters`),
  createCharacter: (id: string, name?: string, leluLook?: string) => call<{ version: CharacterVersion } & CharacterHistory>("POST", `${A}/characters`, { id, name, leluLook }),
  history: (id: string) => call<CharacterHistory>("GET", `${A}/characters/${enc(id)}`),
  version: (id: string, v: string) => call<{ version: CharacterVersion }>("GET", `${A}/characters/${enc(id)}/versions/${enc(v)}`),
  impact: (id: string, patch: SpecPatch, base?: string) => call<{ base: string; impact: ComponentImpact[] }>("POST", `${A}/characters/${enc(id)}/impact`, { patch, base }),
  edit: (id: string, patch: SpecPatch, base?: string, label?: string) => call<{ version: CharacterVersion } & CharacterHistory>("POST", `${A}/characters/${enc(id)}/edit`, { patch, base, label }),
  restore: (id: string, from: string, groups?: RestorableGroup[]) => call<{ version: CharacterVersion } & CharacterHistory>("POST", `${A}/characters/${enc(id)}/restore`, { from, groups }),
  undo: (id: string) => call<CharacterHistory>("POST", `${A}/characters/${enc(id)}/undo`, {}),
  redo: (id: string) => call<CharacterHistory>("POST", `${A}/characters/${enc(id)}/redo`, {}),
  checkout: (id: string, version: string) => call<CharacterHistory>("POST", `${A}/characters/${enc(id)}/checkout`, { version }),
  compare: (id: string, a: string, b: string) =>
    call<{ comparison: { specChanges: string[]; components: ComponentDiff[]; geometry: { iou: number; change: string; added: number; removed: number; cellsA: number; cellsB: number }; triangles: { a: number; b: number }; evidence: string } }>(
      "GET",
      `${A}/characters/${enc(id)}/compare?a=${enc(a)}&b=${enc(b)}`,
    ),
  exportCharacter: (id: string, version: string) => call<{ forgeJobId: string; reused: boolean } & CharacterHistory>("POST", `${A}/characters/${enc(id)}/export`, { version }),
  characterGlbUrl: (id: string, version: string) => `${A}/characters/${enc(id)}/versions/${enc(version)}/glb`,

  /* Forge (ASRE intake + the Forge's own routes) */
  forgeAssets: () => call<{ assets: ForgeAsset[] }>("GET", `${A}/forge`),
  forgeHistory: (jobId: string) => call<{ history: ForgeAsset[] }>("GET", `${A}/forge/${enc(jobId)}/history`),
  forgeEdit: (jobId: string, edit: Record<string, unknown>) => call<{ job: ForgeAsset }>("POST", `${A}/forge/${enc(jobId)}/edit`, { edit }),
  forgeImport: (name: string, glbBase64: string) => call<{ job: ForgeAsset }>("POST", `${A}/forge/import`, { name, glbBase64 }),
  /** The Forge's own Blender export gate (refuses anything that did not pass inspection). */
  forgeExport: (jobId: string, formats: string[]) => call<{ job: ForgeAsset; reused: boolean }>("POST", `/api/forge/jobs/${enc(jobId)}/export`, { formats, render: null }),
  forgePlace: (jobId: string, label: string) => call<{ placement: { id: string } }>("POST", `/api/forge/placements`, { jobId, label }),
  forgeAssetUrl: (file: string) => `/api/forge/assets/${file.split("/").map(enc).join("/")}`,
  assetUrl: (rel: string) => `${A}/assets/${rel.split("/").map(enc).join("/")}`,
};

export default AsreClient;
