/**
 * ==========================================================
 * LÉLU
 * ENGINEERING RESOLVER
 *
 * Connects LÉLU's engineering cognition to the EXISTING runtime:
 * her engineering functions are ACTIONABLE TOOLS, not interface
 * entries. When a request is an engineering task this stage runs
 *
 *   OBSERVE   → inspect the live runtime/system state
 *   UNDERSTAND→ determine what is happening
 *   DIAGNOSE  → identify likely root causes
 *   PLAN      → decide the smallest appropriate next step
 *   ACT       → hand off to the existing AI provider chain with
 *               the diagnostics attached (no second runtime)
 *   VERIFY    → the provider reasons over real state
 *   REMEMBER  → persist durable engineering knowledge locally
 *
 * If no AI provider is reachable, a deterministic diagnostic
 * report is composed from the observed state instead of a dead-end
 * offline notice — engineering introspection never depends on an
 * external API.
 * ==========================================================
 */

import type RouterContext from "./RouterContext";
import type { BrainResult } from "./RouterResults";
import type { AIResponse } from "../../providers/AIProvider";
import IntentDetector from "./IntentDetector";
import AgentEventBus from "../agent/AgentEvents";
import { isIdentityOrProfileQuestion } from "../../brain/LeluIdentity";

export default class EngineeringResolver {
  private readonly detector = new IntentDetector();

