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

import MemoryEngine, { looksLikeCorrection } from "./MemoryEngine";

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

import DeletionLedger
  from "../core/memory/DeletionLedger";

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





/**
 * The existing knowledge item a new write corrects, if any.
 *
 * Pure and exported so the selection rule can be tested without a store.
 *
 * It is deliberately narrow. Knowledge is not merged just because two items
 * share words: a supersession requires the write to be phrased as a
 * correction (or to carry `supersedes: true`), the SAME memory type and
 * category, and either two shared keywords or the same explicit
 * `supersedesKey`. Unrelated facts are therefore added alongside the old one,
 * and the identity seed is never replaced.
 */
export function findKnowledgeToSupersede(
  candidates: ResponsePattern[],
  incoming: {
    content: string;
    keywords: string[];
    memoryType: "system" | "knowledge";
    category: string;
    provenance?: Record<string, unknown>;
  },
): ResponsePattern | undefined {
  const provenance = incoming.provenance ?? {};
  const explicit = provenance.supersedes === true;
  const key = typeof provenance.supersedesKey === "string" ? provenance.supersedesKey : undefined;
  if (!explicit && !key && !looksLikeCorrection(incoming.content)) return undefined;

  const incomingKeywords = new Set(
    incoming.keywords.map((word) => word.toLowerCase()).filter((word) => word.length > 2),
  );

  let best: { pattern: ResponsePattern; overlap: number } | null = null;
  for (const pattern of candidates) {
    if (pattern.id === "lelu-identity-foundation") continue;
    if (pattern.memoryType !== incoming.memoryType) continue;
    if (pattern.category !== incoming.category) continue;
    if (pattern.response === incoming.content) continue;

    const patternKeywords = new Set(pattern.keywords.map((word) => word.toLowerCase()));
    const overlap = [...incomingKeywords].filter((word) => patternKeywords.has(word)).length;
    const keyMatches = key !== undefined && pattern.context?.supersedesKey === key;

    if (!keyMatches && overlap < 2) continue;
    if (!best || overlap > best.overlap) best = { pattern, overlap };
  }

  return best?.pattern;
}

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


    keywords:
      string[] = [],


    context:
      Record<string, unknown> = {},

  ):
    Promise<ResponsePattern | undefined> {


    // Provenance is not decoration: MemoryBridge, agent delegation and
    // knowledge ingestion each compute where a memory came from and whether
    // the work behind it was observed. Dropping it here made every stored
    // fact look identical, so it is handed to the ONE memory engine that
    // already owns persistence.
    const memories =

      await this.memoryEngine.learn(

        prompt,

        response,

        {
          ...(typeof context.source === "string" ? { source: context.source } : {}),
          ...(typeof context.attribution === "string" ? { attribution: context.attribution } : {}),
          keywords,
          context,
        },

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
  public async forgetMemory(id: string): Promise<{
    removed: boolean;
    nodes: number;
    checkpoints: number;
    /** False when the deletion happened but could not be recorded. */
    ledgerRecorded: boolean;
  }> {
    // Read the record first: after removal there is nothing left to find the
    // derived representations by. A project checkpoint can quote the same
    // statement (Orchestrator persisted the turn's request as work state),
    // and CognitiveContext re-injects checkpoints into later prompts — so a
    // deleted memory that only left the store was still reaching the model.
    const pattern = await this.memory.get(id);

    // FINGERPRINT BEFORE REMOVAL (M22.6, WP02.4).
    //
    // The window between removing the record and recording its fingerprints
    // was a window in which a checkpoint quoting it could be read without the
    // guard knowing it was deleted. Nothing is awaited between these two lines,
    // so no context assembly can run inside that gap. If the removal itself
    // then fails, the tombstone is withdrawn — a tombstone for a record that
    // still exists would make a live memory unretrievable.
    let ledgerRecorded = false;
    if (pattern) {
      const origin = (pattern.context as { origin?: { originatingConversationId?: string | null } } | undefined)?.origin;
      try {
        DeletionLedger.getInstance().record({
          id,
          text: [pattern.prompt, pattern.response].filter((text) => typeof text === "string" && text.trim()).join("\n"),
          conversationId: origin?.originatingConversationId ?? null,
        });
        ledgerRecorded = true;
      } catch (error) {
        // Not fatal to the deletion, but the caller must not be told the
        // deletion was fully propagated when it cannot be proven later.
        console.warn("[Brain] deletion ledger unavailable — deletion is not provable", error);
      }
    }

    let removed = false;
    try {
      removed = await this.memory.remove(id);
    } catch (error) {
      if (ledgerRecorded) DeletionLedger.getInstance().discard(id);
      throw error;
    }
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
      ledgerRecorded,
    });
    return { removed, nodes, checkpoints, ledgerRecorded };
  }

  /**
   * Delete a conversation's material. Session memories and graph nodes go;
   * durable user facts stay, with their origin intact, because deleting a
   * chat is not a request to forget the user.
   */
  public async forgetConversation(
    conversationId: string,
    options: { keepPersistent?: boolean } = {},
  ): Promise<{ memories: number; nodes: number; ledgerRecorded: number; memoryIds: string[] }> {
    // Deleting a conversation removes session memories. Before M22.6 it left no
    // trace of what those memories said, so a checkpoint that quoted one could
    // never be proven to quote a deletion — the same blind spot M22.5 closed
    // for single-memory deletion, re-opened by the bulk pathway.
    //
    // Read the doomed records first, fingerprint them, then remove: the text
    // exists only until the removal.
    const doomed = await this.memory.previewForgetByConversation(conversationId, options);
    let ledgerRecorded = 0;
    try {
      const recorded = DeletionLedger.getInstance().recordMany(
        doomed.map((pattern) => ({
          id: pattern.id,
          text: [pattern.prompt, pattern.response]
            .filter((text) => typeof text === "string" && text.trim())
            .join("\n"),
          conversationId,
        })),
      );
      ledgerRecorded = recorded.length;
    } catch (error) {
      console.warn("[Brain] conversation deletion is not provable — ledger unavailable", error);
    }

    const forgotten = await this.memory.forgetByConversation(conversationId, options);
    const nodes = this.cognitionRuntime.forgetConversation(conversationId);
    CognitiveTrace.getInstance().record("MEMORY_WRITE", `forgot conversation ${conversationId.slice(0, 8)}: ${forgotten.length} memory(ies), ${nodes} node(s)`, {
      conversationId,
      memories: forgotten.length,
      nodes,
      ledgerRecorded,
      keepPersistent: options.keepPersistent ?? true,
    });
    return { memories: forgotten.length, nodes, ledgerRecorded, memoryIds: forgotten.map((pattern) => pattern.id) };
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
    provenance: Record<string, unknown> = {},
  ): Promise<void> {

    await this.persistLayer(
      summary,
      keywords,
      "system",
      "general",
      0.5,
      provenance,
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
    provenance: Record<string, unknown> = {},
  ): Promise<void> {

    await this.persistLayer(
      summary,
      keywords,
      "knowledge",
      "general",
      0.5,
      provenance,
    );

  }



  private async persistLayer(
    content: string,
    keywords: string[],
    memoryType: "system" | "knowledge",
    category: string,
    importance: number,
    provenance: Record<string, unknown> = {},
  ): Promise<void> {

    const searched =
      await this.memory.search(
        keywords.join(" ") || content,
      );

    // Supersession needs the candidates the CONTENT reaches, not only those
    // the keyword list reaches: a correction is about an existing fact, and
    // its own keywords are often new words.
    const byContent = content.trim() ? await this.memory.search(content) : [];
    const existing = [
      ...searched,
      ...byContent.filter((pattern) => !searched.some((seen) => seen.id === pattern.id)),
    ];



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

    // CORRECTION, NOT ACCUMULATION.
    //
    // Knowledge used to be append-only: a corrected discovery became a second
    // durable item beside the stale one, and both were retrievable. A newer
    // knowledge item now supersedes the one it corrects, keeping the old text
    // in `context.history` and never erasing unrelated items. It only does so
    // when the write is explicitly a correction or carries a shared
    // `supersedesKey`, so two unrelated discoveries that happen to share a
    // word are not merged.
    const superseded = findKnowledgeToSupersede(existing, {
      content,
      keywords,
      memoryType,
      category,
      provenance,
    });

    if (superseded) {
      const history = Array.isArray(superseded.context?.history)
        ? (superseded.context.history as string[])
        : [];
      history.push(superseded.response);
      superseded.response = content;
      superseded.prompt = content.slice(0, 120);
      superseded.keywords = [...new Set([...superseded.keywords, ...keywords])];
      superseded.importance = Math.max(superseded.importance, importance);
      superseded.context = {
        ...superseded.context,
        ...provenance,
        history: history.slice(-8),
        corrected: now,
      };
      superseded.confidence = 1;
      superseded.successfulUses += 1;
      superseded.updatedAt = now;
      await this.memory.update(superseded);
      return;
    }



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

        // Who supplied it, and on what evidence. The caller's fields win
        // over the category default, because only the caller knows them.
        ...provenance,

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

    // A reset removes every record; before M22.6 it recorded nothing, so every
    // project checkpoint quoting a reset memory became unprovable residue. The
    // fingerprints are written first, in one ledger write, while the text is
    // still in hand.
    const doomed = this.memory.getAll();
    try {
      DeletionLedger.getInstance().recordMany(
        doomed.map((pattern) => ({
          id: pattern.id,
          text: [pattern.prompt, pattern.response]
            .filter((text) => typeof text === "string" && text.trim())
            .join("\n"),
          conversationId:
            (pattern.context as { origin?: { originatingConversationId?: string | null } } | undefined)?.origin
              ?.originatingConversationId ?? null,
        })),
      );
    } catch (error) {
      console.warn("[Brain] memory reset is not provable — ledger unavailable", error);
    }

    await this.memory.clear();

  }

}