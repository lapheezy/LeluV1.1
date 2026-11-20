# WP08 — RUNTIME DIAGNOSTICS AND RECOVERY

**Priority:** P1 · **Gate G12:** VERIFIED

## 1. What is now exposed, and where it comes from

`GET /api/voice/diagnostic` (no network call, no key read) gained a
`tts.runtime` block that answers from the pool itself:

```json
"runtime": {
  "persistent": true,
  "warmWorkers": 1,
  "modelLoads": 2,
  "modelLoadFailures": 0,
  "restarts": 0,
  "requests": 9,
  "failures": 0,
  "cancelled": 0,
  "queueDepth": 0,
  "active": 0,
  "workers": [{
    "profile": "warm", "state": "ready", "pid": 417019, "uptimeMs": 150648,
    "requests": 8, "medianSynthesisMs": 656, "rssMiB": 145, "lastError": null
  }]
}
```

That is a **real** response from the running server during the M22.9 browser
run, not an illustration.

| Mission requirement | Field | Source of truth |
| --- | --- | --- |
| TTS provider | `tts.provider` (`local-piper`) | environment + `localVoiceConfig()` |
| Voice identity status | `voiceIdentity.status` (`fallback`), `cloned: false` | `voiceIdentity.ts` + provider |
| Model loaded state | `workers[].state` (`ready`/`busy`/`absent`/`dead`) | the worker's own child handle |
| Worker process state | `workers[].alive` + `state` | `child !== null` |
| Worker uptime | `workers[].uptimeMs` | spawn timestamp |
| Model initialisation count | `modelLoads` (pool-wide) | incremented only in `ensureChild()` |
| Synthesis queue depth | `queueDepth` | the queue arrays |
| Active synthesis requests | `active` | workers with an in-flight job |
| Cancellation state | `cancelled` | abort path |
| Error and recovery counts | `failures`, `restarts`, `modelLoadFailures`, `lastError` | lifecycle handlers |
| Memory | `workers[].rssMiB` | `/proc/<pid>/status` VmRSS |
| Microphone availability | `hardware.verified: false` + client diagnostics | the client's fact, never the server's |
| Speaker availability | client: `diagnostics.speakerDevices` (count or `null`) | `enumerateDevices()` after the mic is granted |
| Streaming status | `X-Lelu-Streaming` (`warm-wav` / `pcm16`) + `streaming.*` | the route's actual answer |
| AudioContext status | client: `diagnostics.audioContextState` | the live `AudioContext.state` |

## 2. What is never exposed

- No spoken text, no conversation content, no transcript.
- No API key, no environment-variable name, no account identifier.
- No audio bytes, no temporary file paths.
- No deleted-memory contents.

`tests/voice-warm-tts.test.ts` asserts the diagnostic does **not** contain the
sentence that was just spoken, and `tests/voice-runtime-diagnostic.test.ts`
(unchanged from M22.8) asserts no `xi-…` key ever appears.

## 3. Failure scenarios

| Scenario | Tested? | Result |
| --- | --- | --- |
| **Worker crash** | ✅ unit test | in-flight request rejects `worker-crashed`; `restarts` increments; next request spawns a new worker (`modelLoads` +1) and succeeds |
| **Model load failure** | ✅ unit test | `modelLoadFailures = 1`, `lastError` = `model load failed: …`, no infinite retry; the route falls back to the cold path |
| **Cancellation / barge-in** | ✅ unit test | `cancelled` increments, the file is swept, the warm model is **not** reloaded |
| **Queue saturation** | ✅ unit test | 6 concurrent requests → 2 served, 4 refused with `queue-full` |
| **Runtime shutdown** | ✅ unit test + server wiring | in-flight rejects `shutting-down`; `SIGTERM`/`SIGINT` kill warm workers so no 63 MB model is orphaned |
| **Server restart** | ⚠️ partial | boot prewarm logs `warm speech ready: 1 worker(s), 1 model load(s)`; a restart while a page is open was **not** exercised (the hardware/D5 procedure from M22.8 remains unrun) |
| **Browser refresh** | ⚠️ not tested this mission | the page re-requests; the server-side pool is unaffected by construction, but no run measured it |
| **Storage exhaustion** | ❌ not tested | a full disk would make the worker's output file fail; the code treats a missing file as "not finished" until the 20 s timeout, then reports `timeout`. This is an inference, not a measurement |
| **Network loss** | ⚠️ client-side only | the local path is same-origin loopback-free (no external call); a lost connection aborts the response, which aborts the job |
| **Microphone permission denial** | ⚠️ unchanged from M22.8 | `mapMediaError` reports `permission`; not re-run this mission |
| **Speaker disconnection** | ❌ not testable here | no audio device exists |

## 4. Read it from the page

`window.__leluVoice.diagnostics` (published by `VoiceBridge`) now also carries:

- `firstAudibleLatencyMs` — transcript → the output device reported playing;
- `audioContextState` — `unknown` until a context exists, then `running` /
  `suspended` / `closed`;
- `speakerDevices` — output devices enumerated, `null` if never asked;
- `warmSynthesis` — the last sentence's server facts (`synthesisMs`,
  `modelLoads`, `streaming`, `profile`, `coldStart`), read from headers.

The distinction between "audio was handed to a player" (`firstAudioLatencyMs`)
and "the device says it is playing" (`firstAudibleLatencyMs`) was added because
M22.8's single number flattered the pipeline by reporting the earlier moment.
