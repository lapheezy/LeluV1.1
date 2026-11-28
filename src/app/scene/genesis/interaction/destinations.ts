/**
 * ==========================================================
 * LÉLU — THE DESTINATION REGISTRY
 *
 * ONE list of the places the interface can go, and ONE place that says
 * how they are grouped.
 *
 * Before this, the same journeys were written down three times: the home
 * dashboard carried its own horizontal row (Chat · Browser · Studio ·
 * Workspace(s) · Agents · Files), the spatial bar carried an
 * “Environments” branch, and a second floating radial repeated that
 * branch with slightly different names. “Files” and “Workspace” were the
 * same panel under two labels, and “Work” looked like a destination
 * rather than the category it is.
 *
 * So the tree lives here: pure data, no React, no DOM. The dial in the
 * spatial bar renders THIS, and nothing else offers a second opinion
 * about where the interface can go.
 *
 * Rules (enforced by tests/destination-registry.test.ts):
 *   - one entry per destination; a destination never appears twice, by
 *     id, by label, or by the place it actually opens;
 *   - a group is only a group (`kind: "group"`) and is drawn as a
 *     labelled branch of the ring, never as a destination;
 *   - every entry names a panel the interface really renders, or the one
 *     navigation action it performs;
 *   - groups nest, so a space's own contents (a workspace's projects, a
 *     conversation) can be reached without a new navigation system.
 * ==========================================================
 */

import type { GenesisPanel } from "../GenesisCore";

export type DestinationTarget =
  /** LÉLU's own workspace (the dashboard) — the scene stays behind it. */
  | { kind: "home" }
  /** The immersive Cosmos. Opt-in: only a destination or a preference enters it. */
  | { kind: "immersive" }
  /** The Chat Universe. */
  | { kind: "chat" }
  /** A real panel, opened exactly as the palette opens it. */
  | { kind: "panel"; panel: GenesisPanel }
  /**
   * One conversation, in its own window (`chat:<id>` module), and one project
   * in the workspace. The ids are runtime data, so these targets are built by
   * the dial from the stores that own them, never declared here.
   */
  | { kind: "conversation"; conversationId: string }
  | { kind: "project"; projectId: string };

export interface Destination {
  kind: "destination";
  id: string;
  label: string;
  /** What it is, in one line, for the control's title. */
  hint: string;
  /** A HomeIcon name — the same icon vocabulary as the rest of the UI. */
  icon: string;
  target: DestinationTarget;
}

/**
 * A category. It is drawn as a branch, never as a place, and it may hold
 * other groups — that is how a space grows its own contents (Work →
 * Workspace → that workspace's projects) without a second navigation bar.
 */
export interface DestinationGroup {
  id: string;
  label: string;
  /** Why these belong together; also the ring's subtitle. */
  hint: string;
  icon: string;
  kind: "group";
  items: DialEntry[];
}

export type DialEntry = Destination | DestinationGroup;

const panel = (id: string, label: string, hint: string, icon: string, name: GenesisPanel): Destination => ({
  kind: "destination",
  id,
  label,
  hint,
  icon,
  target: { kind: "panel", panel: name },
});

const space = (id: string, label: string, hint: string, icon: string, target: DestinationTarget): Destination => ({
  kind: "destination",
  id,
  label,
  hint,
  icon,
  target,
});

/** Where you are: the four spaces of LÉLU and the live web. */
export const SPACES: Destination[] = [
  space("core", "LÉLU CORE", "Her workspace — the dashboard", "Sparkles", { kind: "home" }),
  space("cosmos", "Cosmos", "Look at the world itself", "Orbit", { kind: "immersive" }),
  panel("genesis", "Genesis Scene", "The Genesis v2 scene", "Layers", "genesisv2"),
  space("chat", "Chat Universe", "Every conversation", "MessagesSquare", { kind: "chat" }),
  panel("browser", "Browser", "The live web, read by LÉLU", "Compass", "browser"),
];

