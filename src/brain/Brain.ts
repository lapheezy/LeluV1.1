/**
 * ==========================================================
 * LÉLU
 * BRAIN
 *
 * Memory + Reflection + Cognition Core
 * ==========================================================
 */

import PatternMemory
  from "./PatternMemory";

import MemoryEngine
  from "./MemoryEngine";

import OfflineComposer
  from "./OfflineComposer";

import ConfidenceEngine
  from "./ConfidenceEngine";

import ReflectionEngine
  from "./ReflectionEngine";

import ConversationEngine
  from "./ConversationEngine";

import CognitionRuntime
  from "./CognitionRuntime";

import MemorySynthesizer
  from "./MemorySynthesizer";

import {
  seedLeluIdentity,
} from "./LeluIdentity";

import CognitiveCore
  from "../core/cognition/CognitiveCore";

import CognitiveTrace
  from "../core/cognition/CognitiveTrace";

import ProjectStore
  from "../core/projects/ProjectStore";

import type ResponsePattern
  from "./ResponsePattern";

import type {
  MemoryScopeContext,
} from "../core/memory/MemorySovereignty";

import type {
  Reflection,
} from "./ReflectionEngine";

import type {
  ReasoningResult,
} from "../core/reasoning/ReasoningEngine";

import type {
  Plan,
} from "../core/planning/PlanningEngine";





export default class Brain {


  private readonly memory:
    PatternMemory;



  private readonly memoryEngine:
    MemoryEngine;



  private readonly composer:
    OfflineComposer;



  private readonly confidence:
    ConfidenceEngine;



  private readonly reflection:
    ReflectionEngine;



  private readonly conversation:
    ConversationEngine;



  private readonly cognition:
    CognitiveCore;



  private readonly cognitionRuntime:
    CognitionRuntime;



  private readonly synthesizer =
    new MemorySynthesizer();





  constructor() {


    this.memory =

      new PatternMemory();



    this.memoryEngine =

      new MemoryEngine(

        this.memory,

      );



    this.composer =

      new OfflineComposer(

        this.memory,

      );



    this.confidence =

      new ConfidenceEngine();



    this.reflection =

      new ReflectionEngine(

        this.memory,

      );



    this.cognition =

      new CognitiveCore();



    this.cognitionRuntime =

      new CognitionRuntime(

        this.cognition,

      );



    this.conversation =

      new ConversationEngine(

        this,

      );

  }





  /**
   * ==========================================================
   * Initialize
   * ==========================================================
   */
  public async initialize():

    Promise<void> {


    // Memory init must never take the runtime down with it: if
    // IndexedDB is unavailable (private mode, storage blocked),
    // the Brain still boots and providers still work — memory
    // operations inside a chat are individually guarded by the
    // caller's error handling.
    try {

      await this.memory.initialize();

      // LÉLU's foundational identity is a persistent local memory
      // record, seeded once and retrievable offline through the
      // normal recall path. It must never depend on an AI API.
      await seedLeluIdentity(this.memory);

    } catch (error) {

      console.error(
        "[Brain] Memory initialization failed; continuing without persistent memory.",
        error,
      );

    }



    this.cognition.initialize();

  }





  /**
   * ==========================================================
   * Learn
   * ==========================================================
   */
  public async learn(

    prompt:
      string,


    response:
      string,


    _intent =
      "general",


    _keywords:
      string[] = [],


    context:
      Record<string, unknown> = {},

  ):
    Promise<ResponsePattern | undefined> {


    const memories =

      await this.memoryEngine.learn(

        prompt,

        response,

        context,

      );





    // Observations belong to the conversation that produced them. The
    // cognitive graph used to take every turn's text with no origin, and
    // buildContext rendered the last five nodes on EVERY turn — so a loss
    // discussed in one chat appeared in another chat's context through
    // "Recent knowledge nodes", outside the memory pipeline entirely.
    const seed = (context.originSeed ?? {}) as { conversationId?: string | null };
    this.cognitionRuntime.observe(

      `${prompt}\n${response}`,

      seed.conversationId ?? undefined,

      // Linked to the durable memory, when one was written, so deleting that
      // memory also removes this observation (M22.1, WP06).
      memories[0]?.id,

    );





    if (

      memories.length > 0

    ) {


      return memories[0];

    }





    // Selective writing: nothing durable was stated. The statement
    // stays as session context in the ConversationEngine instead of
    // polluting long-term memory — Lélu's own replies or ordinary
    // conversational filler never become persistent user facts.

    return undefined;

  }

