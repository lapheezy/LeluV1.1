/**
 * ==========================================================
 * LÉLU HOME — LAYOUT MEMORY AND IMMERSION
 *
 * Going home closes the open windows (GenesisCore.openPanel("none")
 * clears the module set), so the layout is remembered first: which
 * windows were open, how each was presented, where it stood and how big
 * it was, and which panel had focus. The home shows those windows as
 * resumable workspaces, and "restore" puts the whole layout back. The
 * tools' runtimes are singletons, so a closed window loses no state.
 *
 * "Immersive" hides the home to look at the Cosmos itself (the central
 * orb). It does not persist across reloads.
 *
 * Phase 1 adds the Cosmos MODE — how the Chat Universe stands in relation
 * to the live scene — and the chat windows the Universe keeps open:
 *
 *   workspace  the Universe is an opaque room; the scene is paused behind
 *              it (frameloop "never"), so a covered scene costs no GPU
 *   floating   the windows float over the LIVE Cosmos: the scene keeps
 *              rendering and only the cards/windows are solid
 *
 * This store is the single owner of that mode (the Universe header and the
 * Worlds sheet both write here) and of the open chat-window set, whose
 * geometry is saved NORMALISED to the viewport so a reload on a different
 * screen keeps the arrangement.
 * ==========================================================
 */

import KvStore from "../../../../core/storage/KvStore";
import type { GenesisPanel, ModuleState } from "../GenesisCore";

export interface SavedLayout {
  activePanel: GenesisPanel;
  modules: Record<string, ModuleState>;
  savedAt: number;
}

/** How the Chat Universe relates to the live Cosmos. */
export type CosmosMode = "workspace" | "floating";

/** Window geometry in 0..1 of the viewport. */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UniverseState {
  /** Conversation ids the Universe presents as chat module windows. */
  open: string[];
  geometry: Record<string, NormalizedRect>;
}

export interface HomeState {
  layout: SavedLayout | null;
  immersive: boolean;
  cosmosMode: CosmosMode;
  universe: UniverseState;
}

/** Chat conversations open as module windows are owned by `universe`, not
    by the resumable app layout, so "go home" never shows `chat:<id>`. */
const CHAT_MODULE_PREFIX = "chat:";

const KEY = "lelu.home.v1";
type Listener = (state: HomeState) => void;

class HomeStoreImpl {
  private state: HomeState;
  private readonly listeners = new Set<Listener>();

  constructor() {
    const saved = typeof window !== "undefined" ? KvStore.getInstance().get<Partial<HomeState>>(KEY) : null;
    this.state = {
      layout: saved?.layout ?? null,
      immersive: false,
      cosmosMode: saved?.cosmosMode === "floating" ? "floating" : "workspace",
      universe: {
        open: Array.isArray(saved?.universe?.open) ? saved!.universe!.open.filter((id) => typeof id === "string") : [],
        geometry: saved?.universe?.geometry ?? {},
      },
    };
  }

  get(): HomeState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Remember the windows before going home (nothing to remember → keep the last layout). */
  rememberLayout(activePanel: GenesisPanel, modules: Record<string, ModuleState>): void {
    const open = Object.fromEntries(
      Object.entries(modules).filter(
        ([id, m]) => id !== "chat" && !id.startsWith(CHAT_MODULE_PREFIX) && m.presentation !== "closed",
      ),
    );
    if (Object.keys(open).length === 0 && activePanel !== "chat") return;
    this.patch({ layout: { activePanel, modules: open, savedAt: Date.now() } });
  }

  forgetWindow(id: string): void {
    const layout = this.state.layout;
    if (!layout || !layout.modules[id]) return;
    const { [id]: _gone, ...rest } = layout.modules;
    this.patch({ layout: Object.keys(rest).length || layout.activePanel === "chat" ? { ...layout, modules: rest } : null });
  }

  clearLayout(): void {
    this.patch({ layout: null });
  }

  setImmersive(immersive: boolean): void {
    this.patch({ immersive });
  }

  /** The single owner of the Cosmos mode. Persisted. */
  setCosmosMode(mode: CosmosMode): void {
    if (mode === this.state.cosmosMode) return;
    this.patch({ cosmosMode: mode });
  }

  toggleCosmosMode(): void {
    this.setCosmosMode(this.state.cosmosMode === "floating" ? "workspace" : "floating");
  }

  /** The chats the Universe keeps as module windows (survives a closed Universe). */
  rememberUniverseOpen(open: string[]): void {
    const current = this.state.universe.open;
    if (open.length === current.length && open.every((id, index) => id === current[index])) return;
    const geometry = Object.fromEntries(Object.entries(this.state.universe.geometry).filter(([id]) => open.includes(id)));
    this.patch({ universe: { open, geometry } });
  }

  rememberUniverseGeometry(conversationId: string, rect: NormalizedRect): void {
    const current = this.state.universe.geometry[conversationId];
    if (
      current &&
      Math.abs(current.x - rect.x) < 0.002 &&
      Math.abs(current.y - rect.y) < 0.002 &&
      Math.abs(current.width - rect.width) < 0.002 &&
      Math.abs(current.height - rect.height) < 0.002
    ) {
      return;
    }
    this.patch({
      universe: {
        ...this.state.universe,
        geometry: { ...this.state.universe.geometry, [conversationId]: rect },
      },
    });
  }

  private patch(next: Partial<HomeState>): void {
    this.state = { ...this.state, ...next };
    try {
      KvStore.getInstance().set(KEY, {
        layout: this.state.layout,
        immersive: false,
        cosmosMode: this.state.cosmosMode,
        universe: this.state.universe,
      });
    } catch {
      // storage unavailable: the layout lives for this session only
    }
    for (const listener of this.listeners) listener(this.state);
  }
}

const HomeStore = new HomeStoreImpl();
export default HomeStore;
