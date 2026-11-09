# Integration decisions

Each decision names the alternative that was rejected and why. Every one is
reversible by deleting additive files; none required changing an existing
subsystem's contract.

## D1 — Adapters behind existing subsystems, never parallel ones

**Chosen:** one `CapabilityAdapter` contract (`src/core/integration/protocol.ts`)
and one gateway (`AdapterRegistry`) in front of all 16 integrations.
**Rejected:** per-integration clients with their own auth, retries and log formats.
**Why:** the spec forbids duplicate authorities, and per-integration clients make
"who authorised this, what did it touch, can I prove it" unanswerable.

## D2 — Policy: real OPA server-side, a reference implementation in the browser

**Chosen:** `policies/lelu/authorization.rego` evaluated by the real `opa` binary
for server decisions; `src/core/security/policy.ts` as the browser mirror and as
the differential-test partner.
**Rejected:** (a) Rego only — the browser cannot run OPA; (b) TypeScript only —
then the deployed policy is not the audited artifact.
**Why:** correctness is proven by parity, and the answer always says which engine
produced it. A divergence fails `tests/security-integrations.test.ts`.

## D3 — Relationship checks in-process now, OpenFGA server later

**Chosen:** the OpenFGA *tuple model* (owner → device → session → capability)
implemented in `RelationshipStore`, with an HTTP adapter for a real server.
**Rejected:** waiting for an OpenFGA deployment before shipping device authz.
**Cost:** tuples are not shared between instances. Documented in the monitor and
in `known-limitations.md`; the metadata endpoint reports `not_configured`.

## D4 — Observability: local trace store, OTLP export when a collector exists

**Chosen:** staged spans with parent links, structural redaction, a bounded ring
buffer, and a real OTLP/HTTP POST.
**Rejected:** OpenTelemetry SDK as a new dependency for a bundle that already
ships to a phone.
**Why:** the chain is what the acceptance test needs; adding the SDK to every
client would cost bundle size for a capability used server-side. `exportOtlp`
refuses when no endpoint is configured rather than pretending to export.

## D5 — Engineering: one orchestrator, interchangeable backends

**Chosen:** `EngineeringOrchestrator` selecting among `local`, `openhands`,
`opencode`, with an explicit refusal when a requested engine is down.
**Rejected:** falling back silently to the local shell when a remote engine fails.
**Why:** "run on OpenHands" and "run on this machine" are different security
postures; substituting one for the other silently is a lie about isolation.

## D6 — Verification requires a real test run

**Chosen:** a change is `verified` only with (a) changed files inside the allowed
paths, (b) `tests.ran === true`, (c) zero failures and at least one pass.
**Rejected:** trusting the backend's `ok: true`.
**Why:** measured in this repo's own history — runs 5, 8, 9, 15 and 20 of the
self-improvement log show confident success claims that measurement contradicted.

## D7 — Scanners fail closed

**Chosen:** a scanner that is missing, times out, or cannot fetch its DB makes the
gate **fail**, and the detail says "this is NOT a clean result".
**Rejected:** skipping missing scanners (the common default).
**Why:** a green security panel that means "we did not check" is worse than a red
one that means "we could not check".

## D8 — Voice: adapters with honest absence, no simulated audio

**Chosen:** VAD/STT/TTS adapters that report `configured: false` and return
"nothing was transcribed/synthesised".
**Rejected:** wiring browser speech synthesis and calling it Kokoro, or claiming
streaming without a transport.
**Why:** the existing `VoiceEngine` already speaks through browser voices; the new
layer must add capability, not relabel it.

## D9 — Do not create UI that has no implementation behind it

**Chosen:** `/api/integration/status|policy|scan` return real, probed state; the
Security Centre / Engineering Studio screens were **not** built this session.
**Rejected:** shipping panels with placeholder numbers to satisfy "frontend".
**Why:** the spec explicitly forbids decorative controls and fabricated health.
A missing screen is honest; a lying one is not.

## D10 — Preserve the branch strategy, do not force anything

**Chosen:** fast-forward onto the newest Claude branch, additive commits, `.tools/`
gitignored so 260 MB of binaries never enters history.
**Rejected:** rebasing or rewriting the 117 upstream commits to "clean up".
