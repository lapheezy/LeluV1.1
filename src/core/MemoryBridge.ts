/**
 * ==========================================================
 * LÉLU
 * MEMORY BRIDGE
 *
 * Connects memory + cognition + user model. Retrieval happens
 * BEFORE generation, but the retrieved memories are first
 * evaluated and synthesized by the MemorySynthesizer — they
 * inform Lélu's understanding instead of being pasted into the
 * prompt verbatim. A memory only appears in the context when it
 * is relevant to THIS request; a request for more detail gets a
 * deeper subset (progressive disclosure).
 * ==========================================================
 */

import MultiChatStore from "./multichat/MultiChatStore";
import { CHAT_SCOPED } from "./multichat/ContextProvenance";
import type Brain from "../brain/Brain";
import type UserManager from "./user/UserManager";
import type { AIRequest } from "../providers/AIProvider";
import type ResponsePattern from "../brain/ResponsePattern";
import { sanitizeMemoryRecord } from "../brain/ResponsePattern";
import type { SynthesizedContext } from "../brain/MemorySynthesizer";
import AgentEventBus from "./agent/AgentEvents";
import ProjectStore from "./projects/ProjectStore";
import {
  authorizeContextSections,
  summarizeContextDecisions,
  type ContextSection,
} from "./cognition/ContextAuthorization";
import {
  decideProject,
  projectAccessFor,
  projectContextNote,
  projectLabel,
  type ProjectAccess,
  type ProjectDecisionRecord,
} from "./projects/ProjectSovereignty";
import AgentStore from "./agents/AgentStore";
import AvatarStore from "./avatar/AvatarProfile";
import { fitContext } from "./memory/CognitiveBudget";
import DeletionGuard from "./memory/DeletionGuard";
import MemoryOrchestrator from "./memory/MemoryProvider";
import { LocalMemoryProvider, OgArchiveProvider, SupabaseMemoryProvider } from "./memory/providers";
import PersonalityMemoryProvider from "./identity/PersonalityMemoryProvider";
import { composeVoice } from "./identity/voice/VoiceComposer";
import LanguageObserver from "./identity/voice/LanguageObserver";
import SupabasePersistence from "./persistence/SupabasePersistence";
import CognitiveTrace from "./cognition/CognitiveTrace";
import {
  authorize,
  currentSessionId,
  memoryContextNote,
  summarizeDecisions,
  type MemoryScopeContext,
} from "./memory/MemorySovereignty";

export default class MemoryBridge {
  constructor(
    private readonly brain: Brain,
    private readonly user: UserManager,
  ) {
    // Register the sources LÉLU can draw context from. Cognition asks the
    // orchestrator for context and never names a store, so Supabase — v1.1's
    // and the OG archive alike — is one provider rather than a dependency
    // (brief §5). Registration is idempotent: the registry is keyed by id.
    const orchestrator = MemoryOrchestrator.getInstance();
    orchestrator.register(new LocalMemoryProvider(brain));
    orchestrator.register(new SupabaseMemoryProvider());
    const archive = new OgArchiveProvider();
    orchestrator.register(archive);
    // The archive is a frozen snapshot: load it now, not on the first turn.
    archive.prefetch();
    orchestrator.register(new PersonalityMemoryProvider());
  }

  /**
   * THE authoritative memory recall for a user turn.
   *
   * This is the canonical owner: it runs first (before the router),
   * and its result is what actually reaches the model. Everything
   * downstream — BrainResolver, ReasoningResolver, composeFromMemory
   * — now CONSUMES the memories returned here (threaded through
   * AIRuntime.process → RouterContext.recalledMemories) instead of
   * re-querying the brain for the same prompt. Hence the return type:
   * both the enriched request AND the memories that produced it, so
   * the caller can hand them forward rather than the pipeline
   * rediscovering them three more times.
   */
  /**
   * The identity every memory is judged against for one turn: whose it is,
   * which conversation is happening, and which runtime session this is.
   */
  /**
   * Owner id, when there is a user manager. Headless callers (tests, some
   * agents) construct MemoryBridge with the brain alone; provenance must
   * degrade to "no owner recorded" rather than fail the turn.
   */
  private userId(): string | null {
    try {
      return this.user?.get?.()?.id ?? null;
    } catch {
      return null;
    }
  }

