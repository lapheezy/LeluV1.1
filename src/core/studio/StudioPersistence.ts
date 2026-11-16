/**
 * ==========================================================
 * LÉLU — SESSION 3C: STUDIO PERSISTENCE
 *
 * The disk is the authority for which studio projects exist. The browser
 * library is only a cache of measured history (versions, builds, tests), so
 * a project created in another browser or an earlier session must still be
 * discoverable here.
 *
 * This module owns that one question: "what really exists on disk right
 * now?" It returns the runtime's own answer, or `null` when the runtime
 * cannot be reached — never an invented list. Callers distinguish the two:
 * `null` means "unknown, keep what we have", `[]` means "the disk is empty".
 * ==========================================================
 */

import StudioRuntime from "./StudioRuntime";

/** A project directory the studio runtime found on disk, nothing more. */
export interface PersistedStudioProject {
  slug: string;
  files: number;
  bytes?: number;
  updatedAt: number;
  built: boolean;
}

/**
 * Turn a directory slug into the name a person reads: `focus-ledger` becomes
 * `Focus Ledger`. The library already stored whatever name the user gave a
 * project it created; this is only for projects discovered on disk, where the
 * slug is the sole surviving evidence of the name.
 */
export function persistedDisplayName(slug: string): string {
  const words = String(slug ?? "")
    .split(/[-_.\s]+/)
    .filter(Boolean);
  if (words.length === 0) return String(slug ?? "");
  return words
    .map((word) =>
      word.length <= 2 && word === word.toUpperCase()
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

/**
 * Ask the runtime which projects exist on disk. Never throws: an unreachable
 * runtime is reported as `null` so a caller can keep its recorded history
 * instead of wiping it because a request failed.
 */
export async function fetchPersistedStudioProjects(): Promise<PersistedStudioProject[] | null> {
  try {
    const projects = await StudioRuntime.getInstance().projects();
    if (!Array.isArray(projects)) return null;
    return projects
      .filter((project) => project && typeof project.slug === "string" && project.slug.length > 0)
      .map((project) => ({
        slug: project.slug,
        files: Number.isFinite(project.files) ? project.files : 0,
        bytes: Number.isFinite(project.bytes) ? project.bytes : 0,
        updatedAt: Number.isFinite(project.updatedAt) ? project.updatedAt : Date.now(),
        built: project.built === true,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return null;
  }
}
