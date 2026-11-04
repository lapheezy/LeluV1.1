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
 * orb). Both persist across reloads.
 * ==========================================================
 */

import KvStore from "../../../../core/storage/KvStore";
import type { GenesisPanel, ModuleState } from "../GenesisCore";

export interface SavedLayout {
  activePanel: GenesisPanel;
  modules: Record<string, ModuleState>;
  savedAt: number;
}

export interface HomeState {
  layout: SavedLayout | null;
  immersive: boolean;
}

const KEY = "lelu.home.v1";
type Listener = (state: HomeState) => void;

class HomeStoreImpl {
  private state: HomeState;
  private readonly listeners = new Set<Listener>();

  constructor() {
    const saved = typeof window !== "undefined" ? KvStore.getInstance().get<HomeState>(KEY) : null;
    this.state = { layout: saved?.layout ?? null, immersive: false };
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
    const open = Object.fromEntries(Object.entries(modules).filter(([id, m]) => id !== "chat" && m.presentation !== "closed"));
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

  private patch(next: Partial<HomeState>): void {
    this.state = { ...this.state, ...next };
    try {
      KvStore.getInstance().set(KEY, { layout: this.state.layout, immersive: false });
    } catch {
      // storage unavailable: the layout lives for this session only
    }
    for (const listener of this.listeners) listener(this.state);
  }
}

const HomeStore = new HomeStoreImpl();
export default HomeStore;