  /**
   * Delete one memory everywhere it can still be read: the store, and the
   * cognitive observation derived from it. There is no second index to keep
   * in step — this IS the one memory system (M22.1, WP06).
   */
  public async forgetMemory(id: string): Promise<{ removed: boolean; nodes: number; checkpoints: number }> {
    // Read the record first: after removal there is nothing left to find the
    // derived representations by. A project checkpoint can quote the same
    // statement (Orchestrator persisted the turn's request as work state),
    // and CognitiveContext re-injects checkpoints into later prompts — so a
    // deleted memory that only left the store was still reaching the model.
    const pattern = await this.memory.get(id);
    const removed = await this.memory.remove(id);
    const nodes = this.cognitionRuntime.forgetMemory(id);
    const scraps = [pattern?.prompt, pattern?.response]
      .flatMap((text) => (typeof text === "string" ? [text, ...text.split(/(?<=[.!?])\s+/)] : []))
      .map((text) => text.trim())
      .filter((text) => text.length >= 24);
    let checkpoints = 0;
    try {
      const projects = ProjectStore.getInstance();
      for (const scrap of new Set(scraps)) checkpoints += projects.forgetText(scrap);
    } catch (error) {
      console.warn("[Brain] checkpoint cleanup after memory deletion failed (contained)", error);
    }
    CognitiveTrace.getInstance().record("MEMORY_WRITE", `forgot memory ${id.slice(0, 8)}${removed ? "" : " (already absent)"}`, {
      removed,
      nodesRemoved: nodes,
      checkpointsChanged: checkpoints,
    });
    return { removed, nodes, checkpoints };
  }

  /**
   * Delete a conversation's material. Session memories and graph nodes go;
   * durable user facts stay, with their origin intact, because deleting a
   * chat is not a request to forget the user.
   */
  public async forgetConversation(
    conversationId: string,
    options: { keepPersistent?: boolean } = {},
  ): Promise<{ memories: number; nodes: number }> {
    const memories = await this.memory.forgetByConversation(conversationId, options);
    const nodes = this.cognitionRuntime.forgetConversation(conversationId);
    CognitiveTrace.getInstance().record("MEMORY_WRITE", `forgot conversation ${conversationId.slice(0, 8)}: ${memories} memory(ies), ${nodes} node(s)`, {
      conversationId,
      memories,
      nodes,
      keepPersistent: options.keepPersistent ?? true,
    });
    return { memories, nodes };
  }





  /**
   * ==========================================================
   * Recall
   * ==========================================================
   */
  /** Merge persisted cloud memories into the existing PatternMemory engine. */
  public async mergeMemories(patterns: ResponsePattern[]): Promise<void> {
    if (patterns.length === 0) {
      return;
    }
    await this.memory.mergeRemote(patterns);
  }



  /**
   * THE canonical long-term memory recall operation.
   *
   * Instrumented HERE rather than at any single call site so the
   * cognitive trace counts every real recall regardless of who asked
   * — which is what makes "exactly one recall per turn" provable
   * instead of merely asserted. `purpose` distinguishes the one
   * cognition recall that feeds the response from the deliberate
   * post-write profile sync that necessarily runs after new memory
   * has been written (see AIService.chat).
   */
  public async recall(

    prompt:
      string,

    purpose:
      string = "cognition",

    scope?:
      MemoryScopeContext,

  ):
    Promise<ResponsePattern[]> {


    const memories = await this.memoryEngine.recall(

      prompt,

      scope,

    );

    CognitiveTrace.getInstance().record(
      "MEMORY_RETRIEVAL",
      memories.length > 0
        ? `recalled ${memories.length} memory(ies) [${purpose}]: ${memories.slice(0, 3).map((m) => m.category).join(", ")}`
        : `no long-term memories matched this prompt [${purpose}]`,
      {
        purpose,
        count: memories.length,
        conversationId: scope?.conversationId ?? null,
        sessionId: scope?.sessionId ?? null,
        categories: memories.map((m) => m.category),
        topResponses: memories.slice(0, 3).map((m) => m.response.slice(0, 80)),
      },
    );

    return memories;

  }





  /**
   * ==========================================================
   * Recall all
   * ==========================================================
   */
  public async recallAll():

    Promise<ResponsePattern[]> {


    await this.memory.initialize();



    return this.memory.getAll();

  }





  /**
   * ==========================================================
   * Compose
   * ==========================================================
   */
  public async compose(

    prompt:
      string,

  ):
    Promise<string> {


    return await this.composer.compose(

      prompt,

    );

  }





  /**
   * ==========================================================
   * Compose from memory (offline)
   *
   * Synthesizes the most relevant stored facts into a natural
   * answer instead of echoing a single stored sentence. Used
   * by the router when no AI provider is reachable.
   * ==========================================================
   */
  public async composeFromMemory(

    prompt:
      string,

    /** Memories already recalled for THIS turn. Passing them makes this
     *  a pure synthesis step instead of a third redundant recall of the
     *  same prompt (BrainResolver always has them by this point). */
    preRecalled?:
      ResponsePattern[],

  ):
    Promise<string> {


    const memories =
      preRecalled ??
      await this.recall(
        prompt,
      );



    const answer =
      this.synthesizer.summarizeFacts(
        prompt,
        memories,
      );



    if (
      answer
    ) {


      return answer;

    }



    return await this.compose(
      prompt,
    );

  }



