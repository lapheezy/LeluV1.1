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
import type { AIResponse } from "../../providers/AIProvider";
import type RouterContext from "./RouterContext";
import type { ProviderResult } from "./RouterResults";
import AgentEventBus from "../agent/AgentEvents";

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

    // Agent delegation can request a preferred provider (and a fallback
    // provider) per task. Those are tried first, in the requested order;
    // after they are exhausted the normal priority chain continues, so a
    // preferred provider failure still falls through to every other
    // configured provider instead of breaking the agent.
    const ordered = this.orderByPreference(providers, context.request.preferredProviders);

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

  private async executeProvider(
    provider: AIProvider,
    context: RouterContext,
  ): Promise<AIResponse> {
    const started = Date.now();
    const response = await provider.generate(context.request);

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

  private offline(context: RouterContext): AIResponse {
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
      text:
        "I'm in offline mode right now — all AI providers are unreachable or unconfigured, so I can't generate new answers. My local memory, your profile and our shared history are still here and I'm still recording this conversation locally. Try asking \"who are you\", \"who am I\", or about something we've discussed.",
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
