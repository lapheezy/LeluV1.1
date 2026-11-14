/**
 * LÉLU — the ONE way the workspace gets re-organised on purpose.
 *
 * Called by the workspace bar (a person's tap), by UIActionBus
 * `arrange_workspace` (LÉLU's `workspace.arrange` tool and her local intent
 * recogniser) — so a button and LÉLU produce exactly the same change.
 * Deterministic; never calls a model.
 */

import ModuleLayoutStore from "./ModuleLayoutStore";
import WorkspaceStewardStore from "../../../../core/interface/WorkspaceStewardStore";
import { STAGE_MODES, STEWARD_MODES, type StageMode, type StewardMode } from "../../../../core/interface/WorkspaceSteward";
import type { UIActionResult } from "../../../../core/cognition/UIActionBus";
import type { ModuleState } from "../GenesisCore";

export interface StewardHost {
  modules(): Record<string, ModuleState>;
  openModule(id: string): void;
  setModulePresentation(id: string, presentation: "inline" | "expanded" | "minimized"): void;
  raiseModule(id: string): void;
  activeConversationId(): string | null;
}

const open = (m: ModuleState) => m.presentation === "inline" || m.presentation === "expanded";

export function arrangeWorkspace(host: StewardHost, rawMode: string, modules: string[], by: "lelu" | "user"): UIActionResult {
  const mode = (STEWARD_MODES as string[]).includes(rawMode) ? (rawMode as StewardMode) : null;
  if (!mode) return { ok: false, detail: `Unknown layout "${rawMode}". Layouts: ${STEWARD_MODES.join(", ")}.` };

  // Open/raise the named modules, last named first so the first ends on top.
  for (const id of [...modules].reverse()) {
    const m = host.modules()[id];
    if (!m || !open(m)) host.openModule(id);
    host.setModulePresentation(id, "inline");
    host.raiseModule(id);
  }
  // An explicit layout overrides hand placements and maximised windows;
  // pins are the person's and stay.
  const store = ModuleLayoutStore.getInstance();
  for (const [id, m] of Object.entries(host.modules())) {
    if (!open(m)) continue;
    if (store.isManual(id) && !store.getState().entries.find((e) => e.moduleId === id)?.pinned) store.release(id);
    if (m.presentation === "expanded" && mode !== "fullscreen") host.setModulePresentation(id, "inline");
  }
  const focus = modules[0] ?? null;
  WorkspaceStewardStore.setMode(mode, focus);
  const count = Object.values(host.modules()).filter(open).length + modules.filter((id) => !host.modules()[id]).length;
  const detail = `Workspace arranged as "${mode}"${focus ? ` with ${focus} in focus` : ""} — ${count} window(s). Done locally, no model call.`;
  WorkspaceStewardStore.record({ by, what: `layout → ${mode}${focus ? ` (${focus})` : ""}`, reasons: [detail] });
  return { ok: true, detail };
}

export function setStage(host: StewardHost, rawStage: string, conversationId: string | undefined, by: "lelu" | "user"): UIActionResult {
  const stage = (STAGE_MODES as string[]).includes(rawStage) ? (rawStage as StageMode) : null;
  if (!stage) return { ok: false, detail: `Unknown stage "${rawStage}". Stages: ${STAGE_MODES.join(", ")}.` };
  const id = conversationId ?? host.activeConversationId();
  if (!id) return { ok: false, detail: "There is no conversation to stage." };
  // The conversation must be on screen to be staged: open its window.
  const moduleId = `chat:${id}`;
  const m = host.modules()[moduleId];
  if (!m || !open(m)) host.openModule(moduleId);
  host.raiseModule(moduleId);
  WorkspaceStewardStore.setStage(id, stage);
  // Presentations and 3D want the room.
  if (stage === "present" || stage === "spatial" || stage === "cinematic") WorkspaceStewardStore.setMode("fullscreen", moduleId);
  else if (WorkspaceStewardStore.get().mode === "fullscreen" && WorkspaceStewardStore.get().focusId === moduleId) WorkspaceStewardStore.setMode("auto", moduleId);
  const detail = `Conversation staged as "${stage}". Done locally, no model call.`;
  WorkspaceStewardStore.record({ by, what: `stage → ${stage}`, reasons: [detail] });
  return { ok: true, detail };
}
