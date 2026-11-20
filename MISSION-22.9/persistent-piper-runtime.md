# WP01 — PERSISTENT PIPER RUNTIME

**Priority:** P0 · **Status:** VERIFIED (software) · **Gate G2, G3:** VERIFIED

## 1. What was measured before any design decision

Three probe scripts, run against the installed binary and the real
`amy-low.onnx` voice. Raw output: `MISSION-22.9/logs/piper-*.log`.

| Question | Measurement | Consequence |
| --- | --- | --- |
| Cost of a cold process per sentence | 511–630 ms each (first 4 995 ms incl. page-cache cold load); 5 sentences = **7 237 ms** | ~290 ms of every sentence was the model load |
| Can one process serve many sentences? | `--json-input`, 5 sentences = **1 225 ms** total including one load | yes — the architecture |
| Does `--output_raw` still stream in that mode? | **10 bytes** on stdout | no — raw PCM streaming and persistence are mutually exclusive in this build |
| Does `output_file: "-"` work in JSON mode? | **2 bytes** | no |
| Does the output file appear incrementally? | file created, size **0** for the whole synthesis, then complete | the WAV is written at the end |
| Is the WAV header usable as a completion signal? | `data_size == file_size − 44` **only when finished** (header patched last) | yes — this is how the worker knows a sentence is done |
| Does a JSON line carry delivery flags? | `length_scale` per request **ignored**: 5.368 / 5.224 / 5.224 s vs the CLI's 5.000 / 5.400 / 5.816 s | delivery must be per worker, not per request |
| Memory of one warm worker | **111.5 MiB** RSS (95 MiB in the running server) | 3 profiles ≈ 300 MiB, acceptable on a 16 GB host |
| Two workers at once | 1 041 ms for two concurrent processes | profiles can run in parallel |

## 2. The architecture

`plugins/persistentPiper.ts` — one file, one responsibility: keep her voice
loaded and answer sentences from it.

```
POST /api/voice/tts
   └─ voiceApi.synthesizeLocalStream(text, res, profile)
        └─ PersistentPiper.synthesize(text, { profile, signal })
             └─ ProfileWorker (one per delivery profile)
                  ├─ spawn piper --model … --json-input --length_scale … (once)
                  ├─ write {"text": …, "output_file": …} + "\n"
                  ├─ poll the output WAV every 8 ms for data_size == size − 44
                  └─ resolve { wav, synthesisMs, workerPid, modelLoads, coldStart }
```

**Lifecycle**

- **Lazy or prewarmed.** `server.ts` calls `prewarm()` at boot when a local
  voice is configured, so the first reply a visitor hears is already warm
  (measured prewarm: 351 ms, one model load). It logs
  `[LÉLU runtime] warm speech ready: 1 worker(s), 1 model load(s), warm=423ms`.
- **Serialised per worker, parallel across profiles.** One sentence is
  written at a time to a worker; requests queue (bounded, default 8) and
  are answered in order. Different profiles never share a process.
- **Cancellation does not cost the model.** A barge-in aborts the wait and
  the sentence's file is swept; the process keeps its loaded voice because
  killing it would cost a model load on every interruption (measured: a
  cancellation left `modelLoads` at 1 and the same PID answered the next
  sentence).
- **Crash recovery.** A worker that exits with work in flight rejects that
  request as `worker-crashed`, is counted in `restarts`, and is respawned
  by the next request.
- **Load failure is named.** A worker that dies before ever completing a
  sentence, within 5 s of spawn, is a **model load failure** — reported as
  such (`modelLoadFailures`), not retried silently forever.
- **Timeout.** A sentence that has not finished in 20 s is abandoned and its
  worker killed (a hung synthesiser cannot be trusted with the next one).
- **Bounded memory.** Per-profile queue cap, a single temp directory per
  pool, files deleted on completion or sweep, and `shutdownPersistentPipers()`
  wired to `SIGTERM`/`SIGINT`/`server.on("close")` so a 63 MB model is never
  left resident after the runtime exits.

## 3. What the client contract still is

Unchanged from the page's point of view: one `POST /api/voice/tts` with
`{ text, stream }`, audio bytes back. Two additive facts are new:

| Header | Meaning |
| --- | --- |
| `X-Lelu-Streaming: warm-wav` | this sentence arrived complete — it is never labelled `pcm16` |
| `X-Lelu-Synthesis-Ms` | how long the worker took to synthesise it |
| `X-Lelu-Worker-Profile` | which delivery answered (`warm` / `calm` / `bright`) |
| `X-Lelu-Model-Loads` | pool-wide model initialisations at the time of the answer |
| `X-Lelu-Cold-Start` | `1` when this sentence paid for the load |

The old `audio/L16` path is untouched and is used when the warm runtime is
switched off or fails, so the client's PCM playback code is still exercised.

## 4. Worker lifecycle tests

`tests/voice-persistent-piper.test.ts` — 8 tests, real child processes
running a protocol-faithful fake Piper (`MISSION-22.9/scripts/fake-piper.mjs`),
no model and no audio device:

| Test | What it proves |
| --- | --- |
| one model load serves twenty consecutive sentences | 21 requests (prewarm + 20), **1 spawn**, 1 PID, `modelLoads = 1` |
| concurrent requests are serialised safely | 5 simultaneous requests, one worker, no corruption, queue drains, no worker left "busy" |
| each delivery profile is its own warm process | 2 profiles → 2 spawns with different `--length_scale`, different PIDs |
| a cancelled sentence does not cost the warm model | `cancelled = 1`, next sentence from **the same PID**, `modelLoads` still 1, `restarts = 0` |
| a crashed worker is reported and replaced | `worker-crashed`, `restarts ≥ 1`, next sentence succeeds with a new PID, `modelLoads = 2` |
| an unloadable model is a load failure | `modelLoadFailures = 1`, `lastError` starts `model load failed` |
| the queue is bounded | 6 concurrent → 2 served, 4 rejected with `queue-full` |
| shutdown rejects work instead of hanging | in-flight request rejects `shutting-down`; later calls refuse immediately |

`tests/voice-warm-tts.test.ts` — 4 route tests: warm answer + headers, no
reload on the next sentence, a second profile is a second load, an unknown
delivery falls back to `warm`, diagnostic reports the runtime, and
`LELU_PIPER_PERSISTENT=0` restores the M22.8 PCM path byte-for-byte.

## 5. Honest cost

`--json-input` cannot stream raw PCM (measured, 10 bytes), so a warm sentence
arrives complete instead of sample-by-sample. At 114 ms median synthesis
against a 2–5 s playback duration, the synthesis-ahead queue still has the
next sentence ready before the current one ends — and the first sample of a
sentence now arrives sooner than the *old* path's model load alone
(426 ms → 114 ms). The streaming path remains available and tested.
