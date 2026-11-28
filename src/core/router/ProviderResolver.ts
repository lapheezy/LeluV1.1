/**
 * ==========================================================
 * LÉLU
 * PROVIDER RESOLVER
 * ==========================================================
 *
 * Priority-ordered provider fallback. A provider failure is
 * recorded and quarantined briefly by the registry; the next
 * configured provider is attempted immediately.
 */

import { continuationContext } from "./continuationContext";
import { resolveFirst } from "../resolveEnv";
import { classifyChainFailure } from "../voice/turnFailure";
import {
  claimEvidenceCounts,
  contradictedCaptureClaims,
  contradictionNote,
  freshnessCorrection,
  groundingNote,
  ungroundedClaims,
  type EarlierToolRun,
} from "../tools/ClaimGrounding";
import { memoryProvenanceNote, readMemory } from "../memory/MemoryProvenance";
import {
  formatTurnMetrics,
  newTurnMeasurement,
  noteFallback,
  noteFirstText,
  noteProviderAttempt,
  noteProviderFailure,
  summarizeTurn,
} from "./TurnMetrics";
import type AIProvider from "../../providers/AIProvider";
import type { AIMessage, AIRequest, AIResponse } from "../../providers/AIProvider";
import type RouterContext from "./RouterContext";
import type { ProviderResult } from "./RouterResults";
import AgentEventBus from "../agent/AgentEvents";
import ModelRouter from "../model/ModelRouter";
import { dispatchToolCall, latestCaptureMeasurements } from "../tools/ToolDispatcher";
import { reducedToolSchemas, toolSchemasForRequest } from "../tools/ToolSchemas";
import { describeRequestBudget, fitRequestBudget, type SchemaTier } from "./RequestBudget";
import { labelOtherChats } from "../multichat/ContextProvenance";
import { BudgetExhaustedError, budgetNotice, gatedGenerate } from "../observability/UsageBudgetGate";


import { inspectRequest } from "../observability/RequestIntegrity";
import { assessTurn, checkCall, inLoopNote, qualityNotice, type QualityCall } from "./qualityCheckpoint";
import {
  partialWorkReply,
  publicToolRun,
  summarizeToolResult,
  toolEvidence,
  type ToolRunRecord,
} from "./partialWork";
import { DEFAULT_OUTPUT_TOKENS } from "../../providers/AIProvider";
import { EmptyCompletionError } from "../../providers/openaiTools";
/**
 * TERMINATION, not a round quota.
 *
 * A fixed count is the wrong shape for this. Four was too few for a
 * real engineering chain (copy, list, read, write, validate, read the
 * failure, repair, validate, diff) and the model stopped mid-task
 * having done work it could not report; but raising the number just
 * moves the cliff, and a model stuck in a loop still burns every round
 * it is given.
 *
 * So the loop ends for a REASON, and says which:
 *   • the wall-clock budget is spent — the honest bound on a turn,
 *     independent of how many small steps it took;
 *   • a hard backstop count, high enough that legitimate work never
 *     reaches it, low enough that nothing runs away;
 *   • no progress — the same tool called with the same arguments
 *     several times running is a stuck model, not a working one, and
 *     is stopped immediately rather than left to exhaust the budget.
 *
 * Whichever fires, the final generation withholds tools so the model
 * must answer from what it actually has.
 */
const TOOL_LOOP_BUDGET_MS = 8 * 60 * 1000;
const TOOL_LOOP_MAX_ROUNDS = 40;
const NO_PROGRESS_REPEATS = 3;

/**
 * A turn that is only LOOKING THINGS UP — searching, reading pages,
 * recalling memory — is answering someone who is waiting in the chat.
 * The engineering budget above let a research question run its full
 * eight minutes (measured: a model kept re-searching because most news
 * links cannot be read). Until the turn uses any other tool it gets
 * this shorter bound, and is then told to answer from what it found.
 */
const RESEARCH_LOOP_BUDGET_MS = 3 * 60 * 1000;

/**
 * How many tokens a TOOL turn may reserve for its reply.
 *
 * Providers that meter prompt and `max_tokens` together refuse the whole
 * request when their sum crosses a per-minute ceiling: measured on Groq's
 * free tier, a 19.5k-token tool payload against an 8k TPM limit was refused
 * outright. A 2048-token reply budget on top of an already-narrowed tool set
 * leaves no room for a second round, so the loop dies after one tool call.
 * This is a reservation, not a cap on what she can say in the final answer —
 * only rounds that carry tools are trimmed, and the plain reply keeps its own
 * budget.
 */
const RESEARCH_LOOP_MAX_ROUNDS = 16;
const RESEARCH_TOOL = /^(research|browser|memory)[._]/;

/**
 * ONE provider attempt, bounded.
 *
 * Measured live (2026-11-06): an ordinary chat turn spent 20.1 s inside
 * the chain and then answered with the offline notice, while the provider
 * that answers in under a second had only the tail of that time left. The
 * wait was spent on a slow rung, not on an answer — and a rung whose
 * credential is out of quota for the day was re-paid for on every turn.
 *
 * So each attempt gets its own deadline, comfortably below the chain's
 * total, and the next provider is tried while time is still on the clock.
 * A deadline is NOT a user Stop: the turn's own signal is untouched, so
 * the chain falls through instead of settling the turn as cancelled.
 */
const PROVIDER_RUNG_BUDGET_MS = 12_000;

/** The whole fallback chain. No new rung starts once this is spent. */
const CHAIN_BUDGET_MS = 20_000;

/** A positive millisecond setting from the environment, or undefined. */
function configuredMs(name: string): number | undefined {
  const value = Number(resolveFirst(name));
  return Number.isFinite(value) && value >= 1000 && value <= 600_000 ? value : undefined;
}

/** Too little left to be worth starting another provider. */
const MIN_RUNG_SLICE_MS = 1_500;

/**
 * A round whose OUTPUT budget ran out is re-asked once, in this much room.
 *
 * Measured live (2026-11-27): both configured providers stream reasoning
 * before content, and on Groq's gpt-oss-120b a 2048-token reply budget can be
 * spent entirely on `reasoning` — the round comes back 200 with empty content
 * and finish_reason=length. That is not a provider failure, it is a budget
 * that was too small for the way this model answers, and asking again with
 * more room is the fix. Bounded: one retry per round, never a ladder.
 */
const MIN_REPLY_TOKENS = 1_024;
const MAX_REPLY_TOKENS = 4_096;

/** How much of the fallback chain a recovered narration may use. */
const MAX_NARRATION_PROVIDERS = 2;

export default class ProviderResolver {
  private readonly rungBudgetMs: number;
  private readonly chainBudgetMs: number;
  /** Operator ceiling for one request body, in UTF-8 bytes. */
  private readonly requestCeilingBytes?: number;

  /**
   * Budgets are injectable so a test can prove the cut-off in
   * milliseconds instead of waiting out the production numbers.
   */
  constructor(budget: { rungBudgetMs?: number; chainBudgetMs?: number; requestCeilingBytes?: number } = {}) {
    // Operator overrides (defaults unchanged). A rung covers a whole tool
    // loop, so slow providers doing research can need more than 12 s.
    this.rungBudgetMs = budget.rungBudgetMs ?? configuredMs("LELU_PROVIDER_RUNG_BUDGET_MS") ?? PROVIDER_RUNG_BUDGET_MS;
    this.chainBudgetMs = budget.chainBudgetMs ?? configuredMs("LELU_CHAIN_BUDGET_MS") ?? CHAIN_BUDGET_MS;
    this.requestCeilingBytes = budget.requestCeilingBytes ?? configuredMs("LELU_REQUEST_CEILING_BYTES") ?? undefined;
  }

