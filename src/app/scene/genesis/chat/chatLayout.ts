/**
 * LÉLU — when the chat is the whole screen.
 *
 * Narrow workspaces (phones in portrait) and short ones (phones in
 * landscape: 844×390 is wide, but there is no room for a floating
 * window under the tab bar) both get the full-screen sky. GenesisChat,
 * the tab bar and surface/Surface all read this, so they always agree.
 *
 * There used to be a `useDockInset()` here that measured a left dock
 * rail every two seconds and pushed the full-screen chat over by its
 * width — a landscape phone is 844px wide, which the dock read as a
 * tablet and drew a rail for. While the chat owns the screen the dock
 * now takes its phone shape (no rail), so the inset is always 0 and the
 * measurement is gone with it.
 */
import type { WorkspaceMetrics } from "../../../../core/ui/Workspace";

export function chatFillsScreen(workspace: Pick<WorkspaceMetrics, "width" | "height">): boolean {
  return workspace.width <= 720 || workspace.height <= 520;
}
