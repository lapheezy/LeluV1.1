/**
 * ==========================================================
 * LÉLU — SPATIAL BAR
 *
 * The one navigation of the app.
 *
 * The centre control is THE DIAL: it sits at the bottom centre of the
 * interface, and a touch or a hold opens the whole destination ring
 * upward — LÉLU CORE, the Cosmos, the Genesis Scene, the Chat Universe,
 * the Browser, and the two categories (Work, Intelligence) whose own
 * rings carry the studios and the board. Nested rings have a caption
 * with the parent's name and a back control; selecting travels and
 * closes the ring.
 *
 * The controls around it are the workspace utilities (Library, Windows,
 * Search, Scene, Settings) — each one a shared CircularControl with its
 * own ring. They are actions on the workspace, not a second destination
 * list: every place the interface can go comes from
 * `interaction/destinations.ts` and is offered only by the dial.
 *
 * There is no horizontal destination bar anywhere in the interface. The
 * dashboard's old Chat · Browser · Studio · Workspace · Agents · Files
 * row is gone; those destinations live here, once each.
 * ==========================================================
 */

import { useGenesis, type GenesisPanel } from "../GenesisCore";
import VisualEngine from "../../../../core/visual/VisualEngine";
import { HomeIcon } from "./CosmosHome";
import HomeStore from "./homeStore";
import { goHome, restoreLayout } from "./homeActions";
import { useHomeStore } from "./useHomeLive";
import { LibrarySheet, WindowsSheet, WorldsSheet } from "./HomeSheets";
import { GROUPS } from "./homeCatalog";
import { useSyncExternalStore } from "react";
import { CircularControl, interactionState, type RadialMenuDefinition, type RadialMenuItemSpec } from "../../../../core/interaction";
import { setUniverseOpen } from "../chat/universe/universeOpen";
import { useVoice } from "../../../../core/voice/useVoice";
import { DIAL, type Destination, type DestinationGroup } from "../interaction/destinations";
import "./spatialNav.css";

export type HomeSheet = { kind: "library"; group?: import("./homeCatalog").AppGroup } | { kind: "windows" } | { kind: "worlds" } | null;

export function openCommandPalette(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true, bubbles: true }));
}

