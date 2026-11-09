/**
 * ==========================================================
 * LÉLU — WHICH SURFACE OWNS THE SCREEN
 *
 * Chat and Cosmos are sibling surfaces over the same Core, not layers
 * of one scene. Before this, "chat on a phone" meant a full-screen
 * window painted over a live 3D world: the canvas, the sky backdrop,
 * the phase HUD and the overview all kept rendering underneath it.
 * Measured at 390×844 with chat open and idle: 2 frames a second,
 * ~8.6 s of native WebGL work per 8 s, and taps on the composer that
 * timed out — the page was too busy drawing a world nobody could see.
 *
 * So the mode is explicit, decided in one place, and the router and
 * the interface both read it:
 *
 *   HOME           Cosmos is the screen (nothing else open)
 *   CHAT           the conversation
 *   WORKSPACE      a panel or module window
 *   AGENT          the agents panel
 *   NOTIFICATIONS  the history / notification surface
 *
 * On a phone each mode is the whole screen. `chatOwnsScreen` is the
 * case that matters most: the Cosmos scene is not rendered at all —
 * not hidden, not behind — and comes back when the user goes Home.
 * ==========================================================
 */

export type SurfaceMode = "home" | "chat" | "workspace" | "agent" | "notifications";

export interface SurfaceInput {
  /** GenesisCore's activePanel. */
  activePanel: string;
  /** The whole interface is minimized to its chip. */
  minimized: boolean;
  /** Module windows currently open (not closed). */
  openModuleCount: number;
  /** Module windows actually on screen (inline or expanded — not minimized). */
  visibleModuleCount?: number;
  /** chatLayout.chatFillsScreen() for the measured workspace. */
  compact: boolean;
  /**
   * On a phone, the user has expanded the chat to the whole screen
   * (chat/chatExpand). Collapsed — the default — the chat floats above
   * the navigation and the Cosmos keeps rendering behind it, which is
   * the point of a layer: asking one question no longer costs you the
   * view you asked it from.
   */
  chatExpanded?: boolean;
  /**
   * The Chat Universe is open in its opaque "workspace" mode. On a phone
   * that is the conversation surface: Home, the spatial nav and the Cosmos
   * scene must leave the tree, not sit hidden under it. ("Floating" mode
   * keeps the live Cosmos behind its windows by design, and still does.)
   */
  universeOwnsScreen?: boolean;
  /**
   * The LÉLU System environment owns the viewport
   * (VisualEngine.interfaceFocus === "visual").
   *
   * On a phone this is the one case where the chat may not blank the
   * field. LÉLU presents a workspace HERE — surfaces composed or restored
   * by the environment engine paint inside this scene — and measured at
   * 390×844 an expanded chat made cosmosRendered false, so the scene was
   * unmounted and the workspace had zero [data-workspace-view] nodes. The
   * chat keeps its floating phone sheet above the live field instead.
   */
  systemEnvironmentActive?: boolean;
}

export interface Surface {
  mode: SurfaceMode;
  /** Phone-sized chat: the conversation is the only thing on screen. */
  chatOwnsScreen: boolean;
  /**
   * Phone-sized workspace: an open module window is the screen. The chat
   * stays mounted underneath (a running reply is not lost) and comes back
   * when the module is minimized or closed. Measured before this: the
   * full-screen chat (z 100) was shown whenever a module was open and
   * covered every module window (z 30+), so on a phone no workspace
   * could be seen or used.
   */
  workspaceOwnsScreen: boolean;
  /** Whether the Cosmos scene (canvas, sky, HUD, overview) is rendered. */
  cosmosRendered: boolean;
}

function modeFor(activePanel: string, openModuleCount: number): SurfaceMode {
  if (activePanel === "chat") return "chat";
  if (activePanel === "agents") return "agent";
  if (activePanel === "history" || activePanel === "logs") return "notifications";
  if (activePanel === "none") return openModuleCount > 0 ? "workspace" : "home";
  return "workspace";
}

export function resolveSurface(input: SurfaceInput): Surface {
  const mode = input.minimized ? "home" : modeFor(input.activePanel, input.openModuleCount);
  const workspaceOwnsScreen = input.compact && !input.minimized && (input.visibleModuleCount ?? 0) > 0;
  const chatOwnsScreen =
    !input.systemEnvironmentActive &&
    input.compact && !input.minimized && !workspaceOwnsScreen &&
    ((mode === "chat" && (input.chatExpanded ?? true)) || Boolean(input.universeOwnsScreen));
  return { mode, chatOwnsScreen, workspaceOwnsScreen, cosmosRendered: !chatOwnsScreen && !workspaceOwnsScreen };
}
