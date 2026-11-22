# WP01 — Branch recovery and source-of-truth verification

Mission: M22.9 persistent voice runtime (recovery, completion, acceptance).
Executed 2026-11-22 in a fresh cloud container.

## Result

The exact remote branch was recovered with no substitute and no history change.

| Fact | Value |
| --- | --- |
| Repository | `github.com/lapheezy/LeluV1.1` (`gh api repos/lapheezy/LeluV1.1` → `full_name: lapheezy/LeluV1.1`) |
| Remote branch | `m22.9/persistent-voice-runtime` (unprotected) |
| Remote HEAD at recovery | `b46b0aa33c6e8873e8f2f7f5ade05884d102e1d5` — "Name the implementation commit instead of a moving branch head" (2026-11-20) |
| Local branch | `m22.9/persistent-voice-runtime`, tracking `origin/m22.9/persistent-voice-runtime` |
| Local HEAD at recovery | `b46b0aa3…` (identical to remote; ahead 0 / behind 0) |
| Canonical baseline | `543da7c8d7876258869d928648cffa913cd10649` — "Replace the 2.1 hair shell with scalp-rooted volumetric locks" |
| Baseline relation | `merge-base(543da7c8, branch) = 543da7c8`; branch is **14 ahead, 0 behind** the baseline |
| Working tree at recovery | clean (`git status --short` empty) |
| Files changed vs baseline | 150 files, +20 759 / −148 (35 source/test files, the rest evidence under `MISSION-22.5..22.9/`) |

## Commands run

```
git status --short                       # empty
git remote -v                            # origin https://github.com/lapheezy/LeluV1.1
git fetch origin --prune                 # did not finish within 120 s (see below)
gh api repos/lapheezy/LeluV1.1/branches?per_page=100   # branch listed
gh api repos/lapheezy/LeluV1.1/branches/m22.9/persistent-voice-runtime  # sha b46b0aa3…
gh api repos/lapheezy/LeluV1.1/compare/543da7c8...m22.9/persistent-voice-runtime  # ahead 14, behind 0
git fetch --no-tags --depth=200 origin \
  refs/heads/m22.9/persistent-voice-runtime:refs/remotes/origin/m22.9/persistent-voice-runtime
git checkout -b m22.9/persistent-voice-runtime --track origin/m22.9/persistent-voice-runtime
```

## Fetch issue — root cause

* **Mobile branch selector failure (reported):** not reproducible from here;
  the branch exists and is readable through the REST API and git. The name
  contains a `.` and a `/` (`m22.9/persistent-voice-runtime`); the repository
  has ~70 branches, so the branch is not on the first page of an unpaginated
  listing sorted by name. Those are the likely reasons a mobile picker did not
  show it. This is inference, not a reproduced defect.
* **In this container:** a full `git fetch origin --prune` over all ~70 branches
  (many carrying large binary evidence: audio, screenshots, models) did not
  finish within the 120 s tool window and was stopped. Fetching the **single
  exact ref** succeeded immediately. Nothing was wrong with the branch.
* The container started on an unrelated session branch
  (`claude/m22-9-voice-runtime-9bxdrd` @ `f2907161`, an M15.3 lineage, clean
  tree). Nothing there was modified or discarded.

## Commits unique to the branch (vs. 543da7c8), oldest first

```
e481c2c4 Carry provenance, keywords and corrections through LÉLU's one memory path
8aa24ce1 Record M22.5 learning-integrity audit and candidate verification
2bcc3c66 Repair the perception typecheck and close the M22.6 learning and ASR provenance gaps
3f24d798 Record M22.6 build, voice pipeline, learning-integrity and release evidence
afcfd8c7 Record the remote verification of the M22.6 candidate
e4ce1764 Speak through an opt-in local voice and record the live voice qualification
8fe50238 Record the remote verification of the M22.7 voice candidate
90637fc9 Make her speech belong to the turn that asked for it
dba5d793 Record the remote verification of the M22.8 voice candidate
43db0a06 Correct the evidence counts in the M22.8 record
607a677b Keep her voice loaded instead of reloading it for every sentence
8c2d4af6 Record the remote verification of the M22.9 voice candidate
b1450630 Point the M22.9 record at the branch head it actually verified
b46b0aa3 Name the implementation commit instead of a moving branch head
```

The branch already carried an **earlier M22.9** ("persistent Piper runtime":
one warm TTS worker per delivery profile) with its own reports in
`MISSION-22.9/` (`M22.9-REPORT.md`, etc.). Those files are preserved untouched;
this mission's documents are added beside them with the requested names
(`01-…` to `07-…`, `FINAL-REPORT.md`, `ACCEPTANCE-MATRIX.md`) and evidence under
`MISSION-22.9/persistent-runtime/`.

## Safeguards honoured

* No reset, rebase, amend or force-push. The canonical baseline is only read.
* Work is committed **on top of** `b46b0aa3`; pushes are fast-forward only.
