#!/usr/bin/env node
/**
 * M22.9 / WP01 test double: a Piper that speaks the `--json-input` protocol.
 *
 * It is protocol-faithful where it matters to the runtime:
 *   - one JSON document per line on stdin, answered in order;
 *   - a WAV written to `output_file`, with the data-size field patched LAST
 *     (which is exactly the completion signal the persistent pool relies on);
 *   - configurable delay, crash and load-failure behaviour, so recovery can
 *     be tested without a 63 MB model.
 *
 * Environment:
 *   FAKE_PIPER_LOG       file to append one line per request (spawn counting)
 *   FAKE_PIPER_DELAY_MS  synthesis time per sentence
 *   FAKE_PIPER_DIE_ON    exit(1) when the Nth request of this process arrives
 *   FAKE_PIPER_EXIT_NOW  exit(1) immediately without serving anything
 *   FAKE_PIPER_EMPTY     write a 44-byte WAV with no samples
 */
import { appendFileSync, closeSync, openSync, writeSync } from "node:fs";
import readline from "node:readline";

const log = process.env.FAKE_PIPER_LOG;
const delay = Number(process.env.FAKE_PIPER_DELAY_MS ?? 40);
const dieOn = Number(process.env.FAKE_PIPER_DIE_ON ?? 0);

if (log) appendFileSync(log, `spawn ${process.pid} ${process.argv.slice(2).join(" ")}\n`);
if (process.env.FAKE_PIPER_EXIT_NOW === "1") process.exit(1);

let served = 0;

const rl = readline.createInterface({ input: process.stdin });
const pending = [];

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    return;
  }
  pending.push(request);
});

async function drain() {
  for (;;) {
    const request = pending.shift();
    if (!request) return;
    served += 1;
    if (log) appendFileSync(log, `request ${process.pid} ${served} ${request.output_file}\n`);
    if (dieOn > 0 && served === dieOn) process.exit(1);
    // 16 kHz mono 16-bit: 200 ms of a quiet tone per request.
    const samples = process.env.FAKE_PIPER_EMPTY === "1" ? 0 : 3200;
    await new Promise((resolve) => setTimeout(resolve, delay));
    const fd = openSync(request.output_file, "w");
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16_000, 24);
    header.writeUInt32LE(32_000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36, "ascii");
    // Placeholder first: the real length is patched after the samples, so a
    // reader can tell "file exists" from "sentence finished".
    writeSync(fd, header);
    const body = Buffer.alloc(samples * 2);
    writeSync(fd, body);
    const patch = Buffer.alloc(8);
    patch.writeUInt32LE(samples * 2, 0);
    writeSync(fd, patch, 0, 4, 40);
    closeSync(fd);
  }
}

setInterval(() => void drain(), 5);
