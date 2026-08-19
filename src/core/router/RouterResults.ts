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

}

export interface ProviderResult {

  handled:
    boolean;

  response?:
    AIResponse;

}