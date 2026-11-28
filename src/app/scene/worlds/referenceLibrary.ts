/**
 * The local reference registry in the browser (dev server only: it serves the
 * Git-ignored reference/ folder; a production build has no such files, so the
 * library is empty there and says so). Also: a palette taken from a reference.
 */
import { referenceById, referencesFor, searchReferences, type ReferenceEntry, type ReferenceQuery, type Registry } from "../../../core/references/ReferenceRegistry";

let cache: Promise<Registry | null> | null = null;
export function loadReferences(): Promise<Registry | null> {
  cache ??= fetch("/reference/registry.json", { cache: "no-store" })
    .then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("json") ? (r.json() as Promise<Registry>) : null))
    .catch(() => null);
  return cache;
}
export const findReferences = async (q: ReferenceQuery) => searchReferences((await loadReferences()) ?? { entries: [] }, q);
export const getReference = async (id: string) => referenceById((await loadReferences()) ?? { entries: [] }, id);
export const referencesForTarget = async (t: string) => referencesFor((await loadReferences()) ?? { entries: [] }, t);

/** A palette from a reference's own pixels (inside its recorded crop). */
export async function paletteFromReference(e: ReferenceEntry) {
  const { paletteFromImage } = await import("./workspaceImages");
  return paletteFromImage(e.url, e.crop);
}
