/**
 * ==========================================================
 * LÉLUVERSE
 * CORE MORPHOLOGY — THE ONE CORE'S TRANSFORMATION DIMENSIONS
 *
 * The single source of truth for the Genesis Core's two
 * transformation dimensions. This module is consumed by BOTH
 * the EngineBus (which drives the real 3D core every frame)
 * and the Genesis v2 Transformation Lab (which previews and
 * requests morphs), so the lab can never drift from what the
 * Core actually renders.
 *
 *   ENVIRONMENT — the EXTERNAL form of the ONE Core. The
 *   EngineBus walks the Core through these seven morphologies
 *   (HAZARD → AURORA → OCEAN → PLASMA → ELECTRIC → BIOHAZARD
 *   → HYBRID). Each is a weight profile over the same six
 *   engine channels, so the Core morphs — it is never replaced
 *   by another sphere.
 *
 *   MORPHOLOGY (internal system) — the INTERNAL mode of the
 *   ONE Core, shown in UI 2 (Heartbeat / Matrix / Nerve /
 *   Neuron / Core). These map directly to VisualEngine modes.
 *
 * The two dimensions compose freely: Environment = PLASMA with
 * Morphology = NERVE means a plasma-colored Core whose internal
 * system visualization shows nerve pathways.
 * ==========================================================
 */

import { Color } from "three";

import type { EngineWeights } from "../engines/EngineBus";
import {
  blendCoreStateColorInto,
  deriveCoreStateWeights,
} from "../materials/GenesisCoreMaterial";

/* ----------------------- environment morphologies ---------------------- */

export const MORPH_ORDER = [
  "HAZARD",
  "AURORA",
  "OCEAN",
  "PLASMA",
  "ELECTRIC",
  "BIOHAZARD",
  "HYBRID",
] as const;

export type MorphName = (typeof MORPH_ORDER)[number];

/**
 * Each named morphology's target weight profile over the shared six
 * engine channels. Morphologies are the EXTERNAL form; every profile is
 * expressed through the same channels so the Core is one body.
 */
export const MORPH_PROFILES: Record<MorphName, EngineWeights> = {
  // HAZARD — unstable storm: electric filaments + plasma heat.
  HAZARD: { ocean: 0.05, plasma: 0.55, electric: 0.9, crystal: 0.1, halo: 0.1, bio: 0.08 },
  // AURORA — flowing light veils: halo rim + crystal facets + ocean shimmer.
  AURORA: { ocean: 0.35, plasma: 0.08, electric: 0.12, crystal: 0.5, halo: 0.95, bio: 0.08 },
  // OCEAN — fluid aquatic: deep gradients + currents + caustics.
  OCEAN: { ocean: 0.95, plasma: 0.06, electric: 0.1, crystal: 0.15, halo: 0.12, bio: 0.08 },
  // PLASMA — hot luminous boil.
  PLASMA: { ocean: 0.06, plasma: 0.95, electric: 0.18, crystal: 0.08, halo: 0.1, bio: 0.06 },
  // ELECTRIC — branching energy pathways + sparks.
  ELECTRIC: { ocean: 0.06, plasma: 0.16, electric: 0.95, crystal: 0.22, halo: 0.08, bio: 0.06 },
  // BIOHAZARD — organic cellular membranes + green living filaments.
  BIOHAZARD: { ocean: 0.1, plasma: 0.08, electric: 0.14, crystal: 0.06, halo: 0.1, bio: 0.95 },
  // HYBRID — every system layered inside the one body at once.
  HYBRID: { ocean: 0.45, plasma: 0.45, electric: 0.45, crystal: 0.4, halo: 0.45, bio: 0.45 },
};

export const MORPH_DESCRIPTIONS: Record<MorphName, string> = {
  HAZARD: "Unstable storm — electric filaments + plasma heat",
  AURORA: "Flowing light veils — halo rim + crystal facets",
  OCEAN: "Fluid aquatic — deep currents + caustics",
  PLASMA: "Hot luminous boil — traveling energy cells",
  ELECTRIC: "Branching energy pathways + sparks",
  BIOHAZARD: "Organic cellular membranes + living filaments",
  HYBRID: "Every system layered inside the one body",
};

/** UI accent per environment morphology (label + preview tint). */
export const MORPH_ACCENTS: Record<MorphName, string> = {
  HAZARD: "#f87171",
  AURORA: "#c4b5fd",
  OCEAN: "#38bdf8",
  PLASMA: "#fb923c",
  ELECTRIC: "#7dd3fc",
  BIOHAZARD: "#4ade80",
  HYBRID: "#e9d5ff",
};

/* ------------------------ internal system modes ------------------------ */

export interface CoreSystemMode {
  id: string;
  label: string;
  description: string;
  accent: string;
}

/**
 * The internal system dimension of the ONE Core — exactly the modes
 * UI 2 renders (VisualEngine VisualMode ids). Environment decides the
 * Core's external form; morphology decides what the Core is doing
 * internally.
 */
export const CORE_SYSTEMS: CoreSystemMode[] = [
  { id: "core", label: "Core", description: "Conversational core", accent: "#67e8f9" },
  { id: "heartbeat", label: "Heartbeat", description: "Living system pulse", accent: "#34d399" },
  { id: "matrix", label: "Matrix", description: "Computational lattice", accent: "#38bdf8" },
  { id: "nerve", label: "Nerve", description: "Signal propagation", accent: "#a78bfa" },
  { id: "neuron", label: "Neuron", description: "Cognition network", accent: "#f472b6" },
];

/* ---------------------------- shared helpers --------------------------- */

/**
 * The ONE authoritative state color for a morphology — the same
 * derivation the EngineBus/CoreVisualState uses for the live core, so a
 * lab preview of a NOT-YET-APPLIED target is genuinely what the Core
 * will look like in that form, not a fabricated image.
 */
export function morphStateColor(
  name: MorphName,
  inputs?: { life?: number; mutation?: number; emergence?: number },
): string {
  const weights = deriveCoreStateWeights(MORPH_PROFILES[name], {
    life: inputs?.life ?? 0.5,
    mutation: inputs?.mutation ?? 0.3,
    emergence: inputs?.emergence ?? 0.4,
  });
  const color = new Color();
  blendCoreStateColorInto(color, weights);
  return color.getStyle();
}

/** Convenience: is `name` one of the seven environment morphologies? */
export function isMorphName(name: string | null | undefined): name is MorphName {
  return Boolean(name && (MORPH_ORDER as readonly string[]).includes(name));
}
