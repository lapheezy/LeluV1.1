/**
 * ==========================================================
 * LÉLU — COSMOS OBJECTS DOCK
 *
 * The way in and the way out.
 *
 * Mission 16 could put objects in the Cosmos but there was no honest door:
 * the conversation covered the scene, and nothing on screen said the objects
 * were behind it. This dock is that door, and it is also the small set of
 * camera controls once you are inside:
 *
 *   not in the Cosmos   "✦ Cosmos · N" — closes the conversation over the
 *                       scene (it is remembered, not lost), goes home, hides
 *                       the dashboard, and frames the objects
 *   in the Cosmos       "Back", frame all / focus / home / previous, undo and
 *                       redo, and the object count
 *
 * It never toggles the Cosmos by accident: entering and leaving are explicit
 * buttons, and the object controls live inside the scene, not here.
 * ==========================================================
 */

import { useEffect, useRef, useState } from "react";
import { useGenesis } from "../GenesisCore";
import HomeStore from "../home/homeStore";
import { useHomeStore } from "../home/useHomeLive";
import { goHome } from "../home/homeActions";
import CosmosObjectStore from "../../../../core/cosmos/objects/CosmosObjectStore";
import type { CosmosObjectState } from "../../../../core/cosmos/objects/CosmosObjectTypes";
import { cosmosCameraBus, cosmosViewBus, type CosmosCameraMode } from "../../../../core/cosmos/objects/CosmosObjectCamera";
import { isUniverseOpen, setUniverseOpen } from "../chat/universe/universeOpen";

const chip = (label: string, onClick: () => void, opts?: { title?: string; primary?: boolean; disabled?: boolean; testId?: string }) => (
  <button
    key={label}
    type="button"
    data-testid={opts?.testId}
    title={opts?.title ?? label}
    disabled={opts?.disabled}
    onClick={onClick}
    style={{
      pointerEvents: "auto",
      border: `1px solid ${opts?.primary ? "rgba(185,140,255,0.75)" : "rgba(185,140,255,0.4)"}`,
      background: opts?.primary ? "rgba(96,58,168,0.92)" : "rgba(12,8,24,0.88)",
      color: opts?.disabled ? "rgba(244,240,255,0.4)" : "#f4f0ff",
      font: "600 11px/1.5 system-ui, sans-serif",
      borderRadius: 999,
      padding: "6px 11px",
      minHeight: 30,
      whiteSpace: "nowrap",
      cursor: opts?.disabled ? "default" : "pointer",
      backdropFilter: "blur(6px)",
    }}
  >
    {label}
  </button>
);

export default function CosmosObjectsDock() {
  const genesis = useGenesis();
  const home = useHomeStore();
  const store = CosmosObjectStore.getInstance();
  const [state, setState] = useState<CosmosObjectState>(() => store.getState());
  const wasOpen = useRef(false);

  useEffect(() => store.subscribe(setState), [store]);

  /** Enter the Cosmos with the objects in view, keeping the conversation. */
  const enter = (frame = true) => {
    // The conversation is not destroyed: the Universe's open chats live in
    // HomeStore, the chat runtimes are singletons, and leaving the Cosmos
    // puts the Universe back exactly as it was.
    wasOpen.current = isUniverseOpen();
    goHome(genesis);
    setUniverseOpen(false);
    HomeStore.setImmersive(true);
    if (!frame) return;
    // The Cosmos layer is lazy: ask for the framing until the scene's camera
    // bridge is actually listening, rather than firing into nothing.
    let tries = 0;
    const ask = () => {
      tries += 1;
      if (cosmosCameraBus.live) {
        cosmosCameraBus.request({ mode: "all", because: "enter" });
        return;
      }
      if (tries < 16) window.setTimeout(ask, 250);
    };
    window.setTimeout(ask, 200);
  };

  /** Leave the Cosmos and put the workspace back. */
  const leave = () => {
    HomeStore.setImmersive(false);
    if (wasOpen.current) setUniverseOpen(true);
  };

  useEffect(
    () =>
      cosmosViewBus.subscribe((request) => {
        if (request.mode === "open") enter(request.frame !== false);
        else leave();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [genesis],
  );

  // Nothing to do for an empty Cosmos that the user is not standing in.
  if (!home.immersive && state.objects.length === 0) return null;

  const visible = state.objects.filter((o) => o.visible && (o.place === "cosmos" || o.place === "gallery"));
  const selectedName = state.selected ? store.get(state.selected)?.name ?? "" : "";
  const camera = (mode: CosmosCameraMode, object?: string) => cosmosCameraBus.request({ mode, object, because: "dock" });

  return (
    <div
      data-testid="lelu-cosmos-dock"
      data-immersive={home.immersive ? "true" : "false"}
      style={{
        position: "fixed",
        zIndex: 58,
        left: 10,
        right: 10,
        top: home.immersive ? 8 : "auto",
        bottom: home.immersive ? "auto" : 126,
        display: "flex",
        gap: 6,
        alignItems: "center",
        flexWrap: "wrap",
        pointerEvents: "none",
      }}
    >
      {home.immersive ? (
        <>
          {chip("‹ Back", leave, { title: "Back to the workspace", testId: "cosmos-dock-back" })}
          {chip(`${visible.length} object${visible.length === 1 ? "" : "s"}`, () => camera("all"), { primary: true, title: "Frame all the objects", testId: "cosmos-dock-count" })}
          {chip("Focus", () => camera("selected"), { title: selectedName ? `Frame “${selectedName}”` : "Select an object first", disabled: !state.selected, testId: "cosmos-dock-focus" })}
          {chip("Home", () => camera("home"), { title: "Back to the default Cosmos view" })}
          {chip("Prev", () => camera("previous"), { title: "Return to the previous camera position" })}
          {chip("Undo", () => store.undo(), { title: "Take back the last change", disabled: !state.canUndo })}
          {chip("Redo", () => store.redo(), { title: "Put the change back", disabled: !state.canRedo })}
        </>
      ) : (
        chip(
          `✦ Cosmos · ${state.objects.length}`,
          () => enter(true),
          { primary: true, title: "Look at your objects in the Cosmos (the conversation is kept)", testId: "cosmos-dock-enter" },
        )
      )}
    </div>
  );
}
