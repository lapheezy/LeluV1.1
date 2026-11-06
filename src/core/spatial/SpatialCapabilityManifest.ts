/**
 * ==========================================================
 * LÉLU — SPATIAL CAPABILITY MANIFEST
 *
 * Registers the spatial tiers in the EXISTING CapabilityManifest,
 * so cognition's self-model knows what LÉLU can do right now —
 * and, just as importantly, what she cannot.
 *
 * Tiers 1–3 are registered as available because appliers exist.
 * Tiers 4–5 are `not_configured`: the guard enforces them, but
 * this build ships no applier and no granted tier, so claiming
 * them would be exactly the kind of invented capability the
 * project forbids.
 * ==========================================================
 */

import CapabilityManifest, {
  type CapabilityStatus,
} from "../capabilities/CapabilityManifest";

let registered = false;

const ROWS: ReadonlyArray<{
  id: string;
  name: string;
  status: CapabilityStatus;
  description: string;
}> = [
  {
    id: "spatial-observe",
    name: "Spatial Observation",
    status: "available",
    description: "Tier 1 — list, inspect and describe the live 3D scene without changing it.",
  },
  {
    id: "spatial-manipulate",
    name: "Spatial Manipulation",
    status: "available",
    description:
      "Tier 2 — move, rotate, resize, hide or recolour existing objects; every change is reversible with undo.",
  },
  {
    id: "spatial-construct",
    name: "Spatial Construction",
    status: "available",
    description:
      "Tier 3 — create and connect objects. Deleting is destructive and requires the owner's explicit approval.",
  },
  {
    id: "spatial-orchestrate",
    name: "Spatial Orchestration",
    status: "not_configured",
    description:
      "Tier 4 — multi-step scene composition. Enforced by the tier guard; needs a granted tier and approval, neither of which ships in this phase.",
  },
  {
    id: "spatial-autonomous",
    name: "Autonomous Scene Commit",
    status: "not_configured",
    description:
      "Tier 5 — propose, preview, approve, commit. Enforced by the tier guard; no applier exists in this phase.",
  },
];

export function registerSpatialCapabilities(): void {
  if (registered) return;
  registered = true;
  const manifest = CapabilityManifest.getInstance();
  for (const row of ROWS) {
    manifest.register({
      id: row.id,
      name: row.name,
      category: "tools",
      description: row.description,
      status: row.status,
      providers: ["spatial-core"],
      lastSuccessful: null,
      lastChecked: Date.now(),
    });
  }
}

/** Test seam. */
export function resetSpatialCapabilityRegistration(): void {
  registered = false;
}
