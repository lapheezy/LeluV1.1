/**
 * ==========================================================
 * LÉLU — TRANSCRIPTION TRANSPORT
 *
 * Audio posts through the SAME server broker as chat.
 *
 * There used to be two server-owned credential mechanisms: the broker
 * (`endpointUrl` → `/api/model/<provider>/…`, used by every chat provider)
 * and a second relay of its own for audio (`/api/ai/relay-raw`). Both were
 * correct and neither leaked a key — but they were two allowlists, two
 * status endpoints, two id vocabularies and two precedence rules for one
 * responsibility, which is two places for the next provider to be added to
 * only one of.
 *
 * Audio needed its own path for exactly one reason: the broker forwarded
 * every body as `application/json` and decoded it as utf8, which destroys a
 * multipart audio part. The broker now forwards the caller's own
 * Content-Type and the bytes unchanged, so there is nothing left for a
 * second mechanism to do.
 *
 * The browser still holds no key: `authHeaders` returns nothing when the
 * provider is brokered, and the server attaches the credential.
 * ==========================================================
 */

import { endpointUrl } from "../Endpoints";
import { authHeaders, primeBrokerStatus, providerConfigured } from "../model/BrokerTransport";

/** Groq's Whisper endpoint, relative to the groq endpoint base. */
const TRANSCRIPTION_PATH = "openai/v1/audio/transcriptions";

/**
 * Post a prepared multipart transcription request.
 *
 * No Content-Type is set here on purpose: the browser writes the multipart
 * boundary itself, and the broker forwards that header verbatim so the
 * upstream can parse the parts.
 */
export function postTranscription(
  form: FormData,
  options: { apiKey: string; signal?: AbortSignal },
): Promise<Response> {
  return fetch(endpointUrl("groq", TRANSCRIPTION_PATH), {
    method: "POST",
    headers: authHeaders("groq", options.apiKey, (key) => ({ Authorization: `Bearer ${key}` })),
    body: form,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

/**
 * Can speech be transcribed right now?
 *
 * Server-authoritative when brokered — the browser is not entitled to an
 * opinion, because forming one would require seeing a key. The broker status
 * is primed first so the answer comes from what the server actually said
 * rather than from the cold-start default, which is deliberately optimistic
 * for the fallback chain and would overstate voice capability here.
 */
export async function transcriptionAvailable(apiKey = ""): Promise<boolean> {
  await primeBrokerStatus();
  return providerConfigured("groq", apiKey);
}
