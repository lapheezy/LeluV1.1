/**
 * ==========================================================
 * LÉLU
 * BRAIN RESOLVER
 *
 * Memory is cognitive context, NOT response text. This stage
 * retrieves relevant memories for the request and passes them
 * forward (MemoryBridge has already evaluated and synthesized
 * them into the request context). It only answers directly in
 * two cases:
 *
 *   1. Deterministic identity/profile questions ("who are you",
 *      "who am I") — answered from persistent local storage,
 *      online or offline.
 *   2. Offline memory queries — when no AI provider is reachable
 *      and the user asks about something we have stored, the
 *      most relevant memories are synthesized into a natural
 *      answer instead of a provider's generic offline notice.
 *
 * When a provider IS available, retrieved memories are passed
 * to cognition as context and the provider reasons over them —
 * the memory informs the answer without dominating it.
 * ==========================================================
 */

import type { AIResponse } from "../../providers/AIProvider";
import type RouterContext from "./RouterContext";
import type { BrainResult } from "./RouterResults";
import AgentEventBus from "../agent/AgentEvents";
import { isIdentityOrProfileQuestion } from "../../brain/LeluIdentity";
import ExecutiveRuntime from "../executive/ExecutiveRuntime";

export default class BrainResolver {
  /**
   * Attempt to answer directly from memory.
   */
  public async execute(context: RouterContext): Promise<BrainResult> {
    const prompt = context.request.prompt;

    // CONSUME the canonical recall performed by MemoryBridge.enrich()
    // for this turn. Only fall back to our own recall when there was no
    // upstream enrich (a direct runtime.process() caller, e.g. a
    // "none"-memoryAccess agent) — so the brain is queried once per
    // turn, not once per interested stage.
    const memories = context.recalledMemories ?? await context.brain.recall(prompt);
    context.recalledMemories = memories;

    AgentEventBus.getInstance().emit({
      type: "memory_retrieval",
      taskId: String(context.request.timestamp ?? Date.now()),
      query: prompt,
      count: memories.length,
    });

    // 1. Deterministic identity/profile answers — always local,
    //    never dependent on an external API.
    if (isIdentityOrProfileQuestion(prompt)) {
      return this.localAnswer(context);
    }

    // 1b. Operational status questions ("what are you doing?") —
    //     answered deterministically from the Executive Runtime's
    //     MEASURED state, online or offline. The model never gets to
    //     guess what LÉLU is doing; telemetry decides.
    if (ExecutiveRuntime.isOperationalStatusQuestion(prompt)) {
      const response: AIResponse = {
        text: ExecutiveRuntime.getInstance().composeStatusAnswer(prompt),
        provider: "executive",
        model: "self-state",
        processingTime: Date.now() - context.started,
        metadata: { source: "ExecutiveRuntime", category: "status", confidence: 1 },
      };
      context.logger.info("BrainResolver", "Resolved operational status from measured self-state", {
        prompt,
      });
      return { handled: true, response };
    }

    const best = memories[0];

    if (!best) {
      return { handled: false };
    }

    const providersAvailable = (await this.providerAvailability(context)) > 0;

    // 2. Offline memory query: no provider reachable, but we have
    //    relevant stored knowledge — synthesize it into an answer.
    //    System memories (engineering state) are owned by the
    //    EngineeringResolver, which re-observes live state instead
    //    of answering from a stale snapshot.
    if (!providersAvailable && best.confidence >= 0.5 && best.memoryType !== "system") {
      return this.memoryAnswer(context, best);
    }

    // 3. Provider available (or memory not confident enough):
    //    hand off — the memory is already in the request context
    //    (MemoryBridge.synthesize) for the provider to reason over.
    context.logger.info(
      "BrainResolver",
      providersAvailable
        ? "Memories passed to cognition as context (provider will reason over them)."
        : "Memory confidence too low to answer from memory.",
      { prompt, memoryCount: memories.length },
    );

    return { handled: false };
  }

  private async providerAvailability(context: RouterContext): Promise<number> {
    try {
      const available = await context.aiProviders.available();
      return available.length;
    } catch (error) {
      context.logger.error(
        "BrainResolver",
        "Provider availability check failed; treating as offline.",
        { reason: error instanceof Error ? error.message : String(error) },
      );
      return 0;
    }
  }

  /**
   * Offline memory answer — synthesized, not an echo of a single
   * stored sentence.
   */
  private async memoryAnswer(context: RouterContext, best: any): Promise<BrainResult> {
    // Pass the memories already recalled for this turn — synthesis
    // only, no third query for the same prompt.
    const text = await context.brain.composeFromMemory(
      context.request.prompt,
      context.recalledMemories,
    );

    const response: AIResponse = {
      text,
      provider: "brain",
      model: "memory",
      processingTime: Date.now() - context.started,
      metadata: {
        source: "Brain",
        category: best.category,
        confidence: best.confidence,
        offline: true,
        memory: true,
      },
    };

    context.logger.info("BrainResolver", "Resolved offline from memory", {
      prompt: context.request.prompt,
    });

    return { handled: true, response };
  }

  /**
   * Compose a deterministic identity/profile answer from the
   * persistent local store.
   */
  private async localAnswer(context: RouterContext): Promise<BrainResult> {
    const text = await context.brain.compose(context.request.prompt);

    const response: AIResponse = {
      text,
      provider: "brain",
      model: "memory",
      processingTime: Date.now() - context.started,
      metadata: {
        source: "Brain",
        category: "identity",
        confidence: 1,
      },
    };

    context.logger.info(
      "BrainResolver",
      "Resolved identity from local storage",
      { prompt: context.request.prompt },
    );

    return { handled: true, response };
  }
}
