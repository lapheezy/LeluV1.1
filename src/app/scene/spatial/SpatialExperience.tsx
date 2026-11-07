/**
 * ==========================================================
 * LÉLUVERSE — SPATIAL EXPERIENCE
 *
 * Mounted once beside the unified interface. It is the bridge
 * between the SpatialRuntime (where the camera is and what
 * transition is running) and the things that already exist:
 *
 *  - the real workspaces: arriving at Browser / Studios /
 *    Projects / Files / Media / Agents opens the SAME
 *    GenesisPanel through GenesisCore's own openPanel — the
 *    module windows, their runtimes and their state are
 *    untouched. Leaving an environment minimizes instead of
 *    closing, so work in progress survives the journey.
 *  - LÉLU's real tool pipeline: a `genesis-show-surface`
 *    request (what SurfaceResolver dispatches when she opens
 *    something) becomes a spatial transition instead of a
 *    sudden panel appearing over the scene.
 *  - her avatar: on arrival she is asked, through the real
 *    AvatarCommandBus, to turn toward the interface she now
 *    faces.
 *  - diagnostics: the live spatial state is published on the
 *    document (data-spatial-*) and on window.__leluSpatial, so
 *    the demo can measure it instead of trusting a screenshot.
 * ==========================================================
 */

import { useEffect, useRef, useState } from "react";
import SpatialRuntime, { installSpatialBridge, type SpatialState } from "./SpatialRuntime";
import SpatialNavigator from "./SpatialNavigator";
import PortalRegistry from "./PortalRegistry";
import { destinationFor, destinationForPanel, type SpatialSceneId } from "./SpatialScenes";
import { useGenesis } from "../genesis/GenesisCore";
import AvatarCommandBus from "../../../core/avatar/AvatarCommandBus";
import { layer } from "../../../core/ui/Layers";

/** How far into a transition the target surface starts materialising. */
const MATERIALIZE_AT = 0.45;

