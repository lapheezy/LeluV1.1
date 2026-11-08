/**
 * ==========================================================
 * LÉLUVERSE — SPATIAL NAVIGATOR
 *
 * The primary navigation of the spatial experience.
 *
 * Before this, every environment was reached by opening the chat
 * and asking, or by hunting the dock. Now the Cosmos itself has a
 * navigation rail: pick a galaxy, a world, the browser, the studio
 * or a project and the camera flies there while the real surface
 * materialises. Chat is one destination among them — and it is
 * closed when the application opens.
 *
 * It is deliberately quiet: a thin ambient bar at the bottom edge,
 * out of the way of the dock rail, the composer and the phone's
 * system bars. It carries the transition itself (progress, stop,
 * reverse) so the state of the scene is never a mystery.
 * ==========================================================
 */

import { useEffect, useMemo, useState } from "react";
import SpatialRuntime, { type SpatialState } from "./SpatialRuntime";
import { SPATIAL_DESTINATIONS, destinationFor, type SpatialSceneId } from "./SpatialScenes";
import PortalRegistry, { RING_SCENES, isBuiltinPortal, type PortalRecord } from "./PortalRegistry";
import ModuleLayoutStore from "../genesis/layout/ModuleLayoutStore";
import { useGenesis } from "../genesis/GenesisCore";
import { useSurface } from "../genesis/surface/useSurface";
import { useWorkspace } from "../genesis/useWorkspace";
import { chatFillsScreen } from "../genesis/chat/chatLayout";
import { layer } from "../../../core/ui/Layers";
import VoiceEngine from "../../../core/voice/VoiceEngine";
import { DOCK_GLYPHS, orderedGroups } from "./capabilityGroups";
import SavedWorlds from "./SavedWorlds";

function useSpatialState(): SpatialState {
  const runtime = SpatialRuntime.getInstance();
  const [state, setState] = useState<SpatialState>(() => runtime.getState());
  useEffect(() => {
    setState(runtime.getState());
    return runtime.subscribe((next) => setState(next));
  }, [runtime]);
  return state;
}

/**
 * The registry's live portal list: created, edited and removed portals appear
 * here at once.
 *
 * The built-in ring is SEEDED HERE as well as in the 3D field. Before this, only
 * SpatialPortals called `seedRing`, so the panel's only travel controls were
 * user-created portals: with none created, every registered destination in the
 * world had no entry point in the interface at all, and the panel said "only the
 * built-in ring exists" while listing nothing. Seeding is idempotent, so the
 * field and the panel agree and neither depends on the other being mounted.
 */
function usePortalRegistry(): PortalRecord[] {
  const registry = PortalRegistry.getInstance();
  const [portals, setPortals] = useState<PortalRecord[]>(() => {
    registry.seedRing(RING_SCENES);
    return registry.list();
  });
  useEffect(() => {
    registry.seedRing(RING_SCENES);
    setPortals(registry.list());
    return registry.subscribe(setPortals);
  }, [registry]);
  return portals;
}

const FIELD: React.CSSProperties = {
  font: "500 11px system-ui, sans-serif",
  color: "rgba(224,242,254,0.92)",
  background: "rgba(8,16,38,0.7)",
  border: "1px solid rgba(148,163,184,0.24)",
  borderRadius: 8,
  padding: "5px 8px",
  maxWidth: 150,
};

