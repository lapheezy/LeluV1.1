/**
 * ==========================================================
 * LÉLU
 * ENGINEER SERVICE
 *
 * Engineering requests are routed through the ONE AI runtime —
 * the pipeline's EngineeringResolver detects engineering intent,
 * observes live runtime state, attaches diagnostics, and reasons
 * over them through the existing provider chain (or composes a
 * deterministic diagnostic report offline). This service is a
 * thin adapter so the UI keeps a single chat entry point.
 * ==========================================================
 */

import AIService from "../../core/AIService";

export interface EngineerReply {
  text: string;
  source: "ai" | "local";
}

export default class EngineerService {
  private readonly chat = AIService.getInstance();

  async answer(message: string): Promise<EngineerReply> {
    const normalized = message.trim();

    if (!normalized) {
      return {
        text: "I’m ready to help with architecture, debugging, or implementation.",
        source: "local",
      };
    }

    // Pass the request verbatim so the runtime's EngineeringResolver
    // can detect the engineering intent and attach live diagnostics
    // before any provider generates the answer. No second runtime,
    // no duplicate tool path.
    const reply = await this.chat.chat(normalized);

    return {
      text: reply.text,
      source: reply.provider === "brain" || reply.provider === "offline" ? "local" : "ai",
    };
  }
}
