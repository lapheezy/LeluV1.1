/**
 * ==========================================================
 * LÉLU — VOXCPM2 ROUTE OVERHEAD (measured, not estimated)
 *
 * Measures what the LÉLU side of her cloned voice costs: the
 * request, the reference-audio base64 load/encode, the proxy hop
 * and the response body — with a stubbed inference server that
 * answers instantly. Anything the GPU adds is NOT in these
 * numbers and is not claimed by them.
 *
 *   npx tsx scripts/measure-voxcpm-overhead.ts
 *
 * Writes artifacts/voice/route-overhead.json.
 * ==========================================================
 */

import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { createVoxCpmApi, voxCpmConfig } from "../plugins/voxcpmApi";

const RUNS = 7;
const TEXT = "Good evening. I have checked the route, and her voice is ready to speak.";

/** 1 second of silence as a WAV, standing in for the model's audio. */
function wavBytes(seconds = 1, sampleRate = 48_000): Uint8Array {
  const samples = seconds * sampleRate;
  const data = new Uint8Array(44 + samples * 2);
  const view = new DataView(data.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  return data;
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
}

async function main(): Promise<void> {
  const referencePath = voxCpmConfig((key) => process.env[key]).referencePath;
  const real = globalThis.fetch;
  let upstreamCalls = 0;
  let referencePayloadBytes = 0;

  // Replace ONLY the inference server; everything else is the real route.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/v1/audio/speech")) {
      upstreamCalls += 1;
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      referencePayloadBytes = String(body.reference_audio ?? "").length;
      return new Response(wavBytes(1), { headers: { "content-type": "audio/wav" } });
    }
    return real(input, init);
  }) as typeof fetch;

  const api = createVoxCpmApi((key) =>
    key === "VOXCPM_BASE_URL"
      ? "http://127.0.0.1:8000"
      : key === "LELU_VOICE_CONSENT_ATTESTED"
        ? "true"
        : process.env[key],
  );
  const routes: Array<[string, (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void]> = [];
  api.attach({ use: (p, h) => routes.push([p, h as never]) });
  const server = http.createServer((req, res) => {
    const match = routes.find(([p]) => (req.url ?? "").startsWith(p));
    if (!match) {
      res.statusCode = 404;
      res.end();
      return;
    }
    match[1](req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const timings: number[] = [];
  const bytes: number[] = [];
  // One warm-up: the first request loads and caches the reference.
  await fetch(`${base}/api/voice/voxcpm/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: TEXT }),
  });
  for (let run = 0; run < RUNS; run += 1) {
    const started = process.hrtime.bigint();
    const response = await fetch(`${base}/api/voice/voxcpm/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: TEXT }),
    });
    await response.arrayBuffer();
    timings.push(Number(process.hrtime.bigint() - started) / 1e6);
    bytes.push(Number(response.headers.get("content-length") ?? 0));
  }

  const report = {
    measuredAt: new Date().toISOString(),
    runs: RUNS,
    route: "POST /api/voice/voxcpm/tts",
    reference: path.basename(referencePath),
    referencePayloadBytes,
    upstreamCalls,
    overheadMs: {
      median: Math.round(percentile(timings, 0.5) * 10) / 10,
      p95: Math.round(percentile(timings, 0.95) * 10) / 10,
      min: Math.round(Math.min(...timings) * 10) / 10,
      max: Math.round(Math.max(...timings) * 10) / 10,
    },
    audioBytes: bytes[0] ?? 0,
    excludes:
      "OpenBMB VoxCPM2 inference (GPU) — the upstream was stubbed to answer instantly. " +
      "No time-to-first-audio or real-time factor is claimed for the model.",
  };

  mkdirSync("artifacts/voice", { recursive: true });
  writeFileSync("artifacts/voice/route-overhead.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));

  server.closeAllConnections();
  server.close();
  globalThis.fetch = real;
}

void main();