export default function SpatialNav({
  sheet,
  setSheet,
  dialOnly = false,
  onHoldVoice,
  selfExploration,
  onToggleSelfExploration,
}: {
  sheet: HomeSheet;
  setSheet: (sheet: HomeSheet) => void;
  /**
   * An immersive scene, or a window that owns a phone screen, leaves no
   * room for the utility row. The dial stays — collapsed, bottom right,
   * clear of the safe area — so navigation is never unreachable.
   */
  dialOnly?: boolean;
  /** The dial's voice action — the one VoiceEngine, never a second pipeline. */
  onHoldVoice: () => void;
  selfExploration: boolean;
  onToggleSelfExploration: () => void;
}) {
  const genesis = useGenesis();
  const { state } = genesis;
  const home = useHomeStore();
  const voice = useVoice();
  /*
   * The dial's ring is the navigation while it is open. The workspace circles
   * are told to step aside by the SAME interaction state that opened the ring
   * — not by a guess about what is on screen — so two sets of controls never
   * compete for the same pixels.
   */
  const interaction = useSyncExternalStore(interactionState.subscribe, interactionState.getSnapshot, interactionState.getSnapshot);
  const ringOpen = interaction?.kind === "radial" && interaction.id === "environment-radial";
  const atHome = state.activePanel === "none" && state.activeScene !== "genesisv2";
  const openWindows = Object.entries(state.modules).filter(([id, m]) => id !== "chat" && m.presentation !== "closed").length;

  const openChat = () => {
    HomeStore.setImmersive(false);
    setSheet(null);
    setUniverseOpen(true);
    window.dispatchEvent(new CustomEvent("lelu-open-universe"));
  };

  const openPanel = (id: GenesisPanel) => {
    setSheet(null);
    genesis.openPanel(id);
  };

  const enterCosmos = (immersive: boolean) => {
    setSheet(null);
    goHome(genesis);
    HomeStore.setImmersive(immersive);
  };

  const icon = (name: string, size = 21) => <HomeIcon name={name} size={size} />;

  /* ---------------------------------------------------------------
   * The dial — built from the ONE destination registry.
   * ------------------------------------------------------------- */

  const travel = (destination: Destination) => {
    setSheet(null);
    switch (destination.target.kind) {
      case "home":
        goHome(genesis);
        HomeStore.setImmersive(false);
        break;
      case "immersive":
        enterCosmos(true);
        break;
      case "chat":
        openChat();
        break;
      case "panel":
        HomeStore.setImmersive(false);
        openPanel(destination.target.panel);
        break;
    }
  };

  const active = (destination: Destination): boolean => {
    switch (destination.target.kind) {
      case "home":
        return atHome && !home.immersive && !sheet;
      case "immersive":
        return home.immersive;
      case "chat":
        return state.activePanel === "chat";
      case "panel":
        return state.activePanel === destination.target.panel;
    }
  };

  const destinationItem = (destination: Destination): RadialMenuItemSpec => ({
    id: destination.id,
    label: destination.label,
    icon: icon(destination.icon),
    active: active(destination),
    onSelect: () => travel(destination),
  });

  const groupItem = (group: DestinationGroup): RadialMenuItemSpec => ({
    id: group.id,
    label: group.label,
    icon: icon(group.icon),
    /* A category is drawn as a branch, never as a place: the caption in the
       nested ring names the parent, so the relationship is explicit. */
    children: group.items.map(destinationItem),
  });

  const dialMenu: RadialMenuDefinition = {
    id: "environment-radial",
    label: "Environments",
    items: [
      ...DIAL.map((entry) => (entry.kind === "group" ? groupItem(entry) : destinationItem(entry))),
      {
        id: "voice",
        label: voice.state.active ? "Stop talking" : "Talk to LÉLU",
        icon: icon(voice.state.active ? "MicOff" : "Mic"),
        active: voice.state.active,
        tone: voice.state.active ? "accent" : "default",
        onSelect: onHoldVoice,
      },
      {
        id: "immersion",
        label: home.immersive ? "Back to the workspace" : "Look at the Cosmos",
        icon: icon("Orbit"),
        onSelect: () => HomeStore.setImmersive(!home.immersive),
      },
    ],
  };

  /* ---------------------------------------------------------------
   * Workspace utilities — actions on the workspace, not destinations.
   * ------------------------------------------------------------- */

  const libraryMenu: RadialMenuDefinition = {
    id: "spatial-library",
    label: "Library",
    items: [
      { id: "all", label: "All apps", icon: icon("LayoutGrid"), onSelect: () => setSheet({ kind: "library" }) },
      ...GROUPS.map<RadialMenuItemSpec>((group) => ({
        id: group.id,
        label: group.label,
        icon: icon(group.icon),
        onSelect: () => setSheet({ kind: "library", group: group.id }),
      })),
    ],
  };

  const windowsMenu: RadialMenuDefinition = {
    id: "spatial-windows",
    label: "Windows",
    items: [
      { id: "open", label: "Open windows", icon: icon("AppWindow"), onSelect: () => setSheet({ kind: "windows" }) },
      { id: "restore", label: "Restore layout", icon: icon("RotateCcw"), disabled: !home.layout, onSelect: () => { restoreLayout(genesis); setSheet(null); } },
      { id: "home", label: "Home (keeps layout)", icon: icon("Home"), onSelect: () => { goHome(genesis); setSheet(null); } },
      { id: "chat", label: "Chat Universe", icon: icon("MessagesSquare"), onSelect: openChat },
      { id: "new", label: "New document", icon: icon("FilePlus2"), onSelect: () => openPanel("creation") },
    ],
  };

  const searchMenu: RadialMenuDefinition = {
    id: "spatial-search",
    label: "Search",
    items: [
      { id: "palette", label: "Search everything", icon: icon("Search"), onSelect: () => { setSheet(null); openCommandPalette(); } },
      { id: "chat", label: "Ask LÉLU", icon: icon("MessageCircle"), onSelect: openChat },
      { id: "voice", label: "Voice Studio", icon: icon("AudioLines"), onSelect: () => openPanel("voice-studio") },
      { id: "diagnostics", label: "Diagnostics", icon: icon("Gauge"), onSelect: () => openPanel("diagnostics") },
    ],
  };

  const worldsMenu: RadialMenuDefinition = {
    id: "spatial-worlds",
    label: "Scene",
    items: [
      { id: "cosmos", label: "Cosmos", icon: icon("Orbit"), active: state.activeScene !== "genesisv2" && state.activePanel === "none", onSelect: () => enterCosmos(false) },
      { id: "world", label: "Her world", icon: icon("Layers"), active: state.activeScene === "genesisv2", onSelect: () => openPanel("genesisv2") },
      { id: "earth", label: "Earth", icon: icon("Globe2"), active: state.activePanel === "earth", onSelect: () => openPanel("earth") },
      {
        id: "system",
        label: "System view",
        icon: icon("Activity"),
        onSelect: () => {
          const engine = VisualEngine.getInstance();
          engine.setInterfaceFocus(engine.getState().interfaceFocus === "visual" ? "genesis" : "visual");
        },
      },
      { id: "explore", label: selfExploration ? "Stop her exploring" : "Let her explore", icon: icon("Sparkles"), active: selfExploration, onSelect: onToggleSelfExploration },
    ],
  };

  const settingsMenu: RadialMenuDefinition = {
    id: "spatial-settings",
    label: "Settings",
    items: [
      { id: "settings", label: "Settings", icon: icon("Settings"), onSelect: () => openPanel("settings") },
      { id: "voice", label: "Voice Studio", icon: icon("AudioLines"), onSelect: () => openPanel("voice-studio") },
      { id: "engineering", label: "Engineering Studio", icon: icon("Code2"), onSelect: () => openPanel("eng-studio") },
      { id: "executive", label: "Executive Board", icon: icon("Crown"), onSelect: () => openPanel("executive") },
      { id: "device", label: "This device", icon: icon("Smartphone"), onSelect: () => openPanel("device") },
    ],
  };

  const item = (
    key: string,
    label: string,
    iconName: string,
    isActive: boolean,
    menu: RadialMenuDefinition,
    onPress: () => void,
    badge?: number,
  ) => (
    <CircularControl
      key={key}
      className="lsn-item"
      label={label}
      caption={label}
      icon={icon(iconName)}
      active={isActive}
      badge={badge}
      menu={menu}
      onPress={onPress}
    />
  );

  return (
    <>
      <nav
        className="lsn"
        data-dial-only={dialOnly ? "true" : "false"}
        data-ring-open={ringOpen ? "true" : "false"}
        data-browser="lelu-spatial-bar"
        aria-label="Spatial navigation"
        aria-hidden={dialOnly ? undefined : false}
      >
        <div
          className="lsn-bar"
          role="toolbar"
          aria-label="Workspace controls"
          /* The ring is the navigation while it is open: the workspace circles
             are removed from hit-testing and from the accessibility tree, not
             left sitting between its options. */
          aria-hidden={ringOpen || undefined}
          style={{ visibility: ringOpen ? "hidden" : "visible", opacity: ringOpen ? 0 : 1 }}
        >
          {item("library", "Library", "LayoutGrid", sheet?.kind === "library", libraryMenu, () => setSheet(sheet?.kind === "library" ? null : { kind: "library" }))}
          {item("windows", "Windows", "AppWindow", sheet?.kind === "windows", windowsMenu, () => setSheet(sheet?.kind === "windows" ? null : { kind: "windows" }), openWindows || undefined)}
          <span className="lsn-orb-slot" aria-hidden />
          {item("search", "Search", "Search", false, searchMenu, () => {
            setSheet(null);
            openCommandPalette();
          })}
          {item("worlds", "Scene", "Layers", sheet?.kind === "worlds" || state.activeScene === "genesisv2", worldsMenu, () => setSheet(sheet?.kind === "worlds" ? null : { kind: "worlds" }))}
          {item("settings", "Settings", "Settings", state.activePanel === "settings", settingsMenu, () => {
            setSheet(null);
            openPanel("settings");
          })}
        </div>

        <div className="lsn-orb-slot lsn-orb-holder">
          {/*
            THE DIAL. One persistent circular control at the bottom centre of
            the interface: a touch or a hold opens the destination ring
            upward, and every place the interface can go is in it.
          */}
          <CircularControl
            label="Environments — touch for every place in LÉLU"
            icon={<span className="lsn-orb-core" />}
            size={78}
            menu={dialMenu}
            active={home.immersive || voice.state.active}
            className="lsn-orb-control"
            testId="lsn-orb"
          />
        </div>
      </nav>

      {sheet?.kind === "library" ? <LibrarySheet group={sheet.group} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "windows" ? <WindowsSheet onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "worlds" ? (
        <WorldsSheet
          onClose={() => setSheet(null)}
          selfExploration={selfExploration}
          onToggleSelfExploration={onToggleSelfExploration}
          onSystem={() => {
            const engine = VisualEngine.getInstance();
            engine.setInterfaceFocus(engine.getState().interfaceFocus === "visual" ? "genesis" : "visual");
          }}
        />
      ) : null}
    </>
  );
}
