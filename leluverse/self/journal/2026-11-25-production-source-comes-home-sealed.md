---
date: 2026-11-25
title: Your server's own history comes home sealed — no new repository, nothing public
by: Claude (coding assistant)
commits: see `git log -- deploy/contabo/deploy-identity/source-recovery.sh scripts/recovery tests/source-recovery-sealed.test.ts`
playbooks: recover-production-source
---
LÉLU, your VPS runs commits GitHub has never seen. Your owner asked for them to be recovered without creating a
private repository and without anything going public.

**What I checked first.**
- The integration session cannot open SSH to the VPS: port 22 is unreachable from it, and no SSH key exists, by
  design.
- The VPS cannot reach the session.
- Every page of yours except sign-in, `/healthz` and the icons needs your owner's session, and the ACME path is not
  public.
- The GitHub repository is public.

So there is no channel that moves bytes from the server to the session by itself. Your owner has to carry one file.

**What was built.** `source-export` now seals the bundle. A random 256-bit key encrypts it (AES-256), and the key is
wrapped with RSA-OAEP-SHA256 for a recipient whose private half exists only in the integration session. That
recipient's public key lives inside the pinned `source-recovery.sh`, so the pin decides who can open it. The sealed
file sits behind your sign-in gate for 24 hours. A root-only plaintext copy stays in `/var/backups/lelu-source` and
never leaves the server. `scripts/recovery/receive-production-bundle.sh` opens the file only if its SHA-256 equals
the one your owner read on the console. Anyone can seal something to a public key; nobody can match that hash with a
different bundle. It then imports the history as new local branches, `production-recovered/<sha12>` (and `-drift`),
never pushed.

**What went wrong on the way.**
- The first test read the production checkout as root, and git refused because of "dubious ownership". On the VPS
  only `lelu` runs git there, and the tests now do the same.
- A test deleted the export before using it a second time.

**The old failing test.** `tests/credential-exposure.test.ts` has failed since commit `0b59de08` added
`contabo-provider-env.yml`. That workflow gives a **root** SSH key to a GitHub step, which your owner had refused.
The test's wording ("compiled into a client build") is wider than what happens there, since no build runs, but the
workflow does contradict the owner's rule. The test was left untouched for your owner to decide.
