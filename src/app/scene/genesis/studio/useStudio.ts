/** LÉLU — Creation Studio React bindings: the live store, downloads, opening windows. */

import { useCallback, useSyncExternalStore } from "react";
import StudioStore, { type StudioArtifact } from "../../../../core/studio/StudioStore";
import { STUDIO_OPEN_EVENT } from "../../../../core/studio/StudioTools";
import { MIME, type ExportFormat } from "../../../../core/studio/StudioTypes";

export const ARTIFACT_WINDOW_PREFIX = "artifact:";
export const artifactWindowId = (id: string) => `${ARTIFACT_WINDOW_PREFIX}${id}`;
export const artifactIdOf = (moduleId: string) => (moduleId.startsWith(ARTIFACT_WINDOW_PREFIX) ? moduleId.slice(ARTIFACT_WINDOW_PREFIX.length) : null);

/** Re-render on every store write; returns the store. */
export function useStudioStore(): StudioStore {
  const store = StudioStore.getInstance();
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const snapshot = useCallback(() => store.getVersion(), [store]);
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return store;
}

export function useArtifact(id: string | null): StudioArtifact | undefined {
  const store = useStudioStore();
  return id ? store.get(id) : undefined;
}

/** Save bytes as a file the user downloads. */
export function downloadBytes(bytes: Uint8Array, filename: string, format?: ExportFormat): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: format ? MIME[format] : "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Open artifacts as Cosmos windows (the interface places two or more side by side). */
export function openArtifacts(ids: string[]): void {
  window.dispatchEvent(new CustomEvent(STUDIO_OPEN_EVENT, { detail: { ids, layout: ids.length > 1 ? "side-by-side" : "single" } }));
}

export const KIND_LABEL: Record<StudioArtifact["kind"], string> = { document: "Document", deck: "Presentation", workbook: "Spreadsheet", graph: "Graph", drawing: "Drawing" };

export function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
