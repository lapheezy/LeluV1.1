/**
 * ==========================================================
 * LÉLU
 * RESPONSE BUILDER
 * ==========================================================
 */

import type {
  AIResponse,
} from "../../providers/AIProvider";

import type {
  KnowledgeResult,
} from "../../providers/Provider";

export default class ResponseBuilder {

  /**
   * Build a response from research results — a compact,
   * source-attributed digest (used when no AI provider is
   * reachable to synthesize the retrieved data).
   */
  public fromResearch(
    results: KnowledgeResult[],
    started: number,
  ): AIResponse {

    if (results.length === 0) {

      return {
        text: "I searched but couldn't find current information on that.",
        provider: "research",
        model: "knowledge",
        processingTime: Date.now() - started,
        metadata: { count: 0, offline: true },
      };

    }

    const text =
      results
        .slice(0, 6)
        .map((result, index) => {
          const content = (result.content ?? "").replace(/\s+/g, " ").trim();
          const excerpt = content.length > 180 ? `${content.slice(0, 179)}…` : content;
          return `${index + 1}. ${result.title}${excerpt ? ` — ${excerpt}` : ""}${result.source ? ` (source: ${result.source})` : ""}${result.url ? `\n   ${result.url}` : ""}`;
        })
        .join("\n\n");

    return {
      text: `Here's what I found:\n\n${text}`,
      provider: "research",
      model: "knowledge",
      processingTime: Date.now() - started,
      metadata: { count: results.length, offline: true, research: true },
    };

  }

  /**
   * Build an offline response.
   */
  public offline(
    started: number,
  ): AIResponse {

    return {
      text: "I'm in offline mode right now — all AI providers are unreachable or unconfigured, so I can't generate new answers. My local memory, your profile and our shared history are still here and I'm still recording this conversation locally. Try asking \"who are you\", \"who am I\", or about something we've discussed.",
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
