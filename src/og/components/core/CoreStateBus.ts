import { create } from "zustand";

export type CoreVisualState =
  | "listening"
  | "thinking"
  | "speaking"
  | "memory-write"
  | "memory-read"
  | "research"
  | "agent-active"
  | "notification"
  | "error";

type State = {
  active: Set<CoreVisualState>;
  pulses: { id: string; kind: CoreVisualState; at: number }[];
  push: (s: CoreVisualState) => void;
  clear: (s: CoreVisualState) => void;
  pulse: (s: CoreVisualState) => void;
};

export const useCoreStateStore = create<State>((set, get) => ({
  active: new Set(),
  pulses: [],
  push: (s) => {
    const next = new Set(get().active);
    next.add(s);
    set({ active: next });
  },
  clear: (s) => {
    const next = new Set(get().active);
    next.delete(s);
    set({ active: next });
  },
  pulse: (s) => {
    const id = `${s}-${Date.now()}-${Math.random()}`;
    set({ pulses: [...get().pulses, { id, kind: s, at: Date.now() }] });
    setTimeout(() => {
      set({ pulses: get().pulses.filter((p) => p.id !== id) });
    }, 1600);
  },
}));

export function useCoreState() {
  return useCoreStateStore();
}