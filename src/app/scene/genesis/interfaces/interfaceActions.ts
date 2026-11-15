/**
 * ==========================================================
 * LÉLU — OPENING AN INTERFACE (Mission 17)
 *
 * The one place that turns "open this interface" into the existing
 * mechanisms that already own the screen — no new navigation:
 *
 *   cosmos        goHome + HomeStore.setImmersive  (the Cosmos itself)
 *   lelu-room     GenesisCore.openPanel("genesisv2")
 *   lelu-system   VisualEngine.setInterfaceFocus("visual")
 *   og-*          react-router navigate (same SPA, same runtime)
 *
 * Opening one interface alone first closes any open composition, so
 * exactly one scene owns the viewport, as before.
 * ==========================================================
 */

import type { GenesisContextValue, GenesisPanel } from "../GenesisCore";
import VisualEngine from "../../../../core/visual/VisualEngine";
import InterfaceCompositionStore from "../../../../core/interface/InterfaceCompositionStore";
import { interfaceById, type InterfaceId } from "../../../../core/interface/InterfaceCatalog";
import { goHome } from "../home/homeActions";
import HomeStore from "../home/homeStore";

type Genesis = Pick<GenesisContextValue, "state" | "openPanel" | "setModulePresentation" | "moveModule" | "resizeModule">;

/** Leave whatever scene owns the screen and stand at the Cosmos. */
export function toCosmos(genesis: Genesis): void {
  const visual = VisualEngine.getInstance();
  if (visual.getState().interfaceFocus === "visual") visual.setInterfaceFocus("genesis");
  if (genesis.state.activeScene === "genesisv2") genesis.openPanel("none" as GenesisPanel);
}

export function openInterface(genesis: Genesis, id: InterfaceId, navigate: (to: string) => void): { ok: boolean; detail: string } {
  const entry = interfaceById(id);
  if (!entry) return { ok: false, detail: `No interface "${id}".` };
  InterfaceCompositionStore.close();
  if (entry.standalone.kind === "route") {
    navigate(entry.standalone.path);
    return { ok: true, detail: `Opened ${entry.name} on its own (${entry.standalone.path}).` };
  }
  switch (entry.standalone.scene) {
    case "cosmos":
      toCosmos(genesis);
      goHome(genesis);
      HomeStore.setImmersive(true);
      break;
    case "room":
      VisualEngine.getInstance().setInterfaceFocus("genesis");
      genesis.openPanel("genesisv2" as GenesisPanel);
      break;
    case "system":
      if (genesis.state.activeScene === "genesisv2") genesis.openPanel("none" as GenesisPanel);
      VisualEngine.getInstance().setInterfaceFocus("visual");
      break;
  }
  return { ok: true, detail: `Opened ${entry.name}.` };
}

/** Open a composition as one continuous interface over the Cosmos. */
export function openComposition(genesis: Genesis, id: string, regionKey?: string): { ok: boolean; detail: string } {
  const c = InterfaceCompositionStore.get(id);
  if (!c) return { ok: false, detail: `No composition "${id}".` };
  // The composition's regions ARE the scenes now; the router must not also
  // mount the Room or the System underneath it.
  toCosmos(genesis);
  HomeStore.setImmersive(true);
  InterfaceCompositionStore.open(id, regionKey);
  return { ok: true, detail: `Opened “${c.name}”: ${c.regions.length} interfaces in one continuous view.` };
}

export function closeComposition(): { ok: boolean; detail: string } {
  const open = InterfaceCompositionStore.getState().open;
  InterfaceCompositionStore.close();
  return { ok: true, detail: open ? "Closed the composition; back in the Cosmos." : "No composition was open." };
}
