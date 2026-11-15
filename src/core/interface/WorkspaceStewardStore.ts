/**
 * LÉLU — the Workspace Steward's state (one tiny store).
 *
 *   mode        how the windows share the screen (WorkspaceSteward)
 *   focusId     which window a focus/split centres on
 *   stages      per conversation: how the conversation itself is staged
 *               (conversation, cinematic, board, gallery, present, spatial)
 *   needs       measured content widths (a panel wider than its window)
 *   log         the last decisions, with reasons and `modelCalls: 0` —
 *               the visible proof that organising cost nothing
 *
 * Written by the steward bridge (automatic), by the person (buttons) and by
 * LÉLU through UIActionBus → `workspace.arrange` / `workspace.stage`. Read by
 * GenesisModuleHost and the Chat Universe. Persisted through KvStore.
 */

import KvStore from "../storage/KvStore";
import { STAGE_MODES, STEWARD_MODES, type StageMode, type StewardMode } from "./WorkspaceSteward";

export interface StewardDecision {
  at: number;
  by: "lelu" | "user" | "auto";
  what: string;
  reasons: string[];
  /** Always 0: organising runs locally. Kept so the UI can show it. */
  modelCalls: 0;
}

export interface WorkspaceStewardState {
  mode: StewardMode;
  focusId: string | null;
  stages: Record<string, StageMode>;
  needs: Record<string, number>;
  log: StewardDecision[];
}

const KEY = "lelu.workspace.steward.v1";
type Listener = () => void;

function load(): WorkspaceStewardState {
  const saved = (() => {
    try {
      return KvStore.getInstance().get<Partial<WorkspaceStewardState>>(KEY) ?? null;
    } catch {
      return null;
    }
  })();
  const mode = saved?.mode && STEWARD_MODES.includes(saved.mode) ? saved.mode : "auto";
  const stages = Object.fromEntries(
    Object.entries(saved?.stages ?? {}).filter(([, s]) => STAGE_MODES.includes(s as StageMode)),
  ) as Record<string, StageMode>;
  return { mode, focusId: saved?.focusId ?? null, stages, needs: {}, log: [] };
}

let state: WorkspaceStewardState | null = null;
const listeners = new Set<Listener>();

function current(): WorkspaceStewardState {
  if (!state) state = load();
  return state;
}

function commit(next: WorkspaceStewardState): void {
  state = next;
  try {
    KvStore.getInstance().set(KEY, { mode: next.mode, focusId: next.focusId, stages: next.stages });
  } catch {
    /* persistence is best-effort; the live state still changed */
  }
  for (const l of listeners) l();
}

const WorkspaceStewardStore = {
  get: current,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setMode(mode: StewardMode, focusId?: string | null): void {
    const s = current();
    commit({ ...s, mode, focusId: focusId === undefined ? s.focusId : focusId });
  },
  setFocus(focusId: string | null): void {
    commit({ ...current(), focusId });
  },
  stageOf(conversationId: string): StageMode {
    return current().stages[conversationId] ?? "conversation";
  },
  setStage(conversationId: string, stage: StageMode): void {
    const s = current();
    if (s.stages[conversationId] === stage) return;
    commit({ ...s, stages: { ...s.stages, [conversationId]: stage } });
  },
  /** Content measured wider than its window. Only grows, rounded, to avoid feedback loops. */
  reportNeed(moduleId: string, width: number): void {
    const s = current();
    const w = Math.round(width / 20) * 20;
    if ((s.needs[moduleId] ?? 0) >= w) return;
    state = { ...s, needs: { ...s.needs, [moduleId]: w } };
    for (const l of listeners) l();
  },
  record(decision: Omit<StewardDecision, "at" | "modelCalls">): void {
    const s = current();
    const last = s.log[s.log.length - 1];
    if (last && last.what === decision.what && last.by === decision.by && Date.now() - last.at < 1500) return;
    state = { ...s, log: [...s.log.slice(-19), { ...decision, at: Date.now(), modelCalls: 0 }] };
    for (const l of listeners) l();
  },
  /** Test hook. */
  reset(): void {
    state = { mode: "auto", focusId: null, stages: {}, needs: {}, log: [] };
    for (const l of listeners) l();
  },
};

export default WorkspaceStewardStore;
