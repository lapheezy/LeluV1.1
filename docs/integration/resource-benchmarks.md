# Resource benchmarks

Measured on **this container**: 8 vCPU, 15 GB RAM, no GPU, Node v26.13.0,
Bun 1.4.4. Every number below was observed; estimates are labelled as such.

## The host

| Resource | Value |
|---|---|
| CPU | 8 vCPU |
| RAM | 15 GB total, ~14 GB available during the runs |
| GPU | none |
| Docker | client 29.1.3, **daemon unreachable** |
| Disk use by `.tools/` | ~260 MB (`opa` 64 MB, `trivy` 176 MB, `gitleaks` 22 MB) |

## Build and test

| Operation | Measured |
|---|---|
| `bun install` (833 packages, warm cache) | ~3 s |
| `npx tsc -b --force` | ~40 s (observed twice) |
| `bun run test` — 1274 tests (baseline) | **167 s** |
| `bun run test` — 1332 tests (final) | **~170 s** (same order; 58 added tests) |
| `npx tsx --test` on the 7 new files | ~4 s of test time; ~30 s process start-up per file |

## Policy (real OPA)

| Operation | Measured |
|---|---|
| `opa version` | < 100 ms |
| One `opa eval` decision (process per call) | **~20–40 ms** (from `policy-decisions.json`: 10 cases across ~300 ms total) |
| Reference evaluator (in-process) | < 1 ms |
| 15-input parity matrix (30 decisions) | ~390 ms including process spawns |

Implication: a per-call process spawn is fine for authorization checks on
actions, not for per-token work. Keeping OPA resident (`opa run --server`) is the
obvious optimisation and is not done.

## Scanning

| Operation | Measured |
|---|---|
| Gitleaks on a small temp directory | **~770–840 ms** |
| Gitleaks on this repository's working tree | a few seconds; 74 findings |
| Trivy filesystem scan | **not run** — no vulnerability DB (a first-run DB download is ~100 MB and was deliberately not spent) |
| Semgrep | not installed |

## Services

| Operation | Measured |
|---|---|
| `probeAllServices()` with everything unconfigured | < 100 ms — no network call is made when a URL is unset, and `contacted: false` says so |
| A configured-but-dead service | bounded by the 4 s per-probe timeout |

## Memory behaviour that matters

- Trace buffer: hard cap **2000 spans**, oldest dropped (tested with 2200).
- Audit buffer: hard cap **500 entries**.
- Orchestrator history: hard cap **100 outcomes**.
- Page cache in `ToolDispatcher`: bounded to 40 tasks (pre-existing).

These caps exist because an agent loop that traces or audits without a bound
turns observability into a leak.

## Voice (modelled, not measured)

No audio device exists here, so **no latency was measured**. What the system will
report once a device exists:

| Sample field | Source |
|---|---|
| `transcriptionMs` | wall time around `WhisperAdapter.transcribe` |
| `synthesisMs` | wall time around a Kokoro chunk |
| `responseMs` | user speech end → first audio out |
| `interruptionMs` | barge-in detected → synthesis stopped |

`summariseBenchmark` returns median and p95 and prints "Nothing is claimed about
latency" when the sample set is empty.

## Model inference

Not measured, and not measurable here: **no provider credential exists**. Any
figure for model latency in this document would be invented, so there is none.

## Mobile

No device and no emulator. The APK pipeline fails pre-existing at the Android SDK
step. No mobile performance claim is made.

## Concurrency

Not load-tested. Two structural facts are known and tested: one engine per
workspace (lock), and provider calls are serialised inside a turn by the existing
resolver. No concurrency ceiling was measured.
