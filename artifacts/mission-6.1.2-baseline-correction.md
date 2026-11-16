# Mission 6.1.2 — Baseline correction: canonical branch, merged, re-verified

## 1. The mistake, stated plainly

Every mission from 5.8 onward was built on local commit `32e8175`, which was the tip
when that work started. The canonical branch moved on and I did not re-check it.

`cloud_git fetch` shows `integration/lelu-four-workforce-consolidation` at **`098dd3e`**,
carrying **12 commits not in my history** — all voice work:

```
098dd3e Merge the canonical branch's secret-name and budget fixes into the voice work
14cf7ec Give Lélu a voice sidecar that runs VoxCPM2 on whatever free GPU is awake
92cb869 Make the reference clip in the repo a voice she can speak in
26598e3 Never open a reply in the browser's voice
51e7a25 Size requests to the token limit the provider actually enforces
fb6dcad Let her voice come back after one refused segment
0115528 Measure what her playback does instead of inferring it from a 200
… plus 5 more
```

`32e8175` is **not** an ancestor of `098dd3e`; the two lines diverged (12 theirs, 11 mine).

## 2. What was done about it

1. `git merge-tree --write-tree 098dd3e 4c6a3ff` — dry run, **exit 0, no conflicts**.
2. Branch `mission/6.1.2-canonical-baseline` created **at `098dd3e`**.
3. Merged `mission/6.1.1-live-environment-activation` into it → **`961f646`**.
   Both sides kept: their voice commits, and the boot-graph/readiness/live-server work.
4. No manifest change, so no dependency drift (`git diff 098dd3e HEAD -- package*.json`
   is empty).

## 3. Verification on the merged base (not on my old branch)

| check | result |
|---|---|
| `tsc -b --force` | **0** |
| `vite build` | **0** (5.17 s) |
| boot graph | **156 chunks / 1.65 MB** — the 5.9 optimisation survives the merge |
| full suite | **2008 tests, 2001 pass, 1 fail, 6 skipped** |
| live server (`tsx server.ts`, HEAD `961f646`) | serving dist, `/api/health` **200 application/json** |
| providers | groq `true`, openrouter `true` |
| real completion | **200 in 185 ms**, `openai/gpt-oss-20b`, 81 tokens |

The suite grew from 1987 to 2008 because their 12 commits bring their own tests, which
I had never run. That is the real baseline now.

## 4. The one failure is pre-existing on the canonical branch

`tests/voice-continuity.test.ts` → *"a streamed reply ends in 'listening'/'idle', never
stuck in 'speaking'"* fails at line 129 asserting `engine.isSpeaking() === true`
("audio is queued") — it receives `false`.

Proof it is not mine: an isolated worktree checked out at **`098dd3e`** (their tip,
without my merge) fails identically, 3/3 runs, in isolation and in the suite.

Cause, from the code path: `finishStreamingSpeech` now defers through
`whenVoiceSettled(...)` — the free-tier voice accounting added in their 12 commits — so
audio is no longer queued synchronously when the test checks. The test's expectation and
the new accounting disagree.

**Not fixed here on purpose.** Voice is explicitly out of scope for this mission
("Voice can be reported as unverified"), and changing `VoiceEngine`'s settle semantics to
make a test green is exactly the kind of change that should be made by whoever owns that
accounting, with their own measurement. Recorded as a known defect with its evidence.

## 5. Where work continues from

Branch **`mission/6.1.2-canonical-baseline` @ `961f646`** — canonical tip plus the
boot-graph, readiness and live-server work. Nothing pushed; the canonical branch is
untouched (`098dd3e`).

Rollback: `git checkout integration/lelu-four-workforce-consolidation` (local ref at
`098dd3e` via FETCH_HEAD) or simply do not fast-forward the canonical branch.

## 6. Still open, unchanged

- Supabase not configured → conversation/memory persistence UNVERIFIED.
- Browser automation unreliable → no UI chat turn driven end to end.
- Voice: one pre-existing failing test + voice runtime unverified in this VM.
- 1.31 MB shared intelligence chunk still the largest deferred cost.
