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
import type { AIIntent } from "./AIIntent";
import IntentDetector from "./IntentDetector";
import AgentEventBus from "../agent/AgentEvents";
import { isIdentityOrProfileQuestion } from "../../brain/LeluIdentity";

/** Current-information phrases: these force a live tool call.
 *  Deliberately NARROW — a bare "update", "now", "today" or "current"
 *  must never drag a local/execution command ("update your avatar…",
 *  "use the current saved avatar…") into knowledge retrieval. The bare
 *  word has to be paired with an actual current-events frame
 *  ("current news", "today's headlines", "update me on X").
 *  "Update me on X" / "any updates on X" still qualify because they
 *  genuinely ask for current information. */
const CURRENT_INFO =
  /(news|breaking|headlines?|current\s+(?:news|events?|info|information|update|updates|status|situation|weather|scores?|prices?|headlines?)|happening(?:\s+(?:right\s+now|today|now))?|what\s+happened|happened\s+(?:today|recently|yesterday|last\s+night|this\s+week)|today'?s?\s+(?:news|headlines?|weather|events?|stories?)|latest\s+(?:news|headlines?|updates?|info|information|on)|update\s+(?:me|us|on)|updates?\s+on|updated\s+on|give\s+me\s+an?\s+update|keep\s+me\s+updated|in\s+the\s+news|what'?s\s+(?:the\s+)?(?:latest|happening|new|going\s+on)|whats\s+(?:the\s+)?(?:latest|happening|new|going\s+on))/i;

/** Action/execution intents — commands that DO work, never research.
 *  Even when such a command contains a current-info-looking word
 *  ("use the CURRENT saved avatar…"), it must not enter retrieval.
 *  The AIRouter already gates by intent; this is the second line of
 *  defense for direct ResearchResolver callers (cognition, loops). */
const ACTION_INTENTS = new Set<string>([
  "project",
  "avatar",
  "engineering",
  "creative",
  "voice",
  "memory",
  "genesis",
  "time",
]);

/** Execution-command shape: an action verb aimed at a local/execution
 *  target (sandbox, workspace, avatar, UI, renderer, environment).
 *  These are NEVER knowledge questions, no matter which words they
 *  contain. */
const EXECUTION_COMMAND =
  /\b(?:start|build|create|make|execute|run|work\s+on|implement|develop|write|code|use|open|launch|render|simulat|animat|update|change|modify|upgrade|improve|fix|deploy)\b[^?!.]{0,160}\b(?:sandbox|workspace|avatar|full\s?screen|environment|ui|interface|cosmos|scene|3d|3-d|render|simulation|project)\b/i;

/** Domain → knowledge-provider capability tags. */
const DOMAIN_CAPS: Array<[RegExp, string[]]> = [
  [/news|current|latest|happening|today|breaking|headlines?|update\s+(me|us|on)|updates?\s+on/i, ["news", "current-events"]],
  [/who is|who was|what is|what was|wikipedia|fact|history|biograph|encyclopedia|define|meaning|capital of/i, ["encyclopedia", "fact", "reference", "knowledge"]],
  [/weather|forecast|temperature|climate|humidity|storm|rain|forecast/i, ["weather"]],
  [/where is|near me|location|address|map|directions|city of/i, ["geography", "location", "map", "place"]],
  [/space|nasa|astronom|planet|galaxy|orbit|cosmos|star/i, ["space", "astronomy"]],
  [/paper|research|study|academic|arxiv|journal|doi|scientif/i, ["academic", "research", "paper", "scientific"]],
  [/github|repository|repo|code|open source|library|api/i, ["code", "github"]],
  [/youtube|video|watch|trailer/i, ["video", "youtube"]],
  [/(?:instagram|\big\b|reels?|social media|posts?)/i, ["instagram", "social", "media"]],
  [/rss|google news|elpheru/i, ["rss", "news", "current-events"]],
  [/tech|startup|developer|hacker/i, ["technology", "developer", "startups"]],
];

const MAX_PROVIDERS = 4;
const MAX_RESULTS = 6;

export default class ResearchResolver {
  private readonly detector = new IntentDetector();

