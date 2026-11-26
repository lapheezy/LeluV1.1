/**
 * ==========================================================
 * LÉLUVERSE — SPATIAL NAVIGATOR (ORBITAL)
 *
 * The navigation of the spatial experience is an orbit, not a bar.
 *
 *   · LÉLU CORE sits at the centre of the bottom band — the anchor
 *     you return to, with the live transition drawn around it.
 *   · Each navigation CATEGORY is its own orb on an ellipse around
 *     and behind the Core, close enough to reach with a thumb. Each
 *     orb has its own stable position, glyph and accent.
 *   · Selecting a category opens its destinations as a small ring of
 *     satellite orbs AROUND that category — each destination keeps
 *     its own identity and travel is one tap.
 *
 * The Earth and the Core are never covered: only the orbs paint, the
 * space between them is the world, and there is no full-width bar and
 * no expanding panel of pills. Category labels appear only for the
 * orb under the pointer (or the one open), so the composition stays
 * readable at 375px without stacking text over the globe.
 *
 * Utility controls (voice, Creation Studio, portals, chat, minimise)
 * live on an INNER arc that appears on demand; they are not part of
 * the resting composition. Portals and layout remain available as a
 * sheet, because that is a form, not navigation.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { composerLift, liftOverflowsTop } from "./composerClearance";
import { useUniverseOpen } from "../genesis/chat/universe/universeOpen";
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
import { DOCK_GLYPHS, dockGroups, groupFor, type DockGroup } from "./capabilityGroups";
import { orbitRing, satelliteOffsets, type OrbitPoint } from "./orbitLayout";
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
 * here at once. Seeding is idempotent, so the field and the sheet agree and
 * neither depends on the other being mounted.
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

  /* Utility arc, collapsed until asked for. Opened by default it covered the
     home's Notifications and App Library cards right after guest entry. */
  const [open, setOpen] = useState(false);
  /** Which category's destinations are orbiting on screen. */
  const [openCategory, setOpenCategory] = useState<string | null>(null);

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
  const builtinPortals = portals.filter((portal) => isBuiltinPortal(portal));
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

  const universeOpen = useUniverseOpen();
  const phoneWindowOpen =
    genesis.activePanel !== "none" && typeof window !== "undefined" && window.innerWidth < 720;
  const hidden = surface.chatOwnsScreen || universeOpen || phoneWindowOpen;
  const travelling = Boolean(spatial.transition);
  const progress = spatial.transition ? Math.round(spatial.transition.progress * 100) : 100;
  const active = destinationFor(spatial.current);
  const hovered = spatial.interaction.hovered ? destinationFor(spatial.interaction.hovered) : null;
  const voice = genesis.voice;
  const chatOpen = genesis.activePanel === "chat";

  /*
   * The orbit is a fixed composition: five categories at five angles. The
   * list is NOT reordered by the current scene — an orb that moved when you
   * travelled would break the map you just learned.
   */
  const groups = useMemo(() => dockGroups(), []);
  const ring = useMemo(() => orbitRing(groups.length), [groups.length]);
  const activeGroup = groupFor(spatial.current);
  const openGroup: DockGroup | null = useMemo(
    () => groups.find((group) => group.id === openCategory) ?? null,
    [groups, openCategory],
  );
  const openIndex = openGroup ? groups.findIndex((group) => group.id === openGroup.id) : -1;
  const openParent: OrbitPoint | null = openIndex >= 0 ? ring[openIndex] : null;
  const satellites = useMemo(
    () => (openGroup && openParent ? satelliteOffsets(openGroup.entries.length, openParent.angle, 62) : []),
    [openGroup, openParent],
  );
  /*
   * A phone band is ~264px tall: the category ring, the Core and a second
   * constellation do not fit (measured — the fan covered four category
   * orbs and then clipped the band's top). There the open category's
   * destinations simply take the ring's own slots, and the categories
   * step aside while it is open.
   */
  const compactSlots = useMemo(
    () => (compact && openGroup ? orbitRing(openGroup.entries.length) : []),
    [compact, openGroup],
  );

  /* Never over the chat composer: measure and lift the band clear. */
  const navRef = useRef<HTMLDivElement | null>(null);
  const [lift, setLift] = useState(0);
  useEffect(() => {
    if (!chatOpen || hidden) {
      setLift(0);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const nav = navRef.current;
      const composer = document.querySelector("[data-lelu-composer]");
      if (!nav || !composer) {
        setLift((value) => (value === 0 ? value : 0));
        return;
      }
      const r = nav.getBoundingClientRect();
      const current = Number(nav.dataset.spatialComposerClearance ?? 0) || 0;
      const natural = { top: r.top + current, bottom: r.bottom + current, left: r.left, right: r.right };
      const c = composer.getBoundingClientRect();
      const next = composerLift(natural, { top: c.top, bottom: c.bottom, left: c.left, right: c.right });
      if (next > 0 && liftOverflowsTop(natural, next, 8) && open) {
        setOpen(false);
        return;
      }
      setLift((value) => (value === next ? value : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    const timer = window.setInterval(schedule, 400);
    window.addEventListener("resize", schedule);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [chatOpen, hidden, open]);

  /* A tap or click outside the orbit closes what is open, like any menu. */
  useEffect(() => {
    if (!open && !openCategory && !portalPanel) return;
    const onPointerDown = (event: PointerEvent) => {
      const nav = navRef.current;
      if (nav && event.target instanceof Node && !nav.contains(event.target)) {
        setOpen(false);
        setOpenCategory(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, openCategory, portalPanel]);

  /* Escape steps back out of the orbit before it leaves the world. */
  useEffect(() => {
    if (!open && !openCategory) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openCategory) setOpenCategory(null);
      else setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openCategory]);

  if (hidden) return null;

  const pointStyle = (point: OrbitPoint): CSSProperties => ({
    left: `calc(50% + (var(--orbit-rx) * ${point.x.toFixed(4)}))`,
    top: `calc(100% - (var(--core) / 2) + (var(--orbit-ry) * ${point.y.toFixed(4)}))`,
  });

  /** The inner arc: utilities, only while the Core's caret is open. */
  const utilities = [
    {
      id: "voice",
      label: voice === "idle" ? "Talk to LÉLU" : `LÉLU voice: ${voice}`,
      glyph: voice === "idle" ? "🎙" : "◉",
      active: voice !== "idle",
      title: "Speak with LÉLU — no chat window needed",
      run: () => {
        void VoiceEngine.getInstance().toggle();
      },
      testId: "voice",
    },
    {
      id: "creation",
      testId: "creation",
      label: "Open Creation Studio",
      glyph: "▤",
      active: genesis.activePanel === "creation",
      title: "Open the Creation Studio — documents, decks, graphs and drawings",
      run: () => openPanel("creation"),
    },
    {
      id: "portals",
      testId: "portals",
      label: portalPanel ? "Close portals and layout" : "Portals and layout",
      glyph: "◇",
      active: portalPanel,
      title: "Create a portal, or arrange the workspace windows",
      run: () => setPortalPanel((value) => !value),
    },
    {
      id: "chat",
      testId: "chat",
      label: chatOpen ? "Dismiss the chat" : "Summon the chat",
      glyph: chatOpen ? "✕" : "✉",
      active: chatOpen,
      title: chatOpen ? "Dismiss the conversation" : "Summon the conversation",
      run: () => openPanel(chatOpen ? "none" : "chat"),
    },
    ...(compact
      ? []
      : [
          {
            id: "minimise",
            testId: "minimise",
            label: "Minimise the interface",
            glyph: "—",
            active: false,
            title: "Minimise the interface",
            run: () => minimize(),
          },
        ]),
  ];
  const utilityRing = orbitRing(utilities.length, 128);

  const control = (
    scene: SpatialSceneId,
    label: string,
    glyph: string,
    run: () => void,
    options: { testId: string; active: boolean; title: string },
  ) => (
    <button
      key={options.testId}
      type="button"
      data-spatial-scene={scene}
      data-spatial-control={options.testId}
      aria-label={label}
      aria-pressed={options.active}
      title={options.title}
      onClick={run}
      onPointerEnter={() => runtime.hover(scene)}
      onPointerLeave={() => runtime.hover(null)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        borderRadius: 999,
        border: `1px solid ${options.active ? "rgba(103,232,249,0.6)" : "rgba(148,163,184,0.24)"}`,
        background: options.active ? "rgba(34,211,238,0.2)" : "rgba(8,16,38,0.66)",
        color: options.active ? "#a5f3fc" : "rgba(214,228,244,0.9)",
        cursor: "pointer",
        padding: 0,
        fontSize: 13,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
    >
      <span aria-hidden>{glyph}</span>
    </button>
  );

  return (
    <div
      ref={navRef}
      data-spatial-nav
      data-spatial-composer-clearance={lift}
      data-spatial-current={spatial.current}
      data-spatial-destination={spatial.destination ?? ""}
      data-spatial-progress={progress}
      data-spatial-transition={spatial.transition?.kind ?? ""}
      data-spatial-category={openCategory ?? ""}
      className="lso"
      style={{
        left: "50%",
        right: "auto",
        bottom: compact ? "calc(74px + env(safe-area-inset-bottom, 0px))" : 14,
        zIndex: layer("navigation"),
        transform: `translateX(-50%)${lift > 0 ? ` translateY(-${lift}px)` : ""}`,
      }}
    >
      <div className="lso-field" data-compact={compact ? "true" : "false"}>
        {/* The orbit itself: a hairline the orbs sit on, so their place reads. */}
        <div className="lso-rings" aria-hidden />

        {groups.map((group, index) => {
          const point = ring[index];
          const isOpen = openCategory === group.id;
          const holdsCurrent = activeGroup === group.id;
          return (
            <button
              key={group.id}
              type="button"
              data-spatial-group-orb={group.id}
              data-open={isOpen ? "true" : "false"}
              data-current={holdsCurrent ? "true" : "false"}
              aria-label={`${group.label}: ${group.entries.map((entry) => entry.label).join(", ")}`}
              aria-expanded={isOpen}
              title={`${group.label} — ${group.entries.map((entry) => entry.label).join(" · ")}`}
              className="lso-orb lso-category"
              style={{ ...pointStyle(point), "--accent": group.accent } as CSSProperties}
              onClick={() => {
                setOpen(false);
                setOpenCategory(isOpen ? null : group.id);
              }}
            >
              <span className="lso-glyph" aria-hidden>{group.glyph}</span>
              <span className="lso-count" aria-hidden>{group.entries.length}</span>
              <span className="lso-name" aria-hidden>{group.label}</span>
            </button>
          );
        })}

        {openGroup && openParent ? (
          <div data-spatial-groups data-category={openGroup.id} className="lso-cluster">
            {openGroup.entries.map((entry, index) => {
              const offset = satellites[index] ?? { dx: 0, dy: 0 };
              const current = spatial.current === entry.scene;
              return (
                <button
                  key={entry.scene}
                  type="button"
                  data-spatial-scene={entry.scene}
                  data-spatial-group={openGroup.id}
                  data-current={current ? "true" : "false"}
                  aria-label={`Travel to ${entry.label}`}
                  aria-current={current ? "true" : undefined}
                  title={`${entry.label} — ${entry.hint}`}
                  className="lso-orb lso-satellite"
                                    style={
                    compactSlots[index]
                      ? ({ ...pointStyle(compactSlots[index]), "--accent": entry.accent } as CSSProperties)
                      : ({
                          "--lso-left": `calc(50% + (var(--orbit-rx) * ${openParent.x.toFixed(4)}) + ${offset.dx}px)`,
                          "--lso-top": `calc(100% - (var(--core) / 2) + (var(--orbit-ry) * ${openParent.y.toFixed(4)}) + ${offset.dy}px)`,
                          "--accent": entry.accent,
                        } as CSSProperties)
                  }
                  data-slot={compactSlots[index] ? "ring" : "fan"}
                  onClick={() => {
                    setOpenCategory(null);
                    runtime.travel(entry.scene);
                  }}
                  onPointerEnter={() => runtime.hover(entry.scene)}
                  onPointerLeave={() => runtime.hover(null)}
                >
                  <span className="lso-glyph" aria-hidden>{entry.glyph ?? DOCK_GLYPHS[entry.scene] ?? "◇"}</span>
                  <span className="lso-name" aria-hidden>{entry.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* The utilities are an inner arc: present only when asked for. */}
        {open ? (
          <div className="lso-utilities" aria-label="Interface controls">
            {utilities.map((item, index) => {
              const point = utilityRing[index];
              return (
                <span
                  key={item.id}
                  className="lso-utility"
                  style={{
                    left: `calc(50% + (var(--orbit-rx) * 0.46 * ${point.x.toFixed(4)}))`,
                    top: `calc(100% - (var(--core) / 2) + (var(--orbit-ry) * 0.46 * ${point.y.toFixed(4)}))`,
                  }}
                >
                  {control(active.id, item.label, item.glyph, item.run, {
                    testId: item.testId,
                    active: item.active,
                    title: item.title,
                  })}
                </span>
              );
            })}
          </div>
        ) : null}

        {/* Transient transit controls: only while a flight is running. */}
        {travelling ? (
          <div className="lso-transit" aria-label="Transition controls">
            {travelling && spatial.transition && !spatial.transition.interrupted
              ? control("core", "Stop the transition", "❚❚", () => runtime.interrupt(), {
                  testId: "interrupt",
                  active: false,
                  title: "Stop the transition",
                })
              : null}
            {spatial.transition?.interrupted
              ? control("core", "Resume the transition", "▶", () => runtime.resume(), {
                  testId: "resume",
                  active: false,
                  title: "Resume the transition",
                })
              : null}
            {spatial.transition
              ? control("core", "Reverse the transition", "↺", () => runtime.reverse(), {
                  testId: "reverse",
                  active: false,
                  title: "Reverse the transition",
                })
              : null}
          </div>
        ) : null}

        {/* LÉLU CORE: the anchor. It never moves; it is what you come back to. */}
        <button
          type="button"
          data-spatial-control="core"
          data-active={spatial.current === "core" ? "true" : "false"}
          aria-label={`Return to LÉLU's core${active.id === "core" ? " (you are here)" : ""}`}
          title="LÉLU Core — return here"
          className="lso-core"
          onClick={() => {
            setOpenCategory(null);
            runtime.travel("core", { kind: "return-to-core" });
          }}
        >
          <svg className="lso-progress" viewBox="0 0 100 100" aria-hidden>
            <circle
              cx="50"
              cy="50"
              r="46"
              pathLength={100}
              strokeDasharray={100}
              strokeDashoffset={travelling ? 100 - progress : 100}
              style={{ stroke: active.accent }}
            />
          </svg>
          <span className="lso-core-halo" aria-hidden />
          <span className="lso-core-body" aria-hidden />
        </button>

        {/* One caret, attached to the Core: the utilities are one tap away. */}
        <button
          type="button"
          data-spatial-control="expand"
          aria-label={open ? "Collapse the interface controls" : "Open the interface controls"}
          aria-expanded={open}
          title={hovered ? `${hovered.label} — ${hovered.hint}` : `${active.label} — ${active.hint}`}
          className="lso-caret"
          data-open={open ? "true" : "false"}
          onClick={() => {
            setOpenCategory(null);
            setOpen((value) => !value);
          }}
        >
          <span aria-hidden>{open ? "▾" : "▴"}</span>
        </button>

        {hovered && !openGroup ? (
          <p className="lso-hint" aria-live="polite">
            {hovered.label} — {hovered.hint}
          </p>
        ) : (
          <p className="lso-hint" aria-live="polite">
            {openGroup
              ? `${openGroup.label} · ${openGroup.entries.length} destination${openGroup.entries.length === 1 ? "" : "s"}`
              : travelling
                ? `${active.label} · ${progress}%`
                : `${active.label} — ${active.hint}`}
          </p>
        )}
      </div>

      {open && !portalPanel ? (
        <div className="lso-sheet lso-worlds">
          <SavedWorlds compact={compact} />
        </div>
      ) : null}

      {portalPanel ? (
        <div
          data-portal-panel
          data-portal-count={customPortals.length}
          data-portal-agent-count={agentPortals.length}
          data-portal-user-count={userPortals.length}
          className="lso-sheet"
          style={{ pointerEvents: "none" }}
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
    </div>
  );
}
