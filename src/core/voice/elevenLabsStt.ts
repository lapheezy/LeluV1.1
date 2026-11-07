/**
 * ==========================================================
 * LÉLU — HER EARS: ElevenLabs speech-to-text (Scribe)
 *
 * One recorded utterance (voice-activity segmented by VoiceEngine)
 * → POST /api/voice/stt → the server attaches `xi-api-key` and
 * forwards it to ElevenLabs Scribe → the transcript comes back.
 *
 * Every call goes through the usage gate (UsageBudgetGate,
 * kind "api", source "elevenlabs-stt"): reserved before the upload,
 * settled with what ElevenLabs REPORTED (`character-cost`, and the
 * USD `fiat-cost-before-overages` when present). A spent budget
 * refuses the call; it does not switch to another paid transcriber.
 * ==========================================================
 */

import UsageBudgetGate from "../observability/UsageBudgetGate";

interface ReportedUsage {
  characterCost: number | null;
  fiatCostUsd: number | null;
}

const STATUS_TTL_MS = 60_000;
let statusCache: { at: number; stt: boolean } | null = null;

/** True once the server has confirmed it can transcribe with ElevenLabs. */
export async function elevenLabsSttReady(): Promise<boolean> {
  if (typeof fetch !== "function") return false;
  const now = Date.now();
  if (statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache.stt;
  try {
    const response = await fetch("/api/voice/status", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const data = (await response.json()) as { stt?: unknown };
    statusCache = { at: now, stt: data.stt === true };
  } catch {
    statusCache = { at: now, stt: false };
  }
  return statusCache.stt;
}

export function forgetElevenLabsSttStatus(): void {
  statusCache = null;
}

/**
 * Her name, as transcription engines mishear it. Scribe heard
 * "Lei Liu" for "Lélu" in a live probe (2026-11-07); Whisper writes
 * "Lou"/"Lulu". Only the name as a whole word at the start of an
 * utterance or after a greeting is rewritten — never a word that
 * merely contains these letters.
 */
const NAME_VARIANTS = /(^|\b(?:hey|hi|hello|okay|ok|so|and)\s*,?\s*)(lei\s+liu|lay\s+lou|lay\s+lu|lei\s+lu|lei\s*lou|le\s*lou|lelu|lélou|lelou|lulu)(?=\b)/i;

export function normalizeHerName(text: string): string {
  return text.replace(NAME_VARIANTS, (_m, lead: string) => `${lead}Lélu`);
}

export class TranscriptionError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "TranscriptionError";
    this.status = status;
  }
}

/** Transcribe one utterance with ElevenLabs Scribe. Throws on failure or a spent budget. */
export async function transcribeWithElevenLabs(audio: Blob, language?: string): Promise<string> {
  const gate = UsageBudgetGate.getInstance();
  const reservation = await gate.reserve("api", "elevenlabs-stt"); // throws BudgetExhaustedError
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`/api/voice/stt${language ? `?lang=${encodeURIComponent(language)}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": audio.type || "audio/webm" },
      body: audio,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    await gate.settle(reservation, { operation: "stt", ok: false, latencyMs: Date.now() - started, error: (error as Error).message });
    throw new TranscriptionError(`ElevenLabs transcription unreachable: ${(error as Error).message}`);
  }
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean; text?: unknown; model?: unknown; usage?: ReportedUsage; error?: unknown; upstreamStatus?: unknown;
  };
  const usage = data.usage ?? { characterCost: null, fiatCostUsd: null };
  await gate.settle(reservation, {
    operation: "stt",
    model: typeof data.model === "string" ? data.model : undefined,
    ok: response.ok && data.ok === true,
    latencyMs: Date.now() - started,
    rateLimited: response.status === 429 || data.upstreamStatus === 429,
    // `results` carries ElevenLabs' reported character cost for this call.
    results: usage.characterCost ?? undefined,
    usage: usage.fiatCostUsd !== null ? { cost: usage.fiatCostUsd } : undefined,
    error: response.ok ? undefined : String(data.error ?? `HTTP ${response.status}`),
  });
  if (!response.ok || data.ok !== true) {
    throw new TranscriptionError(String(data.error ?? `ElevenLabs transcription failed (${response.status}).`), response.status);
  }
  return normalizeHerName(typeof data.text === "string" ? data.text.trim() : "");
}
