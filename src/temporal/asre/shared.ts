/**
 * TEMPORAL STUDIO — ASRE — SMALL SHARED HELPERS
 *
 * Two things every ASRE module needs and none of them should re-implement:
 * an NRE observation record with explicit provenance, and a human-readable
 * labels table for the provenance vocabulary.
 */

import type { Observation } from "../nre/types.ts";
import { makeObservation } from "../nre/pipeline.ts";

export interface MeanObservationInput {
  id: string;
  sourceId: string;
  confidence: number;
  producer: string;
  note: string;
  capturedAt?: string;
  sequence?: number;
  parameters?: Record<string, string | number | boolean>;
}

/**
 * An observation whose confidence is the hypothesis's measured confidence.
 * ASRE never writes "1" here: a single view is never certain about depth,
 * and the number that reaches the container is the one the scoring produced.
 */
export function meanObservation(input: MeanObservationInput): Observation {
  return makeObservation({
    id: input.id,
    sequence: input.sequence ?? 1,
    sourceId: input.sourceId,
    sourceKind: "image",
    modality: "single-image",
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    confidence: Math.max(0, Math.min(1, input.confidence)),
    producer: input.producer,
    producerKind: "tool",
    licence: "n/a (produced by this engine)",
    inputs: [{ id: input.sourceId, sha256: null, note: input.note }],
    parameters: input.parameters ?? {},
    notes: [input.note],
  });
}

export const PROVENANCE_LABELS: Record<string, string> = {
  OBSERVED: "observed — the image supports this directly",
  INFERRED: "inferred — derived from observations by a stated rule",
  SYNTHESIZED: "synthesized — generated to fill information nothing observed",
  INTERPOLATED: "interpolated — generated between two known states",
};
