# WP05 — Automated test results

Machine-readable: `persistent-runtime/test-results.json`. Raw TAP and logs:
`persistent-runtime/logs/`. Every result below was executed in this session.

## Commands (from package.json / tsconfig)

| Gate | Command | Baseline (b46b0aa3, clean worktree) | Final tree |
| --- | --- | --- | --- |
| Full suite | `npm test` (tsx + node:test, concurrency 1) | 2 326 tests · 2 317 pass · **3 fail** · 6 skipped | 2 346 tests · 2 339 pass · **1 fail** · 6 skipped |
| Targeted voice | 19 `tests/voice-*.test.ts` + `mission-10-3` | — | **141 pass · 0 fail** (`voice-targeted.tap`) |
| Typecheck | `tsc -b --force` | exit 0 | exit 0 (`typecheck.log`) |
| Lint | `oxlint` | 0 errors · 175 warnings | 0 errors · 175 warnings — **identical warning set** (diffed) |
| Build | `npm run build` (`tsc -b && vite build`) | — | exit 0 (`build-tail.log`) |
| Browser E2E | `persistent-runtime/scripts/session-acceptance.mjs desktop|mobile|recovery` | — | 5 runs, all completed (WP06) |
| Resource probe | `persistent-runtime/scripts/resource-probe.mjs 30 [idle]` | — | completed (WP07) |
| Physical device | — | — | **NOT EXECUTED** — no hardware |

## Failures, separated

* **Pre-existing (environment): `tests/genesis-interface.test.tsx`.** Node
  cannot import `@excalidraw/excalidraw/index.css` (`ERR_PACKAGE_PATH_NOT_EXPORTED`,
  `logs/genesis-interface-failure.txt`). Fails identically at baseline. Not touched.
* **Baseline-only:** two `sandbox` module-reuse tests failed in the baseline
  worktree run (a scratch-directory checkout with symlinked `node_modules`)
  and pass in the real checkout before and after the change. Environmental.
* **New failures:** none.
* **Tests not executed:** physical microphone / speaker / iOS Safari / PWA.
* No test was deleted, skipped or weakened.

## Coverage of the required categories

| Category | Where | Notes |
| --- | --- | --- |
| Voice lifecycle (start/stop/resume/cleanup) | `voice-persistent-session` 1–3, 12; E2E all runs | 20 cycles unit, 30 + 10 browser |
| Audio capture (permission, device loss, stream end) | `voice-persistent-session` 4–10, 13 | deny, no device, ended, revoked, busy×2, busy forever, hidden |
| Transcription (partial/final/empty/failed) | existing `voice-core-integration`, `asr-provenance`, `voice-continuity`; E2E STT abort | |
| Cognition integration (same AIService/context) | existing `voice-core-integration`, `voice-turn-ownership`; E2E run3 | typed reply summarised voice turns |
| Streaming (partial/completion/failure) | `voice-streaming-tts-state`, `voice-stream-waits-for-her-voice`, new markdown-split test | |
| Speech generation (success/failure/fallback) | `voice-tts-pipeline`, `voice-elevenlabs`, `voice-warm-tts`, new streamed-failure test; E2E recovery | |
| Playback (start/finish/cancel) | `voice-pcm-playback`, `voice-continuity` | |
| Barge-in (repeated) | new 3× barge-in test; E2E 2× per desktop run | |
| Persistence (supported restoration) | new remount test; conversation persisted across E2E (localStorage) | page reload does not auto-restart the mic by design |
| Concurrency (no duplicate streams/turns) | new double-tap and prompt-open tests; E2E `getUserMediaCalls: 1` | |
| Mobile (touch, lifecycle) | E2E mobile (touch, layout); visibility/pagehide unit tests | WebKit not available |
| Regression | full suite | above |

## New tests — `tests/voice-persistent-session.test.ts` (20)

Each was confirmed to fail against the pre-change engine (21/21 failures with
the original `VoiceEngine.ts` restored) and pass with the change (20/20).
