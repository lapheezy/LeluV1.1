/**
 * ==========================================================
 * LÉLU
 * ROUTER CONTEXT
 * ==========================================================
 */

import type Brain
  from "../../brain/Brain";

import type ProviderRegistry
  from "../ProviderRegistry";

import type AIProviderRegistry
  from "../AIProviderRegistry";

import type ExecutionLogger
  from "../ExecutionLogger";

import type {
  AIRequest,
} from "../../providers/AIProvider";

import type ResponsePattern
  from "../../brain/ResponsePattern";

import type {
  KnowledgeResult,
} from "../../providers/Provider";

import type {
  ReasoningResult,
} from "../reasoning/ReasoningEngine";

import type {
  Plan,
} from "../planning/PlanningEngine";

import type {
  CapabilityStatus,
  CapabilityResult,
} from "../native/NativeCapability";

export default interface RouterContext {

  /**
   * Incoming request.
   */
  request:
    AIRequest;

  /**
   * Processing start time.
   */
  started:
    number;

  /**
   * Memory brain.
   */
  brain:
    Brain;

  /**
   * Knowledge providers.
   */
  knowledgeProviders:
    ProviderRegistry;

  /**
   * AI providers.
   */
  aiProviders:
    AIProviderRegistry;

  /**
   * Runtime logger.
   */
  logger:
    ExecutionLogger;

  /**
   * Memories recalled by BrainResolver
   * for this request, whether or not
   * they were confident enough to
   * answer from directly. Shared so
   * later stages (Planning, Reasoning)
   * don't re-query the brain.
   */
  recalledMemories?:
    ResponsePattern[];

  /**
   * Selected reasoning strategy for
   * this request, set by ReasoningResolver.
   */
  reasoning?:
    ReasoningResult;

  /**
   * Task plan for this request, set by
   * PlanningResolver when the prompt
   * looks multi-step.
   */
  plan?:
    Plan;



  /**
   * Knowledge results retrieved by ResearchResolver
   * for this request, whether or not a provider
   * generated the final answer.
   */
  researchResults?:
    KnowledgeResult[];



  /**
   * Runtime diagnostics gathered by EngineeringResolver
   * when the request is an engineering task.
   */
  engineering?:
  {
    snapshot: string;
    findings: string[];
    timestamp: number;
  };



  /**
   * Device/native capability state + last tool result, gathered
   * by ToolResolver when the request is a device capability
   * action. Always reflects REAL detected state — never a claim.
   */
  native?:
  {
    /** True when running inside a future native WKWebView shell. */
    connected: boolean;
    statuses: CapabilityStatus[];
    lastResult?: {
      capability: string;
      result: CapabilityResult;
    };
  };

}