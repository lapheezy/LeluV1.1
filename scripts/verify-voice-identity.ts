/**
 * ==========================================================
 * LÉLU — VERIFY HER VOICE IDENTITY (no browser needed)
 *
 * The Chat Universe is where the voice is used, but it is not
 * where the voice can be TRUSTED. This checks the whole chain
 * from the committed recording to a real synthesised sentence,
 * and says exactly which link is broken — so a broken chat
 * surface can never be mistaken for a broken voice, or the
 * reverse.
 *
 *   npx tsx scripts/verify-voice-identity.ts
 *   npx tsx scripts/verify-voice-identity.ts --speak   (when a model is deployed)
 *
 * Exit code: 0 = every *reachable* link passed, 1 = a link that
 * should work failed. A link that is honestly blocked (no GPU, no
 * consent) is reported BLOCKED, not PASS.
 * ==========================================================
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { LELU_VOICE_IDENTITY } from "../src/core/voice/voiceIdentity";

type Verdict = "PASS" | "FAIL" | "BLOCKED" | "INFO";

interface Check {
  name: string;
  verdict: Verdict;
  detail: string;
}

const checks: Check[] = [];
const add = (name: string, verdict: Verdict, detail: string) => {
  checks.push({ name, verdict, detail });
};

const BASE = process.env.LELU_BASE_URL ?? "http://127.0.0.1:3000";
const SPEAK = process.argv.includes("--speak");

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** A committed reference must be the real recording, not a placeholder. */
function checkReference(): void {
  const file = LELU_VOICE_IDENTITY.repositoryPath;
  if (!existsSync(file)) {
    add("committed reference", "FAIL", `${file} is missing. Refusing to substitute another recording.`);
    return;
  }
  const stat = statSync(file);
  const head = readFileSync(file).subarray(4, 12).toString("latin1");
  const isMp4 = head.startsWith("ftyp");
  add(
    "committed reference",
    stat.size > 100_000 && isMp4 ? "PASS" : "FAIL",
    `${file} — ${stat.size} bytes, sha256 ${sha256(file).slice(0, 16)}…, container ${isMp4 ? "ISO-MP4/M4A" : "unrecognised"}`,
  );
  add("reference transcript", LELU_VOICE_IDENTITY.promptTranscript.length > 100 ? "PASS" : "FAIL",
    `${LELU_VOICE_IDENTITY.promptTranscript.length} characters carried to the model as prompt_text`);
}

async function checkRoute(): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${BASE}/api/voice/voxcpm/status`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      add("voice route", "FAIL", `GET /api/voice/voxcpm/status → HTTP ${response.status}`);
      return null;
    }
    const body = (await response.json()) as Record<string, unknown>;
    add("voice route", "PASS", `GET /api/voice/voxcpm/status → 200 (${BASE})`);
    add("reference prepared", body.referenceLoaded === true ? "PASS" : "BLOCKED",
      body.referenceLoaded === true
        ? `${body.referenceFile} — ${body.referenceBytes} bytes`
        : "not prepared; run deploy/voxcpm/prepare-reference.sh");
    add("consent attestation", body.consentAttested === true ? "PASS" : "BLOCKED",
      body.consentAttested === true
        ? "operator attested the speaker's authorisation"
        : "LELU_VOICE_CONSENT_ATTESTED is not \"true\" — cloning stays refused by design");
    add("inference server", body.configured === true ? "PASS" : "BLOCKED",
      typeof body.detail === "string" ? body.detail : "no detail");
    return body;
  } catch (error) {
    add("voice route", "FAIL", `${BASE} is unreachable: ${(error as Error).message}`);
    return null;
  }
}

async function checkInference(status: Record<string, unknown> | null): Promise<void> {
  const baseUrl = (process.env.VOXCPM_BASE_URL ?? "").replace(/\/+$/, "");
  if (!baseUrl) {
    add("model process", "BLOCKED", "VOXCPM_BASE_URL is unset — no VoxCPM2 process is deployed.");
    return;
  }
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(8000) });
    const body = (await response.json()) as Record<string, unknown>;
    add("model process", "PASS", `GET /health → ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  } catch (error) {
    add("model process", "FAIL", `${baseUrl}/health unreachable: ${(error as Error).message}`);
  }
  void status;
}

/** A real generation, timed. Only runs when asked and only when configured. */
async function checkSpeech(): Promise<void> {
  if (!SPEAK) {
    add("real generation", "INFO", "not requested — pass --speak once a model is deployed");
    return;
  }
  const text = "Good evening. This is LÉLU, speaking with her own voice.";
  const started = Date.now();
  try {
    const response = await fetch(`${BASE}/api/voice/voxcpm/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/wav" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      const body = await response.text();
      add("real generation", "FAIL", `HTTP ${response.status}: ${body.slice(0, 200)}`);
      return;
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    const totalMs = Date.now() - started;
    mkdirSync("artifacts/voice", { recursive: true });
    const out = "artifacts/voice/verify-sentence.wav";
    writeFileSync(out, audio);
    // 48 kHz, 16-bit, mono → bytes/2/48000 seconds of speech.
    const seconds = Math.max(0, (audio.byteLength - 44) / 2 / 48_000);
    add("real generation", "PASS",
      `${audio.byteLength} bytes → ${out}; ${totalMs} ms total, RTF ${(totalMs / 1000 / Math.max(seconds, 0.001)).toFixed(2)} (model RTF is only meaningful on a warm GPU)`);
  } catch (error) {
    add("real generation", "FAIL", (error as Error).message);
  }
}

async function main(): Promise<void> {
  checkReference();
  const status = await checkRoute();
  await checkInference(status);
  await checkSpeech();

  console.log("\nLÉLU — voice identity verification\n");
  for (const check of checks) {
    console.log(`  ${check.verdict.padEnd(8)} ${check.name.padEnd(22)} ${check.detail}`);
  }

  const failed = checks.filter((c) => c.verdict === "FAIL").length;
  const blocked = checks.filter((c) => c.verdict === "BLOCKED").length;
  console.log(
    `\n  ${checks.filter((c) => c.verdict === "PASS").length} passed, ${failed} failed, ${blocked} blocked.\n`,
  );
  if (failed > 0) {
    console.log("  A blocked step is not a passing step: the voice cannot speak until every link is live.\n");
  } else if (blocked > 0) {
    console.log("  Everything reachable works. The remaining links are honestly blocked — see above.\n");
  } else {
    console.log("  Whole chain live. Listen to the generated sample before claiming similarity.\n");
  }
  process.exitCode = failed > 0 ? 1 : 0;
}

void main();
