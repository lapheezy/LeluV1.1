# MISSION 22.10 — Persistent voice runtime × canonical integration

| # | Deliverable | File |
| --- | --- | --- |
| 1 | Branch recovery report | `01-BRANCH-RECOVERY-AND-INTEGRATION-MAP.md` |
| 2 | Voice integration map | `01-BRANCH-RECOVERY-AND-INTEGRATION-MAP.md` (§ file-level map) |
| 3 | Conflict report | `02-CONFLICT-REPORT.md` |
| 4 | Implementation report | `03-IMPLEMENTATION-REPORT.md` |
| 5 | Regression test results | `04-REGRESSION-RESULTS.md`, `test-results.json`, `logs/*.tap` |
| 6 | Integration acceptance matrix | `05-INTEGRATION-ACCEPTANCE-MATRIX.md`, `logs/e2e-*.json` |
| 7 | Canonical branch and remote verification | `06-CANONICAL-BRANCH-VERIFICATION.md` |
| 8 | Exact final commit hash | the remote head of `integration/lelu-four-workforce-consolidation` after the evidence commit (see 06) |

**Outcome:** the M22.9 persistent voice runtime is on
`integration/lelu-four-workforce-consolidation`. That is the 15-commit voice
line, cherry-picked with provenance, plus 2 fixes for conflicts that only
exist on canonical. Software regression: 0 failures. Browser acceptance:
14/14 on the simulated microphone. Physical microphone, headset and iPhone
acceptance remains outstanding. The GitHub default branch still points
elsewhere and needs an admin to change it.

Reproduce: `scripts/integration-acceptance.mjs desktop|mobile|recovery|denial|visibility`,
`scripts/resource-probe.mjs 30`, `scripts/mobile-cosmos-probe.mjs`,
`scripts/contamination-check.mjs logs/e2e-desktop.json`. These need the server
started with the local Piper voice
(`LELU_LOCAL_TTS_BIN`, `LELU_LOCAL_TTS_MODEL`) and the simulated microphone
`.piper/session-mic.wav` (`MISSION-22.9/persistent-runtime/scripts/build-session-mic.py`).
