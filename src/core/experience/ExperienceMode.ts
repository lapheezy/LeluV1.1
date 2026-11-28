/**
 * Unified Cosmos Chat (default) or the OG experience (WP21.4 §3).
 *
 * ONE flag, and only a presentation choice: both experiences read and write the same stores (conversations,
 * workspaces, worlds, Home presentations, preferences), so nothing is duplicated and changes made in one are
 * there in the other.
 * - unified: the Cosmos landing with the core chat box, the dial's radial, Chat Universe floating.
 * - og: the original landing (the dashboard Home), the original utility row beside the dial, the Chat
 *   Universe on its own backdrop.
 * `?experience=og` opens OG for this visit only, without changing the saved choice.
 */
export type Experience = "unified" | "og";
const KEY = "lelu.experience.v1";
const listeners = new Set<() => void>();

function initial(): { saved: Experience; visit: Experience | null } {
  let saved: Experience = "unified";
  let visit: Experience | null = null;
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "og") saved = "og";
    if (typeof location !== "undefined") {
      const q = new URLSearchParams(location.search).get("experience");
      if (q === "og" || q === "unified") visit = q;
    }
  } catch {
    /* default */
  }
  return { saved, visit };
}
let state = initial();

export function experience(): Experience {
  return state.visit ?? state.saved;
}
/** Switch, and remember it (the person chose it). */
export function setExperience(next: Experience): void {
  state = { saved: next, visit: null };
  try {
    localStorage?.setItem(KEY, next);
  } catch {
    /* memory only */
  }
  for (const fn of listeners) fn();
}
export function subscribeExperience(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Every original screen that opens on its own (from the inventory). None of them changes the saved mode. */
export interface OriginalScreen { id: string; label: string; description: string; open: { kind: "href"; href: string } | { kind: "app"; action: "dashboard" | "universe-original" | "room" } }
export const ORIGINAL_SCREENS: OriginalScreen[] = [
  { id: "og-core", label: "Original LÉLU · Core", description: "The original core: tap it, long-press to speak.", open: { kind: "href", href: "/og/core" } },
  { id: "og-inner-sky", label: "Original LÉLU · Inner Sky", description: "Home, Chats, Agents, Memory Garden, Files, Projects, Universes, Action queue, Settings.", open: { kind: "href", href: "/og/app" } },
  { id: "lelu-system", label: "LÉLU System UI", description: "Heartbeat, Matrix, Nerve, Neuron, Core.", open: { kind: "href", href: "/?interface=lelu-system" } },
  { id: "neural-map", label: "Neural Map (standalone)", description: "The full map on its own.", open: { kind: "href", href: "/?interface=neural-map" } },
  { id: "lelu-room", label: "LÉLU's Room", description: "Genesis V2.", open: { kind: "app", action: "room" } },
  { id: "dashboard", label: "Dashboard Home", description: "The original landing: weather, workspaces, notifications, Infinite Library.", open: { kind: "app", action: "dashboard" } },
  { id: "universe-original", label: "Chat Universe (original backdrop)", description: "The hub on its own backdrop, as it was.", open: { kind: "app", action: "universe-original" } },
];