  /**
   * Apply the request ceiling BEFORE the request is handed to a provider.
   *
   * The degradation in `executeRung` reacts to a 413 that has already
   * happened, and it resends the same history; a turn whose HISTORY is the
   * problem is refused twice and then answers with no work done. This is the
   * same decision made first: tool schemas first (from the end), then the
   * oldest history, then the oldest text — never the prompt, never the most
   * recent twelve messages. When nothing changes, the request is untouched.
   */
  private fitFor(
    provider: AIProvider,
    context: RouterContext,
    messages: AIMessage[],
    tools: Array<{ name: string; description?: string; parameters?: unknown }>,
    tier: SchemaTier,
    /** The reply budget this attempt will ask for, when it differs from the turn's. */
    maxTokensOverride?: number,
  ) {
    const replyBudget = maxTokensOverride ?? context.request.maxTokens;
    const fitted = fitRequestBudget({
      messages,
      prompt: context.request.prompt,
      tools,
      tier,
      provider: provider.name,
      model: context.request.model,
      ...(replyBudget ? { maxTokens: replyBudget } : {}),
      ...(this.requestCeilingBytes ? { limitBytes: this.requestCeilingBytes } : {}),
      protectedTail: 12,
    });
    // DID THE PERSON'S REQUEST SURVIVE? The fitter is allowed to drop tool
    // schemas and old history, never the prompt. Comparing the payload with
    // the prompt is the check that would have caught a subject-less request
    // before it reached a provider.
    const promptText = context.request.prompt ?? "";
    if (promptText) {
      const rawHadPrompt = (context.request.messages ?? []).some(
        (message) => typeof message.content === "string" && message.content.includes(promptText),
      );
      const integrity = inspectRequest({
        originalUserInput: promptText,
        fitted,
        payloadText: JSON.stringify(fitted.messages),
        tier: fitted.tier,
      });
      if (rawHadPrompt && !integrity.providerPayload.promptPresent) {
        context.logger.error("ProviderResolver", "The user's request is no longer in the payload", {
          original: integrity.originalUserInput,
          fitted: integrity.fittedRequest,
          payload: integrity.providerPayload,
          semantic: integrity.semanticPreservation,
        });
      } else if (!integrity.semanticPreservation.ok) {
        context.logger.info("ProviderResolver", "Request kept; some references were shortened", {
          missing: integrity.semanticPreservation.missing,
          ceiling: integrity.fittedRequest.ceilingSource,
        });
      }
    }

    if (fitted.changed) {
      context.logger.info("ProviderResolver", "Request budget enforced before send", {
        provider: provider.name,
        ceilingBytes: fitted.ceiling.bytes,
        ceilingSource: fitted.ceiling.source,
        tier: fitted.tier,
        totalBytes: fitted.budget.totalBytes,
        toolCount: fitted.budget.toolCount,
        droppedTools: fitted.droppedTools,
        droppedMessages: fitted.droppedMessages,
        trimmedMessages: fitted.trimmedMessages,
        notes: fitted.notes,
      });
    }
    return fitted;
  }

