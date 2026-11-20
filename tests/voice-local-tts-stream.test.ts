/**
 * ==========================================================
 * LÉLU — THE LOCAL SPEAKER STREAMS, IT DOES NOT WAIT FOR THE END
 *
 * CATEGORY: route, offline. createVoiceApi against a real local HTTP
 * server, with a stand-in synthesiser that emits raw PCM the way Piper's
 * `--output_raw` does. No model, no provider, no audio device.
 *
 * Before this, the route wrote a whole WAV to a temporary file, read it
 * back and only then answered: the page's first audible sample waited for
 * the last sample of the sentence. Now `stream: true` answers with
 * `audio/L16` at the model's declared rate, chunk by chunk.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { createVoiceApi } from "../plugins/voiceApi";

async function serve(readEnv: (key: string) => string | undefined) {
  const api = createVoiceApi(readEnv);
  const routes: Array<[string, (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void]> = [];
  api.attach({ use: (path, handler) => routes.push([path, handler as never]) });
  const server = http.createServer((req, res) => {
    const match = routes.find(([path]) => (req.url ?? "").startsWith(path));
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
  return {
    base,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

/** A stand-in for Piper: writes raw PCM to stdout, ignoring the model args. */
function fakePiper(directory: string, bytes: Buffer): string {
  const path = join(directory, "fake-piper.sh");
  writeFileSync(
    path,
    `#!/bin/sh\npython3 -c "import sys;sys.stdout.buffer.write(bytes.fromhex('${bytes.toString("hex")}'))"\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

test("stream:true answers with the model's declared rate and raw PCM", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lelu-stream-"));
  const model = join(directory, "voice.onnx");
  writeFileSync(model, "not a real model");
  writeFileSync(`${model}.json`, JSON.stringify({ audio: { sample_rate: 22_050 } }));
  const pcm = Buffer.from(new Int16Array([0, 1000, -1000, 32767, -32768]).buffer);
  const binary = fakePiper(directory, pcm);

  const s = await serve((key) =>
    key === "LELU_LOCAL_TTS_BIN" ? binary : key === "LELU_LOCAL_TTS_MODEL" ? model : undefined,
  );
  try {
    const response = await fetch(`${s.base}/api/voice/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Streaming test.", stream: true }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/L16;rate=22050;channels=1");
    assert.equal(response.headers.get("x-lelu-sample-rate"), "22050");
    assert.equal(response.headers.get("x-lelu-streaming"), "pcm16");
    assert.match(String(response.headers.get("x-lelu-voice-provider")), /^local-piper:/);
    const body = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(body, pcm, "the raw samples reach the page unchanged");
  } finally {
    s.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a synthesiser that produces nothing is a failure, never silent audio", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lelu-stream-"));
  const model = join(directory, "voice.onnx");
  writeFileSync(model, "not a real model");
  const empty = join(directory, "empty-piper.sh");
  writeFileSync(empty, "#!/bin/sh\nexit 0\n");
  chmodSync(empty, 0o755);

  const s = await serve((key) =>
    key === "LELU_LOCAL_TTS_BIN" ? empty : key === "LELU_LOCAL_TTS_MODEL" ? model : undefined,
  );
  try {
    const response = await fetch(`${s.base}/api/voice/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Nothing will come of this.", stream: true }),
    });
    assert.equal(response.status, 502);
    const body = (await response.json()) as { ok?: boolean };
    assert.equal(body.ok, false);
  } finally {
    s.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
