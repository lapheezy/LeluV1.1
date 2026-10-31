/**
 * LÉLU — the current surface, from the shared Genesis state and the
 * measured workspace. See ./Surface for what the modes mean.
 */
import { useMemo } from "react";
import { useGenesis } from "../GenesisCore";
import { useWorkspace } from "../useWorkspace";
import { chatFillsScreen } from "../chat/chatLayout";
import { resolveSurface, type Surface } from "./Surface";

export function useSurface(): Surface {
  const { state } = useGenesis();
  const workspace = useWorkspace();
  // openPanel() records every panel in `modules`, chat included; the chat
  // is not a module window, and counting it made opening chat on a phone
  // read as "a workspace owns the screen" — which hid the chat.
  const modules = Object.entries(state.modules)
    .filter(([id]) => id !== "chat")
    .map(([, module]) => module);
  const openModuleCount = modules.filter((module) => module.presentation !== "closed").length;
  const visibleModuleCount = modules.filter((module) => module.presentation === "inline" || module.presentation === "expanded").length;
  const compact = chatFillsScreen(workspace);
  return useMemo(
    () => resolveSurface({ activePanel: state.activePanel, minimized: state.minimized, openModuleCount, visibleModuleCount, compact }),
    [state.activePanel, state.minimized, openModuleCount, visibleModuleCount, compact],
  );
}
