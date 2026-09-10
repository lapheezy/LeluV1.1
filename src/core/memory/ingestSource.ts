/**
 * ==========================================================
 * LÉLU — INGESTION ENTRY POINT
 *
 * The pipeline is deliberately pure: it takes an analyst
 * function and returns candidates, so it can be tested without
 * a model and without a store. This is the wiring that makes it
 * real — the analyst is v1.1's own provider chain, and the
 * candidates go to MemoryOrchestrator, which is where
 * deduplication and merging already live.
 *
 * Nothing writes memory directly here, for the same reason as
 * everywhere else in this integration: MemoryEngine already
 * owns that, and a second writer is a second memory system.
 * ==========================================================
 */

import AIService from "../AIService";
import { ingest, type IngestionResult } from "./IngestionPipeline";
import MemoryOrchestrator from "./MemoryProvider";

export interface IngestOutcome extends IngestionResult {
  /** Providers that accepted the candidates, for honest UI reporting (§12). */
  persistedTo: string[];
}

/**
 * Read something, keep the part worth keeping.
 *
 * Returns what actually happened rather than throwing: a source that cannot be
 * reached is an answer ("I couldn't read that"), not an exception for a chat
 * surface to catch.
 */
export async function ingestSource(input: string): Promise<IngestOutcome> {
  const ai = AIService.getInstance();

  const result = await ingest(input, async (prompt) => {
    // The extraction pass goes through the ordinary chat runtime, so it
    // inherits the provider fallback chain: if Groq is down the extraction
    // still happens on the next provider rather than the ingestion failing.
    const response = await ai.chat(prompt);
    return response?.text ?? "";
  });

  if (result.candidates.length === 0) {
    return { ...result, persistedTo: [] };
  }

  const orchestrator = MemoryOrchestrator.getInstance();
  const accepted = new Set<string>();

  for (const candidate of result.candidates) {
    const { accepted: took } = await orchestrator.persist(candidate);
    took.forEach((id) => accepted.add(id));
  }

  return { ...result, persistedTo: [...accepted] };
}

export default ingestSource;
