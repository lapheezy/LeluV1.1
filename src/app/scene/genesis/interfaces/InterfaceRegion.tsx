/**
 * ==========================================================
 * LÉLU — ONE INTERFACE, LIVE, INSIDE A REGION (Mission 17)
 *
 * Mounts the REAL implementation of a catalogued interface inside a
 * composition region. Nothing is re-implemented and nothing is a
 * screenshot:
 *
 *   lelu-room     GenesisLab               (Genesis V2, its own canvas)
 *   lelu-system   LivingSystemUI embedded  (all five modes)
 *   og-inner-sky  OgEmbedded entry="app"   (same OG route table)
 *   og-core       OgEmbedded entry="core"
 *   cosmos        nothing — the region is a clear window onto the ONE
 *                 Cosmos world the scene router already draws. A second
 *                 world would be a second renderer and a second state.
 *
 * Those interfaces were written as full-screen scenes (`position:
 * fixed; inset: 0`). The region body is a transformed, paint-contained
 * box, which makes it the containing block for its fixed descendants: the
 * interface fills its region exactly as it fills a screen, without a
 * line of it changing.
 * ==========================================================
 */

import { lazy, Suspense } from "react";
import { interfaceById, type InterfaceId } from "../../../../core/interface/InterfaceCatalog";
import GenesisErrorBoundary from "../GenesisErrorBoundary";

const GenesisLab = lazy(() => import("../GenesisLab"));
const LivingSystemUI = lazy(() => import("../LivingSystemUI"));
const OgEmbedded = lazy(() => import("../../../../og/OgRoutes").then((m) => ({ default: m.OgEmbedded })));

export function RegionLoading({ name }: { name: string }) {
  return (
    <div className="ij-loading" role="status">
      Opening {name}…
    </div>
  );
}

export default function InterfaceRegion({
  interfaceId,
  onLeave,
  onGo,
  exploringCosmos,
}: {
  interfaceId: InterfaceId;
  /** The interface's own "leave" control: back to the Cosmos. */
  onLeave: () => void;
  /** Move to another interface in the composition (e.g. System → Room). */
  onGo: (id: InterfaceId) => void;
  exploringCosmos: boolean;
}) {
  const entry = interfaceById(interfaceId)!;
  if (interfaceId === "cosmos") {
    return (
      <div className="ij-cosmos-window" data-exploring={exploringCosmos ? "true" : "false"} aria-label="The live Cosmos">
        {exploringCosmos ? null : <span className="ij-cosmos-caption">The live Cosmos — the same world, not a copy</span>}
      </div>
    );
  }
  return (
    <GenesisErrorBoundary>
      <Suspense fallback={<RegionLoading name={entry.name} />}>
        {interfaceId === "lelu-room" ? <GenesisLab onClose={onLeave} /> : null}
        {interfaceId === "lelu-system" ? <LivingSystemUI embedded={{ onExit: onLeave, onOpenRoom: () => onGo("lelu-room") }} /> : null}
        {interfaceId === "og-inner-sky" ? <OgEmbedded entry="app" /> : null}
        {interfaceId === "og-core" ? <OgEmbedded entry="core" /> : null}
      </Suspense>
    </GenesisErrorBoundary>
  );
}
