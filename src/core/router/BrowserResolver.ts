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
import AuthorizationQueue, { assessAccess } from "../browser/AuthGate";
import { ingestSource } from "../memory/ingestSource";

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
    events.emit({
      type: "browser_result",
      taskId,
      url: page.url,
      title: page.title,
      excerpt: page.excerpt,
      status: page.status,
      error: page.error,
    });

    // A source that needs the user signed in is a question, not a failed read
    // (§13). Parking it here rather than in a second entry point keeps one
    // path for "LÉLU was given a link" — there is no separate ingest command
    // that could drift from this one.
    const access = assessAccess(page);
    if (access.verdict === "auth-required") {
      const pending = AuthorizationQueue.getInstance().request(access);
      context.logger.info("BrowserResolver", "Source needs authorization.", {
        url: page.url,
        requestId: pending.id,
      });
      return {
        handled: true,
        response: {
          text: `${access.reason}${pending.signInUrl ? ` Sign in at ${pending.signInUrl} and ask me again.` : ""}`,
          provider: "browser",
          model: "auth-gate",
          processingTime: 0,
          metadata: { intent: "authorization_required", success: true },
        },
      };
    }

    if (page.status === "read") {
      // Keep what is durable, in the background. The turn answers from the
      // page content attached below; consolidation is a separate concern and
      // must not delay the reply. ingestSource resolves a provider directly
      // rather than calling chat(), so this cannot re-enter the router.
      void ingestSource(page.url, {
        url: page.url,
        title: page.title,
        text: page.text,
      }).catch((error) => {
        context.logger.info("BrowserResolver", "Background ingestion skipped.", {
          url: page.url,
          error: error instanceof Error ? error.message : String(error),
        });
      });

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
