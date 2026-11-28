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
import { CircularControl, type RadialMenuDefinition, type RadialMenuItemSpec } from "../../../../core/interaction";
import { HomeIcon } from "../home/CosmosHome";

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

  /*
   * Seven rectangular camera chips became one circular control and its
   * radial menu. Every action is still here, with the same disabled
   * rules; the Cosmos simply gives the scene back its screen instead of
   * laying a toolbar across it.
   */
  const items: RadialMenuItemSpec[] = home.immersive
    ? [
        { id: "back", label: "Back", icon: <HomeIcon name="ChevronLeft" size={20} />, testId: "cosmos-dock-back", onSelect: leave },
        { id: "frame", label: `${visible.length} object${visible.length === 1 ? "" : "s"}`, icon: <HomeIcon name="Orbit" size={20} />, testId: "cosmos-dock-count", onSelect: () => camera("all") },
        {
          id: "focus",
          label: "Focus",
          icon: <HomeIcon name="Focus" size={20} />,
          hint: selectedName,
          disabled: !state.selected,
          testId: "cosmos-dock-focus",
          onSelect: () => camera("selected"),
        },
        { id: "home", label: "Home view", icon: <HomeIcon name="Home" size={20} />, onSelect: () => camera("home") },
        { id: "previous", label: "Previous", icon: <HomeIcon name="RotateCcw" size={20} />, onSelect: () => camera("previous") },
        { id: "undo", label: "Undo", icon: <HomeIcon name="Undo2" size={20} />, disabled: !state.canUndo, onSelect: () => store.undo() },
        { id: "redo", label: "Redo", icon: <HomeIcon name="Redo2" size={20} />, disabled: !state.canRedo, onSelect: () => store.redo() },
      ]
    : [
        { id: "enter", label: `Cosmos · ${state.objects.length}`, icon: <HomeIcon name="Orbit" size={20} />, testId: "cosmos-dock-enter", onSelect: () => enter(true) },
        { id: "enter-framed", label: "Frame the objects", icon: <HomeIcon name="Focus" size={20} />, onSelect: () => enter(true) },
      ];

  const menu: RadialMenuDefinition = {
    id: "cosmos-dock",
    label: home.immersive ? `${visible.length} object${visible.length === 1 ? "" : "s"}` : "Cosmos",
    items,
  };

  return (
    <div
      data-testid="lelu-cosmos-dock"
      data-immersive={home.immersive ? "true" : "false"}
      style={{
        position: "fixed",
        zIndex: 58,
        left: 10,
        top: home.immersive ? 8 : "auto",
        bottom: home.immersive ? "auto" : 126,
        pointerEvents: "none",
      }}
    >
      <CircularControl
        label={home.immersive ? "Cosmos controls — hold for camera actions" : `Look at the Cosmos (${state.objects.length} objects)`}
        icon={<HomeIcon name={home.immersive ? "Compass" : "Orbit"} size={21} />}
        size={44}
        tone="accent"
        menu={menu}
        onPress={home.immersive ? undefined : () => enter(true)}
        testId="cosmos-dock"
      />
    </div>
  );
}
