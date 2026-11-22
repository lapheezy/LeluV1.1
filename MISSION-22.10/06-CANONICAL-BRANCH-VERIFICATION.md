# M22.10 WP06 — Canonical branch promotion and remote verification

## Before the push (checked)

* Remote `integration/lelu-four-workforce-consolidation` = `b74b378e`, re-fetched
  immediately before pushing; unprotected; push access, **no admin**.
* `b74b378e` is an ancestor of the local head: the push is a **fast-forward**.
  No force, no rebase of shared history.
* 18 commits on top of canonical: 15 voice-line cherry-picks, 2 integration
  fixes, 1 test-assertion follow-up, plus this evidence commit.
* No unrelated work lost: relative to `b74b378e`, outside `MISSION-22.*`, the
  integrated tree **adds 20 files and modifies 22. It deletes none.** All 55
  canonical-only commits remain in history.
* The canonical branch contains the completed M22.9 runtime: the voice line's
  files are byte-identical to `448770bd`, except the 3 documented resolutions
  (`01-…INTEGRATION-MAP.md`). `VoiceEngine.ts`, `elevenLabsTts.ts`, `useVoice.ts`,
  `voiceApi.ts`, `persistentPiper.ts` and `tests/voice-persistent-session.test.ts`
  are identical.
* Provenance: each integrated voice commit carries
  `(cherry picked from commit <M22.9 sha>)`. Because the history is
  cherry-picked, `448770bd` itself is **not an ancestor** of canonical; its
  content is. This was chosen so as not to pull in the non-voice group A
  (WP01).

## After the push

The final commit hash is the head of the remote branch after this commit. It
is reported in the mission summary and is readable with:

```
git ls-remote origin refs/heads/integration/lelu-four-workforce-consolidation
```

An evidence commit cannot contain its own hash.

## Source branch

`m22.9/persistent-voice-runtime` is untouched at `448770bd` and **not deleted**.
Group A (Cosmos reconciliation, perception, avatar hair) remains only there.

## GitHub default branch

* Current default: **`claude/open-session-rbwmdw`**. It does **not** point to
  the canonical branch.
* This session's GitHub access has `push` but not `admin`, so the default
  cannot be changed from here. Changing it is also a repository-wide setting
  that affects every clone and PR base, so it was not attempted.
* **Remaining step (repository owner):** GitHub → lapheezy/LeluV1.1 →
  Settings → General → Default branch → switch to
  `integration/lelu-four-workforce-consolidation`. With admin CLI access, the
  equivalent is
  `gh api -X PATCH repos/lapheezy/LeluV1.1 -f default_branch=integration/lelu-four-workforce-consolidation`.

## Not done (by instruction)

No deployment, no production credential change, no force-push, no branch
deletion, no Supabase change.
