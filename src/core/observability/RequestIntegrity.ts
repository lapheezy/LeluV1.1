/**
 * ==========================================================
 * LÉLU — DID THE PERSON'S REQUEST ACTUALLY ARRIVE?
 *
 * A request passes through assembly, a budget fitter and a provider adapter.
 * Each of those can shorten something, and until this existed nobody could say
 * afterwards whether the original text made it. This records the five things
 * that answer it for one turn:
 *
 *   originalUserInput   → what the person typed
 *   assembledRequest    → what the router composed (sizes, never content)
 *   fittedRequest       → what the budget fitter kept or gave up
 *   providerPayload     → what the adapter is about to send (sizes + presence)
 *   semanticPreservation→ which protected terms survived
 *
 * It never records message text, tool arguments or credentials: the record is
 * names, byte counts, booleans and the *protected terms the caller already
 * knows* (a URL it supplied), which is what makes it safe to log.
 * ==========================================================
 */

import type { FittedRequest, SchemaTier } from "../router/RequestBudget";

export interface RequestIntegrityRecord {
  tier: SchemaTier;
  originalUserInput: { chars: number; bytes: number };
  assembledRequest: {
    promptBytes: number;
    historyBytes: number;
    systemBytes: number;
    toolCount: number;
    totalBytes: number;
  };
  fittedRequest: {
    changed: boolean;
    droppedTools: number;
    droppedMessages: number;
    trimmedMessages: number;
    totalBytes: number;
    ceilingBytes: number;
    ceilingSource: string;
    notes: string[];
  };
  providerPayload: {
    promptPresent: boolean;
    promptBytesInPayload: number;
    payloadBytes: number;
  };
  semanticPreservation: {
    ok: boolean;
    checked: number;
    missing: string[];
  };
}

const encoder = new TextEncoder();

function bytesOf(value: string): number {
  return encoder.encode(value).length;
}

/**
 * The parts of a request that a search, a provider or a person would consider
 * the subject: URLs, repository names, quoted text, code-like identifiers and
 * ALL-CAPS names. These are what must never quietly disappear.
 */
export function semanticTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s)"'<>]+/g)) terms.add(match[0].replace(/[.,;:]+$/, ""));
  for (const match of text.matchAll(/`([^`]{2,})`/g)) terms.add(match[1] ?? "");
  for (const match of text.matchAll(/\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/g)) terms.add(match[0]);
  for (const match of text.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*(?:[._][A-Za-z0-9_]+)+\b/g)) terms.add(match[0]);
  for (const match of text.matchAll(/\b[A-Z]{2,}[A-Z0-9_]*\b/g)) terms.add(match[0]);
  return [...terms].map((term) => term.trim()).filter((term) => term.length > 2);
}

/**
 * Compare what was asked with what the adapter is about to send.
 *
 * `payloadText` is the serialized request body. It is measured, and only the
 * result of the measurement is kept — the body itself is never stored here.
 */
export function inspectRequest(input: {
  originalUserInput: string;
  fitted: FittedRequest<unknown, unknown>;
  payloadText: string;
  tier?: SchemaTier;
}): RequestIntegrityRecord {
  const original = input.originalUserInput;
  const promptPresent = original.length > 0 && input.payloadText.includes(original);
  const checked = semanticTerms(original);
  const missing = checked.filter((term) => !input.payloadText.includes(term));

  return {
    tier: input.tier ?? input.fitted.tier,
    originalUserInput: { chars: original.length, bytes: bytesOf(original) },
    assembledRequest: {
      promptBytes: input.fitted.budget.promptBytes,
      historyBytes: input.fitted.budget.historyBytes,
      systemBytes: input.fitted.budget.systemBytes,
      toolCount: input.fitted.budget.toolCount,
      totalBytes: input.fitted.budget.totalBytes,
    },
    fittedRequest: {
      changed: input.fitted.changed,
      droppedTools: input.fitted.droppedTools,
      droppedMessages: input.fitted.droppedMessages,
      trimmedMessages: input.fitted.trimmedMessages,
      totalBytes: input.fitted.budget.totalBytes,
      ceilingBytes: input.fitted.ceiling.bytes,
      ceilingSource: input.fitted.ceiling.source,
      notes: [...input.fitted.notes],
    },
    providerPayload: {
      promptPresent,
      promptBytesInPayload: promptPresent ? bytesOf(original) : 0,
      payloadBytes: bytesOf(input.payloadText),
    },
    semanticPreservation: { ok: missing.length === 0, checked: checked.length, missing },
  };
}