const TINY: React.CSSProperties = {
  font: "600 10.5px system-ui, sans-serif",
  letterSpacing: "0.04em",
  color: "rgba(214,228,244,0.86)",
  background: "rgba(34,211,238,0.12)",
  border: "1px solid rgba(103,232,249,0.35)",
  borderRadius: 999,
  padding: "4px 9px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export default function SpatialNavigator() {
  const runtime = SpatialRuntime.getInstance();
  const spatial = useSpatialState();
  const { state: genesis, minimize, openPanel } = useGenesis();
  const surface = useSurface();
  const workspace = useWorkspace();
  const compact = chatFillsScreen(workspace);
  const [open, setOpen] = useState(() => !compact);

  /* Portals and the workspace layout are part of THIS interface, not a
     separate settings screen: the rail that navigates the world also names
     the connections in it and arranges the windows. */
  const portals = usePortalRegistry();
  const [portalPanel, setPortalPanel] = useState(false);
  const [portalTarget, setPortalTarget] = useState<SpatialSceneId>("studio");
  const [portalName, setPortalName] = useState("");
  const [portalNotice, setPortalNotice] = useState("");
  const layoutStore = ModuleLayoutStore.getInstance();
  const [layoutVersion, setLayoutVersion] = useState(0);
  useEffect(() => layoutStore.subscribe(() => setLayoutVersion((value) => value + 1)), [layoutStore]);
  const layout = useMemo(() => layoutStore.getState(), [layoutStore, layoutVersion]);
  const manualCount = layout.entries.filter((entry) => entry.manual).length;
  const pinnedCount = layout.entries.filter((entry) => entry.pinned).length;
  const customPortals = portals.filter((portal) => !isBuiltinPortal(portal));
  /* The ring's own destinations, in registry order: real ids, real labels, and
     the same `planTravel` a created portal uses. */
  const builtinPortals = portals.filter((portal) => isBuiltinPortal(portal));
  /* Who made each connection is part of its identity: a portal LÉLU created
     and one the person created are both first-class, and the panel says which
     is which instead of leaving it to be inferred from a label. */
  const agentPortals = customPortals.filter((portal) => portal.createdBy === "agent");
  const userPortals = customPortals.filter((portal) => portal.createdBy === "user");

  const createPortal = () => {
    const result = PortalRegistry.getInstance().create({
      destination: portalTarget,
      label: portalName,
      createdBy: "user",
    });
    if (!result.ok) {
      setPortalNotice(result.reason);
      return;
    }
    setPortalName("");
    setPortalNotice(`Portal “${result.portal.label}” created.`);
  };

  const travelPortal = (id: string) => {
    const plan = PortalRegistry.getInstance().planTravel(id);
    if (!plan) {
      setPortalNotice("That portal no longer leads anywhere.");
      return;
    }
    runtime.travel(plan.destination.id);
  };

  const removePortal = (id: string) => {
    const removed = PortalRegistry.getInstance().remove(id);
    setPortalNotice(removed ? "Portal removed." : "The portal could not be removed.");
  };

  // The rail belongs to the WORLD, not to the conversation: it is present
  // while the chat interface is collapsed (the state the app opens in), so
  // the Cosmos can be navigated without summoning chat at all. It steps
  // aside only when a phone chat owns the whole screen.
  const hidden = surface.chatOwnsScreen;
  const travelling = Boolean(spatial.transition);
  const progress = spatial.transition ? Math.round(spatial.transition.progress * 100) : 100;
  const active = destinationFor(spatial.current);
  const hovered = spatial.interaction.hovered ? destinationFor(spatial.interaction.hovered) : null;
  const voice = genesis.voice;
  const chatOpen = genesis.activePanel === "chat";

  if (hidden) return null;

  const button = (scene: SpatialSceneId) => {
    const destination = destinationFor(scene);
    const isActive = spatial.current === scene;
    const isHovered = spatial.interaction.hovered === scene;
    return (
      <button
        key={scene}
        type="button"
        data-spatial-scene={scene}
        aria-label={`Travel to ${destination.label}`}
        title={`${destination.label} — ${destination.hint}`}
        onClick={() => runtime.travel(scene)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: compact ? "7px 9px" : "6px 11px",
          borderRadius: 999,
          border: `1px solid ${isActive ? `${destination.accent}88` : "rgba(148,163,184,0.18)"}`,
          background: isActive
            ? `${destination.accent}22`
            : isHovered
              ? "rgba(148,163,184,0.14)"
              : "rgba(8,16,38,0.55)",
          color: isActive ? destination.accent : "rgba(214,228,244,0.86)",
          font: "600 11px system-ui, sans-serif",
          letterSpacing: "0.02em",
          cursor: "pointer",
          whiteSpace: "nowrap",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease",
        }}
        onPointerEnter={() => runtime.hover(scene)}
        onPointerLeave={() => runtime.hover(null)}
      >
        <span aria-hidden style={{ fontSize: 12 }}>
          {DOCK_GLYPHS[scene] ?? "◇"}
        </span>
        {!compact && <span>{destination.label}</span>}
      </button>
    );
  };

  const control = (
    label: string,
    glyph: string,
    onClick: () => void,
    options: { testId?: string; active?: boolean; title?: string } = {},
  ) => (
    <button
      key={label}
      type="button"
      data-spatial-control={options.testId ?? label}
      aria-label={label}
      title={options.title ?? label}
      aria-pressed={options.active}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: 999,
        border: `1px solid ${options.active ? "rgba(103,232,249,0.6)" : "rgba(148,163,184,0.2)"}`,
        background: options.active ? "rgba(34,211,238,0.18)" : "rgba(8,16,38,0.62)",
        color: options.active ? "#a5f3fc" : "rgba(214,228,244,0.85)",
        cursor: "pointer",
        padding: 0,
        fontSize: 13,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <span aria-hidden>{glyph}</span>
    </button>
  );

  return (
    <div
      data-spatial-nav
      data-spatial-current={spatial.current}
      data-spatial-destination={spatial.destination ?? ""}
      data-spatial-progress={progress}
      data-spatial-transition={spatial.transition?.kind ?? ""}
      style={{
        position: "fixed",
        left: compact ? 8 : 92,
        right: 12,
        bottom: compact ? "calc(84px + env(safe-area-inset-bottom, 0px))" : 20,
        zIndex: layer("navigation"),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        pointerEvents: "none",
      }}
    >
      {travelling ? (
        <div
          aria-hidden
          style={{
            width: "min(420px, 80%)",
            height: 2,
            borderRadius: 2,
            background: "rgba(148,163,184,0.2)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background: active.accent,
              transition: "width 0.08s linear",
            }}
          />
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          maxWidth: "100%",
          flexWrap: "wrap",
          justifyContent: "center",
          pointerEvents: "auto",
          padding: compact ? "6px 7px" : "8px 10px",
          borderRadius: compact ? 14 : 18,
          background: "rgba(4,10,26,0.55)",
          border: "1px solid rgba(125,211,252,0.12)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        <button
          type="button"
          data-spatial-control="expand"
          aria-label={open ? "Collapse spatial navigation" : "Open spatial navigation"}
          title={hovered ? `${hovered.label} — ${hovered.hint}` : `${active.label} — ${active.hint}`}
          onClick={() => setOpen((value) => !value)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "6px 10px",
            borderRadius: 999,
            border: `1px solid ${active.accent}55`,
            background: `${active.accent}18`,
            color: active.accent,
            font: "700 11px system-ui, sans-serif",
            letterSpacing: "0.08em",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <span aria-hidden>{DOCK_GLYPHS[active.id] ?? "◇"}</span>
          {open ? (travelling ? `${active.label} · ${progress}%` : active.label) : "Spatial"}
        </button>

        <span aria-hidden style={{ width: 1, height: 18, background: "rgba(148,163,184,0.2)" }} />

        {control(
          "Return to the core",
          "◎",
          () => runtime.travel("core", { kind: "return-to-core" }),
          { testId: "core", title: "Return to LÉLU's core" },
        )}
        {travelling && spatial.transition && !spatial.transition.interrupted
          ? control("Stop the transition", "❚❚", () => runtime.interrupt(), { testId: "interrupt" })
          : null}
        {spatial.transition?.interrupted
          ? control("Resume the transition", "▶", () => runtime.resume(), { testId: "resume" })
          : null}
        {spatial.transition
          ? control("Reverse the transition", "↺", () => runtime.reverse(), { testId: "reverse" })
          : null}

        {/* Voice without chat: the mic talks to LÉLU directly. No panel opens. */}
        {control(
          voice === "idle" ? "Talk to LÉLU" : `LÉLU voice: ${voice}`,
          voice === "idle" ? "🎙" : "◉",
          () => {
            void VoiceEngine.getInstance().toggle();
          },
          { testId: "voice", active: voice !== "idle", title: "Speak with LÉLU — no chat window needed" },
        )}

        {/*
          The Studio destination opens Visual Studio; the canonical Creation
          Studio (panel id `creation`) had no control in the spatial shell at
          all — the dock that names it is not rendered on desktop, so the one
          surface for documents, decks, graphs and drawings was unreachable
          without chat. This opens that SAME panel through GenesisCore's own
          openPanel; it is an entry point, not a second studio.
        */}
        {control("Open Creation Studio", "▤", () => openPanel("creation"), {
          testId: "creation",
          title: "Open the Creation Studio — documents, decks, graphs and drawings",
        })}

        {control(portalPanel ? "Close portals and layout" : "Portals and layout", "◇", () => setPortalPanel((value) => !value), {
          testId: "portals",
          active: portalPanel,
          title: "Create a portal, or arrange the workspace windows",
        })}

        {/* Chat is summonable and dismissible: a destination, not the frame. */}
        {control(
          chatOpen ? "Dismiss the chat" : "Summon the chat",
          chatOpen ? "✕" : "✉",
          () => openPanel(chatOpen ? "none" : "chat"),
          { testId: "chat", active: chatOpen, title: chatOpen ? "Dismiss the conversation" : "Summon the conversation" },
        )}

        {compact
          ? null
          : control("Minimise the interface", "—", () => minimize(), { testId: "minimise" })}
      </div>

      {/* Grouped capabilities, not a row of unrelated chips: the group the
          person is looking at leads, and only destinations the scene graph
          really has can appear here. */}
      {open ? (
        <div
          data-spatial-groups
          style={{
            display: "grid",
            gap: 4,
            width: "min(600px, 100%)",
            pointerEvents: "auto",
            padding: "8px 10px",
            borderRadius: 18,
            background: "rgba(4,10,26,0.55)",
            border: "1px solid rgba(125,211,252,0.12)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
          }}
        >
          {orderedGroups(spatial.current).map((group) => (
            <div
              key={group.id}
              data-spatial-group={group.id}
              style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
            >
              <span
                aria-hidden
                style={{
                  flex: "0 0 auto",
                  width: compact ? 34 : 98,
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  font: "600 8.5px system-ui, sans-serif",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: `${group.accent}b0`,
                }}
              >
                {compact ? group.glyph : group.label}
              </span>
              <span
                aria-hidden
                style={{ flex: "0 0 auto", width: 1, height: 18, background: "rgba(148,163,184,0.16)" }}
              />
              <span style={{ display: "flex", flexWrap: "wrap", gap: 5, minWidth: 0 }}>
                {group.entries.map((entry) => button(entry.scene))}
              </span>
            </div>
          ))}
          {/* Environments created through the world engine, from the same store. */}
          <SavedWorlds compact={compact} />
        </div>
      ) : null}

      {portalPanel ? (
        <div
          data-portal-panel
          data-portal-count={customPortals.length}
          data-portal-agent-count={agentPortals.length}
          data-portal-user-count={userPortals.length}
          style={{
            display: "grid",
            gap: 7,
            width: "min(620px, 100%)",
            pointerEvents: "auto",
            padding: "9px 11px",
            borderRadius: 16,
            background: "rgba(4,10,26,0.72)",
            border: "1px solid rgba(125,211,252,0.18)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span
              style={{
                font: "600 8.5px system-ui, sans-serif",
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "rgba(103,232,249,0.85)",
              }}
            >
              New portal
            </span>
            <select
              data-portal-destination
              aria-label="Portal destination"
              value={portalTarget}
              onChange={(event) => setPortalTarget(event.target.value as SpatialSceneId)}
              style={FIELD}
            >
              {SPATIAL_DESTINATIONS.filter(
                (destination) => destination.kind !== "core" && destination.kind !== "cosmos",
              ).map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.label}
                </option>
              ))}
            </select>
            <input
              data-portal-name
              aria-label="Portal name"
              placeholder="Name (optional)"
              value={portalName}
              onChange={(event) => setPortalName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createPortal();
              }}
              style={{ ...FIELD, width: 132 }}
            />
            <button type="button" data-portal-create onClick={createPortal} style={TINY}>
              Create
            </button>
          </div>

          {portalNotice ? (
            <span data-portal-notice role="status" style={{ font: "500 10.5px system-ui, sans-serif", color: "rgba(186,230,253,0.85)" }}>
              {portalNotice}
            </span>
          ) : null}

          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span
              style={{
                font: "600 8.5px system-ui, sans-serif",
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "rgba(148,163,184,0.8)",
              }}
            >
              Portals
            </span>
            {builtinPortals.length === 0 ? (
              <span style={{ font: "500 10.5px system-ui, sans-serif", color: "rgba(148,163,184,0.65)" }}>
                The built-in ring did not register on this device.
              </span>
            ) : null}
            {/* Every registered destination, travelable by pointer without aiming
                at 3D geometry. Same registry ids the world portals use. */}
            {builtinPortals.map((portal) => {
              const destination = destinationFor(portal.destination);
              return (
                <button
                  key={portal.id}
                  type="button"
                  data-portal-travel={portal.id}
                  data-portal-builtin="true"
                  data-portal-destination-id={portal.destination}
                  title={`Travel to ${destination.label}`}
                  onClick={() => travelPortal(portal.id)}
                  style={{
                    ...TINY,
                    border: `1px solid ${destination.accent}55`,
                    background: `${destination.accent}14`,
                    color: spatial.current === portal.destination ? destination.accent : TINY.color,
                  }}
                >
                  {destination.label}
                </button>
              );
            })}
            {customPortals.length === 0 && builtinPortals.length > 0 ? (
              <span style={{ font: "500 10.5px system-ui, sans-serif", color: "rgba(148,163,184,0.65)" }}>
                No portals of your own yet — travel above is the world&apos;s ring.
              </span>
            ) : null}
            {customPortals.map((portal) => (
              <span
                key={portal.id}
                data-portal-id={portal.id}
                data-portal-creator={portal.createdBy}
                data-portal-destination-id={portal.destination}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 2,
                  padding: "2px 3px 2px 2px",
                  borderRadius: 999,
                  border: `1px solid ${destinationFor(portal.destination).accent}44`,
                  background: `${destinationFor(portal.destination).accent}14`,
                }}
              >
                <button
                  type="button"
                  data-portal-travel={portal.id}
                  title={`Travel to ${destinationFor(portal.destination).label}`}
                  onClick={() => travelPortal(portal.id)}
                  style={{ ...TINY, background: "transparent", border: "none", padding: "3px 7px" }}
                >
                  {portal.label}
                  <span aria-hidden style={{ opacity: 0.55 }}> · {destinationFor(portal.destination).label}</span>
                  <span
                    aria-hidden
                    data-portal-authority={portal.createdBy}
                    style={{ opacity: 0.6, marginLeft: 3, fontSize: 9, letterSpacing: "0.04em" }}
                  >
                    {portal.createdBy === "agent" ? "LÉLU" : "you"}
                  </span>
                </button>
                <button
                  type="button"
                  data-portal-remove={portal.id}
                  aria-label={`Remove ${portal.label}`}
                  title="Remove this portal"
                  onClick={() => removePortal(portal.id)}
                  style={{ ...TINY, background: "transparent", border: "none", padding: "2px 6px", color: "rgba(252,165,165,0.85)" }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span
              style={{
                font: "600 8.5px system-ui, sans-serif",
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "rgba(148,163,184,0.8)",
              }}
            >
              Layout
            </span>
            <button
              type="button"
              data-layout-arrange
              title="Tile the automatic windows around the ones you placed"
              onClick={() => {
                layoutStore.arrange();
                setPortalNotice("Auto-arranged the automatic windows; your placed windows stayed put.");
              }}
              style={TINY}
            >
              Auto-arrange
            </button>
            <button
              type="button"
              data-layout-regenerate
              title="Regenerate every window's position. This is a layout change, not a data reset."
              onClick={() => {
                const changed = layoutStore.restore();
                setPortalNotice(
                  changed.length === 0
                    ? "Layout already matches the automatic arrangement."
                    : `Regenerated ${changed.length} window${changed.length === 1 ? "" : "s"}. Your data, dock order and visibility are untouched.`,
                );
              }}
              style={TINY}
            >
              Regenerate layout
            </button>
            <span data-layout-manual-count style={{ font: "500 10.5px system-ui, sans-serif", color: "rgba(148,163,184,0.7)" }}>
              {manualCount} placed · {pinnedCount} pinned
            </span>
          </div>
        </div>
      ) : null}

      {hovered && !open ? (
        <div
          style={{
            font: "500 10.5px system-ui, sans-serif",
            color: "rgba(186,230,253,0.7)",
            letterSpacing: "0.06em",
            pointerEvents: "none",
          }}
        >
          {hovered.label} — {hovered.hint}
        </div>
      ) : null}
    </div>
  );
}
