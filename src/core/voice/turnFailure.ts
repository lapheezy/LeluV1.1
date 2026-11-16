/**
 * LÉLU — what kind of failure ended a voice turn.
 *
 * Five failures used to look alike from the voice loop: each either became
 * "I couldn't process that" read aloud, or the offline notice read aloud as
 * if it were her answer. They are different events with different remedies,
 * so they are told apart here, and none of them is spoken AS an answer.
 *
 *   provider-timeout       a model provider did not answer in time
 *   transcription-failure  the speech could not be turned into text
 *   playback-failure       her reply was generated but could not be played
 *   user-cancellation      the person stopped it (Stop, or barge-in)
 *   network-failure        the network itself failed
 *   provider-unavailable   providers refused (quota, credit, key) — not a timeout
 *
 * Pure, so it is unit-tested.
 */

export type VoiceTurnFailureKind =
  | "provider-timeout"
  | "transcription-failure"
  | "playback-failure"
  | "user-cancellation"
  | "network-failure"
  | "provider-unavailable";

export interface VoiceTurnFailure {
  kind: VoiceTurnFailureKind;
  /** Shown in the conversation / status line. Never spoken as her answer. */
  message: string;
}

const TIMEOUT = /timed out|timeout|BodyStreamBuffer was aborted|deadline|rung budget|chain budget|took too long/i;
const NETWORK = /failed to fetch|networkerror|network error|ERR_NETWORK|ERR_INTERNET|offline|ECONNRESET|ENOTFOUND|load failed/i;

/** Classify one provider error message (not a user stop). */
export function classifyProviderError(message: string): "provider-timeout" | "network-failure" | "provider-unavailable" {
  if (TIMEOUT.test(message)) return "provider-timeout";
  if (NETWORK.test(message) && !/\b(4\d\d|5\d\d)\b/.test(message)) return "network-failure";
  return "provider-unavailable";
}

/**
 * The turn's failure from the chain's per-provider errors. A timeout
 * anywhere in the chain is what the person needs to hear about (the
 * others are standing conditions such as a spent quota), then network.
 */
export function classifyChainFailure(errors: string[]): "provider-timeout" | "network-failure" | "provider-unavailable" {
  const kinds = errors.map(classifyProviderError);
  if (kinds.includes("provider-timeout")) return "provider-timeout";
  if (kinds.length > 0 && kinds.every((kind) => kind === "network-failure")) return "network-failure";
  if (kinds.includes("network-failure") && !kinds.includes("provider-unavailable")) return "network-failure";
  return "provider-unavailable";
}

/**
 * Read an AIService reply: is it really an answer, or a failure notice in
 * an answer's clothing? The resolver marks its notices `success: false`
 * with a reason; a budget refusal and a user stop are marked too.
 */
export function failureFromResponse(response: { text?: string; provider?: string; metadata?: Record<string, unknown> }): VoiceTurnFailure | null {
  const meta = response.metadata ?? {};
  if (meta.success !== false) return null;
  if (meta.toolLoopStopped === "user" || response.provider === "cancelled") {
    return { kind: "user-cancellation", message: "Stopped." };
  }
  if (meta.partial === true) return null; // real work happened and is reported — that IS the answer
  if (meta.budgetExhausted) return null; // the budget notice is the answer the person needs
  if (meta.reason === "all-ai-providers-failed" || response.provider === "offline") {
    const kind = (meta.failureKind as VoiceTurnFailureKind | undefined) ?? "provider-unavailable";
    return { kind, message: String(response.text ?? "") };
  }
  return null;
}

/** Classify a thrown error from a voice turn's chat call. */
export function failureFromError(error: unknown): VoiceTurnFailure {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (name === "AbortError" && !TIMEOUT.test(message)) return { kind: "user-cancellation", message: "Stopped." };
  const kind = classifyProviderError(message);
  const text =
    kind === "provider-timeout" ? "The model provider did not answer in time. Nothing was lost — ask again."
    : kind === "network-failure" ? "The network failed while I was answering. Nothing was lost — ask again when you're back online."
    : "I couldn't get an answer from any provider. Nothing was lost — ask again.";
  return { kind, message: text };
}