/**
 * Work is a CATEGORY, not a place: the spaces where something gets made.
 * `projects` is the Workspace — it has exactly one entry here, under one
 * name, and no second “Files” destination pointing at it.
 */
export const WORK: DestinationGroup = {
  id: "work",
  label: "Work",
  hint: "The spaces where you make things",
  icon: "LayoutGrid",
  kind: "group",
  items: [
    panel("workspace", "Workspace", "Projects, documents and their files", "Folder", "projects"),
    panel("creation", "Creation Studio", "Documents, decks, graphs and drawings", "PenLine", "creation"),
    panel("ui", "UI Universe", "Sketches, renders and the visual studio", "Box", "visualstudio"),
    panel("voice-studio", "Voice Studio", "Her voice, and yours", "AudioLines", "voice-studio"),
    panel("eng-studio", "Engineering Studio", "The engineering runtime", "Code2", "eng-studio"),
    panel("sketch", "Sketch", "Draw with LÉLU", "PenLine", "sketch"),
    panel("render", "Render", "Images and 3D", "Aperture", "render"),
    panel("video", "Video", "Motion and rendered work", "Film", "video"),
  ],
};

/**
 * Intelligence is a category too: who is thinking, and what she remembers.
 *
 * `galaxies` used to be a second ”Cosmos” — the same `immersive` target under
 * another name, which is the exact duplication this registry exists to end.
 * The executive galaxies ARE the Cosmos' own structure, and the Cosmos map
 * panel is the surface that shows them, so the entry opens that panel: one
 * destination, one place, no opt-in entry into the 3D world.
 */
export const INTELLIGENCE: DestinationGroup = {
  id: "intelligence",
  label: "Intelligence",
  hint: "Who is thinking, and what she remembers",
  icon: "Brain",
  kind: "group",
  items: [
    panel("agents", "Agent Universe", "Her agents at work", "Workflow", "agents"),
    panel("executive", "Executive Board", "What she has decided, and why", "Crown", "executive"),
    panel("galaxies", "Executive Galaxies", "The board's own worlds, on the Cosmos map", "Orbit", "cosmos"),
    panel("reasoning", "Reasoning", "Her current line of thought", "Lightbulb", "reasoning"),
    panel("memory", "Memory", "What she keeps", "Layers", "memory"),
  ],
};

/** The dial's root ring, in the order a person moves through it. */
export const DIAL: DialEntry[] = [...SPACES, WORK, INTELLIGENCE];

const isGroup = (entry: DialEntry): entry is DestinationGroup => entry.kind === "group";

/** Every destination the dial can reach, at any depth. */
export function allDestinations(entries: DialEntry[] = DIAL): Destination[] {
  return entries.flatMap((entry) => (isGroup(entry) ? allDestinations(entry.items) : [entry]));
}

/** One destination by id, across every level. */
export function destinationById(id: string): Destination | null {
  return allDestinations().find((destination) => destination.id === id) ?? null;
}

/** The group a destination lives in, if it is nested. */
export function groupOf(id: string): DestinationGroup | null {
  const search = (entries: DialEntry[]): DestinationGroup | null => {
    for (const entry of entries) {
      if (!isGroup(entry)) continue;
      if (entry.items.some((item) => item.id === id)) return entry;
      const deeper = search(entry.items);
      if (deeper) return deeper;
    }
    return null;
  };
  return search(DIAL);
}

/**
 * Where a destination sits, root first — the breadcrumb the ring shows and
 * the spatial context that survives zooming back out.
 */
export function destinationPath(id: string): DialEntry[] {
  const walk = (entries: DialEntry[], trail: DialEntry[]): DialEntry[] | null => {
    for (const entry of entries) {
      const next = [...trail, entry];
      if (!isGroup(entry)) {
        if (entry.id === id) return next;
        continue;
      }
      const deeper = walk(entry.items, next);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(DIAL, []) ?? [];
}
