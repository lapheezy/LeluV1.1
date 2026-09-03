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

import type AIProvider from "../../providers/AIProvider";
import type { AIMessage, AIResponse } from "../../providers/AIProvider";
import type RouterContext from "./RouterContext";
import type { ProviderResult } from "./RouterResults";
import AgentEventBus from "../agent/AgentEvents";
import ModelRouter from "../model/ModelRouter";
import { dispatchToolCall } from "../tools/ToolDispatcher";
import { toolSchemasForModel } from "../tools/ToolSchemas";

/**
 * How many generate -> execute -> generate rounds one request may take.
 * Enough for a model to search, read the result and follow up once;
 * short enough that a looping model cannot burn the request.
 */
const MAX_TOOL_ROUNDS = 4;

export default class ProviderResolver {
  public async execute(context: RouterContext): Promise<ProviderResult> {
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
        response: this.offline(context),
      };
    }

    // The model router decides *how* to route: modality (vision/text),
    // hardware tier, and explicit offline mode. Remote providers are
    // optional fallbacks — in offline mode they are skipped even when
    // a key happens to be configured, so LÉLU stays local-first.
    const router = ModelRouter.getInstance();
    const decision = router.route(context.request);

    context.logger.info(
      "ProviderResolver",
      "Model routing decision",
      {
        modality: decision.modality,
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
        response: this.offline(context, true),
      };
    }

    // Agent delegation can request a preferred provider (and a fallback
    // provider) per task. The router's modality/hardware ordering is
    // tried first, in the requested order; after it is exhausted the
    // normal priority chain continues, so a preferred provider failure
    // still falls through to every other configured provider instead of
    // breaking the agent.
    const ordered = this.orderByPreference(eligible, decision.preferredProviders);

    for (const provider of ordered) {
      if (!provider.canHandle(context.request.prompt)) {
        context.logger.info(
          "ProviderResolver",
          `${provider.name} cannot handle request.`,
          { provider: provider.name },
        );
        continue;
      }

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

        const response = await this.executeProvider(provider, context);
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
        const message = error instanceof Error ? error.message : String(error);
        context.aiProviders.markFailure(provider.name, message);
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
      response: this.offline(context),
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
  private async generateWithTools(
    provider: AIProvider,
    context: RouterContext,
  ): Promise<AIResponse> {
    const tools = provider.supportsTools === true ? toolSchemasForModel() : [];

    // No native tool support, or nothing currently executable to offer:
    // the original single call, untouched.
    if (tools.length === 0) {
      return provider.generate(context.request);
    }

    const taskId = String(context.request.timestamp ?? Date.now());
    const messages: AIMessage[] = [...(context.request.messages ?? [])];
    const executed: Array<{ tool: string; ok: boolean }> = [];

    let response = await provider.generate({ ...context.request, messages, tools });
    let promptMaterialized = false;

    for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
      const calls = response.toolCalls ?? [];
      if (calls.length === 0) break;

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

      // Record the request turn before its results, so the pairing the
      // providers replay stays intact.
      messages.push({
        role: "assistant",
        content: response.text ?? "",
        toolCalls: calls,
      });

      for (const call of calls) {
        const result = await dispatchToolCall(call, taskId, context);
        executed.push({ tool: call.name, ok: result.ok });
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

      const lastRound = round === MAX_TOOL_ROUNDS;
      response = await provider.generate({
        ...context.request,
        messages,
        ...(lastRound ? {} : { tools }),
      });
    }

    if (executed.length === 0) {
      return response;
    }

    // Provenance: what actually ran, on the response itself. MemoryBridge
    // reads execution events for the same purpose, and the timeline reads
    // the events the dispatcher emitted — this is the record on the reply.
    return {
      ...response,
      metadata: {
        ...response.metadata,
        toolsExecuted: executed,
        toolRounds: executed.length,
      },
    };
  }

  private async executeProvider(
    provider: AIProvider,
    context: RouterContext,
  ): Promise<AIResponse> {
    const started = Date.now();
    const response = await this.generateWithTools(provider, context);

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

  private offline(context: RouterContext, offlineMode = false): AIResponse {
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
        offline: true,
        identity: true,
        memory: true,
      },
    };
  }
}
