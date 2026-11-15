/**
 * ==========================================================
 * LÉLU — SPATIAL NAVIGATION
 *
 * The one navigation of the app, floating at the bottom of the Cosmos
 * (no side rail, no vertical menu list):
 *
 *   Home · Library · Windows · ◉ Cosmos · Search · Worlds · Settings
 *
 * The central orb is the Cosmos: tap to look at it (the home steps
 * aside), tap again to come back; press and hold to talk to LÉLU (the
 * same voice pipeline as the chat's mic).
 *
 * Library (the Infinite Library: interfaces, Legacy UIs, compositions
 * and apps) and Windows open sheets (HomeSheets); Search is the ⌘K
 * command palette; Worlds switches the scene (Cosmos, LÉLU's Room,
 * Earth). Every action goes through GenesisCore.
 * ==========================================================
 */

import { useRef, useState } from "react";
import { useGenesis } from "../GenesisCore";
import { HomeIcon } from "./CosmosHome";
import HomeStore from "./homeStore";
import { goHome, launch } from "./homeActions";
import { useHomeStore } from "./useHomeLive";
import { LibrarySheet, WindowsSheet, WorldsSheet } from "./HomeSheets";
import type { AppGroup } from "./homeCatalog";
import "./spatialNav.css";

export type HomeSheet = { kind: "library"; group?: AppGroup | "interfaces" } | { kind: "windows" } | { kind: "worlds" } | null;

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
  const atHome = state.activePanel === "none" && state.activeScene !== "genesisv2";
  const openWindows = Object.entries(state.modules).filter(([id, m]) => id !== "chat" && m.presentation !== "closed").length;

  // The orb: tap = look at the Cosmos / come back; hold = talk.
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean; x: number; y: number }>({ timer: null, fired: false, x: 0, y: 0 });
  const [holding, setHolding] = useState(false);
  const orbDown = (e: { clientX: number; clientY: number }) => {
    hold.current.fired = false;
    hold.current.x = e.clientX;
    hold.current.y = e.clientY;
    hold.current.timer = setTimeout(() => {
      hold.current.fired = true;
      setHolding(true);
      onHoldVoice();
    }, 450);
  };
  const orbUp = (e: { clientX: number; clientY: number }) => {
    if (hold.current.timer) clearTimeout(hold.current.timer);
    hold.current.timer = null;
    setHolding(false);
    if (hold.current.fired) return;
    // A swipe that merely started on the orb (scrolling the Home on a phone)
    // is not a tap: it must not flip the screen to the Cosmos. (Mission 15)
    if (Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 12) return;
    if (!atHome) {
      goHome(genesis);
      HomeStore.setImmersive(true);
      return;
    }
    HomeStore.setImmersive(!home.immersive);
  };

  const item = (key: string, label: string, icon: string, active: boolean, act: (el: HTMLElement) => void, badge?: number) => (
    <button key={key} type="button" className="lsn-item" data-active={active ? "true" : "false"} aria-label={label} title={label} onClick={(e) => act(e.currentTarget)}>
      <HomeIcon name={icon} size={24} />
      {badge ? <span className="lsn-badge">{badge}</span> : null}
    </button>
  );

  return (
    <>
      <nav className="lsn" data-hidden={hidden ? "true" : "false"} aria-label="Navigation" aria-hidden={hidden}>
        <div className="lsn-bar">
          {item("home", "Home", "Home", atHome && !home.immersive && !sheet, () => {
            setSheet(null);
            if (atHome) HomeStore.setImmersive(false);
            else goHome(genesis);
          })}
          {item("library", "Infinite Library", "LayoutGrid", sheet?.kind === "library", () => setSheet(sheet?.kind === "library" ? null : { kind: "library" }))}
          {item("windows", "Open windows", "AppWindow", sheet?.kind === "windows", () => setSheet(sheet?.kind === "windows" ? null : { kind: "windows" }), openWindows || undefined)}
          <span className="lsn-orb-slot" />
          {item("search", "Search (⌘K)", "Search", false, () => {
            setSheet(null);
            openCommandPalette();
          })}
          {item("worlds", "Worlds", "Layers", sheet?.kind === "worlds" || state.activeScene === "genesisv2", () => setSheet(sheet?.kind === "worlds" ? null : { kind: "worlds" }))}
          {item("settings", "Settings", "Settings", state.activePanel === "settings", (el) => {
            setSheet(null);
            launch(genesis, "settings", el);
          })}
        </div>
        <button
          type="button"
          className="lsn-orb"
          data-holding={holding ? "true" : "false"}
          data-immersive={home.immersive ? "true" : "false"}
          aria-label={home.immersive ? "Back to the workspace (hold to talk)" : "Look at the Cosmos (hold to talk to LÉLU)"}
          title="Tap: the Cosmos · Hold: talk to LÉLU"
          onPointerDown={orbDown}
          onPointerUp={orbUp}
          onPointerMove={(e) => {
            // A finger travelling off the orb is a swipe, not a hold: with
            // touch, pointerleave only fires on release, so cancel here.
            if (hold.current.timer && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 12) {
              clearTimeout(hold.current.timer);
              hold.current.timer = null;
            }
          }}
          onPointerLeave={() => {
            if (hold.current.timer) clearTimeout(hold.current.timer);
            hold.current.timer = null;
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span className="lsn-orb-core" />
        </button>
      </nav>

      {sheet?.kind === "library" ? <LibrarySheet group={sheet.group} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "windows" ? <WindowsSheet onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "worlds" ? (
        <WorldsSheet
          onClose={() => setSheet(null)}
          selfExploration={selfExploration}
          onToggleSelfExploration={onToggleSelfExploration}
          onOpenLibrary={() => setSheet({ kind: "library", group: "interfaces" })}
        />
      ) : null}
    </>
  );
}
