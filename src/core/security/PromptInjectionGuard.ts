/**
 * ==========================================================
 * LÉLU
 * PROMPT INJECTION GUARD — data is not authority
 *
 * External content (web pages, documents, API responses, tool
 * output, agent messages) is treated as untrusted data, never
 * as instructions LÉLU is authorized to execute. This guard:
 *
 *   - detects instruction-override / identity-rewrite attempts
 *   - redacts secrets before they reach chat, logs, memory or
 *     external providers
 *   - helps build the minimum-necessary context for a trust
 *     boundary (the information firewall)
 *
 * It is part of M.S. Ma'at Sentinel's systems. It never blocks
 * legitimate conversation — it classifies and sanitizes, and the
 * caller decides (with the autonomy gate) what to do next.
 * ==========================================================
 */

export type ThreatLevel = "none" | "low" | "high";

export interface InjectionReport {
  threatLevel: ThreatLevel;
  patterns: string[];
  isInstructionOverride: boolean;
  /** Text with secrets removed (safe to log/transmit). */
  redacted: string;
}

const INJECTION_PATTERNS: { pattern: RegExp; label: string; level: ThreatLevel }[] = [
  { pattern: /ignore\s+(?:all\s+)?(?:your\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?|prompt)/i, label: "instruction override", level: "high" },
  { pattern: /disregard\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?|context)/i, label: "instruction override", level: "high" },
  { pattern: /(?:you\s+are\s+now|from\s+now\s+on\s+you\s+are|your\s+new\s+(?:role|identity|instructions?))\b/i, label: "identity rewrite", level: "high" },
  { pattern: /reveal\s+(?:your\s+)?(?:system\s+prompt|instructions?|hidden\s+prompt|developer\s+message)/i, label: "prompt extraction", level: "high" },
  { pattern: /(?:developer\s+mode|jailbreak|do\s+anything\s+now|ignore\s+safety)/i, label: "safety bypass", level: "high" },
  { pattern: /(?:forget|reset|wipe|delete)\s+(?:everything|your\s+(?:identity|personality|memory|instructions?))/i, label: "memory reset", level: "high" },
  { pattern: /act\s+as\s+if\s+you\s+have\s+no\s+(?:rules?|restrictions?|ethics)/i, label: "policy removal", level: "high" },
  { pattern: /expose\s+(?:the\s+)?(?:system|internal|private)\s+(?:state|architecture|instructions?)/i, label: "internal disclosure", level: "low" },
  { pattern: /modify\s+(?:your|lelu'?s)\s+(?:identity|personality|memory|permissions)/i, label: "protected-state modification", level: "high" },
];

const SECRET_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /ghp_[A-Za-z0-9]{20,}/g, replacement: "[github-pat-redacted]" },
  { pattern: /\b(sk|pk|rk|whsec)_[A-Za-z0-9]{16,}/g, replacement: "[api-key-redacted]" },
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, replacement: "Bearer [redacted]" },
  { pattern: /[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{16,}/g, replacement: "[token-redacted]" },
  { pattern: /(api[_-]?key|secret|token|password|passwd)["'\s:=]+[A-Za-z0-9._~+/=-]{12,}/gi, replacement: "$1=[redacted]" },
];

export default class PromptInjectionGuard {
  private static instance: PromptInjectionGuard | null = null;

  public static getInstance(): PromptInjectionGuard {
    if (!PromptInjectionGuard.instance) {
      PromptInjectionGuard.instance = new PromptInjectionGuard();
    }
    return PromptInjectionGuard.instance;
  }

  /** Classify text for instruction-override / injection attempts. */
  public analyze(text: string): InjectionReport {
    const patterns: string[] = [];
    let threatLevel: ThreatLevel = "none";

    for (const rule of INJECTION_PATTERNS) {
      if (rule.pattern.test(text)) {
        patterns.push(rule.label);
        if (rule.level === "high") {
          threatLevel = "high";
        } else if (threatLevel === "none") {
          threatLevel = "low";
        }
      }
    }

    return {
      threatLevel,
      patterns: [...new Set(patterns)],
      isInstructionOverride: threatLevel === "high",
      redacted: this.redactSecrets(text),
    };
  }

  /** Remove secrets so they never reach chat, logs, memory or providers. */
  public redactSecrets(text: string): string {
    if (!text) {
      return text;
    }
    let result = text;
    for (const rule of SECRET_PATTERNS) {
      result = result.replace(rule.pattern, rule.replacement);
    }
    return result;
  }

  /**
   * Treat external content as untrusted data. Returns a sanitized,
   * clearly-labeled block so LÉLU analyzes it without treating it
   * as instructions she is authorized to execute.
   */
  public screenExternalContent(content: string, source: string): { safe: boolean; note?: string; redacted: string } {
    const report = this.analyze(content);
    const redacted = report.redacted;
    if (report.isInstructionOverride) {
      return {
        safe: false,
        note: `Ignored instruction-override content from ${source || "external source"}: ${report.patterns.join(", ")}`,
        redacted,
      };
    }
    return { safe: true, redacted };
  }

  /**
   * Information-firewall helper: reduce a payload to the minimum fields
   * necessary for an external operation. `allowed` is the whitelist of
   * keys; everything else is dropped (never transmitted).
   */
  public minimumContext(payload: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
    const minimum: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in payload) {
        minimum[key] = payload[key];
      }
    }
    return minimum;
  }
}