  public scopeFor(conversationId: string | undefined, prompt: string): MemoryScopeContext {
    return {
      userId: this.userId(),
      conversationId: conversationId ?? null,
      sessionId: currentSessionId(),
      prompt,
    };
  }

  public async enrich(request: AIRequest): Promise<{ request: AIRequest; memories: ResponsePattern[] }> {
    const trace = CognitiveTrace.getInstance();
    const scope = this.scopeFor(request.conversationId, request.prompt);

    // THE CANONICAL RECALL, now scoped. Ownership and session isolation are
    // enforced inside the store (PatternMemory.search → isEligible), so an
    // ineligible memory is never a candidate. What survives is then
    // AUTHORIZED: relevance is not permission, and historical material must
    // keep its origin. Only allowed memories are returned — every downstream
    // consumer (router, offline composer, memory synthesis) receives the
    // authorized set, not the raw recall.
    // REPAIRED BEFORE IT IS READ. A recalled record can come from a persisted
    // row or a hydrated snapshot with fields missing (`keywords`, `context`) or
    // a layer spelled another way; authorization reads those fields, so a
    // malformed record used to throw here — before synthesis even ran — and
    // took the whole reply with it. Records with no usable text are dropped;
    // the rest are made readable once, for every consumer downstream.
    const recalled = (await this.brain.recall(request.prompt, "cognition", scope))
      .map((pattern) => sanitizeMemoryRecord(pattern))
      .filter((pattern): pattern is ResponsePattern => pattern !== null);
    const authorization = authorize(recalled, scope);
    const memories = authorization.allowed;

    trace.record(
      "MEMORY_RETRIEVAL",
      `scope ${scope.conversationId ?? "no-conversation"} — ${summarizeDecisions(authorization.decisions)} (${memories.length}/${recalled.length} authorized)`,
      {
        conversationId: scope.conversationId,
        sessionId: scope.sessionId,
        userId: scope.userId,
        recalled: recalled.length,
        allowed: memories.length,
        counts: authorization.counts,
        deferred: authorization.decisions
          .filter((decision) => decision.decision === "DEFER")
          .slice(0, 6),
        rejected: authorization.decisions
          .filter((decision) => decision.decision === "REJECT")
          .slice(0, 6),
        withContext: authorization.decisions
          .filter((decision) => decision.decision === "RETRIEVE_WITH_CONTEXT")
          .slice(0, 6),
      },
    );

    // Reflection reads memory too. A failure there is a missing section, not
    // a failed turn.
    let reflection: Awaited<ReturnType<Brain["reflect"]>> | null = null;
    try {
      reflection = await this.brain.reflect();
    } catch (error) {
      trace.record("MEMORY_RETRIEVAL", "memory reflection FAILED — section omitted", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const conversation = this.threadContext(request);
    // Scoped to THIS conversation. The cognitive graph also holds other
    // chats' observations, and rendering them here was a second, independent
    // cross-conversation path that existed outside the memory store.
    const cognition = this.brain.cognitiveState(request.conversationId);
    const profile = this.user.context();

    // HER VOICE FOR THIS TURN, composed BEFORE a provider is chosen.
    //
    // This is what makes identity provider-independent: the directive is
    // built from her persistent linguistic profile + the stance of this
    // message, attached to the request, and read by every provider through
    // leluSystemPrompt(request). A model's house style cannot replace it
    // because the model never chose it.
    //
    // Guarded: voice composition must never cost a turn.
    let voice: string | undefined;
    try {
      const composition = composeVoice({ prompt: request.prompt, recentMessages: request.messages });
      voice = composition.text;
      trace.record(
        "VOICE",
        `voice composed — ${composition.stance.register}/${composition.stance.length}, familiarity ${composition.familiarity.tier}`,
        {
          version: composition.version,
          register: composition.stance.register,
          length: composition.stance.length,
          humor: composition.stance.humor,
          challenge: composition.stance.challenge,
          followUp: composition.stance.followUp,
          emotionalSupport: composition.stance.emotionalSupport,
          frustration: composition.stance.frustrationDetected,
          familiarity: composition.familiarity.tier,
          emotion: composition.appraisal.primary,
          emotionIntensity: composition.appraisal.intensity,
          emotionConfidence: composition.appraisal.confidence,
          emotionGuarded: composition.appraisal.guarded,
          responseMode: composition.appraisal.mode,
          reasons: composition.stance.reasons,
        },
      );
    } catch (error) {
      voice = undefined;
      trace.record("VOICE", "voice composition FAILED — base identity prompt only", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const requestWithVoice: AIRequest = voice ? { ...request, voice } : request;

    trace.record(
      "USER_CONTEXT",
      profile ? `user profile present (${profile.length} chars)` : "no user profile yet",
      { profileLength: profile?.length ?? 0 },
    );
    trace.record(
      "TASK_CONTEXT",
      `conversation: ${conversation?.messageCount ?? 0} message(s), topic "${conversation?.lastTopic || "general"}"`,
      {
        shortTermMessageCount: conversation?.messageCount ?? 0,
        lastTopic: conversation?.lastTopic ?? null,
        recentMessages: conversation?.recentMessages?.length ?? 0,
      },
    );

    // MEMORY MUST NEVER BE THE REASON A TURN FAILS.
    //
    // Synthesis is the one place every recalled memory is processed at once,
    // so a single record with an unexpected layer (`memoryType`) or missing
    // metadata used to throw out of here and out of the whole reply —
    // "undefined is not an object (… .push)" instead of an answer. The
    // records are now sanitised at the door (MemorySynthesizer.sanitize) AND
    // the call is contained: if synthesis still fails for a reason nobody
    // predicted, the turn continues without synthesized memory rather than
    // not at all.
    let synthesized: SynthesizedContext;
    try {
      synthesized = this.brain.synthesizeContext(request.prompt, memories, {
        deep: /(everything|all you (?:remember|know)|more detail|more details|tell me more|elaborate|expand|tell me everything)/i.test(request.prompt),
        profile,
        conversation: {
          lastTopic: conversation.lastTopic,
          recentMessages: conversation.recentMessages,
        },
        conversationId: request.conversationId,
      });
    } catch (error) {
      synthesized = { context: "", used: [], rejected: memories.length, contradictions: [], notes: [] };
      trace.record("MEMORY_RETRIEVAL", "memory synthesis FAILED — answering without synthesized memory", {
        error: error instanceof Error ? error.message : String(error),
        recalled: memories.length,
        conversationId: scope.conversationId,
      });
      console.warn("[MemoryBridge] memory synthesis failed (contained):", error);
    }

    // Historical and inferred material is labelled in the section it appears
    // in; this note explains the labels once, and only when they are present.
    // TOP AND BOTTOM. Context on a real turn is 10–14k chars, and the memory
    // it explains sits in the middle; a note only at the end was measured to
    // be missed (the model denied a memory that was in its own context).
    // ContextProvenance reached the same conclusion for its own labels.
    const provenanceNote = memoryContextNote(authorization.decisions);
    const baseContext = this.buildContext(
      synthesized,
      reflection,
      conversation,
      cognition,
      scope,
    );
    const context = [
      provenanceNote,
      baseContext,
      provenanceNote,
    ]
      .filter((part) => part.trim().length > 0)
      .join("\n\n");

    if (context.trim().length === 0) {
      trace.record("CONTEXT_INJECTION", "nothing relevant to inject — request left unchanged", {
        injected: false,
        synthesizedMemoriesUsed: synthesized.used.length,
      });
      return { request: requestWithVoice, memories };
    }

    // The load-bearing evidence: this is the exact moment retrieved
    // memory becomes part of what the model will actually see. A test
    // asserting only "memories were recalled" proves nothing without
    // this — retrieval that never reaches the request is a silent
    // no-op, which is precisely the failure mode being audited.
    trace.record(
      "CONTEXT_INJECTION",
      `injected ${context.length} chars of memory/cognition context into the model request`,
      {
        injected: true,
        contextLength: context.length,
        synthesizedMemoriesUsed: synthesized.used.length,
        synthesizedMemoriesRejected: synthesized.rejected,
        contradictions: synthesized.contradictions.length,
        conversationId: scope.conversationId,
        retrievalDecisions: authorization.counts,
        provenanceNote: provenanceNote.length > 0,
      },
    );

    // MERGE, never replace. `request.context` already carries the live
    // cognitive context (self-model, projects, agents, capabilities,
    // autonomous self-study state) that AIService assembled for this
    // turn. Overwriting it here silently threw all of that away, so the
    // model only ever saw memory — never LÉLU's actual runtime state.
    const merged = [request.context?.trim(), context.trim()]
      .filter((part): part is string => Boolean(part && part.length > 0))
      .join("\n\n");

    if (merged.length === 0) {
      return { request: requestWithVoice, memories };
    }

    // EXTERNAL / HISTORICAL CONTEXT (brief §6 bands 6-7, §19).
    //
    // Everything above is what LÉLU holds in process. This reaches the
    // optional sources — v1.1's Supabase and the read-only OG archive — so
    // conversations from the OG era are still reachable without v1.1 being
    // built around the OG schema. It is appended AFTER local context because
    // §6 ranks history below what is at hand, and the budget below trims from
    // the oldest end, so history is what gets cut first when space runs short.
    //
    // gather() never throws and skips providers that are unavailable or slow,
    // so an absent or broken Supabase costs exactly its own rows.
    let withHistory = merged;
    try {
      const external = await MemoryOrchestrator.getInstance().gather(request.prompt, {
        bands: [6, 7],
        limit: 4,
        timeoutMs: 3_000,
        scope,
      });
      if (external.length > 0) {
        withHistory = [
          merged,
          `Earlier, from ${external.map((item) => item.source).join(", ")}:`,
          ...external.map((item) => item.content),
        ].join("\n\n");
      }
    } catch (error) {
      // Belt and braces: gather() is already guarded, but memory enrichment
      // must never be the reason a turn fails.
      console.warn("[MemoryBridge] external context unavailable:", error);
    }

    // PERSISTENT LÉLU MEMORY (band 4).
    //
    // PersonalityMemoryProvider has been registered here since the identity
    // layer existed, but no chat turn ever gathered band 4 — the provider's
    // values, traits and curiosity reached no model at all. It is wired now,
    // bounded to two items and guarded like every other source. This is the
    // band §6 defined for her own persistent memory; it is not a second
    // store, just the registered provider finally being asked.
    try {
      const identityItems = (await MemoryOrchestrator.getInstance().gather(request.prompt, {
        bands: [4],
        limit: 2,
        timeoutMs: 1_500,
        scope,
      }))
        // LocalMemoryProvider also declares band 4, but it is long-term user
        // memory: it already reached the model through the AUTHORIZED recall
        // above, with its provenance label. Letting it back in here would be a
        // second injection path around the sovereignty boundary, and would
        // print another conversation's fact under "LÉLU's own identity".
        .filter((item) => item.source !== "local");
      if (identityItems.length > 0) {
        withHistory = [
          withHistory,
          "From LÉLU's own identity:",
          ...identityItems.map((item) => item.content),
        ].join("\n\n");
      }
    } catch (error) {
      console.warn("[MemoryBridge] identity context unavailable:", error);
    }

    // BOUNDED CONTEXT (integration brief §9). Recall grows with LÉLU's
    // history, and nothing here used to cap it — every remembered turn made
    // the next prompt larger, which is the slow version of the crash the OG
    // build hit. fitContext() is a no-op while the context is reasonable and
    // otherwise walks the required ladder: deduplicate, then compress, then
    // drop oldest. It never throws, because failing a turn to protect a
    // budget would trade one crash for another.
    // DELETION GATE (M22.6, WP05.5).
    //
    // Everything a model can see about memory passes through here: authorized
    // recall, synthesized memory, project checkpoints, the identity providers
    // and the external archive. A statement the user deleted must not reach a
    // provider even when one of those sources still holds a copy — so the gate
    // is applied to the assembled block, after every source has contributed
    // and before the budget trims it. Removing whole sentences can only shrink
    // the context, so the budget below still sees a valid size.
    const guarded = DeletionGuard.getInstance().sanitizeContext(withHistory);
    if (guarded.removed > 0) {
      trace.record(
        "CONTEXT_INJECTION",
        `removed ${guarded.removed} sentence(s) that quoted a deleted memory before the provider saw them`,
        { removedSegments: guarded.removed, conversationId: scope.conversationId },
      );
    }
    const safeContext = guarded.context;

    const fitted = fitContext(safeContext);
    if (fitted.applied.length > 0) {
      console.info(
        "[MemoryBridge] Context %d → %d chars (%s) — %d removed.",
        safeContext.length,
        fitted.context.length,
        fitted.applied.join(" → "),
        fitted.removed,
      );
    }

    // FINAL PAYLOAD GATE (M22.6, WP05.5). The dialogue turns are the last place
    // a deleted statement can hide: an earlier reply or an earlier user turn can
    // quote it. The newest user message is deliberately NOT scrubbed — the user
    // may be restating something on purpose, and silently deleting their own
    // words would be a different bug (documented in known-limitations.md).
    const dialogue = DeletionGuard.getInstance().sanitizeMessages(request.messages ?? []);
    if (dialogue.removed > 0) {
      trace.record(
        "CONTEXT_INJECTION",
        `removed ${dialogue.removed} sentence(s) that quoted a deleted memory from the dialogue turns`,
        { removedSegments: dialogue.removed, conversationId: scope.conversationId },
      );
    }

    const enrichedRequest: AIRequest = {
      ...requestWithVoice,
      context: fitted.context,
      // The conversation turns in `request.messages` are the dialogue so
      // far and are left exactly as they are. Only the behavioural rules
      // are prepended as a system turn — the context itself already
      // reaches the provider through `context`, so repeating it here
      // would send the same text twice.
      messages: [
        {
          role: "system",
          content:
`You are Lélu.

You have an evolving memory and cognition model.

Rules:

- The context you are given is your memory and your live runtime state: known facts about the user, about yourself, and our history.
- The messages before this one are the actual conversation. Read them: do not ask for something the user has already told you, and do not repeat a question you have already asked.
- If the user corrects a fact, the correction wins — treat the older version as stale.
- Use context to understand and personalize — do NOT dump it back or announce "I remember that..." unless it is genuinely useful.
- Never invent personal information that is not in the context.
- Answer the user's actual question with the minimum sufficient relevant information first; go deeper only when asked.
- Say it in your own voice: the identity instructions define it. Do not open with filler, do not restate the question, and do not close with a stock offer of further help.`,
        },
        ...dialogue.messages,
      ],
    };

    return { request: enrichedRequest, memories };
  }

  /**
   * The "current thread" for this turn: the chat it belongs to, not the
   * brain's one shared window, whose last topic and recent messages are
   * whichever chat spoke last.
   */
  private threadContext(request: AIRequest) {
    const shared = this.brain.getConversation().context();
    const id = request.conversationId;
    // NO IDENTITY, NO SHARED WINDOW. This used to return the brain's window
    // for an id-less caller, which holds whichever chat spoke last. The thread
    // is now built from this request's own turns and message.
    if (!id) return this.threadFromRequest(request);
    try {
      const chat = MultiChatStore.getInstance().get(id);
      if (!chat) {
        // A conversation id this store does not hold (a fresh session, or a
        // chat hydrated by another surface). The brain's shared window holds
        // whichever chat spoke last, and using it here is exactly how one
        // conversation's topic became another's context. Build the thread
        // from what this request itself carries instead.
        return this.threadFromRequest(request);
      }
      const userLines = chat.messages.filter((message) => message.role === "user" && message.text.trim()).map((message) => message.text);
      const lastUser = userLines.at(-1) ?? request.prompt;
      const topicWord = lastUser.replace(/[^a-zA-Z0-9\s]/g, "").split(/\s+/).find((word) => word.length > 4);
      return {
        ...shared,
        lastTopic: chat.topic || topicWord || "general",
        recentMessages: userLines.slice(-20),
        messageCount: chat.messages.length,
      };
    } catch {
      return shared;
    }
  }

  /** A thread derived only from this request — used when no chat is known. */
  private threadFromRequest(request: AIRequest) {
    const ownLines = (request.messages ?? [])
      .filter((message) => message.role === "user" && typeof message.content === "string" && message.content.trim())
      .map((message) => message.content as string);
    const lastUser = ownLines.at(-1) ?? request.prompt;
    const topicWord = lastUser.replace(/[^a-zA-Z0-9\s]/g, "").split(/\s+/).find((word) => word.length > 4);
    return {
      lastTopic: topicWord || "general",
      recentMessages: ownLines.slice(-20),
      messageCount: ownLines.length + 1,
    };
  }

  private buildContext(
    synthesized: {
      context: string;
      used: unknown[];
      rejected: number;
      contradictions: string[];
      notes: string[];
    },
    reflection: any,
    conversation: any,
    cognition: any,
    scope: MemoryScopeContext,
  ): string {
    // THE ONE CHECKPOINT. Every section below is classified before it can
    // enter the payload: whose material it is, which conversation made it,
    // and whether this turn may see it. Sections assembled here are already
    // this conversation's or authorized by their own boundary, so they are
    // declared as such — the value is that a future section cannot be added
    // without declaring provenance and being classified.
    const sections: ContextSection[] = [];
    const add = (
      id: string,
      kind: ContextSection["kind"],
      text: string,
      labelled = false,
    ) => {
      sections.push({
        id,
        kind,
        text,
        labelled,
        provenance: {
          userId: scope.userId,
          conversationId: scope.conversationId,
          sessionId: scope.sessionId,
          scope: "current-conversation",
        },
      });
    };

    if (synthesized.context) {
      add("memory", "memory", synthesized.context, /\[earlier conversation|\[inferred/.test(synthesized.context));
    }

    if (reflection?.summary && reflection.memories?.length) {
      add("reflection", "memory", `## Reflection\n${reflection.summary}`);
    }

    if (conversation?.lastTopic) {
      add("thread", "session", `## Current Thread\nTopic: ${conversation.lastTopic}`);
    }

    if (cognition) {
      const formatted = this.formatCognition(cognition);
      if (formatted) {
        add("cognition", "cognitive-graph", `## Cognitive State\n${formatted}`);
      }
    }

    // REAL project + agent context from the persistent stores — LÉLU
    // knows what work exists and which specialists are available.
    //
    // PROJECT SOVEREIGNTY (2.2.1). The registry used to be rendered whole: a
    // project created in another chat, or belonging to another user, appeared
    // as current work. Ownership and session isolation now refuse it before
    // formatting, and a durable project started elsewhere is stated as such.
    const projectContext = this.formatProjects(projectAccessFor(scope));
    if (projectContext) {
      add("projects", "project", `## Projects\n${projectContext}`, /\[started in the chat|\[historical project/.test(projectContext));
    }

    const agentContext = this.formatAgents();
    if (agentContext) {
      add("agents", "agent", `## Agents\n${agentContext}`);
    }

    const avatarContext = this.formatAvatar();
    if (avatarContext) {
      add("self", "operational", `## Self\n${avatarContext}`);
    }

    const authorization = authorizeContextSections(sections, {
      userId: scope.userId,
      conversationId: scope.conversationId,
      sessionId: scope.sessionId,
    });

    CognitiveTrace.getInstance().record(
      "CONTEXT_INJECTION",
      `context authorized: ${summarizeContextDecisions(authorization.decisions)}`,
      {
        counts: authorization.counts,
        sections: authorization.decisions,
      },
    );

    return authorization.allowed.map((section) => section.text).join("\n\n");
  }

  private formatCognition(cognition: any): string {
    const output: string[] = [];

    if (cognition.workspaces?.length) {
      output.push(
        `Workspaces: ${cognition.workspaces.map((space: any) => space.name).join(", ")}`,
      );
    }

    if (cognition.nodes?.length) {
      output.push(
        `Recent knowledge nodes: ${cognition.nodes
          .slice(-5)
          .map((node: any) => node.label)
          .join(", ")}`,
      );
    }

    return output.join("\n");
  }

  /** Active projects this turn may see, newest first, capped and labelled. */
  private formatProjects(access: ProjectAccess): string {
    const decisions: ProjectDecisionRecord[] = [];
    const lines: string[] = [];
    for (const project of ProjectStore.getInstance().list()) {
      if (project.status !== "active" || project.items.length === 0) continue;
      const decision = decideProject(project, access);
      decisions.push(decision);
      if (decision.decision === "REJECT" || decision.decision === "DEFER") continue;
      if (lines.length >= 4) continue;
      const kinds = [...new Set(project.items.map((item) => item.kind))].join(", ");
      const label = projectLabel(project, access.conversationId);
      lines.push(
        `- ${label ? `${label} ` : ""}${project.name}${project.description ? ` — ${project.description}` : ""} (${project.items.length} item(s): ${kinds})`,
      );
    }

    if (decisions.length > 0) {
      CognitiveTrace.getInstance().record(
        "TASK_CONTEXT",
        `projects: ${decisions.map((decision) => `${decision.projectId.slice(0, 8)}=${decision.decision}`).join(", ")}`,
        { decisions },
      );
    }

    if (lines.length === 0) return "";
    const note = projectContextNote(decisions);
    return [lines.join("\n"), note].filter((part) => part.trim().length > 0).join("\n");
  }

  /** Runnable agents, so LÉLU knows her specialists. */
  private formatAgents(): string {
    const agents = AgentStore.getInstance().runnable().slice(0, 8);
    if (agents.length === 0) {
      return "";
    }
    return agents
      .map((agent) => `- ${agent.name} (${agent.role})${agent.capabilities.length > 0 ? ` — ${agent.capabilities.join(", ")}` : ""}`)
      .join("\n");
  }

  /** LÉLU's persistent visual identity (single source with the memory seed). */
  private formatAvatar(): string {
    const store = AvatarStore.getInstance();
    const profile = store.get();
    return `I am ${profile.identity.name}. ${profile.identity.selfDescription}`;
  }

  /**
   * Learn conversation (consolidation happens inside the Brain's
   * MemoryEngine, which decides what is durable enough to persist).
   */
  /**
   * Sentences in which the assistant asserts it COMPLETED a retrieval
   * action. Present tense ("I'm searching") is an intention and is not
   * matched; only claims of a finished action are, because only those
   * would be stored as though the action had happened.
   */
  private static readonly ACTION_CLAIM =
    /\b(?:I|I've|I have)\s+(?:just\s+)?(?:searched|looked\s+up|checked|fetched|retrieved|pulled\s+up|queried|browsed|read)\b[^.!?]*[.!?]/gi;

  /**
   * Did a tool actually produce a result for this turn?
   *
   * AgentEventBus keeps a bounded history precisely so cognition can
   * read what really happened; a completed tool_result for this taskId
   * is the evidence that an action claim is true.
   */
  private executionBackedBy(taskId: string | undefined): boolean {
    if (!taskId) return false;
    return AgentEventBus.getInstance()
      .recent(80)
      .some(
        (event) =>
          event.type === "tool_result" &&
          event.taskId === taskId &&
          event.status !== "error" &&
          Array.isArray((event as { results?: unknown[] }).results) &&
          ((event as { results: unknown[] }).results.length > 0),
      );
  }

  public async learn(
    prompt: string,
    response: string,
    taskId?: string,
    /**
     * The conversation this exchange belongs to (memory sovereignty, M22.x),
     * or — the voice line's older call shape — a provenance record.
     */
    conversationOrProvenance?: string | Record<string, unknown>,
    /** Who produced this exchange (an agent's report is not the user's words),
     *  and provenance the turn itself knows and memory cannot reconstruct:
     *  how a spoken sentence became text, and a recogniser's confidence when
     *  one was reported. Merged into the stored context, never invented here. */
    options: { sourceType?: "user-said" | "agent-reported" | "derived"; provenance?: Record<string, unknown> } = {},
  ): Promise<void> {
    const conversationId = typeof conversationOrProvenance === "string" ? conversationOrProvenance : undefined;
    const provenance: Record<string, unknown> = {
      ...(conversationOrProvenance && typeof conversationOrProvenance === "object" ? conversationOrProvenance : {}),
      ...(options.provenance ?? {}),
    };
    // LANGUAGE EVIDENCE, from the exchange that just happened.
    //
    // The observer reads the user's own words (their vocabulary, explicit
    // direction about how she should talk, corrections, banter) and the
    // familiarity counters. It never mines her own replies for new
    // catchphrases, and external documents reach noteExternalContent()
    // instead — see LanguageObserver.
    try {
      LanguageObserver.getInstance().observeTurn({ prompt, reply: response });
    } catch (error) {
      console.warn("[MemoryBridge] language observation failed (contained)", error);
    }

    // "Remember this for this chat": the user scoped it to that chat. It
    // stays in that conversation's own history and is not made a
    // long-term fact every other chat would be handed.
    if (CHAT_SCOPED.test(prompt)) {
      CognitiveTrace.getInstance().record("MEMORY_WRITE", "kept to its chat at the user's request (not long-term memory)", { persisted: false, scoped: true });
      return;
    }
    // PROVENANCE. The model can write "I searched the Elpheru RSS feed"
    // whether or not anything ran, and persisting that verbatim turns a
    // sentence into a remembered fact — LÉLU would later recall having
    // done work she never did. An action claim is only durable when a
    // real tool_result for this turn backs it.
    const verified = this.executionBackedBy(taskId);
    let learnable = response;
    let redactedClaims = 0;

    if (!verified) {
      learnable = response.replace(MemoryBridge.ACTION_CLAIM, () => {
        redactedClaims += 1;
        return "";
      }).replace(/\s{2,}/g, " ").trim();

      if (redactedClaims > 0) {
        console.warn(
          "[MemoryBridge] Dropped %d unverified action claim(s) before storing — " +
            "no tool_result backed this turn.",
          redactedClaims,
        );
      }
    }

    // Nothing durable survived the redaction: the reply was ONLY an
    // unbacked claim, so there is no fact worth remembering.
    if (learnable.length === 0 && redactedClaims > 0) return;

    // WHERE THIS WAS LEARNED. The origin is written with the memory, so a
    // later conversation can recall it without ever claiming it was said
    // there. The title is read now, not guessed later.
    let conversationTitle: string | null = null;
    if (conversationId) {
      try {
        conversationTitle = MultiChatStore.getInstance().get(conversationId)?.title ?? null;
      } catch {
        conversationTitle = null;
      }
    }

    const learned = await this.brain.learn(prompt, learnable, "conversation", [], {
      source: "lelu-chat",
      // Provenance travels with the memory so a later reader can tell a
      // recorded action from a reported one.
      executionVerified: verified,
      ...(redactedClaims > 0 ? { redactedActionClaims: redactedClaims } : {}),
      ...provenance,
      originSeed: {
        userId: this.userId(),
        conversationId: conversationId ?? null,
        sessionId: currentSessionId(),
        conversationTitle,
        sourceType: options.sourceType ?? "user-said",
      },
    });

    CognitiveTrace.getInstance().record(
      "MEMORY_WRITE",
      learned
        ? `persisted a durable "${learned.category}" memory: ${learned.response.slice(0, 80)}`
        : "nothing durable enough to persist from this turn (stays session-scoped)",
      {
        persisted: Boolean(learned),
        category: learned?.category ?? null,
        memoryType: learned?.memoryType ?? null,
        id: learned?.id ?? null,
        conversationId: conversationId ?? null,
      },
    );

    if (learned) {
      void SupabasePersistence.getInstance().persistMemories([learned]);
    }

    AgentEventBus.getInstance().emit({
      type: "memory_update",
      taskId: taskId ?? String(Date.now()),
      category: "conversation",
    });
  }
}