export default function SpatialExperience() {
  const runtime = SpatialRuntime.getInstance();
  const { state, openPanel, minimizeModule } = useGenesis();
  const [spatial, setSpatial] = useState<SpatialState>(() => runtime.getState());
  /** Surfaces this layer opened, so leaving can minimize — never close — them. */
  const opened = useRef<Set<string>>(new Set());
  const materialized = useRef<Set<SpatialSceneId>>(new Set());

  useEffect(() => {
    const uninstall = installSpatialBridge();
    runtime.start("core");
    return uninstall;
  }, [runtime]);

  useEffect(() => {
    setSpatial(runtime.getState());
    return runtime.subscribe((next) => setSpatial(next));
  }, [runtime]);

  /* ---------------- arrivals: open the real surface, minimize on leave ---- */

  useEffect(() => {
    return runtime.subscribe((next, event) => {
      if (event === "travel:progress" || event === "hover" || event === "workspace") return;
      const destination = destinationFor(next.current);
      if (destination.panel) {
        // The canonical environment: the ONE module instance, opened the
        // same way the dock and her tools open it.
        opened.current.add(destination.panel);
        runtime.setActiveWorkspace(next.current);
        openPanel(destination.panel);
        return;
      }
      // Out in space again: environments are minimized, never discarded —
      // a running render, a half-read page and a draft all survive. The
      // chat is the one surface that is dismissed (it is the exception the
      // rest of the app already treats as a panel, not a module window).
      const chatWasOpened = opened.current.has("chat");
      if (chatWasOpened) openPanel("none");
      for (const panel of opened.current) {
        if (panel === "chat") continue;
        minimizeModule(panel);
      }
      opened.current.clear();
      runtime.setActiveWorkspace(null);
    });
  }, [runtime, openPanel, minimizeModule]);

  /* ------------- materialisation: surfaces appear during the flight ----- */

  useEffect(() => {
    return runtime.subscribe((next, event) => {
      if (event !== "travel:progress" || !next.transition) return;
      const panel = destinationFor(next.destination ?? next.current).panel;
      if (!panel) return;
      if (next.transition.progress < MATERIALIZE_AT) {
        return;
      }
      const key = next.destination;
      if (!key || materialized.current.has(key)) return;
      materialized.current.add(key);
      opened.current.add(panel);
      openPanel(panel);
    });
  }, [runtime, openPanel]);

  useEffect(() => {
    return runtime.subscribe((next, event) => {
      if (event === "travel:start") materialized.current.clear();
      if (event !== "travel:end" && event !== "travel:reversed") return;
      // She turns toward the interface she now faces. Through the real
      // command channel, so the renderer verifies it actually moved; an
      // unconfirmed command is ignored rather than claimed.
      void AvatarCommandBus.getInstance()
        .issue("look", `turn toward ${destinationFor(next.current).label}`, 4_000)
        .catch(() => {});
    });
  }, [runtime]);

  /* -------- her tool pipeline speaks the same spatial language ---------- */

  /*
   * LÉLU opens environments through her REAL pipeline: `genesis-show-surface`
   * is handled by GenesisSurfaceController, which opens the canonical panel
   * exactly as before. This layer records which environment that is, so her
   * work is reflected in the spatial state — but it deliberately does NOT fly
   * the camera for it.
   *
   * Background cognition opens surfaces all the time (self-study, research).
   * Turning those into camera flights hijacked a transition the user had just
   * started — measured in the browser: a background research surface event
   * during the Core → Cosmos pull landed the user in the Browser instead.
   * Camera travel is the user's navigation; her surfaces open as they always
   * have, and the rail shows where she went.
   */
  useEffect(() => {
    function onShowSurface(event: Event) {
      const detail = (event as CustomEvent).detail as { panel?: string } | undefined;
      if (!detail?.panel) return;
      const destination = destinationForPanel(detail.panel);
      if (!destination) return;
      runtime.setActiveWorkspace(destination.id);
    }
    window.addEventListener("genesis-show-surface", onShowSurface);
    return () => window.removeEventListener("genesis-show-surface", onShowSurface);
  }, [runtime]);

  /* ---------------- agent-created portals: the same channel --------------- */

  /*
   * LÉLU (or any authorised agent) creates portals through the canonical
   * registry and gets a structured result back — never a claimed success. The
   * domain events are the agent-facing surface, the same way
   * `genesis-show-surface` is for surfaces; a request that names a destination
   * the scene graph does not have is answered with `{ ok: false, reason }`.
   *
   *   window.dispatchEvent(new CustomEvent("lelu-portal-create", {
   *     detail: { destination: "browser", label: "Research feed", workspace, requestId },
   *   }))
   *   → "lelu-portal-created" { ...result, requestId }
   */
  useEffect(() => {
    const registry = PortalRegistry.getInstance();
    function onCreate(event: Event) {
      const detail = (event as CustomEvent).detail as
        | { destination?: string; label?: string; workspace?: string; requestId?: string }
        | undefined;
      const result = registry.create({
        destination: detail?.destination,
        label: detail?.label,
        workspace: detail?.workspace,
        createdBy: "agent",
      });
      window.dispatchEvent(
        new CustomEvent("lelu-portal-created", { detail: { ...result, requestId: detail?.requestId } }),
      );
    }
    function onRemove(event: Event) {
      const detail = (event as CustomEvent).detail as { id?: string; requestId?: string } | undefined;
      const ok = detail?.id ? registry.remove(detail.id) : false;
      window.dispatchEvent(
        new CustomEvent("lelu-portal-removed", {
          detail: { ok, id: detail?.id, requestId: detail?.requestId },
        }),
      );
    }
    window.addEventListener("lelu-portal-create", onCreate);
    window.addEventListener("lelu-portal-remove", onRemove);
    return () => {
      window.removeEventListener("lelu-portal-create", onCreate);
      window.removeEventListener("lelu-portal-remove", onRemove);
    };
  }, []);

  /* ------------------------------ diagnostics --------------------------- */

  useEffect(() => {
    document.body.dataset.spatialScene = spatial.current;
    document.body.dataset.spatialTransition = spatial.transition?.kind ?? "";
    document.body.dataset.spatialProgress = String(
      spatial.transition ? Math.round(spatial.transition.progress * 100) : 100,
    );
    document.body.dataset.spatialBackend = spatial.backend;
  }, [spatial.current, spatial.transition, spatial.backend]);

  // The chat's own panel state is the application's, not ours; this keeps
  // the recorded workspace honest if the user opens chat from the dock.
  useEffect(() => {
    if (state.activePanel === "none") return;
    const destination = destinationForPanel(state.activePanel);
    if (!destination) return;
    runtime.setActiveWorkspace(destination.id);
  }, [state.activePanel, runtime]);

  return (
    <>
      <SpatialNavigator />
      {/* Live spatial read-out for the demo harness — invisible, cheap. */}
      <div
        data-spatial-telemetry
        aria-hidden
        style={{
          position: "fixed",
          right: 0,
          bottom: 0,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
          zIndex: layer("scene"),
        }}
      >
        {`${spatial.current}|${spatial.transition?.kind ?? "idle"}|${Math.round((spatial.transition?.progress ?? 1) * 100)}`}
      </div>
    </>
  );
}
