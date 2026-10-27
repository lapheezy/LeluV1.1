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
  /** chatLayout.chatFillsScreen() for the measured workspace. */
  compact: boolean;
}

export interface Surface {
  mode: SurfaceMode;
  /** Phone-sized chat: the conversation is the only thing on screen. */
  chatOwnsScreen: boolean;
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
  const chatOwnsScreen = input.compact && mode === "chat";
  return { mode, chatOwnsScreen, cosmosRendered: !chatOwnsScreen };
}