  public async execute(context: RouterContext): Promise<BrainResult> {
    const prompt = context.request.prompt;
    const intent = this.detector.detect(prompt);

    if (intent !== "engineering" && !this.isEngineeringPrompt(prompt)) {
      return { handled: false };
    }

    // Identity/profile questions are answered locally first.
    if (isIdentityOrProfileQuestion(prompt)) {
      return { handled: false };
    }

    context.logger.info("EngineeringResolver", "Engineering task detected; observing runtime state.", {
      prompt,
    });

    const events = AgentEventBus.getInstance();
    const taskId = String(context.request.timestamp ?? Date.now());
    events.emit({ type: "tool_selected", taskId, tool: "engineering", label: "runtime inspection" });
    events.emit({ type: "tool_started", taskId, tool: "engineering", label: "observing runtime state" });

    const snapshot = await this.observe(context);
    const findings = this.diagnose(context);

    context.engineering = {
      snapshot,
      findings,
      timestamp: Date.now(),
    };

    // Attach the diagnostics so the provider (if any) reasons over
    // REAL runtime state instead of guessing.
    context.request.context = [context.request.context, `## System Diagnostics\n${snapshot}`]
      .filter((value) => Boolean(value && value.trim().length > 0))
      .join("\n\n");

    events.emit({
      type: "tool_result",
      taskId,
      tool: "engineering",
      result: findings.join(" ").slice(0, 400),
    });

    // REMEMBER: persist durable engineering knowledge (e.g. a
    // provider that is missing its key, or a known failure cause).
    for (const finding of findings) {
      if (this.isDurable(finding)) {
        try {
          await context.brain.rememberSystem(
            finding,
            finding.toLowerCase().split(/\s+/).filter((word) => word.length > 3).slice(0, 8),
          );
        } catch (error) {
          context.logger.error("EngineeringResolver", "Failed to persist engineering memory.", {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    let providersAvailable = 0;
    try {
      providersAvailable = (await context.aiProviders.available()).length;
    } catch {
      providersAvailable = 0;
    }

    if (providersAvailable > 0) {
      context.logger.info("EngineeringResolver", "Diagnostics attached; provider will reason over them.", {
        findingCount: findings.length,
      });
      return { handled: false };
    }

    // Offline: deterministic diagnostic report from observed state.
    context.logger.info("EngineeringResolver", "No AI provider; composing diagnostic report from observed state.", {
      findingCount: findings.length,
    });
    return { handled: true, response: this.diagnosticReport(context, snapshot, findings) };
  }

  /**
   * Engineering prompts that the generic intent detector misses:
   * provider/configuration/runtime diagnostics. The result is the
   * same — the request gets live diagnostics attached, and the
   * provider reasons over them; nothing is rewritten or guessed.
   */
  private isEngineeringPrompt(prompt: string): boolean {
    const text = prompt.toLowerCase();

    return (
      /(engineer|engineering|diagnos|debug|bug|compile|compiler|typescript|javascript|react|vite|implement|refactor|crash|sandbox|api key|configured|configuration|runtime|provider|groq|openrouter|cerebras|mistral|fireworks|github models|not working|failed|verify|inspect|diagnostic|system state|status of|build check)/.test(text) &&
      !/(who are you|who am i|tell me about yourself)/.test(text)
    );
  }



  /**
   * OBSERVE: collect a read-only snapshot of the live system.
   * Never includes credentials — only safe status diagnostics.
   */
  private async observe(context: RouterContext): Promise<string> {
    const lines: string[] = [];
    const now = new Date().toLocaleTimeString();

    lines.push(`Observed at ${now}`);

    // AI providers: state + health.
    const providers = context.aiProviders.statusSnapshot();
    if (providers.length > 0) {
      lines.push("AI providers:");
      for (const provider of providers) {
        let health = "";
        try {
          const report = await context.aiProviders.get(provider.name)?.health();
          health = report
            ? `available=${report.available}, error=${report.lastError ?? "none"}`
            : "unreachable";
        } catch (error) {
          health = `health check failed (${error instanceof Error ? error.message : String(error)})`;
        }
        lines.push(
          `- ${provider.name} (priority ${provider.priority}): ${provider.inCooldown ? "cooldown after failure" : "ok"}, ${health}${provider.lastSuccess ? `, last success ${new Date(provider.lastSuccess).toLocaleTimeString()}` : ""}`,
        );
      }
    } else {
      lines.push("AI providers: none registered");
    }

    // Knowledge providers: just names/categories (no live probing).
    const knowledge = context.knowledgeProviders.all();
    if (knowledge.length > 0) {
      lines.push(
        `Knowledge providers: ${knowledge.map((provider) => `${provider.name}(${provider.category})`).join(", ")}`,
      );
    }

    // Memory reflection.
    try {
      const reflection = await context.brain.reflect();
      lines.push(
        `Memory: ${reflection.memories.length} significant pattern(s), themes: ${reflection.activeThemes.slice(0, 5).join(", ") || "none"}`,
      );
    } catch {
      lines.push("Memory: unavailable");
    }

    // Conversation awareness.
    try {
      const conversation = context.brain.getConversation().context();
      lines.push(`Conversation: ${conversation.messageCount} message(s), topic: ${conversation.lastTopic || "general"}`);
    } catch {
      lines.push("Conversation: unavailable");
    }

    // Recent execution failures.
    const failures = context.logger.failures().slice(-5);
    if (failures.length > 0) {
      lines.push("Recent failures:");
      for (const failure of failures) {
        lines.push(`- [${failure.stage}] ${failure.message}${failure.metadata?.reason ? ` (${String(failure.metadata.reason)})` : ""}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * DIAGNOSE: turn the observed state into concrete findings.
   */
  private diagnose(context: RouterContext): string[] {
    const findings: string[] = [];
    const providers = context.aiProviders.statusSnapshot();

    for (const provider of providers) {
      if (provider.failure) {
        findings.push(
          `${provider.name} has a recorded failure: ${provider.failure.reason}${provider.inCooldown ? " (still in cooldown)" : ""}.`,
        );
      } else if (provider.requiresApiKey && !provider.lastSuccess) {
        findings.push(
          `${provider.name} requires an API key and has never succeeded — check its credential configuration (key name VITE_${provider.name.toUpperCase().replace(/\s+/g, "_")}_API_KEY or the __LELU_* runtime global).`,
        );
      }
    }

    if (findings.length === 0) {
      findings.push("No provider failures detected in the current runtime state.");
    }

    return findings;
  }

  private isDurable(finding: string): boolean {
    // Durable = a config/state fact worth remembering (provider
    // credential or failure state), not a transient "no failures".
    return /requires an API key|has a recorded failure|missing|credential|cooldown|unavailable/i.test(finding);
  }

  private diagnosticReport(context: RouterContext, snapshot: string, findings: string[]): AIResponse {
    const text = [
      "I can't reach an AI model right now, so here is a direct diagnostic report from my live runtime state:",
      "",
      "## Findings",
      ...findings.map((finding) => `- ${finding}`),
      "",
      "## Observed state",
      snapshot,
      "",
      "I've saved the durable findings to my local engineering memory, so this knowledge survives even while providers are offline. Re-run a chat once a provider is available and I'll reason over this state with full cognition.",
    ].join("\n");

    return {
      text,
      provider: "brain",
      model: "engineering-diagnostics",
      processingTime: Date.now() - context.started,
      metadata: {
        source: "EngineeringResolver",
        engineering: true,
        offline: true,
        findings,
      },
    };
  }
}
