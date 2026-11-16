/**
 * ==========================================================
 * LÉLUVERSE — SPATIAL DOCK: INFORMATION ARCHITECTURE
 *
 * The old rail was a flat row of twelve equally-weighted chips. It
 * answered "where can I go", never "what is running, and what belongs
 * together". This is the model behind the replacement: five groups,
 * each holding destinations that already exist.
 *
 * Two rules, both enforced in code rather than by convention:
 *
 *   1. A group may only contain a destination the scene graph really
 *      has (SPATIAL_DESTINATIONS). Nothing can be advertised that the
 *      app cannot open.
 *   2. The label, hint and accent of an entry come from the scene
 *      graph itself, so the dock can never drift from the surfaces it
 *      launches.
 *
 * Pure data and pure functions: no React, no DOM, no runtime import.
 * ==========================================================
 */

import { SPATIAL_DESTINATIONS, destinationFor, type SpatialSceneId } from "./SpatialScenes";

export type DockGroupId = "environment" | "intelligence" | "creation" | "resources" | "communication";

export interface DockEntry {
  scene: SpatialSceneId;
  label: string;
  hint: string;
  glyph: string;
  /** The canonical GenesisPanel this destination opens, if any. */
  panel: string | null;
  /** Contextual accent, taken from the destination. */
  accent: string;
}

export interface DockGroup {
  id: DockGroupId;
  label: string;
  glyph: string;
  /** The group's own accent: the accent of its first destination. */
  accent: string;
  entries: DockEntry[];
}

/** One glyph per destination — the dock's only icon vocabulary. */
export const DOCK_GLYPHS: Record<SpatialSceneId, string> = {
  core: "◎",
  cosmos: "✦",
  galaxy: "✺",
  planet: "◉",
  portal: "◈",
  agents: "⬡",
  browser: "◫",
  studio: "◍",
  research: "⌁",
  projects: "▤",
  files: "▥",
  media: "▶",
  conversation: "✉",
};

/**
 * The groups, in the order a person moves through them. This list is
 * about *meaning*, not about pixels: Environment is where you are,
 * Intelligence is who is thinking, Creation is what you make, Resources
 * is what you keep, Communication is who you talk to.
 */
const ARCHITECTURE: Array<{ id: DockGroupId; label: string; glyph: string; scenes: SpatialSceneId[] }> = [
  { id: "environment", label: "Environment", glyph: "✦", scenes: ["cosmos", "galaxy", "planet", "portal", "browser"] },
  { id: "intelligence", label: "Intelligence", glyph: "◬", scenes: ["agents", "research"] },
  { id: "creation", label: "Creation", glyph: "◍", scenes: ["studio", "media"] },
  { id: "resources", label: "Resources", glyph: "▤", scenes: ["projects", "files"] },
  { id: "communication", label: "Communication", glyph: "✉", scenes: ["conversation"] },
];

const exists = (scene: SpatialSceneId): boolean =>
  SPATIAL_DESTINATIONS.some((destination) => destination.id === scene);

function entryFor(scene: SpatialSceneId): DockEntry | null {
  if (!exists(scene)) return null;
  const destination = destinationFor(scene);
  return {
    scene,
    label: destination.label,
    hint: destination.hint,
    glyph: DOCK_GLYPHS[scene] ?? "◇",
    panel: (destination.panel as string | null) ?? null,
    accent: destination.accent,
  };
}

/**
 * The groups the dock may show. Empty groups are dropped rather than
 * rendered as a heading with nothing under it.
 */
export function dockGroups(): DockGroup[] {
  return ARCHITECTURE.map((group) => {
    const entries = group.scenes
      .map(entryFor)
      .filter((entry): entry is DockEntry => entry !== null);
    return {
      id: group.id,
      label: group.label,
      glyph: group.glyph,
      accent: entries[0]?.accent ?? "#94a3b8",
      entries,
    };
  }).filter((group) => group.entries.length > 0);
}

/** Every destination appears in exactly one group — or in none, if ungrouped. */
export function ungroupedScenes(): SpatialSceneId[] {
  const grouped = new Set(dockGroups().flatMap((group) => group.entries.map((entry) => entry.scene)));
  return SPATIAL_DESTINATIONS.map((destination) => destination.id).filter(
    (scene) => scene !== "core" && !grouped.has(scene),
  );
}

export function groupFor(scene: SpatialSceneId | null): DockGroupId | null {
  if (!scene) return null;
  const group = dockGroups().find((candidate) => candidate.entries.some((entry) => entry.scene === scene));
  return group?.id ?? null;
}

export function dockEntryFor(scene: SpatialSceneId): DockEntry | null {
  return dockGroups()
    .flatMap((group) => group.entries)
    .find((entry) => entry.scene === scene) ?? null;
}

/**
 * The active group first, then the rest in their natural order. A person
 * standing in the studio should not have to hunt for the Creation group.
 */
export function orderedGroups(activeScene: SpatialSceneId | null): DockGroup[] {
  const groups = dockGroups();
  const active = groupFor(activeScene);
  if (!active) return groups;
  return [...groups].sort((a, b) => (a.id === active ? -1 : b.id === active ? 1 : 0));
}
