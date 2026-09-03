/**
 * ==========================================================
 * LÉLU — TOOL CALL INTERCEPTOR
 *
 * Sits between the AI provider response and the chat UI.
 * When a model returns raw tool-call markup (e.g. from
 * openai/gpt-5.5 or similar models), this interceptor:
 *
 * 1. Detects structured/raw tool-call syntax
 * 2. Executes the corresponding real tool (Researcher, etc.)
 * 3. Returns a clean synthesized response
 *
 * The user NEVER sees raw tool-call markup.
 * ==========================================================
 */

import type { AIResponse } from "../../providers/AIProvider";
import type RouterContext from "./RouterContext";
import AgentEventBus from "../agent/AgentEvents";
import { extractToolQuery, isRawToolMarkup } from "./ToolMarkup";

/** Patterns that indicate a raw tool call leaked into response text */
const TOOL_CALL_PATTERNS = [
  /<tool_call_start>/i,
  /<tool_call_end>/i,
  /<dots_function_call>/i,
  /<parameter\s+name=/i,
  /\[Researcher\s*\(/i,
  /\[search\s*\(/i,
  /function_call\s*\{/i,
  /"tool"\s*:\s*"(?:browser|research|instagram|search)"/i,
  /"name"\s*:\s*"researcher"/i,
  /"name"\s*:\s*"search"/i,
];

/** Extract key=value pairs from tool-call syntax like [Researcher(query="...")] */
function extractQuery(raw: string): string | null {
  // Pattern: [Researcher(query="some query")]
  const researcherMatch = raw.match(/\[Researcher\s*\(\s*query\s*=\s*"([^"]*)"/i);
  if (researcherMatch) return researcherMatch[1];

  // Pattern: [search(query="some query")]
  const searchMatch = raw.match(/\[search\s*\(\s*query\s*=\s*"([^"]*)"/i);
  if (searchMatch) return searchMatch[1];

  // Pattern: JSON function call
  const jsonMatch = raw.match(/"arguments"\s*:\s*\{[^}]*"query"\s*:\s*"([^"]*)"/i);
  if (jsonMatch) return jsonMatch[1];

  return extractToolQuery(raw);
}

function isToolCallResponse(text: string): boolean {
  return TOOL_CALL_PATTERNS.some((p) => p.test(text));
}

/**
 * Build a high-quality search query from the user's request.
 * Never hardcodes dates — uses runtime clock.
 */
function buildSmartQuery(userPrompt: string): string {
  const prompt = userPrompt.trim();

  // Extract topic from news queries
  const topicPatterns = [
    /(?:latest|current|recent|today).*(?:news|happen).*(?:about|on|regarding)\s+(.+?)(?:\?|$)/i,
    /(?:news|happen).*(?:about|on|regarding)\s+(.+?)(?:\?|$)/i,
    /what(?:'s|'?s| is)(?: the)?(?: latest| current| recent)?\s*(?:news|happen).*(?:about|on)\s+(.+?)(?:\?|$)/i,
    /(?:news|happen).*in\s+(.+?)(?:\?|$)/i,
    /what(?:'s|'?s| is)(?: the)?(?: latest| current)?\s*(?:news|happen).*in\s+(.+?)(?:\?|$)/i,
  ];

  let topic = "";
  for (const pattern of topicPatterns) {
    const match = prompt.match(pattern);
    if (match && match[1]) {
      topic = match[1].trim().replace(/[?.]$/, "");
      break;
    }
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });

  if (topic) {
    return `latest ${topic} news ${dateStr} recent developments`;
  }

  return `latest major news headlines ${dateStr} current events`;
}

export interface ToolCallResult {
  /** Whether a tool call was detected and handled */
  intercepted: boolean;
  /** The final response to show the user (only set when intercepted) */
  response?: AIResponse;
  /** The query that was searched (for diagnostics) */
  query?: string;
}

export default class ToolCallInterceptor {
  /**
   * Check a provider response for raw tool-call markup.
   * If found, execute the real tool and return a clean result.
   */
  async intercept(
    providerResponse: AIResponse,
    context: RouterContext,
  ): Promise<ToolCallResult> {
    const text = providerResponse.text;

    if (!isToolCallResponse(text) && !isRawToolMarkup(text)) {
      return { intercepted: false };
    }

    context.logger.info(
      "ToolCallInterceptor",
      "Detected raw tool-call markup — executing real tool instead",
    );

    // Extract the query
    const query = extractQuery(text) ?? buildSmartQuery(context.request.prompt ?? "");
    const events = AgentEventBus.getInstance();
    const taskId = String(context.request.timestamp ?? Date.now());
    events.emit({ type: "tool_selected", taskId, tool: "research", label: `Researching ${query}` });
    events.emit({ type: "tool_started", taskId, tool: "research", label: `Searching ${query}` });
    context.logger.info("ToolCallInterceptor", `Executing query: "${query}"`);

    try {
      // Execute through the ResearchResolver for real results
      const { default: ResearchResolver } = await import("./ResearchResolver");
      const resolver = new ResearchResolver();

      // Create a modified context with the extracted query
      const toolContext = {
        ...context,
        request: {
          ...context.request,
          prompt: query,
          messages: [{ role: "user" as const, content: query }],
        },
      };

      const result = await resolver.execute(toolContext);

      // Gate on RESULTS, never on `handled`.
      //
      // `handled` answers "who replies next", not "did research work".
      // ResearchResolver returns handled:false WITH results on its main
      // success path (it hands off so a provider can synthesise them),
      // and handled:true WITHOUT results when retrieval failed. The old
      // `handled && length > 0` therefore matched neither state: a real
      // search that returned real sources fell through to the "didn't
      // find current results" branch below, so LÉLU told the user she
      // found nothing while holding the results. That is the exact
      // "search executes but returns nothing" defect.
      if (result.results.length > 0) {
        // Build a clean synthesized response from real results
        const sources = result.results.slice(0, 6).map((r, i) => {
          const content = (r.content ?? "").replace(/\s+/g, " ").trim();
          const excerpt = content.length > 200 ? content.slice(0, 197) + "…" : content;
          return `${i + 1}. **${r.title}**${excerpt ? ` — ${excerpt}` : ""}${r.source ? ` (${r.source})` : ""}${r.url ? `\n   ${r.url}` : ""}`;
        }).join("\n\n");

        const now = new Date();
        const timeStr = now.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });

        return {
          intercepted: true,
          query,
          response: {
            text: `Here's what I found on the latest news (as of ${timeStr}):\n\n${sources}`,
            provider: "research",
            model: "tool-interceptor",
            processingTime: Date.now() - context.started,
            metadata: {
              intent: "news",
              success: true,
              sourceCount: result.results.length,
              query,
            },
          },
        };
      }

      // No results found
      return {
        intercepted: true,
        query,
        response: {
          text:
            `I searched for "${query}" and the knowledge providers returned no usable results. ` +
            `This is a real retrieval attempt that came back empty — not a guess, and not a ` +
            `search I skipped. Try a more specific query, or check provider availability.`,
          provider: "research",
          model: "tool-interceptor",
          processingTime: Date.now() - context.started,
          metadata: {
            intent: "news",
            success: false,
            reason: "no-results",
            query,
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error("ToolCallInterceptor", "Tool execution failed", { error: message });

      // ResearchResolver emits its own tool_result for the success and
      // empty-result paths, so this is the ONLY branch that would
      // otherwise have no terminal event: the resolver threw before
      // reaching either emission. Duplicating the other two here put two
      // rows in the activity timeline for one execution.
      events.emit({
        type: "tool_result",
        taskId,
        tool: "research",
        query,
        provider: "research",
        result: `Tool execution failed: ${message}`,
        results: [],
        status: "error",
      });

      return {
        intercepted: true,
        query,
        response: {
          text: `I tried to look up current information but the search tool encountered an issue. ${message}`,
          provider: "error",
          model: "tool-interceptor",
          processingTime: Date.now() - context.started,
          metadata: {
            intent: "news",
            success: false,
            error: message,
            query,
          },
        },
      };
    }
  }
}