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
 * Rules:
 *   - one entry per destination; a destination never appears twice;
 *   - a group is only a group (`kind: "group"`) and is drawn as a
 *     labelled branch of the ring, never as a destination;
 *   - every entry names the real GenesisPanel it opens, or the one
 *     navigation action it performs.
 * ==========================================================
 */

import type { GenesisPanel } from "../GenesisCore";

export type DestinationTarget =
  /** LÉLU's own workspace (the dashboard) — the scene stays behind it. */
  | { kind: "home" }
  /** The immersive Cosmos. */
  | { kind: "immersive" }
  /** The Chat Universe. */
  | { kind: "chat" }
  /** A real panel, opened exactly as the palette opens it. */
  | { kind: "panel"; panel: GenesisPanel };

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

export interface DestinationGroup {
  id: string;
  label: string;
  /** Why these belong together; also the ring's subtitle. */
  hint: string;
  icon: string;
  kind: "group";
  items: Destination[];
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

/** Intelligence is a category too: who is thinking, and what she remembers. */
export const INTELLIGENCE: DestinationGroup = {
  id: "intelligence",
  label: "Intelligence",
  hint: "Who is thinking, and what she remembers",
  icon: "Brain",
  kind: "group",
  items: [
    panel("agents", "Agent Universe", "Her agents at work", "Workflow", "agents"),
    panel("executive", "Executive Board", "What she has decided, and why", "Crown", "executive"),
    /* The galaxies are the Cosmos' own structure, so this leans on the one
       Cosmos destination instead of being a second dashboard. */
    space("galaxies", "Executive Galaxies", "The board's own worlds, in the Cosmos", "Orbit", { kind: "immersive" }),
    panel("reasoning", "Reasoning", "Her current line of thought", "Lightbulb", "reasoning"),
    panel("memory", "Memory", "What she keeps", "Layers", "memory"),
  ],
};

/** The dial's root ring, in the order a person moves through it. */
export const DIAL: DialEntry[] = [...SPACES, WORK, INTELLIGENCE];

/** Every destination the dial can reach, groups flattened. */
export function allDestinations(): Destination[] {
  return DIAL.flatMap((entry) => (entry.kind === "group" ? entry.items : [entry]));
}

/** One destination by id, across every level. */
export function destinationById(id: string): Destination | null {
  return allDestinations().find((destination) => destination.id === id) ?? null;
}

/** The group a destination lives in, if it is nested. */
export function groupOf(id: string): DestinationGroup | null {
  const group = DIAL.find((entry): entry is DestinationGroup => entry.kind === "group" && entry.items.some((item) => item.id === id));
  return group ?? null;
}
