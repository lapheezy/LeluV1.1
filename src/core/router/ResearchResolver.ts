/**
 * ==========================================================
 * LÉLU
 * RESEARCH RESOLVER
 *
 * Connects cognition to the EXISTING knowledge-provider registry
 * (news, Wikipedia, weather, academic, geo, space, code, video).
 *
 * When the request needs current or external information:
 *
 *   COGNITION → recognizes need → selects existing tools
 *     → executes them → receives results → evaluates results
 *     → incorporates relevant information → answers
 *
 * If an AI provider is available, the retrieved data is attached
 * to the request context and the provider synthesizes the final
 * answer from REAL data (never "I can't access current
 * information"). If every provider is down, a deterministic
 * digest with sources is returned instead.
 *
 * No duplicate knowledge system: it drives the same
 * ProviderRegistry the rest of the runtime uses.
 * ==========================================================
 */

import type RouterContext from "./RouterContext";
import type { ResearchResult } from "./RouterResults";
import type { KnowledgeResult } from "../../providers/Provider";
import IntentDetector from "./IntentDetector";
import AgentEventBus from "../agent/AgentEvents";
import { isIdentityOrProfileQuestion } from "../../brain/LeluIdentity";

/** Current-information phrases: these force a live tool call. */
const CURRENT_INFO =
  /(news|current|latest|happening|today|breaking|headlines|headline|update|live|now)/i;

/** Domain → knowledge-provider capability tags. */
const DOMAIN_CAPS: Array<[RegExp, string[]]> = [
  [/news|current|latest|happening|today|breaking|headlines|update|headline/i, ["news", "current-events"]],
  [/who is|who was|what is|what was|wikipedia|fact|history|biograph|encyclopedia|define|meaning|capital of/i, ["encyclopedia", "fact", "reference", "knowledge"]],
  [/weather|forecast|temperature|climate|humidity|storm|rain|forecast/i, ["weather"]],
  [/where is|near me|location|address|map|directions|city of/i, ["geography", "location", "map", "place"]],
  [/space|nasa|astronom|planet|galaxy|orbit|cosmos|star/i, ["space", "astronomy"]],
  [/paper|research|study|academic|arxiv|journal|doi|scientif/i, ["academic", "research", "paper", "scientific"]],
  [/github|repository|repo|code|open source|library|api/i, ["code", "github"]],
  [/youtube|video|watch|trailer/i, ["video", "youtube"]],
  [/tech|startup|developer|hacker/i, ["technology", "developer", "startups"]],
];

const MAX_PROVIDERS = 4;
const MAX_RESULTS = 6;

export default class ResearchResolver {
  private readonly detector = new IntentDetector();

