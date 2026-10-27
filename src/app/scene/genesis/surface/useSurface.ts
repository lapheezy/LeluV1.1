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
  const openModuleCount = Object.values(state.modules).filter((module) => module.presentation !== "closed").length;
  const compact = chatFillsScreen(workspace);
  return useMemo(
    () => resolveSurface({ activePanel: state.activePanel, minimized: state.minimized, openModuleCount, compact }),
    [state.activePanel, state.minimized, openModuleCount, compact],
  );
}
