import { create } from "zustand";
import { useCoreStateStore, type CoreVisualState } from "./CoreStateBus";

export type ProcKind =
  | "thinking"
  | "searching"
  | "writing_memory"
  | "reading_memory"
  | "organizing"
  | "agent"
  | "speaking"
  | "listening";

export type ProcTask = {
  id: string;
  kind: ProcKind;
  label: string;
  startedAt: number;
  progress?: number;
  meta?: Record<string, unknown>;
};

type State = {
  tasks: ProcTask[];
  history: ProcTask[];
  start: (t: Omit<ProcTask, "startedAt" | "id"> & { id?: string }) => string;
  end: (id: string) => void;
  update: (id: string, patch: Partial<ProcTask>) => void;
};

const KIND_TO_CORE: Record<ProcKind, CoreVisualState | null> = {
  thinking: "thinking",
  searching: "research",
  writing_memory: null,
  reading_memory: "memory-read",
  organizing: "thinking",
  agent: "agent-active",
  speaking: "speaking",
  listening: "listening",
};

export const useProcessing = create<State>((set, get) => ({
  tasks: [],
  history: [],
  start: (t) => {
    const id = t.id ?? `${t.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const task: ProcTask = { ...t, id, startedAt: Date.now() };
    set({ tasks: [...get().tasks, task] });
    const s = KIND_TO_CORE[t.kind];
    if (s) useCoreStateStore.getState().push(s);
    if (t.kind === "writing_memory") useCoreStateStore.getState().pulse("memory-write");
    return id;
  },
  end: (id) => {
    const t = get().tasks.find((x) => x.id === id);
    if (!t) return;
    set({
      tasks: get().tasks.filter((x) => x.id !== id),
      history: [t, ...get().history].slice(0, 200),
    });
    const s = KIND_TO_CORE[t.kind];
    if (s) {
      const stillActive = get().tasks.some((x) => KIND_TO_CORE[x.kind] === s);
      if (!stillActive) useCoreStateStore.getState().clear(s);
    }
  },
  update: (id, patch) =>
    set({ tasks: get().tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
}));