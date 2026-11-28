/** What exists in LÉLU right now, for checking reference relations. */
import { allFamilies } from "../worlds/ThemeFamilies";
import { PLACES } from "../worlds/Places";
import { LAYER_KINDS } from "../worlds/WorldSchema";
import type { KnownTargets } from "./ReferenceRegistry";

export function knownTargets(): KnownTargets {
  return {
    families: allFamilies().map((f) => f.id),
    layerKinds: Object.values(LAYER_KINDS).flat() as string[],
    places: PLACES.flatMap((p) => [p.id, ...p.eras.map((e) => `${p.id}:${e.id}`)]),
    features: ["neural-map-connectome", "thread-workspace", "couture-techpack"],
  };
}
