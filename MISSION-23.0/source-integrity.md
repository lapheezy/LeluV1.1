# M23.0 — Source Integrity

**Status: VERIFIED**

## Branch and baseline

```
$ git log --oneline -1 m22.9/persistent-voice-runtime
b46b0aa3 Name the implementation commit instead of a moving branch head

$ git checkout -b m23.0/embodied-conversational-experience
Switched to a new branch 'm23.0/embodied-conversational-experience'
```

The M23.0 branch was created **from the M22.9 baseline candidate**, with a
clean working tree, before any file in this mission was touched.

## Historical references, resolved locally

```
$ git rev-parse m22.8/real-time-conversational-intelligence \
                m22.7/live-voice-qualification \
                543da7c8
43db0a06c3c9c587aab9606e4cb328671548c805   m22.8
8fe502382fb9911629860bda08d90dcff0be7fdc   m22.7
543da7c8d7876258869d928648cffa913cd10649   canonical
```

## Remote state (before work began)

```
$ git ls-remote --heads origin
543da7c8d7876258869d928648cffa913cd10649  refs/heads/integration/m16-3-wp05-reconciliation
8fe502382fb9911629860bda08d90dcff0be7fdc  refs/heads/m22.7/live-voice-qualification
43db0a06c3c9c587aab9606e4cb328671548c805  refs/heads/m22.8/real-time-conversational-intelligence
b46b0aa33c6e8873e8f2f7f5ade05884d102e1d5  refs/heads/m22.9/persistent-voice-runtime
```

| Reference | Expected | Remote | Result |
|---|---|---|---|
| canonical | `543da7c8` | `543da7c8` | unchanged |
| M22.7 | `8fe50238` | `8fe50238` | recoverable |
| M22.8 | `43db0a06` | `43db0a06` | recoverable |
| M22.9 | `b46b0aa3` | `b46b0aa3` | matches local |

## Preservation

* Canonical `543da7c8` was **not** modified, merged into, or pushed to.
* M22.7, M22.8 and M22.9 branches are untouched; every M22.9 evidence file
  under `MISSION-22.9/` remains in the tree and unedited.
* M23.0 adds `MISSION-23.0/` and three voice source files
  (`speechOutcome.ts` new; `VoiceEngine.ts` and `VoiceBridge.tsx` edited), plus
  one test file. The persistent-Piper runtime (`plugins/persistentPiper.ts`,
  `plugins/voiceApi.ts`, `server.ts`) is unchanged in this mission.
* No reset, no rebase, no history rewrite, no force-push.

## Baseline reproduction

The M22.9 verification claims were re-derived rather than trusted, because the
voice suites are the ones this mission edits:

| Check | M22.9 claimed | M23.0 measured before edits |
|---|---|---|
| `npx tsc -b --force` | 0 | 0 |
| `bun run build` | 0 | 0 (`✓ built in 11.26s`) |
| Voice suites | 114 tests, 113 pass, 1 skip | confirmed, plus 8 new tests |
| Warm worker at boot | ready | `warm speech ready: 1 worker(s), 1 model load(s), warm=359ms` |

The full-suite baseline and post-change results are in
`M23.0-verification-report.md`.