  /**
   * ==========================================================
   * Synthesized context
   *
   * Exposes the cognitive-context builder so the MemoryBridge
   * (and any other consumer) can evaluate memories instead of
   * dumping them raw.
   * ==========================================================
   */
  public synthesizeContext(
    prompt: string,
    memories: ResponsePattern[],
    options?: {
      deep?: boolean;
      maxMemories?: number;
      profile?: string;
      conversation?: {
        lastTopic?: string;
        recentMessages?: string[];
      };
      /** The conversation this context is for; labels memories from others. */
      conversationId?: string | null;
    },
  ) {
    return this.synthesizer.synthesize({
      prompt,
      memories,
      deep: options?.deep,
      maxMemories: options?.maxMemories,
      profile: options?.profile,
      conversation: options?.conversation,
      conversationId: options?.conversationId,
    });
  }



  /**
   * ==========================================================
   * Remember system knowledge
   *
   * Persists durable engineering/runtime knowledge (which module
   * owns a capability, provider configuration facts, diagnosed
   * issues) as a "system" memory through the ONE memory store.
   * ==========================================================
   */
  public async rememberSystem(
    summary: string,
    keywords: string[],
  ): Promise<void> {

    await this.persistLayer(
      summary,
      keywords,
      "system",
      "general",
      0.5,
    );

  }



  /**
   * ==========================================================
   * Remember knowledge
   *
   * Persists durable external knowledge (research findings) as
   * a "knowledge" memory so it can inform future cognition.
   * ==========================================================
   */
  public async rememberKnowledge(
    summary: string,
    keywords: string[],
  ): Promise<void> {

    await this.persistLayer(
      summary,
      keywords,
      "knowledge",
      "general",
      0.5,
    );

  }



  private async persistLayer(
    content: string,
    keywords: string[],
    memoryType: "system" | "knowledge",
    category: string,
    importance: number,
  ): Promise<void> {

    const existing =
      await this.memory.search(
        keywords.join(" ") || content,
      );



    const same =
      existing.find(
        pattern =>
          pattern.memoryType === memoryType &&
          pattern.category === category &&
          pattern.response === content,
      );



    if (
      same
    ) {

      return;

    }



    const now =
      Date.now();



    const pattern: ResponsePattern = {

      id:
        crypto.randomUUID(),


      category:
        category as ResponsePattern["category"],


      prompt:
        content.slice(0, 120),


      response:
        content,


      intent:
        memoryType,


      keywords,


      context:
      {

        source:
          memoryType === "system"
            ? "engineering"
            : "research",


        durable:
          true,

      },


      memoryType,


      importance,


      confidence:
        0.9,


      successfulUses:
        1,


      failedUses:
        0,


      createdAt:
        now,


      updatedAt:
        now,

    };



    await this.memory.add(
      pattern,
    );

  }





  /**
   * ==========================================================
   * Best memory
   * ==========================================================
   */
  public async best(

    prompt:
      string,

  ):
    Promise<ResponsePattern | undefined> {


    const patterns =

      await this.memory.search(

        prompt,

      );



    return this.confidence.best(

      patterns,

    );

  }





  /**
   * ==========================================================
   * Knows
   * ==========================================================
   */
  public async knows(

    prompt:
      string,

  ):
    Promise<boolean> {


    const memories =

      await this.memory.search(

        prompt,

      );



    return memories.length > 0;

  }





  /**
   * ==========================================================
   * Reflection
   * ==========================================================
   */
  public async reflect():

    Promise<Reflection> {


    return await this.reflection.reflect();

  }





  /**
   * ==========================================================
   * Conversation
   * ==========================================================
   */
  public getConversation():

    ConversationEngine {


    return this.conversation;

  }





  /**
   * ==========================================================
   * Cognition runtime
   * ==========================================================
   */
  public getCognitionRuntime():

    CognitionRuntime {


    return this.cognitionRuntime;

  }





  /**
   * ==========================================================
   * Cognition state
   * ==========================================================
   */
    public cognitiveState(

    conversationId?: string,

  ):

  {
    nodes: unknown[];


    connections:
      unknown[];


    agents:
      unknown[];


    workspaces:
      unknown[];


    reasoning:
      ReasoningResult | null;


    plan:
      Plan | null;

  } {


    return this.cognition.state(conversationId);

  }



  /**
   * ==========================================================
   * Record Reasoning/Planning output
   *
   * Called after a request completes so the Reasoning and
   * Planning stage output (RouterContext.reasoning /
   * RouterContext.plan, already attached to
   * AIResponse.metadata by AIRouter) becomes part of the
   * live cognitive state instead of only living on the
   * one-off response object.
   * ==========================================================
   */
  public recordThinking(
    reasoning: ReasoningResult | null | undefined,
    plan: Plan | null | undefined,
  ): void {

    this.cognitionRuntime.think(reasoning, plan);
  }





  /**
   * ==========================================================
   * Suggestions
   * ==========================================================
   */
  public async suggestions(

    prompt:
      string,

  ):
    Promise<string[]> {


    return await this.composer.suggestions(

      prompt,

    );

  }





  /**
   * ==========================================================
   * Reset
   * ==========================================================
   */
  public async reset():

    Promise<void> {


    await this.memory.clear();

  }

}