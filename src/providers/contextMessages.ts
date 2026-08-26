/**
 * ==========================================================
 * LÉLU — PROVIDER CONTEXT MESSAGES
 *
 * Single shared implementation of how `request.context` becomes
 * system messages in every AI provider. Prevents the exact bug
 * where live-retrieved news was labeled "Memory context:", which
 * made models answer "I'm unable to access real-time news" even
 * while holding fresh results in their own context window.
 * ==========================================================
 */

import type { AIRequest } from "./AIProvider";

/** Marker written by ResearchResolver when live data is attached. */
export const LIVE_RETRIEVAL_MARKER = "## LIVE RETRIEVAL RESULTS";

export type ProviderContextMessage = {
  role: "system";
  content: string;
};

export function contextMessages(request: AIRequest): ProviderContextMessage[] {
  if (!request.context || request.context.trim().length === 0) return [];

  const isLive = request.context.includes(LIVE_RETRIEVAL_MARKER);

  if (isLive) {
    return [
      {
        role: "system",
        content:
          `Live retrieved information — fetched moments ago from Lélu's connected knowledge APIs for this exact question:\n\n` +
          `${request.context}\n\n` +
          `This is NOT memory and NOT training knowledge. It is real current data retrieved right now. ` +
          `Answer directly from it, cite the source names it provides, and never claim you cannot access real-time information.`,
      },
    ];
  }

  return [
    {
      role: "system",
      content: `Memory context:\n\n${request.context}`,
    },
  ];
}
