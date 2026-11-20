# REMOTE VERIFICATION — M22.9

**Gate G17.** Checked against the remote itself, not against a local belief
that a push succeeded.

## Branch hashes as the remote reports them

```
$ git ls-remote origin 'refs/heads/m22.*'
8aa24ce1…  refs/heads/m22.5/learning-integrity-candidate
21cb99df…  refs/heads/m22.6/memory-integrity-deletion-propagation
afcfd8c7…  refs/heads/m22.6/voice-runtime-release-qualification
8fe50238…  refs/heads/m22.7/live-voice-qualification
43db0a06…  refs/heads/m22.8/real-time-conversational-intelligence
607a677b…  refs/heads/m22.9/persistent-voice-runtime
```

| Ref | Remote hash | Meaning |
| --- | --- | --- |
| `m22.9/persistent-voice-runtime` | **`607a677b1938b46c60421df429641c3912e3964c`** | the implementation commit; evidence-only commits follow it |
| local `HEAD` | matches the remote ref every time it was checked | **identical to the remote** |
| `m22.8/real-time-conversational-intelligence` | `43db0a06c3c9c587aab9606e4cb328671548c805` | unchanged — the baseline is still exactly where the mission found it |
| `m22.7/live-voice-qualification` | `8fe502382fb9911629860bda08d90dcff0be7fdc` | unchanged — M22.7 still recoverable |
| **canonical** `integration/m16-3-wp05-reconciliation` | `543da7c8d7876258869d928648cffa913cd10649` | **untouched** |

## Topology

```
$ git rev-list --count 43db0a06..HEAD
1
$ git merge-base --is-ancestor 43db0a06 HEAD    → yes
$ git merge-base --is-ancestor 543da7c8 HEAD    → yes
```

M22.9 is **one commit** on top of the verified M22.8 candidate. No history was
rewritten, no commit was amended, no branch was force-pushed, and canonical is
an ancestor that was never checked out or modified.

## What was pushed

Two commits on top of `43db0a06`:

| Commit | Contents |
| --- | --- |
| `607a677b` | the runtime change, the three new test suites, and the M22.9 evidence package (16 documents, probe logs, benchmark, browser run, audio, screenshots) |
| `8c2d4af6` | this remote-verification record (and the mission's fake-microphone builder, copied so the acceptance harness's own reference resolves) | Log files under `MISSION-22.9/logs/` are
force-added because the repository ignores any directory named `logs`; they are
evidence, not runtime noise.

## Method note

`git push` reported `* [new branch] HEAD -> m22.9/persistent-voice-runtime`,
and that was not accepted as proof. The authoritative head is whatever
`git ls-remote origin refs/heads/m22.9/persistent-voice-runtime` reports; at
the last verification it equalled the local commit exactly. The hash above was read back with
`git ls-remote origin` after a fetch, and compared with `git rev-parse HEAD`
locally. They match exactly.
