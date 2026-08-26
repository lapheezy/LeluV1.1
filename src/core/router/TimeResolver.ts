/**
 * ==========================================================
 * LÉLU — TIME RESOLVER
 *
 * Handles current-time / current-date queries. No external
 * API needed — this is a deterministic local capability.
 * Always returns live time, not model-guessed time.
 * ==========================================================
 */

import type { AIResponse } from "../../providers/AIProvider";
import type RouterContext from "./RouterContext";
import { type BrainResult } from "./RouterResults";

export default class TimeResolver {
  public async execute(context: RouterContext): Promise<BrainResult> {
    const prompt = (context.request.prompt ?? "").toLowerCase().trim();

    // Detect time/date queries from the prompt directly
    const isTimeQuery =
      /what time|current time|what['"]s the time|whats the time|time now|tell me the time/.test(prompt) ||
      /what day|what date|today['"]s date|todays date|date now|tell me the date/.test(prompt) ||
      /what is today|what['"]s today|whats today|what month|what day is it|what year/.test(prompt) ||
      /current date|what.*(?:day|date|month|year) is it/.test(prompt);

    if (!isTimeQuery) return { handled: false };

    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const utcStr = now.toISOString().slice(0, 19).replace("T", " ") + " UTC";

    const response: AIResponse = {
      text: `Right now it's ${timeStr} on ${dateStr} (${utcStr}).`,
      provider: "browser",
      model: "time",
      processingTime: Date.now() - context.started,
      metadata: {
        intent: "time",
        success: true,
        timestamp: now.getTime(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };

    context.logger.info("TimeResolver", "Resolved current time/date from browser clock");
    return { handled: true, response };
  }
}