  public async execute(context: RouterContext): Promise<ResearchResult> {
    const prompt = context.request.prompt;
    const intent = context.intent ?? this.detector.detect(prompt);

    // ACTION COMMANDS ARE NEVER RESEARCH. An execution intent
    // (project, avatar, engineering, creative, …) is work to do, not
    // a knowledge question — even when the sentence contains
    // current-info-looking words. Provider failures for unrelated
    // knowledge sources must never block or hijack execution.
    if (ACTION_INTENTS.has(intent)) {
      context.logger.info("ResearchResolver", "Action intent — skipping live retrieval.", {
        intent,
        prompt,
      });
      return { handled: false, results: [] };
    }

    // Second line of defense: even a chat-classified sentence shaped
    // like an execution command ("use the current saved avatar…",
    // "start in the sandbox…") is not a knowledge request.
    if (EXECUTION_COMMAND.test(prompt)) {
      context.logger.info("ResearchResolver", "Execution command — skipping live retrieval.", { prompt });
      return { handled: false, results: [] };
    }

    const wantsCurrent = CURRENT_INFO.test(prompt);

    // News and search intents ALWAYS attempt live retrieval —
    // ordinary conversation can never bypass a required tool call.
    const forced = intent === "search" || intent === "news";
    if (!forced && !wantsCurrent) {
      return { handled: false, results: [] };
    }

    // Identity/profile questions are answered locally; do not
    // route them into external tools.
    if (isIdentityOrProfileQuestion(prompt)) {
      return { handled: false, results: [] };
    }

    // Personal-memory questions ("What is my name?") belong to the
    // cognition/memory path — never to web retrieval.
    if (
      /\b(?:my name|who am i|remember me|about me|my favorite|i told you|do you know me)\b/i.test(
        prompt,
      )
    ) {
      context.logger.info("ResearchResolver", "Personal-memory question — skipping live retrieval.", { prompt });
      return { handled: false, results: [] };
    }

    const query = this.buildQuery(prompt, intent);
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
    events.emit({
      type: "tool_started",
      taskId,
      tool: "research",
      label: `Searching ${query}`,
    });

    const attempted: Array<{ provider: string; error?: string }> = [];
    let results = await this.runProviders(context, selected, query, attempted);

    // Bounded retry: if no results, try simplified fallback queries
    if (results.length === 0 && (intent === "news" || intent === "search")) {
      const fallbacks = this.fallbackQueries(query);
      for (const fq of fallbacks) {
        results = await this.runProviders(context, selected, fq, attempted);
        if (results.length > 0) break;
      }
    }

    // Relevance filtering: when query has distinctive content words,
    // drop results that match none of them (prevents "BBC world news"
    // being presented as "Tampa news").
    if (results.length > 0) {
      results = this.filterByRelevance(results, query);
    }

    if (results.length === 0) {
      context.logger.info("ResearchResolver", "Knowledge providers returned no usable results.", {
        query,
        attempted: selected.map((provider) => provider.name),
      });

      // The complete retrieval chain executed and produced nothing.
      // Return handled so this request NEVER falls through to generic
      // conversation that could disclaim or fabricate current info —
      // the router answers with an explicit, honest retrieval failure
      // that names every provider actually attempted and why it failed.
      events.emit({
        type: "tool_result",
        taskId,
        tool: "research",
        query,
        provider: selected.map((provider) => provider.name).join(" + "),
        result: "No usable results returned",
        results: [],
        status: "error",
      });
      return { handled: true, results: [], attempted };
    }

    context.researchResults = results;

    events.emit({
      type: "tool_result",
      taskId,
      tool: "research",
      result: `${results.length} result(s) from ${selected.map((provider) => provider.name).join(" + ")}`,
      query,
      provider: selected.map((provider) => provider.name).join(" + "),
      status: "complete",
      results: results.map((result) => ({
        title: result.title,
        url: result.url ?? undefined,
        type: result.source,
        content: result.content,
        source: result.source,
        timestamp: result.timestamp,
        metadata: result.metadata,
      })),
    });

    const digest = this.formatResults(results);
    const retrievedAt = new Date().toLocaleString();
    context.request.context = [
      context.request.context,
      `## LIVE RETRIEVAL RESULTS — fetched just now (${retrievedAt}) from connected knowledge APIs\n${digest}\n\nINSTRUCTIONS FOR THIS REPLY:\n- These are real, current results retrieved live for the user's question.\n- Base your answer on them and cite source names inline (e.g. "per Reuters").\n- Never say you lack access to real-time information — the data above was retrieved live right now.`,
    ]
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
   * behavior, same principle as the AI provider chain). Every
   * attempt is recorded (provider + error) so a total failure
   * can be reported honestly instead of silently swallowed.
   */
  private async runProviders(
    context: RouterContext,
    providers: any[],
    query: string,
    attempted: Array<{ provider: string; error?: string }> = [],
  ): Promise<KnowledgeResult[]> {
    const collected: KnowledgeResult[] = [];
    const started = Date.now();

    for (const provider of providers) {
      if (collected.length >= MAX_RESULTS) {
        break;
      }

      if (!provider.canSearch?.(query)) {
        attempted.push({ provider: provider.name, error: "provider-cannot-handle-query" });
        continue;
      }

      const timeoutMs = provider.timeout ?? 10000;
      const providerStarted = Date.now();

      try {
        const results = await Promise.race([
          provider.search(query),
          new Promise<never>((_resolve, reject) =>
            setTimeout(() => reject(new Error(`${provider.name} timed out`)), timeoutMs),
          ),
        ]);

        // Validate the response shape before accepting it — an HTTP
        // 200 with a malformed/empty payload is a failure, not success.
        const usable = Array.isArray(results)
          ? results.filter((result) => result && typeof result.title === "string" && result.title.trim().length > 0)
          : [];

        for (const result of usable.slice(0, MAX_RESULTS - collected.length)) {
          collected.push(result);
        }

        context.logger.info("ResearchResolver", `${provider.name} returned ${usable.length} usable result(s)`, {
          query,
          provider: provider.name,
          latencyMs: Date.now() - providerStarted,
          rawCount: Array.isArray(results) ? results.length : 0,
        });
        if (usable.length === 0) {
          attempted.push({ provider: provider.name, error: "0-usable-results" });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        attempted.push({ provider: provider.name, error: reason });
        context.logger.error("ResearchResolver", `${provider.name} failed; trying next knowledge provider.`, {
          provider: provider.name,
          reason,
          latencyMs: Date.now() - providerStarted,
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
   * Extract the search subject by removing conversational filler
   * and current-events scaffolding while preserving content words
   * in order ("What's happening in Florida?" → "Florida",
   * "What's the latest news about AI?" → "AI"). A subjectless
   * current-events ask becomes a general world-news query.
   */
  private buildQuery(prompt: string, intent?: AIIntent): string {
    const cleaned = prompt
      .trim()
      .replace(/[?.!]+$/g, "")
      // Contraction tails ("what's" → "what") so no stray "'s"
      // leaks into the provider query.
      .replace(/[’']s\b/gi, "");

    // For news/search intent: preserve topic words + add "news" context.
    // This ensures "What's Tampa news?" → "Tampa news" (not just "Tampa").
    if (intent === "news" || intent === "search") {
      const NEWS_KEEPER =
        /\b(?:can|you|could|please|hey|lelu|lélu|tell|me|give|show|find|research|look|up|do|does|know|what|whats|who|whose|when|where|how|is|are|was|were|there|the|a|an|latest|current|recently|breaking|todays|happening|happened|going|on|in|about|with|for|of|right|now|world|worldwide|global|updates|headlines?|events?|anything|something)\b/gi;
      let query = cleaned
        .replace(NEWS_KEEPER, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!/news/i.test(query)) {
        query = query ? `${query} news` : "major world news";
      }
      return query.slice(0, 120);
    }

    const FILLER =
      /\b(?:can|you|could|please|hey|lelu|lélu|tell|me|give|show|find|search|research|look|up|do|does|know|what|whats|who|whose|when|where|how|is|are|was|were|there|the|a|an|latest|current|recently|recent|breaking|today|todays|happening|happened|going|on|in|about|with|for|of|right|now|world|worldwide|global|update|updates|news|headlines?|events?|anything|something)\b/gi;

    let query = cleaned
      .replace(FILLER, "")
      .replace(/\s+/g, " ")
      .trim();

    if (query.length < 2) {
      query = "major world news";
    }

    return query.slice(0, 120);
  }

  private fallbackQueries(query: string): string[] {
    const words = query.replace(/\bnews\b/gi, "").trim();
    const fallbacks: string[] = [];
    if (words && words !== query) {
      fallbacks.push(`${words} news today`);
      fallbacks.push(words);
    }
    return fallbacks;
  }

  private filterByRelevance(results: KnowledgeResult[], query: string): KnowledgeResult[] {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !/^(news|major|world)$/.test(w));
    if (words.length === 0) return results;
    const matches = (r: KnowledgeResult) => {
      const text = `${r.title ?? ""} ${r.content ?? ""}`.toLowerCase();
      return words.some((w) => text.includes(w));
    };
    const filtered = results.filter(matches);
    return filtered.length > 0 ? filtered : results;
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
