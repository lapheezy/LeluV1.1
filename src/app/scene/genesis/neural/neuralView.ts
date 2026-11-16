/**
 * ==========================================================
 * LÉLU — NEURAL MAP VIEW STATE (M17.2)
 *
 * Presentation only: which entity the embedded inspector shows, and
 * whether the standalone Neural Map is open and on what. This is
 * deliberately NOT canonical state — closing a view, or reloading, loses
 * nothing real; the entities live in their authorities and the map
 * re-derives them. (Brief: "Interface-specific layouts and presentation
 * state do not become canonical graph state.")
 *
 * The React hooks live in useNeural.ts; this file has no React so the
 * launcher and tools can call it.
 * ==========================================================
 */

export interface NeuralViewState {
  /** The embedded inspector's entity (in Cosmos or any host interface). */
  inspecting: string | null;
  /** The standalone Neural Map: open, and focused on which entity. */
  standalone: { open: boolean; focus: string | null; history: string[]; layer?: "base" | "over"; from?: string };
  revision: number;
}

type Listener = (s: NeuralViewState) => void;

let state: NeuralViewState = { inspecting: null, standalone: { open: false, focus: null, history: [] }, revision: 0 };
const listeners = new Set<Listener>();

function commit(patch: Partial<NeuralViewState>): void {
  state = { ...state, ...patch, revision: state.revision + 1 };
  for (const l of listeners) l(state);
}

export const NeuralView = {
  get: (): NeuralViewState => state,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  inspect(id: string | null): void {
    if (state.inspecting !== id) commit({ inspecting: id });
  },
  /**
   * `over`: opened from an interface that sits above the Cosmos (Chat
   * Universe, a window, the System UI): the map opens over it, and
   * Return lands back in that same interface. `from` names the host.
   */
  openStandalone(focus?: string | null, opts: { over?: boolean; from?: string } = {}): void {
    const f = focus ?? state.standalone.focus ?? state.inspecting;
    commit({
      standalone: {
        open: true,
        focus: f,
        history: f && state.standalone.focus !== f ? [...state.standalone.history, ...(state.standalone.focus ? [state.standalone.focus] : [])].slice(-30) : state.standalone.history,
        layer: opts.over ? "over" : "base",
        ...(opts.from ? { from: opts.from } : {}),
      },
    });
  },
  focus(id: string): void {
    const s = state.standalone;
    if (s.focus === id) return;
    commit({ standalone: { ...s, focus: id, history: s.focus ? [...s.history, s.focus].slice(-30) : s.history } });
  },
  back(): void {
    const s = state.standalone;
    const prev = s.history.at(-1);
    if (prev) commit({ standalone: { ...s, focus: prev, history: s.history.slice(0, -1) } });
  },
  closeStandalone(): void {
    if (state.standalone.open) commit({ standalone: { ...state.standalone, open: false } });
  },
  resetForTests(): void {
    state = { inspecting: null, standalone: { open: false, focus: null, history: [] }, revision: 0 };
  },
};
