/**
 * ==========================================================
 * LÉLU — WHAT A WORKSPACE COPY CHANGED, AGAINST WHAT IT WAS COPIED FROM
 *
 * A copy's changes are copy vs BASELINE (the project as it was when the
 * copy was made, recorded then as a hash per file), not copy vs the real
 * project as it is now. Measured in self-improvement runs 27–28: the real
 * project gained evidence files and fixes after her copy was made, and the
 * old copy-vs-now diff listed them as files SHE had deleted or modified —
 * binary JPEGs inlined into her context, and an apply that would have
 * deleted them and reverted the fixes.
 *
 *   in the copy, not in the baseline          → added
 *   in both, copy differs from the baseline   → modified
 *   in the baseline, gone from the copy       → deleted
 *   anything only the real project changed    → not hers: not listed
 *   hers, and the real file also changed      → realChangedSince (apply refuses it)
 *
 * Pure: the adapters hash files and read them.
 * ==========================================================
 */

/** Written into the copy's root when it is made; never copied or listed. */
export const BASELINE_FILE = ".lelu-baseline.json";

export type FileHashes = ReadonlyMap<string, string>;

export interface ClassifiedChange {
  path: string;
  status: "added" | "modified" | "deleted";
  /** The real project's file is no longer what the copy started from. */
  realChangedSince: boolean;
}

/**
 * Her changes. Without a baseline (copies made before baselines existed)
 * this falls back to copy vs the real project now, and says so.
 */
export function classifyChanges(copy: FileHashes, baseline: FileHashes | null, real: FileHashes): ClassifiedChange[] {
  const out: ClassifiedChange[] = [];
  if (!baseline) {
    for (const [file, hash] of copy) {
      if (!real.has(file)) out.push({ path: file, status: "added", realChangedSince: false });
      else if (real.get(file) !== hash) out.push({ path: file, status: "modified", realChangedSince: false });
    }
    for (const file of real.keys()) if (!copy.has(file)) out.push({ path: file, status: "deleted", realChangedSince: false });
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
  for (const [file, hash] of copy) {
    const base = baseline.get(file);
    if (base === hash) continue; // untouched by her, whatever happened to the real file
    if (base === undefined) {
      // New in the copy. If the real project has since gained the identical file, nothing to do.
      if (real.get(file) === hash) continue;
      out.push({ path: file, status: "added", realChangedSince: real.has(file) });
    } else {
      out.push({ path: file, status: "modified", realChangedSince: real.get(file) !== base });
    }
  }
  for (const [file, base] of baseline) {
    if (copy.has(file)) continue;
    if (!real.has(file)) continue; // gone from both: nothing to delete
    out.push({ path: file, status: "deleted", realChangedSince: real.get(file) !== base });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** A file with a NUL byte in its first 8 KB is binary: never inlined as text. */
export function isBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 8192);
  for (let i = 0; i < end; i += 1) if (bytes[i] === 0) return true;
  return false;
}

export function serializeBaseline(hashes: FileHashes, createdAt: number): string {
  return JSON.stringify({ createdAt, files: Object.fromEntries([...hashes].sort(([a], [b]) => a.localeCompare(b))) });
}

export function parseBaseline(text: string): Map<string, string> | null {
  try {
    const parsed = JSON.parse(text) as { files?: Record<string, unknown> };
    if (!parsed.files || typeof parsed.files !== "object") return null;
    return new Map(Object.entries(parsed.files).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return null;
  }
}