  public async execute(context: RouterContext): Promise<ProviderResult> {
    /**
     * Tools that really executed, across every provider attempt.
     *
     * The per-attempt list lives inside generateWithTools and dies with
     * it when that provider throws — so a provider that ran a tool and
     * then failed left no trace, and the cognition cycle recorded "no
     * action taken" about a workflow it had genuinely created. This
     * outlives the attempt and is attached to whatever answer is
     * finally returned, including the offline one.
     */
    const toolsReallyRun: Array<ToolRunRecord> = [];
    /** Why each provider in the chain failed — so the final notice can say timeout vs network vs unavailable. */
    const chainErrors: string[] = [];
    /**
     * Counts and timings for THIS turn (Mission 44.7). Every value is noted
     * by the code that observed the event; the first delta is the one real
     * measurement of "time to first text", not an estimate from the reply.
     * Content-free: counts and milliseconds only.
     */
    const measurement = newTurnMeasurement(context.started || Date.now());
    const userOnDelta = context.request.onDelta;
    if (userOnDelta) {
      context.request.onDelta = (text: string) => {
        noteFirstText(measurement);
        userOnDelta(text);
      };
    }
    /**
     * Text a provider had already streamed before its connection broke.
     *
     * A streamed answer is shown as it arrives, so a break in the middle is
     * not "nothing happened": the user has read those words. Falling through
     * to the next provider is right (it may finish the answer), but if the
     * whole chain fails, the offline notice REPLACED that visible text with
     * "all providers are unreachable" — the answer the user was reading was
     * lost. The longest partial is kept and used as the last resort instead.
     */
    let bestPartial = "";
    let bestPartialProvider = "";

    // The last point before any provider sees the context: whatever her
    // cognition put in it that quotes ANOTHER chat is labelled with that
    // chat (multichat/ContextProvenance), so she can tell where it came
    // from instead of presenting it as said here.
    if (context.request.conversationId && context.request.context) {
      try {
        context.request.context = labelOtherChats(context.request.context, context.request.conversationId).context;
      } catch {
        // labelling must never cost the turn
      }
    }

    const providers = await context.aiProviders.available();

    if (providers.length === 0) {
      context.logger.error(
        "ProviderResolver",
        "No AI providers are available.",
        {
          reason: "missing-credentials-or-provider-cooldown",
          registeredProviders: context.aiProviders.names(),
        },
      );

      return {
        handled: true,
        response: this.withRealTools(this.offline(context), toolsReallyRun),
      };
    }

    // The model router decides *how* to route: modality (vision/text),
    // hardware tier, and explicit offline mode. Remote providers are
    // optional fallbacks — in offline mode they are skipped even when
    // a key happens to be configured, so LÉLU stays local-first.
    const router = ModelRouter.getInstance();
    const decision = router.route(context.request, context.intent);
    // Mark coding turns on the request itself so a provider with a
    // dedicated coding model (Fireworks → Kimi) selects it. Not `model`:
    // that would pin a Fireworks id onto every provider in the chain.
    if (decision.workload === "coding") {
      context.request.workload = "coding";
    }

    context.logger.info(
      "ProviderResolver",
      "Model routing decision",
      {
        modality: decision.modality,
        workload: decision.workload ?? "general",
        hardwareTier: decision.hardware.tier,
        offlineEnabled: decision.offlineEnabled,
        preferredProviders: decision.preferredProviders,
        recommendedModel: decision.model,
      },
    );

    const eligible = providers.filter(
      (provider) => !decision.offlineEnabled || !provider.requiresApiKey,
    );

    if (eligible.length === 0) {
      context.logger.error(
        "ProviderResolver",
        "Offline mode is active and no local providers are installed.",
        {
          reason: "offline-mode-no-local-provider",
          skippedRemoteProviders: providers.map((p) => p.name),
        },
      );

      return {
        handled: true,
        response: this.withRealTools(this.offline(context, true), toolsReallyRun),
      };
    }

    // Agent delegation can request a preferred provider (and a fallback
    // provider) per task. The router's modality/hardware ordering is
    // tried first, in the requested order; after it is exhausted the
    // normal priority chain continues, so a preferred provider failure
    // still falls through to every other configured provider instead of
    // breaking the agent.
    const ordered = this.orderByPreference(eligible, decision.preferredProviders);
    const chainStarted = Date.now();

    for (const provider of ordered) {
      // The user pressed Stop: do not start another provider.
      throwIfStopped(context);
      if (!provider.canHandle(context.request.prompt)) {
        context.logger.info(
          "ProviderResolver",
          `${provider.name} cannot handle request.`,
          { provider: provider.name },
        );
        continue;
      }

      noteProviderAttempt(measurement);

      /** Tools that ran on THIS attempt — a fallback would repeat them. */
      const toolsBeforeRung = toolsReallyRun.length;
      try {
        context.logger.info(
          "ProviderResolver",
          `Trying ${provider.name}`,
          {
            provider: provider.name,
            priority: provider.priority,
            promptLength: context.request.prompt.length,
            requestedModel: context.request.model,
          },
        );

        const events = AgentEventBus.getInstance();
        const taskId = String(context.request.timestamp ?? Date.now());
        events.emit({
          type: "provider_selected",
          taskId,
          provider: provider.name,
          priority: provider.priority,
        });

        // Start a rung only while the chain has time to hear its answer.
        const remaining = this.chainBudgetMs - (Date.now() - chainStarted);
        if (remaining < MIN_RUNG_SLICE_MS) {
          context.logger.info(
            "ProviderResolver",
            `Not trying ${provider.name}: the fallback chain's ${Math.round(this.chainBudgetMs / 1000)}s budget is spent.`,
            { provider: provider.name, chainElapsedMs: Date.now() - chainStarted },
          );
          break;
        }

        const response = await this.executeRung(
          provider,
          context,
          toolsReallyRun,
          Math.min(this.rungBudgetMs, remaining),
        );
        events.emit({
          type: "provider_status",
          taskId,
          provider: provider.name,
          status: "operational",
        });
        context.aiProviders.markSuccess(
          provider.name,
          response.metadata?.usage,
        );

        context.logger.info(
          "ProviderResolver",
          `${provider.name} generated response`,
          {
            provider: response.provider,
            model: response.model,
            latencyMs: response.processingTime,
            responseLength: response.text.length,
            usage: response.metadata?.usage,
            finishReason: response.metadata?.finishReason,
            activeProvider: response.provider,
          },
        );

        const summary = summarizeTurn(measurement, toolsReallyRun.length);
        context.logger.info("ProviderResolver", formatTurnMetrics(summary), { turnMetrics: summary });
        return {
          handled: true,
          response: {
            ...response,
            metadata: { ...response.metadata, turnMetrics: summary },
          },
        };
      } catch (error) {
        // A user Stop is not a provider failure. Marking it one put a
        // healthy provider into failure cooldown, and falling through ran
        // every other provider and then answered with the offline notice
        // — "all providers are unreachable" — to a turn the user ended.
        //
        // It is also not an exception the UI should have to catch: a stop
        // is settled HERE, as a cancelled answer that says what already
        // ran, so the caller gets one ordinary result and every other
        // provider is left alone.
        if (stopped(context, error)) {
          const ran = (toolsReallyRun ?? []).map((tool) => tool.tool);
          // Nothing ran: there is nothing to report, so the AbortError goes
          // back to the caller exactly as a pre-flight stop always has.
          if (ran.length === 0) throwIfStopped(context, error);
          return {
            handled: true,
            response: {
              text: ran.length ? `Stopped. Already ran: ${ran.join(", ")}.` : "Stopped before anything ran.",
              provider: "cancelled",
              model: "stopped",
              processingTime: Date.now() - context.started,
              metadata: { success: false, toolLoopStopped: "user" },
            },
          };
        }
        // A spent budget is not a provider failure, and it must not fall
        // through to the next provider: that could be a paid one the user
        // never chose. Stop here and say why, inside the chat.
        if (error instanceof BudgetExhaustedError) {
          context.logger.info("ProviderResolver", "Budget refused the call before dispatch.", {
            provider: provider.name,
            scope: error.scope,
            reason: error.message,
          });
          AgentEventBus.getInstance().emit({
            type: "provider_status",
            taskId: String(context.request.timestamp ?? Date.now()),
            provider: provider.name,
            status: "budget reached — not sent",
          });
          return {
            handled: true,
            response: {
              text: budgetNotice(error),
              provider: "budget",
              model: "none",
              processingTime: Date.now() - context.started,
              metadata: { success: false, budgetExhausted: { source: error.source, scope: error.scope, reason: error.message } },
            },
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        // Keep what was already on the user's screen, in case the whole chain
        // fails and there would otherwise be nothing to show for the turn.
        const streamed = (error as { partialText?: unknown } | null)?.partialText;
        if (typeof streamed === "string" && streamed.trim().length > bestPartial.trim().length) {
          bestPartial = streamed;
          bestPartialProvider = provider.name;
        }
        // Did this attempt already do real work before it failed?
        //
        // Falling through now would hand the next provider the SAME messages
        // and the SAME tools, so every edit already made would be made
        // again — and the user's reply would be replaced by the offline
        // notice. That is the measured product-creation stall: tools ran,
        // then the turn "stuck" with nothing to show. The turn ends here,
        // naming what ran, and nothing is repeated.
        const ranThisRung = toolsReallyRun.slice(toolsBeforeRung);
        if (ranThisRung.length > 0) {
          const names = [...new Set(ranThisRung.map((tool) => tool.tool))];
          noteProviderFailure(measurement);
          context.aiProviders.markFailure(provider.name, message);
          AgentEventBus.getInstance().emit({
            type: "provider_status",
            taskId: String(context.request.timestamp ?? Date.now()),
            provider: provider.name,
            status: "failed after running tools — not falling back",
          });
          context.logger.error(
            "ProviderResolver",
            `${provider.name} failed after running tools; not repeating them on another provider.`,
            { provider: provider.name, ran: names, fallbackReason: message.slice(0, 200) },
          );
          // THE RESULTS SURVIVE THE PROVIDER. Falling through would replay the
          // work; the offline notice would throw it away. Neither is right
          // when the evidence is already in hand, so one bounded, TOOL-FREE
          // attempt is made on the next provider to write the answer from what
          // actually ran. Only when that fails too does the reply degrade to
          // the step list (`partialWorkReply`), which claims nothing.
          const narrated = await this.narrateFromResults(
            context,
            ranThisRung,
            provider.name,
            message,
            ordered.slice(ordered.indexOf(provider) + 1),
            this.chainBudgetMs - (Date.now() - chainStarted),
          );
          if (narrated) return { handled: true, response: narrated };
          return {
            handled: true,
            response: {
              text: partialWorkReply(ranThisRung, provider.name, message),
              provider: provider.name,
              model: context.request.model ?? "unknown",
              processingTime: Date.now() - context.started,
              metadata: {
                success: false,
                partial: true,
                toolsExecuted: ranThisRung.map(publicToolRun),
                // The same contract the fallback path keeps: work that
                // happened before the answer is marked as such, so nothing
                // reads it as the answering provider's own doing.
                toolsRanBeforeFallback: true,
                toolLoopStopped: "provider-failed-after-tools",
              },
            },
          };
        }
        noteProviderFailure(measurement);
        noteFallback(measurement);
        context.aiProviders.markFailure(provider.name, message);
        chainErrors.push(message);
        AgentEventBus.getInstance().emit({
          type: "provider_status",
          taskId: String(context.request.timestamp ?? Date.now()),
          provider: provider.name,
          status: "failed — falling back",
        });

        context.logger.error(
          "ProviderResolver",
          `${provider.name} failed; falling back to the next provider.`,
          {
            provider: provider.name,
            priority: provider.priority,
            fallbackReason: message,
            latencyMs: Date.now() - context.started,
          },
        );
      }
    }

    throwIfStopped(context);
    context.logger.error(
      "ProviderResolver",
      "All available AI providers failed.",
      {
        attemptedProviders: providers.map((provider) => provider.name),
        fallbackReason: "provider-exhaustion",
      },
    );

    return {
      handled: true,
      response: this.withRealTools(
        bestPartial
          ? {
              text:
                `${bestPartial.trim()}\n\n` +
                `⚠️ The connection to ${bestPartialProvider} broke while this answer was arriving, so it stops where ` +
                "the stream stopped. The other providers could not continue it. Nothing that already ran was repeated.",
              provider: bestPartialProvider,
              model: "stream-cut",
              processingTime: Date.now() - context.started,
              metadata: {
                success: false,
                partial: true,
                streamInterrupted: true,
                reason: "all-ai-providers-failed",
              },
            }
          : this.offline(context, false, chainErrors),
        toolsReallyRun,
      ),
    };
  }

  private orderByPreference(
    providers: AIProvider[],
    preferred: string[] | undefined,
  ): AIProvider[] {
    if (!preferred || preferred.length === 0) {
      return providers;
    }
    const byName = new Map(providers.map((provider) => [provider.name, provider]));
    const preferredFirst: AIProvider[] = [];
    for (const name of preferred) {
      const provider = byName.get(name);
      if (provider && !preferredFirst.includes(provider)) {
        preferredFirst.push(provider);
      }
    }
    const remaining = providers.filter((provider) => !preferredFirst.includes(provider));
    return [...preferredFirst, ...remaining];
  }

  /**
   * Generate, running any tools the model actually asks for.
   *
   * This is the ONE place a provider is invoked, so the tool loop lives
   * here rather than in a second agent loop beside it: fallback,
   * streaming, model routing and event emission all keep working
   * unchanged, and a provider without tool support takes exactly the
   * path it took before.
   *
   * The loop is bounded. On the final round tools are WITHHELD, which
   * forces the model to answer from what it has instead of asking for
   * another call it will not get — an unbounded version stalls on a
   * model that keeps requesting tools, and a bounded one that keeps
   * offering tools ends on a tool request with no text.
   */
  /**
   * ONE provider attempt: its own deadline, and one narrow retry.
   *
   * The retry exists for a measured request shape. An ordinary "write me a
   * poem" turn carried 87 tool schemas — an 86,331-character request, 17,816
   * of them system context — and the same prompt with no schemas answered in
   * 452 ms. The schemas ARE the bulk of the request, and a conversational
   * answer needs none of them, so a refusal about the request's SIZE is met
   * with the request the provider will accept rather than with the offline
   * notice.
   *
   * Only a size refusal retries. The refusal measured on the day this was
   * written was a spent DAILY allowance (`tokens per day (TPD): Used 199144`
   * of 200000), which is not in this pattern on purpose: sending that smaller
   * still exceeds what is left, so it is parked by the registry instead.
   */
  private async executeRung(
    provider: AIProvider,
    context: RouterContext,
    toolsReallyRun: Array<ToolRunRecord> | undefined,
    budgetMs: number,
  ): Promise<AIResponse> {
    const rung = new AbortController();
    let expired = false;
    /**
     * The rung deadline is a STALL watchdog, not a total.
     *
     * Measured live (2026-11-06): a product-creation turn ran several tool
     * rounds inside one rung, each round a real edit. The fixed 12 s
     * deadline fired mid-round, the abort surfaced as a provider failure,
     * and the chain fell through carrying the ORIGINAL messages and tools —
     * so the work was repeated on the next provider, and the reply the user
     * was waiting for became the offline notice. That is the reported "stuck
     * conversation after successful multi-tool execution".
     *
     * So every round that returns and every tool that finishes re-arms it. A
     * silent provider is still cut off at the same budget; a turn visibly
     * making progress is bounded by the tool loop's own budget instead.
     */
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        expired = true;
        rung.abort();
      }, budgetMs);
    };
    arm();
    const onProgress = () => {
      if (!expired) arm();
    };

