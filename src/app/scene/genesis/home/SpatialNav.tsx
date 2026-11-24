/**
 * ==========================================================
 * LÉLU — SPATIAL BAR
 *
 * The one navigation of the app, rebuilt around circular controls.
 *
 * Every primary control is a shared CircularControl:
 *
 *   tap                 the control's own destination
 *   press and hold      its contextual radial menu expands, and stays
 *                       open after release — nothing has to keep pressure
 *   tap an option       the action runs, the ring closes
 *   tap outside         the ring dismisses
 *
 * The menus carry what used to be lists of buttons: spatial navigation,
 * window management, scene manipulation, object creation, workspace
 * organisation, environment controls and navigation between LÉLU's
 * environments. The controls themselves stay six quiet circles around
 * the Core instead of a long bar of rectangular buttons.
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
import { CircularControl, type RadialMenuDefinition, type RadialMenuItemSpec } from "../../../../core/interaction";
import { setUniverseOpen } from "../chat/universe/universeOpen";
import { useVoice } from "../../../../core/voice/useVoice";
import "./spatialNav.css";

export type HomeSheet = { kind: "library"; group?: import("./homeCatalog").AppGroup } | { kind: "windows" } | { kind: "worlds" } | null;

export function openCommandPalette(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true, bubbles: true }));
}

export default function SpatialNav({
  sheet,
  setSheet,
  onHoldVoice,
  hidden,
  selfExploration,
  onToggleSelfExploration,
}: {
  sheet: HomeSheet;
  setSheet: (sheet: HomeSheet) => void;
  onHoldVoice: () => void;
  hidden: boolean;
  selfExploration: boolean;
  onToggleSelfExploration: () => void;
}) {
  const genesis = useGenesis();
  const { state } = genesis;
  const home = useHomeStore();
  const voice = useVoice();
  const atHome = state.activePanel === "none" && state.activeScene !== "genesisv2";
  const openWindows = Object.entries(state.modules).filter(([id, m]) => id !== "chat" && m.presentation !== "closed").length;

  const openChat = () => {
    HomeStore.setImmersive(false);
    setSheet(null);
    setUniverseOpen(true);
    window.dispatchEvent(new CustomEvent("lelu-open-universe"));
  };

  const openPanel = (id: string) => {
    setSheet(null);
    genesis.openPanel(id as GenesisPanel);
  };

  const enterCosmos = (immersive: boolean) => {
    setSheet(null);
    goHome(genesis);
    HomeStore.setImmersive(immersive);
  };

  const icon = (name: string, size = 21) => <HomeIcon name={name} size={size} />;

  const homeMenu: RadialMenuDefinition = {
    id: "spatial-home",
    label: "Home",
    items: [
      { id: "home", label: "Home", icon: icon("Home"), active: atHome && !home.immersive, onSelect: () => { setSheet(null); if (atHome) HomeStore.setImmersive(false); else goHome(genesis); } },
      { id: "cosmos", label: "Cosmos", icon: icon("Orbit"), active: home.immersive, onSelect: () => enterCosmos(true) },
      { id: "chat", label: "Chat Universe", icon: icon("MessagesSquare"), onSelect: openChat },
      { id: "library", label: "App Library", icon: icon("LayoutGrid"), onSelect: () => setSheet({ kind: "library" }) },
      { id: "windows", label: "Windows", icon: icon("AppWindow"), onSelect: () => setSheet({ kind: "windows" }) },
    ],
  };

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
    label: "Worlds",
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

  const orbMenu: RadialMenuDefinition = {
    id: "spatial-core",
    label: "LÉLU",
    items: [
      {
        id: "voice",
        label: voice.state.active ? "Stop talking" : "Talk to LÉLU",
        icon: icon(voice.state.active ? "MicOff" : "Mic"),
        active: voice.state.active,
        tone: voice.state.active ? "accent" : "default",
        onSelect: onHoldVoice,
      },
      { id: "immersion", label: home.immersive ? "Back to the workspace" : "Look at the Cosmos", icon: icon("Orbit"), onSelect: () => HomeStore.setImmersive(!home.immersive) },
      { id: "chat", label: "Chat Universe", icon: icon("MessagesSquare"), onSelect: openChat },
      {
        id: "environments",
        label: "Environments",
        icon: icon("Layers3"),
        children: [
          { id: "core", label: "LÉLU CORE", icon: icon("Sparkles"), onSelect: () => { goHome(genesis); HomeStore.setImmersive(false); } },
          { id: "cosmos-env", label: "Cosmos", icon: icon("Orbit"), onSelect: () => enterCosmos(true) },
          { id: "genesis", label: "Genesis Scene", icon: icon("Layers"), onSelect: () => openPanel("genesisv2") },
          { id: "ui", label: "UI Universe", icon: icon("Box"), onSelect: () => openPanel("visualstudio") },
          { id: "agents", label: "Agent Universe", icon: icon("Workflow"), onSelect: () => openPanel("agents") },
          { id: "executive", label: "Executive Board", icon: icon("Crown"), onSelect: () => openPanel("executive") },
          { id: "workspace", label: "Workspace", icon: icon("Folder"), onSelect: () => openPanel("projects") },
          { id: "voice-studio", label: "Voice Studio", icon: icon("AudioLines"), onSelect: () => openPanel("voice-studio") },
          { id: "eng-studio", label: "Engineering Studio", icon: icon("Code2"), onSelect: () => openPanel("eng-studio") },
        ],
      },
      {
        id: "create",
        label: "Create",
        icon: icon("Plus"),
        children: [
          { id: "document", label: "Document", icon: icon("FileText"), onSelect: () => openPanel("creation") },
          { id: "sketch", label: "Sketch", icon: icon("PenLine"), onSelect: () => openPanel("sketch") },
          { id: "render", label: "Render", icon: icon("Aperture"), onSelect: () => openPanel("render") },
          { id: "video", label: "Video", icon: icon("Film"), onSelect: () => openPanel("video") },
          { id: "studio", label: "Creation Studio", icon: icon("Box"), onSelect: () => openPanel("visualstudio") },
        ],
      },
      {
        id: "spatial-nav",
        label: "Spatial navigation",
        icon: icon("Compass"),
        children: [
          { id: "worlds", label: "Worlds", icon: icon("Globe2"), onSelect: () => setSheet({ kind: "worlds" }) },
          { id: "earth-nav", label: "Earth", icon: icon("Globe"), onSelect: () => openPanel("earth") },
          { id: "browser", label: "Browser", icon: icon("Compass"), onSelect: () => openPanel("browser") },
          { id: "history", label: "History", icon: icon("History"), onSelect: () => openPanel("history") },
        ],
      },
    ],
  };

  const item = (
    key: string,
    label: string,
    iconName: string,
    active: boolean,
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
      active={active}
      badge={badge}
      menu={menu}
      onPress={onPress}
    />
  );

  return (
    <>
      <nav
        className="lsn"
        data-hidden={hidden ? "true" : "false"}
        data-browser="lelu-spatial-bar"
        aria-label="Spatial navigation"
        aria-hidden={hidden}
      >
        <div className="lsn-bar" role="toolbar" aria-label="Spatial controls">
          {item("home", "Home", "Home", atHome && !home.immersive && !sheet, homeMenu, () => {
            setSheet(null);
            if (atHome) HomeStore.setImmersive(false);
            else goHome(genesis);
          })}
          {item("library", "Library", "LayoutGrid", sheet?.kind === "library", libraryMenu, () => setSheet(sheet?.kind === "library" ? null : { kind: "library" }))}
          {item("windows", "Windows", "AppWindow", sheet?.kind === "windows", windowsMenu, () => setSheet(sheet?.kind === "windows" ? null : { kind: "windows" }), openWindows || undefined)}
          <span className="lsn-orb-slot" aria-hidden />
          {item("search", "Search", "Search", false, searchMenu, () => {
            setSheet(null);
            openCommandPalette();
          })}
          {item("worlds", "Worlds", "Layers", sheet?.kind === "worlds" || state.activeScene === "genesisv2", worldsMenu, () => setSheet(sheet?.kind === "worlds" ? null : { kind: "worlds" }))}
          {item("settings", "Settings", "Settings", state.activePanel === "settings", settingsMenu, () => {
            setSheet(null);
            openPanel("settings");
          })}
        </div>

        <div className="lsn-orb-slot lsn-orb-holder">
          <CircularControl
            label={home.immersive ? "Back to the workspace (hold for LÉLU actions)" : "Look at the Cosmos (hold for LÉLU actions)"}
            icon={<span className="lsn-orb-core" />}
            size={78}
            menu={orbMenu}
            active={home.immersive || voice.state.active}
            className="lsn-orb-control"
            testId="lsn-orb"
            onPress={() => {
              if (!atHome) {
                goHome(genesis);
                HomeStore.setImmersive(true);
                return;
              }
              HomeStore.setImmersive(!home.immersive);
            }}
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
