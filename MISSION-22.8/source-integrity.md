# Source integrity — Phase 0

## What was verified before anything was changed

```text
$ git rev-parse --abbrev-ref HEAD
m22.7/live-voice-qualification
$ git rev-parse HEAD
8fe502382fb9911629860bda08d90dcff0be7fdc
$ git log --oneline -3
8fe50238 Record the remote verification of the M22.7 voice candidate
e4ce1764 Speak through an opt-in local voice and record the live voice qualification
afcfd8c7 Record the remote verification of the M22.6 candidate
$ git cat-file -t 543da7c8d7876258869d928648cffa913cd10649
commit
$ git rev-parse 543da7c8
543da7c8d7876258869d928648cffa913cd10649
```

* The M22.7 candidate named by this mission (`8fe50238…`) is the checked-out
  commit and the tip of `m22.7/live-voice-qualification`.
* The implementation reference `e4ce1764` is its parent.
* The canonical baseline `543da7c8` resolves and is **not** an ancestor of the
  working branch in any modified sense: nothing in this mission touches it,
  merges into it, or pushes to it.
* `MISSION-22.7/` was read but not rewritten. Its evidence (12 reports, 6 WAVs,
  4 screenshots, 2 logs) remains exactly as committed.

## The branch

```text
$ git checkout -b m22.8/real-time-conversational-intelligence
Switched to a new branch 'm22.8/real-time-conversational-intelligence'
$ git rev-parse HEAD
8fe502382fb9911629860bda08d90dcff0be7fdc
```

A new isolated branch from the verified candidate: no commit was rewritten, no
branch was forced, and the M22.7 branch remains where it was.

## Files changed by M22.8

| File | Change | Work package |
|---|---|---|
| `src/core/voice/spokenText.ts` | **new** — the spoken-language normalization layer | WP05 |
| `src/core/voice/VoiceEngine.ts` | stream ownership, streamed spoken turns, latency measurement, echo-cancelling capture, diagnostics preserved across polls | WP01, WP02, WP03, WP06 |
| `src/core/voice/elevenLabsTts.ts` | synthesis-ahead queue, incremental PCM playback, stop/cancel | WP02 |
| `src/app/scene/genesis/GenesisChat.tsx` | passes its turn id to the streaming speech calls | WP01 |
| `src/app/scene/genesis/VoiceBridge.tsx` | publishes `window.__leluVoice` (the runtime diagnostic) | WP06 |
| `plugins/voiceApi.ts` | `/api/voice/diagnostic`, incremental local PCM streaming | WP02, WP06 |
| `tests/voice-spoken-text.test.ts` | **new** — 61 normalization assertions | WP05 |
| `tests/voice-tts-pipeline.test.ts` | **new** — synthesis-ahead, ordering, stop, failure | WP02 |
| `tests/voice-turn-ownership.test.ts` | **new** — superseded streams cannot speak | WP01 |
| `tests/voice-runtime-diagnostic.test.ts` | **new** — the diagnostic reports what is wired | WP06 |
| `tests/voice-local-tts-stream.test.ts` | **new** — route-level PCM streaming | WP02 |
| `tests/voice-pcm-playback.test.ts` | **new** — first-chunk playback and stop | WP02 |
| `MISSION-22.8/` | **new** — this evidence package | all |

Nothing was deleted, renamed or weakened. No existing test assertion was
relaxed; the full suite result is compared against the M22.7 baseline in
`M22.8-verification-report.md`.

## Rollback

The branch is the rollback point, and the candidate it started from is a
committed hash:

```text
git switch m22.7/live-voice-qualification   # back to the M22.7 candidate
git branch -D m22.8/real-time-conversational-intelligence   # discard M22.8
```

No M22.8 commit is merged into any long-lived branch, and canonical
`543da7c8` remains untouched.