    try {
      try {
        return await this.executeProvider(provider, context, toolsReallyRun, rung.signal, "full", onProgress);
      } catch (error) {
        // A user Stop outranks the deadline: the turn ended, it did not time
        // out, and settling it as a timeout would hide the Stop.
        if (context.request.signal?.aborted) throwIfStopped(context, error);
        // The deadline fired: report it as the provider's, not as a Stop.
        if (expired) {
          throw new Error(
            `${provider.name} timed out after its ${(budgetMs / 1000).toFixed(1)}s budget.`,
          );
        }

        const reason = error instanceof Error ? error.message : String(error);
        const offeredTools =
          provider.supportsTools === true && context.request.allowTools === true;
        if (!offeredTools || !requestTooLarge(reason)) throw error;

        // Degrade in TWO steps, not one. Dropping every tool on the first
        // refusal is what turned a size error into a model that described
        // work it could not do; a smaller set still lets it act.
        context.logger.info(
          "ProviderResolver",
          `${provider.name} refused the request as too large; retrying with a reduced tool set.`,
          { provider: provider.name, fallbackReason: reason.slice(0, 200) },
        );

        try {
          return await this.executeProvider(provider, context, toolsReallyRun, rung.signal, "reduced", onProgress);
        } catch (again) {
          if (context.request.signal?.aborted) throwIfStopped(context, again);
          if (expired) {
            throw new Error(`${provider.name} timed out after its ${(budgetMs / 1000).toFixed(1)}s budget.`);
          }
          const secondReason = again instanceof Error ? again.message : String(again);
          if (!requestTooLarge(secondReason)) throw again;

          context.logger.info(
            "ProviderResolver",
            `${provider.name} refused the reduced set too; retrying without tools.`,
            { provider: provider.name, fallbackReason: secondReason.slice(0, 200) },
          );
          return await this.executeProvider(provider, context, toolsReallyRun, rung.signal, "none", onProgress);
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** The request as this attempt sends it: the user's signal, plus the rung's. */
  private withRungSignal(request: AIRequest, rung?: AbortSignal): AIRequest {
    if (!rung) return request;
    return {
      ...request,
      signal: request.signal ? AbortSignal.any([request.signal, rung]) : rung,
    };
  }

  /**
   * Count a streamed DELTA as progress.
   *
   * The rung deadline is a stall watchdog, and it only ever re-armed when a
   * whole round returned. A provider that is streaming — visibly alive, tokens
   * arriving — was therefore cut off at the same fixed budget as one that had
   * gone silent. Measured 2026-11-27: OpenRouter's free reasoning model spent
   * 7.4 s on its first tool round and 4.4 s on its second, so a three-round
   * research turn crosses the 12 s deadline while working perfectly. A delta is
   * the strongest evidence of life there is; it now resets the watchdog.
   */
  private withStreamingProgress(request: AIRequest, onProgress?: () => void): AIRequest {
    const onDelta = request.onDelta;
    if (!onProgress || !onDelta) return request;
    return {
      ...request,
      onDelta: (text: string) => {
        onProgress();
        onDelta(text);
      },
    };
  }

  private async generateWithTools(
    provider: AIProvider,
    context: RouterContext,
    toolsReallyRun?: Array<ToolRunRecord>,
    rungSignal?: AbortSignal,
    toolMode: "full" | "reduced" | "none" = "full",
    onProgress?: () => void,
  ): Promise<AIResponse> {
    // Tools are offered only on a conversational turn. Internal
    // structured-output calls (see AIRequest.allowTools) must reach the
    // provider exactly as they did before, or their parsers break.
    const offeredTools =
      toolMode !== "none" && provider.supportsTools === true && context.request.allowTools === true
        ? toolMode === "reduced"
          ? reducedToolSchemas(context.request.prompt, context.intent)
          : toolSchemasForRequest(context.request.prompt, context.intent)
        : [];
    const requestedTier: SchemaTier =
      toolMode === "reduced" ? "REDUCED" : toolMode === "none" ? "NONE" : "FULL";

    /**
     * THE CEILING, APPLIED HERE — the last point before a provider sees it.
     * Everything below sends `fitted`, not the raw context, so a request that
     * can only be refused is made acceptable first.
     */
    const fitted = this.fitFor(provider, context, context.request.messages ?? [], offeredTools, requestedTier);
    const tools = fitted.tools;

    // The request as it will actually be sent, measured at the boundary where
    // it is assembled. Lengths and counts only: never content, never a key.
    context.logger.info(
      "ProviderResolver",
      "Request budget",
      describeRequestBudget({
        messages: fitted.messages as never,
        prompt: context.request.prompt,
        tools,
        tier: fitted.tier,
        provider: provider.name,
        model: context.request.model,
      }) as unknown as Record<string, unknown>,
    );

    const taskId = String(context.request.timestamp ?? Date.now());
    const messages: AIMessage[] = [...fitted.messages];
    const executed: Array<ToolRunRecord> = [];
    // What the tools produced, for the quality checkpoint (arguments only — no model).
    const qualityCalls: QualityCall[] = [];
    // What the model ASKED for, separately from what really ran.
    //
    // These are the same list on this path, by construction — every
    // accepted call is dispatched below. Recording both anyway is what
    // lets a reader downstream tell "the model wanted three tools and
    // got three" from "the model wanted three and one never reached the
    // dispatcher", without having to assume the loop is intact. A
    // completion claim is checked against executions, and a request
    // that produced no execution is exactly the gap that check exists
    // to catch.
    const requested: string[] = [];

    /**
     * The reply budget this turn will ask for — raised once if it is spent.
     * Providers that meter prompt and reply together count this against the
     * same minute, so a round that was truncated is re-fitted to the ceiling
     * for its new budget rather than sent blind (see sendRound).
     */
    let replyBudget = context.request.maxTokens ?? DEFAULT_OUTPUT_TOKENS;

    /**
     * Send ONE round, with the only retry that cannot repeat work.
     *
     * A round that comes back EMPTY and TRUNCATED (finish_reason=length) ran
     * out of output while thinking: nothing was produced, so nothing can be
     * replayed. It is re-asked once — with more reply room, and with the tool
     * schemas withheld so the extra room is not paid for out of the same
     * per-minute token ceiling. A round that already produced text or a tool
     * call never reaches this path; it is returned as it is.
     */
    const sendRound = async (
      roundMessages: AIMessage[],
      roundTools: Array<{ name: string; description?: string; parameters?: unknown }>,
      roundTier: SchemaTier,
      continuation: boolean,
    ): Promise<AIResponse> => {
      const send = (
        overrides: { budget?: number; tools?: typeof roundTools } = {},
      ): Promise<AIResponse> => {
        const budget = overrides.budget;
        const toolsForRound = overrides.tools ?? roundTools;
        const fittedRound =
          budget === undefined
            ? { messages: roundMessages, tools: toolsForRound }
            : this.fitFor(provider, context, roundMessages, toolsForRound, roundTier, budget);
        const request: AIRequest = this.withStreamingProgress(
          {
            ...this.withRungSignal(context.request, rungSignal),
            // A continuation round re-reads tool results; LÉLU's full self-state
            // was given on round 0 and is not re-sent (see continuationContext).
            ...(continuation ? { context: continuationContext(context.request.context) } : {}),
            messages: fittedRound.messages,
            ...(budget === undefined ? {} : { maxTokens: budget }),
            ...(fittedRound.tools.length
              ? { tools: fittedRound.tools as NonNullable<AIRequest["tools"]> }
              : {}),
          },
          onProgress,
        );
        return gatedGenerate(provider, request);
      };

      /** The one budget raise this round is allowed. */
      const raise = (): number | null => {
        const raised = Math.min(MAX_REPLY_TOKENS, Math.max(replyBudget, MIN_REPLY_TOKENS) * 2);
        if (raised <= replyBudget) return null;
        replyBudget = raised;
        return raised;
      };

      try {
        const first = await send();
        // A reply the output budget CUT OFF is not a whole answer. Measured
        // live 2026-11-27: a 300-token round returned 606 characters of a
        // sentence with finish_reason=length, and 2048 does the same to a long
        // one. Nothing was executed in that round, so asking again with more
        // room cannot repeat work — and the answer the person keeps is the
        // complete one. If the second attempt cannot improve on it, the real
        // partial reply is returned rather than an error.
        const truncatedAnswer =
          first.metadata?.truncated === true && (first.toolCalls?.length ?? 0) === 0;
        if (!truncatedAnswer) return first;
        const raised = raise();
        if (raised === null) return first;
        context.logger.info(
          "ProviderResolver",
          `${provider.name}'s answer was cut off by the output budget; re-asking once with more room and no tools`,
          {
            provider: provider.name,
            toTokens: raised,
            finishReason: first.metadata?.finishReason,
            partialChars: first.text?.length ?? 0,
          },
        );
        try {
          return await send({ budget: raised, tools: [] });
        } catch {
          return first;
        }
      } catch (error) {
        if (!(error instanceof EmptyCompletionError) || !error.truncated) throw error;
        const raised = raise();
        if (raised === null) throw error;
        context.logger.info(
          "ProviderResolver",
          `${provider.name}'s output budget ran out before it produced anything; re-asking once with more room and no tools`,
          {
            provider: provider.name,
            toTokens: raised,
            finishReason: error.finishReason,
            round: continuation ? "continuation" : "first",
          },
        );
        return await send({ budget: raised, tools: [] });
      }
    };

    // No native tool support, or nothing currently executable to offer: the
    // original single call — which now shares the round's truncation retry,
    // because an answer cut off by the output budget is the same failure
    // whether a tool was offered or not. ToolCallInterceptor still salvages
    // tool markup from these replies.
    if (tools.length === 0) {
      const plain = await sendRound(messages, [], requestedTier, false);
      onProgress?.();
      return plain;
    }

    let response = await sendRound(messages, tools, requestedTier, false);
    // A round that came back is proof the rung is alive.
    onProgress?.();
    let promptMaterialized = false;

    const loopStarted = Date.now();
    const recentSignatures: string[] = [];
    let stopReason = "";

    for (let round = 1; round <= TOOL_LOOP_MAX_ROUNDS; round += 1) {
      const calls = response.toolCalls ?? [];
      if (calls.length === 0) break;
      if (context.request.signal?.aborted) throw new Error("cancelled");

      // A stuck model repeats itself exactly. Detect that on the calls
      // it is ASKING for, before running them again.
      const signature = calls
        .map((call) => `${call.name}:${JSON.stringify(call.arguments ?? {})}`)
        .join("|");
      recentSignatures.push(signature);
      if (
        recentSignatures.length >= NO_PROGRESS_REPEATS &&
        recentSignatures.slice(-NO_PROGRESS_REPEATS).every((entry) => entry === signature)
      ) {
        stopReason = `the same tool call repeated ${NO_PROGRESS_REPEATS} times without progress`;
      }
      // Research-only so far, including the calls being asked for now?
      const researchOnly = [...requested, ...calls.map((call) => call.name)].every((name) => RESEARCH_TOOL.test(name));
      const budgetMs = researchOnly ? RESEARCH_LOOP_BUDGET_MS : TOOL_LOOP_BUDGET_MS;
      const maxRounds = researchOnly ? RESEARCH_LOOP_MAX_ROUNDS : TOOL_LOOP_MAX_ROUNDS;
      if (!stopReason && Date.now() - loopStarted > budgetMs) {
        stopReason = `the ${Math.round(budgetMs / 60000)}-minute ${researchOnly ? "research" : "tool"} budget was spent`;
      }
      if (!stopReason && round >= maxRounds) {
        stopReason = `the ${maxRounds}-round ${researchOnly ? "research " : ""}limit was reached`;
      }

      // Put the user's actual question INTO the conversation before any
      // tool turns follow it.
      //
      // Providers append request.prompt themselves as the trailing turn,
      // and they stop doing so once the tail is a tool result — otherwise
      // the question is asked again after it has been answered. That
      // leaves the prompt nowhere at all on round two unless it is
      // materialized here, so the model was being handed a tool result
      // with no question attached, and the exchange also opened on an
      // assistant turn, which the Messages API rejects outright.
      if (!promptMaterialized) {
        messages.push({ role: "user", content: context.request.prompt });
        promptMaterialized = true;
      }

      // What she said she was doing alongside the request ("I'm checking
      // current sources") is a status line for the activity — the reply
      // itself is the final answer, not this.
      if (response.text?.trim()) {
        AgentEventBus.getInstance().emit({ type: "tool_narration", taskId, text: response.text.trim().slice(0, 400) });
      }

      // Record the request turn before its results, so the pairing the
      // providers replay stays intact.
      messages.push({
        role: "assistant",
        content: response.text ?? "",
        toolCalls: calls,
        // Replayed verbatim by the provider that produced it (Anthropic's
        // thinking blocks must survive the round trip); ignored by others.
        ...(response.providerBlocks ? { providerBlocks: response.providerBlocks } : {}),
      });

      // A model that asks for the same call twice in one round must not run
      // it twice: a side-effecting tool would apply its change again. The
      // repeat reuses the first result and says so.
      const seenThisRound = new Map<string, { ok: boolean; content: string }>();

      for (const call of calls) {
        // Never start a tool after the user pressed stop.
        throwIfStopped(context);
        requested.push(call.name);
        const callKey = `${call.name}:${JSON.stringify(call.arguments ?? {})}`;
        const already = seenThisRound.get(callKey);
        if (already) {
          executed.push({ tool: call.name, ok: already.ok });
          // A suppressed repeat is evidence of its own: it was NOT executed a
          // second time, and the record must never read as another success.
          AgentEventBus.getInstance().emit({
            type: "execution_evidence",
            taskId,
            record: {
              executionId: `chat-suppressed-${Date.now().toString(36)}-${call.id}`,
              taskId,
              path: "chat",
              tool: call.name,
              approval: "not-required",
              stage: "suppressed",
              outcome: "suppressed",
              reason: `Repeated ${call.name} with identical arguments in the same round; the first result was reused instead of running it again.`,
            },
          });
          context.logger.info(
            "ProviderResolver",
            `Tool ${call.name} was requested twice in one round; the repeat reused the first result`,
            { tool: call.name, round },
          );
          messages.push({
            role: "tool",
            content: `Not run again: ${call.name} was already executed with these exact arguments in this round. Its result was:\n\n${already.content}`,
            toolCallId: call.id,
            toolName: call.name,
            toolError: !already.ok,
          });
          continue;
        }
        const result = await dispatchToolCall(call, taskId, context, {
          path: "chat",
          turnSignature: context.request.prompt,
        });
        seenThisRound.set(callKey, { ok: result.ok, content: result.content });
        // A tool that finished running is progress, however long it took.
        onProgress?.();
        executed.push({ tool: call.name, ok: result.ok });
        // ALSO record it where a later provider failure cannot erase it.
        // A tool that ran, ran: if this provider throws on the next
        // round the chain falls through, and without this the cycle
        // would report "no action taken" about a workflow it really
        // created.
        toolsReallyRun?.push({
          tool: call.name,
          ok: result.ok,
          summary: summarizeToolResult(result.content),
          // The body, capped: if the provider stops before writing the answer,
          // this is what a recovered narration is written from.
          content: toolEvidence(result.content),
        });
        context.logger.info("ProviderResolver", `Tool ${call.name} -> ${result.ok ? "ok" : "failed"}`, {
          tool: call.name,
          ok: result.ok,
          round,
        });
        const qualityCall: QualityCall = { name: call.name, args: (call.arguments ?? {}) as Record<string, unknown>, ok: result.ok };
        qualityCalls.push(qualityCall);
        const deficiency = checkCall(context.request.prompt ?? "", qualityCall);
        messages.push({
          role: "tool",
          content: deficiency ? `${result.content}${inLoopNote(deficiency)}` : result.content,
          toolCallId: call.id,
          toolName: call.name,
          toolError: !result.ok,
        });
      }

      // The user spoke while the tools ran. Hand it to the model now, so
      // a new instruction changes the work in progress rather than
      // waiting behind it.
      for (const text of context.request.drainSteering?.() ?? []) {
        context.request.steered = [...(context.request.steered ?? []), text];
        AgentEventBus.getInstance().emit({ type: "user_steering", taskId, text: text.slice(0, 400) });
        messages.push({
          role: "user",
          content:
            `[The user sent this while you were working. Take it into account from now on, ` +
            `adjust what you are doing if it changes the task, and acknowledge it briefly in your reply.]\n${text}`,
        });
      }

      // Tell the model WHY it is being cut off, so its final answer
      // reports where the work actually stopped instead of trailing off
      // mid-plan as though it had finished.
      if (stopReason) {
        messages.push({
          role: "user",
          content:
            `[system] The tool loop is ending because ${stopReason}. Do not request more ` +
            `tools. Report exactly what you completed, what you verified, and what remains.`,
        });
      }

      // The history grew while the tools ran: fit it again before the next
      // round, so a long tool loop cannot walk into the same 413 the first
      // request was trimmed to avoid. The most recent twelve messages are
      // protected — that is this round's question and its results.
      const roundTier: SchemaTier = stopReason
        ? "NONE"
        : tools.length === offeredTools.length
          ? requestedTier
          : "REDUCED";
      const refitted = this.fitFor(
        provider,
        context,
        messages,
        stopReason ? [] : tools,
        roundTier,
      );
      response = await sendRound(refitted.messages, refitted.tools, roundTier, true);
      onProgress?.();

      if (stopReason) break;
    }

    // Provenance: what actually ran, on the response itself. MemoryBridge
    // reads execution events for the same purpose, and the timeline reads
    // the events the dispatcher emitted — this is the record on the reply.
    //
    // `nativeTools` is set even when the model chose to call nothing. It
    // marks the response as having come from a provider that HAD its
    // chance to invoke tools for real, which is what tells
    // ToolCallInterceptor to stand down: tool-shaped text from such a
    // provider is prose about tools, not an unexecuted request, and
    // re-running it would execute a second time and throw away the
    // grounded answer.
    // A result she reports must have a tool behind it (ClaimGrounding):
    // claims about tools that did not run successfully this turn are
    // marked "not verified" in the reply itself.
    const ranThisTurn = [...(toolsReallyRun ?? []), ...executed];
    // A tool result already in the conversation is real evidence — of an
    // EARLIER turn. Passing it separately is what lets the note say "history,
    // not a fresh check" instead of accusing her of inventing a result she
    // really did produce a few minutes ago (Mission 44.7).
    const earlierRuns: EarlierToolRun[] = (context.request.messages ?? [])
      .filter((message) => message.role === "tool" && typeof message.toolName === "string" && message.toolName.length > 0)
      .map((message) => ({ tool: String(message.toolName) }));
    const ungrounded = ungroundedClaims(response.text ?? "", ranThisTurn, earlierRuns);
    const evidence = claimEvidenceCounts(ungrounded);
    if (ungrounded.length > 0) {
      context.logger.info("ProviderResolver", "Reply claims tool results with no tool behind them", {
        claims: ungrounded.map((claim) => claim.label),
        evidence,
        freshness: ungrounded.filter((claim) => claim.fresh).length,
        toolsExecuted: executed.map((entry) => entry.tool),
      });
    }
    // ...and the numbers she reports must be the ones measured.
    const contradicted = contradictedCaptureClaims(response.text ?? "", latestCaptureMeasurements());
    if (contradicted.length > 0) {
      context.logger.info("ProviderResolver", "Reply contradicts measured capture results", {
        claims: contradicted.map((claim) => `${claim.target}: ${claim.claimed}`),
      });
    }
    // A claim that comes from MEMORY has evidence too — but it is memory, not
    // a measurement (Mission 44.8, WP02). When the reply itself attributes
    // something to memory, the records recalled for this turn are read for
    // provenance: when each was recorded, where it came from, and whether it
    // is contradicted. That note is what stops "I remember…" from sounding
    // like "I have just checked…".
    const memoryClaims = ungrounded.filter((claim) => claim.family === "memory");
    const memoryReading =
      memoryClaims.length > 0 && (context.recalledMemories?.length ?? 0) > 0
        ? readMemory(context.recalledMemories!)
        : null;
    const memoryNote = memoryReading ? memoryProvenanceNote(memoryReading, { limit: 2 }) : "";
    // Quality checkpoint: what is still below the bar is said, not hidden.
    const deficiencies = assessTurn(context.request.prompt ?? "", qualityCalls);
    return {
      ...response,
      // A claim of a FRESH result is corrected before the reply, not after it:
      // the reader who stops at the first line must not be left believing an
      // old answer was a new check (Mission 44.6, measured on a phone).
      text: `${freshnessCorrection(ungrounded, { earlierRuns })}${response.text ?? ""}${groundingNote(ungrounded)}${memoryNote ? `\n\n${memoryNote}` : ""}${contradictionNote(contradicted)}${qualityNotice(deficiencies)}`,
      metadata: {
        ...response.metadata,
        ...(deficiencies.length ? { qualityDeficiencies: deficiencies } : {}),
        ...(ungrounded.length ? { ungroundedClaims: ungrounded.map((claim) => claim.label) } : {}),
        ...(ungrounded.length ? { claimEvidence: evidence } : {}),
        ...(memoryReading ? { memoryProvenance: memoryReading.counts } : {}),
        ...(contradicted.length ? { contradictedClaims: contradicted.map((claim) => `${claim.target}: ${claim.claimed}`) } : {}),
        nativeTools: true,
        ...(executed.length
          ? { toolsExecuted: executed, toolRounds: executed.length }
          : {}),
        ...(requested.length ? { toolsRequested: requested } : {}),
        ...(stopReason ? { toolLoopStopped: stopReason } : {}),
      },
    };
  }

  private async executeProvider(
    provider: AIProvider,
    context: RouterContext,
    toolsReallyRun?: Array<ToolRunRecord>,
    rungSignal?: AbortSignal,
    toolMode: "full" | "reduced" | "none" = "full",
    onProgress?: () => void,
  ): Promise<AIResponse> {
    const started = Date.now();
    const response = await this.generateWithTools(
      provider,
      context,
      toolsReallyRun,
      rungSignal,
      toolMode,
      onProgress,
    );

    if (!response || typeof response.text !== "string") {
      throw new Error(`${provider.name} returned an invalid response.`);
    }

    const text = response.text.trim();

    if (!text) {
      throw new Error(`${provider.name} returned empty response text.`);
    }

    return {
      ...response,
      text,
      provider: response.provider || provider.name,
      model: response.model || context.request.model || "unknown",
      processingTime:
        response.processingTime > 0
          ? response.processingTime
          : Date.now() - started,
      metadata: {
        ...response.metadata,
        providerPriority: provider.priority,
      },
    };
  }

  /**
   * Write the answer from results that already exist.
   *
   * A provider can stop between "the tools ran" and "say what they mean".
   * The evidence is still real, so the reply should be an answer about it —
   * not a list of steps, and never the offline notice. This asks the NEXT
   * provider for prose only:
   *
   *   • no tool schemas are offered, so no step can be executed twice, and
   *     no second side effect is possible;
   *   • the tool results travel as text, in the same request, so the answer
   *     is grounded in what was measured rather than in what the model
   *     believes;
   *   • the model is told to name what the results do NOT cover, so a partial
   *     answer is labelled partial instead of being padded;
   *   • the attempt is bounded by the rung budget and capped at two providers.
   *
   * Null means no provider could write it — the caller then reports the step
   * list it already has.
   */
  private async narrateFromResults(
    context: RouterContext,
    ran: ToolRunRecord[],
    failedProvider: string,
    reason: string,
    candidates: AIProvider[],
    remainingMs: number,
  ): Promise<AIResponse | null> {
    if (candidates.length === 0 || remainingMs < MIN_RUNG_SLICE_MS * 2) return null;

    const evidence = ran
      .slice(0, 8)
      .map((record, index) => {
        const body = record.content ?? record.summary ?? "(the tool returned no text)";
        return `${index + 1}. ${record.tool} — ${record.ok ? "succeeded" : "failed"}\n${body}`;
      })
      .join("\n\n");

    const instruction = [
      `[system] ${failedProvider} stopped before writing the answer (${reason.slice(0, 160)}).`,
      "The steps below have ALREADY RUN and their results are real. Nothing will be repeated.",
      "You have no tools on this turn — do not ask for one. Answer the person's question using ONLY",
      "these results, and say plainly which part of the question they do not cover. Do not invent a",
      "result, a number or a source that is not below.",
      "",
      `The question was: ${context.request.prompt}`,
      "",
      "Results already obtained:",
      evidence,
    ].join("\n");

    const narratedContext: RouterContext = {
      ...context,
      request: {
        ...context.request,
        // No history and no tool results as messages: a bare question keeps the
        // narration request small, and an orphaned `tool` message would be
        // rejected outright by the OpenAI-shaped providers.
        messages: [{ role: "user", content: instruction }],
        maxTokens: Math.max(context.request.maxTokens ?? 0, MIN_REPLY_TOKENS),
      },
    };

    let budgetLeft = remainingMs;
    for (const provider of candidates.slice(0, MAX_NARRATION_PROVIDERS)) {
      if (budgetLeft < MIN_RUNG_SLICE_MS * 2) break;
      if (!provider.canHandle(context.request.prompt)) continue;
      const started = Date.now();
      const slice = Math.min(this.rungBudgetMs, budgetLeft);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), slice);
      try {
        const response = await this.executeProvider(
          provider,
          narratedContext,
          // Deliberately not recorded again: these are the same steps, and the
          // caller attaches them once.
          undefined,
          controller.signal,
          "none",
        );
        context.logger.info(
          "ProviderResolver",
          `${provider.name} wrote the answer from ${ran.length} completed step(s) after ${failedProvider} stopped`,
          {
            provider: provider.name,
            failedProvider,
            steps: ran.map((record) => record.tool),
            latencyMs: Date.now() - started,
          },
        );
        return {
          ...response,
          text:
            `${response.text}\n\nProvenance: this answer was written from the ${ran.length} step(s) that ran ` +
            `before ${failedProvider} stopped (${reason.slice(0, 120)}). No step was run again.`,
          metadata: {
            ...response.metadata,
            success: true,
            narratedAfterFailure: {
              failedProvider,
              narratedBy: response.provider,
              steps: ran.map((record) => record.tool),
            },
            toolsExecuted: ran.map(publicToolRun),
            toolsRanBeforeFallback: true,
            toolLoopStopped: "narration-recovered",
          },
        };
      } catch (error) {
        // A Stop outranks the recovery: the person ended the turn.
        if (stopped(context, error)) throwIfStopped(context, error);
        const message = error instanceof Error ? error.message : String(error);
        context.aiProviders.markFailure(provider.name, message);
        context.logger.info(
          "ProviderResolver",
          `${provider.name} could not write the answer from completed step(s); the step list will be reported instead.`,
          { provider: provider.name, fallbackReason: message.slice(0, 200) },
        );
      } finally {
        clearTimeout(timer);
      }
      budgetLeft -= Date.now() - started;
    }
    return null;
  }

  /**
   * Carry the actions that really happened onto an answer that did not
   * come from the provider that performed them.
   *
   * Silence here is the dangerous direction: an unrecorded action is one
   * the runtime believes never occurred.
   */
  private withRealTools(
    response: AIResponse,
    toolsReallyRun: Array<ToolRunRecord>,
  ): AIResponse {
    if (toolsReallyRun.length === 0) return response;
    return {
      ...response,
      metadata: {
        ...response.metadata,
        toolsExecuted: toolsReallyRun.map(publicToolRun),
        toolsRanBeforeFallback: true,
      },
    };
  }

  private offline(context: RouterContext, offlineMode = false, chainErrors: string[] = []): AIResponse {
    const started = context.started;

    // If knowledge tools already retrieved real data for this
    // request, surface it instead of the generic offline notice —
    // "no provider" must never hide retrieved information.
    if (context.researchResults && context.researchResults.length > 0) {
      const digest = context.researchResults
        .slice(0, 6)
        .map((result, index) => {
          const content = (result.content ?? "").replace(/\s+/g, " ").trim();
          const excerpt = content.length > 180 ? `${content.slice(0, 179)}…` : content;
          return `${index + 1}. ${result.title}${excerpt ? ` — ${excerpt}` : ""}${result.source ? ` (source: ${result.source})` : ""}${result.url ? `\n   ${result.url}` : ""}`;
        })
        .join("\n\n");

      return {
        text: `Here's what I found:\n\n${digest}`,
        provider: "research",
        model: "knowledge",
        processingTime: Date.now() - started,
        metadata: {
          count: context.researchResults.length,
          offline: true,
          research: true,
        },
      };
    }

    // Say what really happened. "Unreachable or unconfigured" was read out
    // for every failure — including a provider that was reached and simply
    // ran out of time (Mission 10.3, 18 of 20 turns).
    const failureKind = offlineMode ? "provider-unavailable" : classifyChainFailure(chainErrors);
    if (!offlineMode && chainErrors.length > 0 && failureKind !== "provider-unavailable") {
      return {
        text:
          failureKind === "provider-timeout"
            ? "I couldn't get an answer in time — the model provider took too long to reply and the other providers are unavailable right now. Nothing was lost; ask me again."
            : failureKind === "provider-rate-limited"
              // Measured live in Mission 44.7: injecting a 429 on every model
              // call produced "all AI providers are unreachable or
              // unconfigured". They were reached, and they answered.
              ? "Every provider that could answer is rate-limited or out of capacity for this model right now, so the request never reached one. Nothing was lost — nothing ran and nothing was sent twice. Give it a minute and ask again."
              : "The network failed while I was reaching the model providers. Nothing was lost; ask me again once you're back online.",
        provider: "offline",
        model: "offline",
        processingTime: Date.now() - started,
        metadata: { success: false, reason: "all-ai-providers-failed", failureKind, offline: true },
      };
    }
    return {
      text: offlineMode
        ? "I'm in local / offline mode right now — remote AI providers are disabled, and no local model runtime is installed yet, so I can't generate new answers. My local memory, your profile and our shared history are still here and I'm still recording this conversation locally. Turn offline mode off in Settings → Local-first model engine, or ask \"who are you\" / \"who am I\"."
        : "I'm in offline mode right now — all AI providers are unreachable or unconfigured, so I can't generate new answers. My local memory, your profile and our shared history are still here and I'm still recording this conversation locally. Try asking \"who are you\", \"who am I\", or about something we've discussed.",
      provider: "offline",
      model: "offline",
      processingTime: Date.now() - started,
      metadata: {
        success: false,
        reason: "all-ai-providers-failed",
        failureKind,
        offline: true,
        identity: true,
        memory: true,
      },
    };
  }
}


/**
 * Did the provider refuse the REQUEST for its size, rather than fail?
 *
 * Deliberately only the size ceilings — 413, a token/context ceiling, or a
 * tokens-per-minute limit — because those are the refusals the SAME provider
 * answers when the request is smaller. A daily quota and a refused credential
 * are not here: sending those smaller changes nothing, and the registry gives
 * them their own cooldown instead of a retry.
 */
function requestTooLarge(reason: string): boolean {
  return /\b413\b|too large|tokens per minute|\btpm\b|maximum context|context length|request entity/i.test(
    reason,
  );
}

/**
 * Rethrow as an AbortError when the turn's own signal has been aborted
 * (the user pressed Stop), so AIService settles it as cancelled.
 */
function throwIfStopped(context: RouterContext, cause?: unknown): void {
  const signal = (context.request as { signal?: AbortSignal }).signal;
  if (!signal?.aborted) return;
  if (cause instanceof Error && cause.name === "AbortError") throw cause;
  throw new DOMException("Turn stopped by the user.", "AbortError");
}

/**
 * Has the TURN been stopped? Only when the turn's own signal is aborted.
 *
 * An AbortError from below with the turn's signal intact is a provider
 * aborting its own request — e.g. OpenRouter's internal 30 s
 * AbortSignal.timeout, which surfaces in Chrome as "BodyStreamBuffer was
 * aborted" (AbortError). Treating that as a Stop settled live voice turns as
 * "Stopped before anything ran." instead of falling through to the next
 * provider (found live, 2026-11-07). A Stop always aborts the turn signal
 * (AIService composes it from the turn and conversation controllers), so
 * nothing a user does is missed by this.
 */
function stopped(context: RouterContext, _cause?: unknown): boolean {
  const signal = (context.request as { signal?: AbortSignal }).signal;
  return Boolean(signal?.aborted);
}
