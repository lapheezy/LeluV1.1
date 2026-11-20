# M23.0 — Remote Verification

**Status: VERIFIED.**

Every hash below was read from the remote with `git ls-remote`, not inferred
from local state.

## Before the work

```
$ git ls-remote --heads origin | grep -E "m22\.[789]|integration/m16"
543da7c8d7876258869d928648cffa913cd10649  refs/heads/integration/m16-3-wp05-reconciliation
8fe502382fb9911629860bda08d90dcff0be7fdc  refs/heads/m22.7/live-voice-qualification
43db0a06c3c9c587aab9606e4cb328671548c805  refs/heads/m22.8/real-time-conversational-intelligence
b46b0aa33c6e8873e8f2f7f5ade05884d102e1d5  refs/heads/m22.9/persistent-voice-runtime
```

The M23.0 branch was created from `b46b0aa3` — the same commit the remote had —
so the branch starts from the candidate it claims to start from.

## After the work

```
$ git ls-remote --heads origin | grep -E "m22\.[789]|m23\.0|integration/m16"
543da7c8d7876258869d928648cffa913cd10649  refs/heads/integration/m16-3-wp05-reconciliation
8fe502382fb9911629860bda08d90dcff0be7fdc  refs/heads/m22.7/live-voice-qualification
4e9dd24c443fec37f8e649e05a743d81c80e6035  refs/heads/m22.7/universal-memory-erasure
43db0a06c3c9c587aab9606e4cb328671548c805  refs/heads/m22.8/real-time-conversational-intelligence
b46b0aa33c6e8873e8f2f7f5ade05884d102e1d5  refs/heads/m22.9/persistent-voice-runtime
42b1aed3173517b6d105a74e8d4de87918692d8d  refs/heads/m23.0/embodied-conversational-experience
```

| Reference | Before | After | Result |
|---|---|---|---|
| Canonical `integration/m16-3-wp05-reconciliation` | `543da7c8` | `543da7c8` | **untouched** |
| M22.7 | `8fe50238` | `8fe50238` | recoverable |
| M22.8 | `43db0a06` | `43db0a06` | recoverable |
| M22.9 | `b46b0aa3` | `b46b0aa3` | recoverable, unmodified |
| M23.0 | — | `42b1aed3` | **pushed** |

(`m22.7/universal-memory-erasure` is an unrelated pre-existing branch, listed
only because it matches the filter.)

## Commits on the M23.0 branch

```
$ git log --oneline b46b0aa3..HEAD
42b1aed3 Record the M23.0 embodied-experience evidence package
96c99b0e Account for every voice turn instead of letting silence go unrecorded
```

Two commits on top of the M22.9 baseline: the implementation (voice layer and
its tests) and the evidence package. No commit touches `plugins/persistentPiper.ts`,
`plugins/voiceApi.ts`, `server.ts`, `speechProfile.ts`, `speechDelivery.ts` or
`elevenLabsTts.ts`.

## Push

```
$ git push origin HEAD:m23.0/embodied-conversational-experience
 * [new branch]  HEAD -> m23.0/embodied-conversational-experience
```

A new branch, so no force, no rewrite, no divergence resolution was required.
Local HEAD and the remote branch head are the **same commit**
(`42b1aed3`), and the working tree was clean at that moment.

## What is not claimed

* This document's own commit is a third, evidence-only commit; the push receipt
  above covers `42b1aed3`, and the same command pushed the file you are reading.
* Nothing was merged into canonical and nothing was promoted. The pull-request
  URL the remote suggested was **not** opened.
