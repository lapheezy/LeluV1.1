/**
 * ==========================================================
 * LÉLU — SPATIAL CAPABILITY MANIFEST
 *
 * Registers the spatial capabilities in the EXISTING
 * CapabilityManifest, so cognition's self-model knows what LÉLU
 * can do right now — and, just as importantly, what she cannot.
 *
 * Phase 2.2 added real appliers for composition, the camera and
 * world discovery, so those rows are `available`. Tier 5 stays
 * `not_configured`: no operation in the table is Tier 5, no
 * applier exists, and the guard refuses it.
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
    id: "spatial-adapter",
    name: "World Discovery",
    status: "available",
    description:
      "Read-only adapter over authored objects, Cosmos entities, world destinations and live three.js nodes, with stable namespaced identity.",
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
      "Tier 3 — create and connect objects, and plan multi-object compositions. Deleting is destructive and requires the owner's explicit approval.",
  },
  {
    id: "spatial-orchestrate",
    name: "Scene Composition",
    status: "available",
    description:
      "Tier 4 — a prepared composition commits as ONE atomic revision after the owner's explicit approval, then is verified and rolled back if the renderer disagrees.",
  },
  {
    id: "spatial-camera",
    name: "Camera Control",
    status: "available",
    description:
      "Tier 2 — geometry-aware focus, multi-object framing, orbit, zoom and reset driven through the existing Genesis camera rig.",
  },
  {
    id: "spatial-verification",
    name: "Spatial Verification",
    status: "available",
    description:
      "Graph, live-renderer, camera and framing layers verified independently; screenshots are reported as not captured by the core rather than claimed.",
  },
  {
    id: "spatial-autonomous",
    name: "Autonomous Scene Commit",
    status: "not_configured",
    description:
      "Tier 5 — propose, preview, approve, commit without an owner in the loop. Enforced by the tier guard; no operation and no applier exist in this phase.",
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
