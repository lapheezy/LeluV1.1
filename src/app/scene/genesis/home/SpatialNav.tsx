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
import { goHome, restoreLayout } from "./homeActions";
import { useHomeStore } from "./useHomeLive";
import { LibrarySheet, WindowsSheet, WorldsSheet } from "./HomeSheets";
import { GROUPS } from "./homeCatalog";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CircularControl, interactionState, type RadialMenuDefinition, type RadialMenuItemSpec } from "../../../../core/interaction";
import { buildDialMenu, enterCosmos, openDestination, openUniverse } from "./dialMenu";
import { useVoice } from "../../../../core/voice/useVoice";

import "./spatialNav.css";

export type HomeSheet = { kind: "library"; group?: import("./homeCatalog").AppGroup } | { kind: "windows" } | { kind: "worlds" } | null;

export function openCommandPalette(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true, bubbles: true }));
}

export default function SpatialNav({
  sheet,
  setSheet,
  dialOnly = false,
  slotMode = false,
  onHoldVoice,
  selfExploration,
  onToggleSelfExploration,
}: {
  sheet: HomeSheet;
  setSheet: (sheet: HomeSheet) => void;
  /**
   * A conversation owns the phone screen. Its composer, microphone, send
   * control and keyboard occupy the bottom edge, so the dial is NOT drawn
   * there: it moves into the reserved slot the chat header keeps for it
   * (`data-lelu-nav-slot`), at the top of the screen, outside every control
   * the conversation needs.
   */
  slotMode?: boolean;
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
  /*
   * THE RESERVED SLOT the conversation keeps for the dial.
   *
   * When a conversation owns a phone screen, the bottom edge belongs to the
   * composer, the microphone and the keyboard. The chat header reserves a
   * 44 px slot for the one dial instead, so navigation stays one touch away
   * without being painted over an interaction control.
   */
  const [slotElement, setSlotElement] = useState<HTMLElement | null>(null);
  /*
   * A slot is only a slot while it is on screen.
   *
   * The chat header stays mounted while another surface owns the phone (the
   * Universe, a window), and a dial portalled into a hidden header would be
   * navigation that exists in the DOM and nowhere a finger can reach it. The
   * slot is watched, and the dial falls back to its collapsed corner when the
   * slot has no size.
   */
  const [slotHasRoom, setSlotHasRoom] = useState(false);
  useEffect(() => {
    if (!slotMode) {
      setSlotElement(null);
      setSlotHasRoom(false);
      return;
    }
    /* More than one surface can hold a slot; the TOP one is the screen. */
    const topSlot = () => {
      const slots = Array.from(document.querySelectorAll<HTMLElement>("[data-lelu-nav-slot]"))
        .filter((element) => element.getBoundingClientRect().width > 0);
      if (slots.length === 0) return null;
      const depth = (element: HTMLElement) => {
        const owner = element.closest("[data-lelu-module-window]") ?? element;
        const value = Number.parseInt(getComputedStyle(owner).zIndex, 10);
        return Number.isFinite(value) ? value : 0;
      };
      return slots.reduce((best, candidate) => (depth(candidate) >= depth(best) ? candidate : best));
    };
    /*
     * Windows open, close and change order while the conversation stays on
     * screen, so the slot is re-read — never bound once. A dial that is
     * already open keeps its anchor: the ring is not closed by the field
     * changing underneath it.
     */
    const tick = () => {
      if (document.querySelector('[data-lelu-radial-menu="environment-radial"]')) return;
      const element = topSlot();
      if (!element) return;
      setSlotHasRoom(element.getBoundingClientRect().width > 0);
      setSlotElement((current) => (current === element ? current : element));
    };
    tick();
    const timer = window.setInterval(tick, 400);
    return () => window.clearInterval(timer);
  }, [slotMode]);
  /*
   * One dial, always — and never two.
   *
   * Some chat-owned screens already carry the dial's own trigger in their
   * header (the Chat Universe's navigation control opens THIS ring). In that
   * case the bar stays out of the way instead of floating a second copy of
   * the same control over the composer.
   */
  const [dialAlreadyOnScreen, setDialAlreadyOnScreen] = useState(false);
  useEffect(() => {
    if (!slotMode) {
      setDialAlreadyOnScreen(false);
      return;
    }
    const check = () => {
      const anchors = Array.from(document.querySelectorAll('[data-lelu-menu-anchor="environment-radial"]'))
        .filter((element) => !element.closest(".lsn"));
      setDialAlreadyOnScreen(anchors.some((element) => element.getBoundingClientRect().width > 0));
    };
    check();
    const timer = window.setInterval(check, 400);
    return () => window.clearInterval(timer);
  }, [slotMode]);

  const ringOpen = interaction?.kind === "radial" && interaction.id === "environment-radial";
  const openWindows = Object.entries(state.modules).filter(([id, m]) => id !== "chat" && m.presentation !== "closed").length;

  const openChat = () => openUniverse(genesis, () => setSheet(null));

  const openPanel = (id: GenesisPanel) => openDestination(genesis, id, () => setSheet(null));

  const enterCosmosScene = (immersive: boolean) => enterCosmos(genesis, immersive, () => setSheet(null));

  const icon = (name: string, size = 21) => <HomeIcon name={name} size={size} />;

  /* ---------------------------------------------------------------
   * The dial — ONE ring, built once, from the ONE destination registry.
   *
   * The bar, a phone conversation's reserved slot and the Chat Universe's
   * rail all call the same builder, so no surface can offer a destination
   * the others do not have, or open one differently.
   * ------------------------------------------------------------- */

  const dialMenu: RadialMenuDefinition = buildDialMenu({
    genesis,
    home,
    voice,
    onHoldVoice,
    clearSheet: () => setSheet(null),
    sheetOpen: Boolean(sheet),
  });

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
      { id: "cosmos", label: "Cosmos", icon: icon("Orbit"), active: state.activeScene !== "genesisv2" && state.activePanel === "none", onSelect: () => enterCosmosScene(false) },
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

  /*
   * The conversation's screen: the dial lives in the chat's reserved slot, and
   * nothing else of the spatial bar is drawn. The ring itself is portalled by
   * RadialMenu, so it opens over the conversation without being clipped by
   * the header.
   */
  if (slotMode) {
    /*
     * No slot on screen yet (or a surface that owns the phone screen without
     * a chat header, such as the Universe) — the dial still exists: it is
     * drawn collapsed, bottom-right, exactly as it is anywhere else. The
     * navigation is never absent, and it is never painted over a control
     * that needs the same pixels.
     */
    if (!slotElement || !slotHasRoom) {
      if (dialAlreadyOnScreen) return null;
      return (
        <nav className="lsn" data-dial-only="true" data-browser="lelu-spatial-bar" aria-label="Spatial navigation">
          <div className="lsn-orb-slot lsn-orb-holder">
            <CircularControl
              label="Environments — every place in LÉLU"
              icon={<span className="lsn-orb-core" />}
              size={60}
              menu={dialMenu}
              active={home.immersive || voice.state.active}
              className="lsn-orb-control"
              testId="lsn-orb"
            />
          </div>
        </nav>
      );
    }
    return createPortal(
      <span className="lsn-slot" data-dial-slot="chat">
        <CircularControl
          label="Environments — every place in LÉLU"
          icon={<span className="lsn-orb-core" />}
          /* 36 px inside a 40 px title bar: the dial fits the slot exactly. */
          size={36}
          menu={dialMenu}
          active={home.immersive || voice.state.active}
          className="lsn-orb-control lsn-orb-control--slot"
          testId="lsn-orb"
        />
      </span>,
      slotElement,
    );
  }

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
