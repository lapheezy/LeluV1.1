# M22.8 — REMOTE VERIFICATION

**Date:** 2026-11-20
**Command:** `git ls-remote origin integration/m16-3-wp05-reconciliation m22.7/live-voice-qualification m22.8/real-time-conversational-intelligence`

```
543da7c8d7876258869d928648cffa913cd10649	refs/heads/integration/m16-3-wp05-reconciliation
8fe502382fb9911629860bda08d90dcff0be7fdc	refs/heads/m22.7/live-voice-qualification
90637fc9c67355bd63ed0fd10314ef5f918bbe8f	refs/heads/m22.8/real-time-conversational-intelligence
```

| Ref | Remote SHA | Meaning |
|---|---|---|
| canonical `integration/m16-3-wp05-reconciliation` | `543da7c8…` | **unchanged** — the same commit M22.6 and M22.7 recorded |
| M22.7 candidate `m22.7/live-voice-qualification` | `8fe50238…` | preserved; M22.8 branched from exactly this |
| M22.8 candidate `m22.8/real-time-conversational-intelligence` | `90637fc9…` | implementation, tests and the evidence package |

Local HEAD at verification time: `90637fc9c67355bd63ed0fd10314ef5f918bbe8f` — identical to the remote ref, so the push was a straight new-branch push with no divergence and no force.

## What this commit contains

Source: `src/core/voice/VoiceEngine.ts`, `src/core/voice/elevenLabsTts.ts`,
`src/core/voice/spokenText.ts` (new), `plugins/voiceApi.ts`,
`src/app/scene/genesis/GenesisChat.tsx`, `src/app/scene/genesis/VoiceBridge.tsx`.

Tests: six new files (24 tests) — `voice-spoken-text`, `voice-tts-pipeline`,
`voice-turn-ownership`, `voice-runtime-diagnostic`, `voice-local-tts-stream`,
`voice-pcm-playback`.

Evidence: fifteen documents (the thirteen the mission requires, plus
`MISSION-22.8-REPORT.md` and this file), five run logs, four screenshots, two
audio samples and two scripts under `MISSION-22.8/`.

Nothing in `MISSION-22.7/` was modified. The commit that adds this file changes
no source, test or evidence; it only records the remote check, so the branch
HEAD after it is one commit ahead of `90637fc9` and can be re-verified with the
same command.

## Not done, on purpose

* no merge into `integration/m16-3-wp05-reconciliation`;
* no pull request opened;
* no force-push, reset or history rewrite;
* no tag.
