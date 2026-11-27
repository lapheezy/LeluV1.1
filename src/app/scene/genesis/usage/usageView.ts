/**
 * Whether the Usage & Conversations monitor (WP19) is open, and on which
 * conversation. Presentation only; no React, so tools and links can call it.
 */
type Listener = (s: UsageViewState) => void;
export interface UsageViewState {
  open: boolean;
  focus: string | null;
  revision: number;
}
let state: UsageViewState = { open: false, focus: null, revision: 0 };
const listeners = new Set<Listener>();
const commit = (p: Partial<UsageViewState>) => {
  state = { ...state, ...p, revision: state.revision + 1 };
  for (const l of listeners) l(state);
};
export const UsageView = {
  get: () => state,
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  open(focus: string | null = null) {
    commit({ open: true, focus });
  },
  focus(id: string | null) {
    commit({ focus: id });
  },
  close() {
    commit({ open: false });
  },
};
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("monitor") === "usage") state = { open: true, focus: null, revision: 1 };
