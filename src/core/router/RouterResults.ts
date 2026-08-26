/**
 * ==========================================================
 * LÉLU
 * ROUTER RESULTS
 * ==========================================================
 */

import type {
  AIResponse,
} from "../../providers/AIProvider";

import type {
  KnowledgeResult,
} from "../../providers/Provider";

export interface BrainResult {

  handled:
    boolean;

  response?:
    AIResponse;

}

export interface ResearchResult {

  handled:
    boolean;

  results:
    KnowledgeResult[];

  /** Every provider actually attempted for this request, with the
   *  error/outcome when it produced nothing — honest failure detail
   *  surfaced to the response instead of silently swallowed. */
  attempted?:
    Array<{ provider: string; error?: string }>;

}

export interface ProviderResult {

  handled:
    boolean;

  response?:
    AIResponse;

}