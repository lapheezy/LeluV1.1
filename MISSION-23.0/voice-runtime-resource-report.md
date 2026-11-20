# WP08 — Runtime and Resource Qualification

**Status: VERIFIED (30-minute soak, three profiles, one forced worker death).**

The question M22.9 left open was whether keeping several delivery-profile
workers resident is affordable, and whether anything leaks. This is measured on
the real server, the real Piper binary and the real warm pool — no browser, no
audio device, no simulated hardware.

## Setup

```
fresh server: PORT=4180, LELU_LOCAL_TTS_BIN=.piper/piper/piper,
              LELU_LOCAL_TTS_MODEL=.piper/voices/amy-low.onnx
boot:         warm speech ready: 1 worker(s), 1 model load(s), warm=461ms
load:         856 real syntheses over 30.05 minutes, profiles rotating
              warm → calm → bright, paced at ~28/min
              (the endpoint admits 60/min per client; 48/min was partly
               rejected, 28/min was not: rate-limited = 0)
script:       scripts/warm-runtime-soak.ts
```

## Result

| Measure | Value |
|---|---|
| Duration | 1 803 s (30 min 03 s) |
| Syntheses served | **856** |
| Errors | **0** |
| Rejected by the endpoint's own limiter | **0** |
| Synthesis latency (n=857) | min 72 ms · **median 138 ms** · p90 169 ms · max 586 ms |
| Queue depth | 0 at every sample |
| Model loads | 3 (one per profile) |
| Model-load failures | 0 |
| Restarts during the load | 0 |

### Memory

| Measure | Value |
|---|---|
| Server (parent) RSS, start | 49 MiB |
| Server (parent) RSS, end | 59 MiB |
| Server RSS, min / max | 49 / 59 MiB |
| Mean, first half of run | 55.7 MiB |
| Mean, second half of run | 57.9 MiB |
| Worker `warm` | ~112–128 MiB (median synthesis 138 ms) |
| Worker `calm` | 99 MiB (median 146 ms) |
| Worker `bright` | 100 MiB (median 131 ms) |
| **Total, all resident** | **≈ 405 MiB** (59 parent + 346 workers) |

**No leak.** The parent drifts +1.2 MiB on average between the first and second
halves and then sits at 57–59 MiB for the remaining quarter of the run; the
workers do not grow. The `calm` and `bright` workers were **never restarted**:
`uptimeMs` 1 848 s and 1 846 s at the end — they were alive for the whole
session, 285 requests each, with `lastError: none`.

### Do all three profiles need to stay resident?

Yes, and this is a property of the synthesiser, not a design preference. M22.9's
probe established that a warm `--json-input` worker **ignores** a per-request
`length_scale`, so a delivery profile cannot be a parameter of one worker — it
needs its own. The three workers cost ~346 MiB together and remove a model
reload (~0.4–0.9 s) from every register change. Idle eviction would trade
~115 MiB for exactly that reload on the next sentence, and the measured benefit
is unchanged across a 30-minute session, so eviction is **not** recommended.

## Recovery: a worker killed mid-session

At the end of the soak the `warm` worker was killed with `SIGKILL`:

```
lastError: "worker exited (code null, signal SIGKILL) after 1802125 ms"
```

| Step | Observed |
|---|---|
| Death detected | immediately; worker reported `state: "dead"`, `failures` 0 → 1 |
| Request for that profile | **served**, 513 ms, 125 740 bytes |
| Pool afterwards | `modelLoads` 3 → **4**, `warm` back to `state: "ready"` |
| Next request, same profile | **148 ms** — warm latency restored |

**Recovery is lazy, and that is the honest description:** the pool does not
proactively re-warm a dead profile; the *next request for that profile* spawns
the worker and is itself served by it, paying one model load (~0.5 s in this
measurement, on an idle machine). The other two profiles are unaffected
throughout.

One nuance worth recording: inside the soak script's automated check, the pool
still reported the killed `warm` worker as dead 1.5 s after the request that
succeeded, which made the script's own `ok` assertion unreliable. A separate,
direct probe reproduced the recovery plainly (513 ms → 148 ms, loads 3 → 4).
The behaviour is verified; the script's assertion was too eager, and the
numbers here come from the direct probe.

## An earlier, invalid run (kept for honesty)

A previous 30-minute soak sent `profile` in the request body where the route
reads `delivery`, so every request used the default `warm` profile — a
single-profile run masquerading as a three-profile one. It is kept as
`logs/warm-soak-30min-single-profile-superseded.json` and is **not** cited as
evidence. It also produced no growth (66–70 MiB parent, flat), which is
consistent with the corrected run but not a substitute for it.

## Against the mission's acceptance criteria

| Criterion | Result |
|---|---|
| Run a 30-minute voice session | **yes** — 1 803 s, 856 syntheses |
| Inspect memory growth | **yes** — +1.2 MiB mean half-on-half, bounded, no worker growth |
| Detect worker leaks | **none** — workers alive 30 min with no restart, queue depth 0 |
| Verify worker health | **yes** — 3 ready, 0 load failures, per-worker medians 131–146 ms |
| Recovery after process termination | **yes** — SIGKILL → next request respawns and is served, 513 ms then 148 ms |
| Bounded resource consumption | **yes** — ≈405 MiB total, stable |

## Caveat

This is one process on one 8-vCPU machine with a single client. It says nothing
about two concurrent sessions, about a machine with 2 vCPU, or about behaviour
under a real browser's streaming path — which the 100-turn run exercised
separately with a different memory profile.
