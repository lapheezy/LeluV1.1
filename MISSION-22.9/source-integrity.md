# SOURCE INTEGRITY

**Gate G1.** Verified before and after the work.

## Starting state

```
$ git rev-parse HEAD
43db0a06c3c9c587aab9606e4cb328671548c805
$ git branch --show-current
m22.8/real-time-conversational-intelligence
$ git status --porcelain
(empty — no modified, staged or untracked files)
```

The M22.8 candidate is `43db0a06`, whose parents are the verified chain:

```
43db0a06 Correct the evidence counts in the M22.8 record
dba5d793 Record the remote verification of the M22.8 voice candidate
90637fc9 Make her speech belong to the turn that asked for it
8fe50238 Record the remote verification of the M22.7 voice candidate
```

## Branch creation

```
$ git checkout -b m22.9/persistent-voice-runtime
Switched to a new branch 'm22.9/persistent-voice-runtime'
$ git rev-parse HEAD
43db0a06c3c9c587aab9606e4cb328671548c805
```

`m22.9` starts exactly at the M22.8 candidate — no cherry-pick, no rebase, no
squash — so every M22.8 commit stays reachable, and M22.7 stays recoverable at
`8fe50238`.

## Canonical

`543da7c8` was not checked out, not reset, not force-pushed and not merged
into. The M22.9 branch is an isolated branch; promotion requires explicit
authorization that this mission does not grant itself.

## Prior evidence

`MISSION-22.7/` and `MISSION-22.8/` were not edited. Their documents, logs,
screenshots and audio are byte-identical to the candidate commit: every new
document in this mission lives under `MISSION-22.9/`, and the M22.9 browser
harness is a *copy* of the M22.8 harness with its output directory changed,
not a modification of it.

## Constraint compliance

| Constraint | State |
| --- | --- |
| No paid API used | ✅ no provider call was made; every measurement is local Piper |
| No subscription / account / credit card | ✅ |
| No Anthropic | ✅ (the package is a pre-existing dependency; nothing was called) |
| No LangChain / LangGraph | ✅ not imported, not installed |
| No duplicate voice service | ✅ one `VoiceEngine`, one `plugins/persistentPiper.ts` worker pool, no new registry or store |
| Piper preserved as fallback | ✅ the cold `--output_raw` path is intact and tested (`LELU_PIPER_PERSISTENT=0`) |
| No secrets exposed | ✅ diagnostic opens no socket, reads no key; tests assert no key/text is echoed |
| No history rewrite | ✅ new branch, additive commits only |
