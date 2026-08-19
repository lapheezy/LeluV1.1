/**
 * ==========================================================
 * LÉLU
 * BROWSER RESOLVER
 *
 * A stage in the EXISTING router chain (after research, before
 * the provider stage). When the user asks LÉLU to open/browse a
 * page, this resolver:
 *
 *   - reads the page through BrowserTool (the in-app browser
 *     layer — native browser launching is impossible inside a web
 *     sandbox),
 *   - attaches the page's readable content to the request context
 *     so the EXISTING provider/cognition chain reasons over REAL
 *     page content instead of guessing,
 *   - when no AI provider is reachable, composes a deterministic
 *     summary from the page itself (same offline pattern as
 *     EngineeringResolver) so the capability never dead-ends on
 *     an API outage.
 *
 * No second runtime, no second memory system, no duplicate chat.
 * ==========================================================
 */

import type RouterContext from "./RouterContext";
import type { BrainResult } from "./RouterResults";
import type { AIResponse } from "../../providers/AIProvider";
import BrowserTool from "../browser/BrowserTool";
import AgentEventBus from "../agent/AgentEvents";

export default class BrowserResolver {
  public async execute(context: RouterContext): Promise<BrainResult> {
    const prompt = context.request.prompt;
    const url = BrowserTool.findUrl(prompt);
    const looksLikeBrowse = BrowserTool.looksLikeBrowseRequest(prompt);

    if (!url && !looksLikeBrowse) {
      return { handled: false };
    }

    const events = AgentEventBus.getInstance();
    const taskId = String(context.request.timestamp ?? Date.now());
    events.emit({
      type: "browser_opened",
      taskId,
      url: url ?? prompt,
    });

    const page = await BrowserTool.visit(url ?? prompt);

    events.emit({
      type: "browser_navigation",
      taskId,
      url: page.url,
    });

    if (page.status === "read") {
      context.logger.info("BrowserResolver", "Page read; attaching content to request context.", {
        url: page.url,
        title: page.title,
      });

      context.request.context = [
        context.request.context,
        `## Page Content (browsed by Lélu)\nURL: ${page.url}\nTitle: ${page.title}\n\n${page.excerpt}`,
      ]
        .filter((value) => Boolean(value && value.trim().length > 0))
        .join("\n\n");
    } else {
      context.logger.info("BrowserResolver", "Page could not be read directly; in-app browser can still open it.", {
        url: page.url,
        error: page.error,
      });
    }

    let providersAvailable = 0;
    try {
      providersAvailable = (await context.aiProviders.available()).length;
    } catch {
      providersAvailable = 0;
    }

    if (providersAvailable > 0) {
      // The provider chain reasons over the browsed content — the
      // page context is already attached above.
      return { handled: false };
    }

    // Offline: deterministic answer from the page itself.
    if (page.status === "read") {
      return {
        handled: true,
        response: this.pageSummary(context, page),
      };
    }

    return {
      handled: true,
      response: {
        text: page.error ?? "I couldn't read that page.",
        provider: "browser",
        model: "page",
        processingTime: Date.now() - context.started,
        metadata: {
          intent: "browse",
          success: false,
          browser: {
            url: page.url,
            status: page.status,
          },
        },
      },
    };
  }

  private pageSummary(
    context: RouterContext,
    page: { url: string; title: string; excerpt: string },
  ): AIResponse {
    const firstSentence = page.excerpt.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
    const text = [
      `I browsed **${page.title}** (${page.url}).`,
      ``,
      page.excerpt.length > 0
        ? firstSentence
        : "The page loaded but contained no readable text.",
      ``,
      "My AI providers are currently offline, so this is a direct read of the page. Ask me anything about it and I'll look it up again when the connection returns.",
    ].join("\n");

    return {
      text,
      provider: "browser",
      model: "page",
      processingTime: Date.now() - context.started,
      metadata: {
        intent: "browse",
        success: true,
        browser: {
          url: page.url,
          title: page.title,
          status: "read",
        },
      },
    };
  }
}