  public async execute(context: RouterContext): Promise<ResearchResult> {
    const prompt = context.request.prompt;
    const intent = this.detector.detect(prompt);
    const wantsCurrent = CURRENT_INFO.test(prompt);

    if (intent !== "search" && !wantsCurrent) {
      return { handled: false, results: [] };
    }

    // Identity/profile questions are answered locally; do not
    // route them into external tools.
    if (isIdentityOrProfileQuestion(prompt)) {
      return { handled: false, results: [] };
    }

    const query = this.buildQuery(prompt);
    const selected = this.selectProviders(context, prompt);

    if (selected.length === 0) {
      context.logger.info("ResearchResolver", "No knowledge provider matches this request.", {
        prompt,
        registered: context.knowledgeProviders.names(),
      });
      return { handled: false, results: [] };
    }

    const events = AgentEventBus.getInstance();
    const taskId = String(context.request.timestamp ?? Date.now());
    events.emit({
      type: "tool_selected",
      taskId,
      tool: "research",
      label: selected.map((provider) => provider.name).join(" + "),
    });

    const results = await this.runProviders(context, selected, query);

    if (results.length === 0) {
      context.logger.info("ResearchResolver", "Knowledge providers returned no results.", {
        query,
        attempted: selected.map((provider) => provider.name),
      });
      return { handled: false, results: [] };
    }

    context.researchResults = results;

    events.emit({
      type: "tool_result",
      taskId,
      tool: "research",
      result: `${results.length} result(s) from ${selected.map((provider) => provider.name).join(" + ")}`,
      results: results.map((result) => ({
        title: result.title,
        url: result.url ?? undefined,
        type: result.source,
      })),
    });

    const digest = this.formatResults(results);
    context.request.context = [context.request.context, `## Retrieved information\n${digest}`]
      .filter((value) => Boolean(value && value.trim().length > 0))
      .join("\n\n");

    // Remember a compact durable knowledge memory so future
    // cognition can build on it (memoryType "knowledge").
    try {
      await context.brain.rememberKnowledge(
        `Research on "${query}": ${results
          .slice(0, 3)
          .map((result) => `${result.title}: ${result.content}`)
          .join(" | ")}`.slice(0, 600),
        query.split(/\s+/).filter((word) => word.length > 3),
      );
    } catch (error) {
      context.logger.error("ResearchResolver", "Failed to persist knowledge memory.", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    let providersAvailable = 0;
    try {
      providersAvailable = (await context.aiProviders.available()).length;
    } catch {
      providersAvailable = 0;
    }

    if (providersAvailable > 0) {
      context.logger.info("ResearchResolver", "Knowledge retrieved; provider will synthesize the answer from the data.", {
        query,
        resultCount: results.length,
      });
      return { handled: false, results };
    }

    // Offline: answer directly from the retrieved data.
    context.logger.info("ResearchResolver", "No AI provider; answering from retrieved knowledge.", {
      query,
      resultCount: results.length,
    });
    return { handled: true, results };
  }

  /**
   * Pick the most relevant registered providers for this prompt by
   * matching capabilities, then rank by relevance and priority.
   */
  private selectProviders(context: RouterContext, prompt: string) {
    const wanted = new Set<string>();
    for (const [pattern, caps] of DOMAIN_CAPS) {
      if (pattern.test(prompt)) {
        for (const cap of caps) {
          wanted.add(cap);
        }
      }
    }

    const scored = context.knowledgeProviders
      .all()
      .map((provider) => {
        const matches = provider.capabilities.filter((cap) => wanted.has(cap)).length;
        return { provider, matches };
      })
      .filter((item) => item.matches > 0)
      .sort((a, b) => b.matches - a.matches || a.provider.priority - b.provider.priority);

    return scored.slice(0, MAX_PROVIDERS).map((item) => item.provider);
  }

  /**
   * Execute providers with per-provider timeouts; a failing
   * provider is skipped without killing the rest (fallback
   * behavior, same principle as the AI provider chain).
   */
  private async runProviders(context: RouterContext, providers: any[], query: string): Promise<KnowledgeResult[]> {
    const collected: KnowledgeResult[] = [];
    const started = Date.now();

    for (const provider of providers) {
      if (collected.length >= MAX_RESULTS) {
        break;
      }

      if (!provider.canSearch?.(query)) {
        continue;
      }

      const timeoutMs = provider.timeout ?? 10000;

      try {
        const results = await Promise.race([
          provider.search(query),
          new Promise<never>((_resolve, reject) =>
            setTimeout(() => reject(new Error(`${provider.name} timed out`)), timeoutMs),
          ),
        ]);

        for (const result of results.slice(0, MAX_RESULTS - collected.length)) {
          if (!result?.title) {
            continue;
          }
          collected.push(result);
        }

        context.logger.info("ResearchResolver", `${provider.name} returned ${results.length} result(s)`, {
          query,
          provider: provider.name,
        });
      } catch (error) {
        context.logger.error("ResearchResolver", `${provider.name} failed; trying next knowledge provider.`, {
          provider: provider.name,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    context.logger.info("ResearchResolver", "Research complete", {
      elapsedMs: Date.now() - started,
      totalResults: collected.length,
    });

    return collected;
  }

  /**
   * Strip conversational filler and interrogatives to get the
   * actual search topic ("What is the latest news in Tampa?" →
   * "Tampa").
   */
  private buildQuery(prompt: string): string {
    let query = prompt
      .trim()
      .replace(/^(?:can you|could you|please|hey|lelu|lélu)\s+/i, "")
      .replace(/^(?:tell me|give me|show me|find|search for|look up|do you know|what is|what's|what are|who is|who's|who are|when is|where is|how is|is there|are there)\s+/i, "")
      .replace(/^(?:the\s+)?(?:latest|current|recent|breaking)\s+(?:news|headlines)\s+(?:in|about|for|on)\s+/i, "")
      .replace(/[?.!]+$/g, "")
      .trim();

    if (query.length < 2) {
      query = prompt.trim();
    }

    return query.slice(0, 120);
  }

  /** Compact, source-attributed digest of the retrieved results. */
  private formatResults(results: KnowledgeResult[]): string {
    return results
      .slice(0, MAX_RESULTS)
      .map((result, index) => {
        const content = (result.content ?? "").replace(/\s+/g, " ").trim();
        const excerpt = content.length > 180 ? `${content.slice(0, 179)}…` : content;
        return `${index + 1}. ${result.title}${excerpt ? ` — ${excerpt}` : ""}${result.source ? ` (source: ${result.source})` : ""}${result.url ? ` ${result.url}` : ""}`;
      })
      .join("\n");
  }
}
