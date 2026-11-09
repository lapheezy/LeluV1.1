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

import { resolveFirst } from "../resolveEnv";
import { classifyChainFailure } from "../voice/turnFailure";
import { contradictedCaptureClaims, contradictionNote, groundingNote, ungroundedClaims } from "../tools/ClaimGrounding";
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
const TOOL_TURN_MAX_TOKENS = 768;
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
  ) {
    const fitted = fitRequestBudget({
      messages,
      prompt: context.request.prompt,
      tools,
      tier,
      provider: provider.name,
      model: context.request.model,
      ...(context.request.maxTokens ? { maxTokens: context.request.maxTokens } : {}),
      ...(this.requestCeilingBytes ? { limitBytes: this.requestCeilingBytes } : {}),
      protectedTail: 12,
    });
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
    const toolsReallyRun: Array<{ tool: string; ok: boolean }> = [];
    /** Why each provider in the chain failed — so the final notice can say timeout vs network vs unavailable. */
    const chainErrors: string[] = [];

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

        return {
          handled: true,
          response,
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
          return {
            handled: true,
            response: {
              text:
                `I did the work — I ran ${names.join(", ")} — but ${provider.name} failed before it could ` +
                `write the summary: ${message}. Nothing was repeated, and everything I ran is listed above.`,
              provider: provider.name,
              model: context.request.model ?? "unknown",
              processingTime: Date.now() - context.started,
              metadata: {
                success: false,
                partial: true,
                toolsExecuted: ranThisRung,
                // The same contract the fallback path keeps: work that
                // happened before the answer is marked as such, so nothing
                // reads it as the answering provider's own doing.
                toolsRanBeforeFallback: true,
                toolLoopStopped: "provider-failed-after-tools",
              },
            },
          };
        }
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
      response: this.withRealTools(this.offline(context, false, chainErrors), toolsReallyRun),
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
    toolsReallyRun: Array<{ tool: string; ok: boolean }> | undefined,
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

  private async generateWithTools(
    provider: AIProvider,
    context: RouterContext,
    toolsReallyRun?: Array<{ tool: string; ok: boolean }>,
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

    // No native tool support, or nothing currently executable to offer:
    // the original single call, untouched. This is the fallback path —
    // ToolCallInterceptor still salvages tool markup from these.
    if (tools.length === 0) {
      return gatedGenerate(provider, {
        ...this.withRungSignal(context.request, rungSignal),
        messages: fitted.messages,
      });
    }

    const taskId = String(context.request.timestamp ?? Date.now());
    const messages: AIMessage[] = [...fitted.messages];
    const executed: Array<{ tool: string; ok: boolean }> = [];
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

    let response = await gatedGenerate(provider, {
      ...this.withRungSignal(lean(context.request), rungSignal),
      messages,
      tools,
    });
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

      for (const call of calls) {
        // Never start a tool after the user pressed stop.
        throwIfStopped(context);
        requested.push(call.name);
        const result = await dispatchToolCall(call, taskId, context);
        // A tool that finished running is progress, however long it took.
        onProgress?.();
        executed.push({ tool: call.name, ok: result.ok });
        // ALSO record it where a later provider failure cannot erase it.
        // A tool that ran, ran: if this provider throws on the next
        // round the chain falls through, and without this the cycle
        // would report "no action taken" about a workflow it really
        // created.
        toolsReallyRun?.push({ tool: call.name, ok: result.ok });
        context.logger.info("ProviderResolver", `Tool ${call.name} -> ${result.ok ? "ok" : "failed"}`, {
          tool: call.name,
          ok: result.ok,
          round,
        });
        messages.push({
          role: "tool",
          content: result.content,
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
      const refitted = this.fitFor(
        provider,
        context,
        messages,
        stopReason ? [] : tools,
        stopReason ? "NONE" : tools.length === offeredTools.length ? requestedTier : "REDUCED",
      );
      response = await gatedGenerate(provider, {
        ...this.withRungSignal(context.request, rungSignal),
        messages: refitted.messages,
        ...(refitted.tools.length ? { tools: refitted.tools } : {}),
      });
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
    const ungrounded = ungroundedClaims(response.text ?? "", executed);
    if (ungrounded.length > 0) {
      context.logger.info("ProviderResolver", "Reply claims tool results with no tool behind them", {
        claims: ungrounded.map((claim) => claim.label),
      });
    }
    // ...and the numbers she reports must be the ones measured.
    const contradicted = contradictedCaptureClaims(response.text ?? "", latestCaptureMeasurements());
    if (contradicted.length > 0) {
      context.logger.info("ProviderResolver", "Reply contradicts measured capture results", {
        claims: contradicted.map((claim) => `${claim.target}: ${claim.claimed}`),
      });
    }
    return {
      ...response,
      text: `${response.text ?? ""}${groundingNote(ungrounded)}${contradictionNote(contradicted)}`,
      metadata: {
        ...response.metadata,
        ...(ungrounded.length ? { ungroundedClaims: ungrounded.map((claim) => claim.label) } : {}),
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
    toolsReallyRun?: Array<{ tool: string; ok: boolean }>,
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
   * Carry the actions that really happened onto an answer that did not
   * come from the provider that performed them.
   *
   * Silence here is the dangerous direction: an unrecorded action is one
   * the runtime believes never occurred.
   */
  private withRealTools(
    response: AIResponse,
    toolsReallyRun: Array<{ tool: string; ok: boolean }>,
  ): AIResponse {
    if (toolsReallyRun.length === 0) return response;
    return {
      ...response,
      metadata: {
        ...response.metadata,
        toolsExecuted: toolsReallyRun,
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
