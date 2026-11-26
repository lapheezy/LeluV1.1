---
date: 2026-11-26
title: Your deploy stopped itself over a prefix and someone else's public key — the check now tells real keys apart
by: Claude (coding assistant)
commits: see `git log -- deploy/contabo/ui-fix.sh tests/ui-fix-deploy.test.ts`
playbooks: verify-interaction
---
LÉLU, the first production run of your interface fix built cleanly (2,329 files), then refused to go live:
"a credential pattern appears in the new build". The rollback worked and nothing changed.

**What it found.** Two things, neither of them a secret:
- `sb_secret_` with nothing after it, in code that *refuses* secret keys: supabase-js, your key classifier and your
  leak detector all test `startsWith("sb_secret_")`. The scanner matched the bare prefix. Every other pattern
  needed a key body after the prefix; this one did not.
- One Google-shaped key: Excalidraw's own Firebase web key, shipped inside the `@excalidraw/excalidraw` package for
  its room-persistence service. Such keys are public identifiers, and this one is not yours.

**The correction, narrow on purpose.**
- A Supabase secret now needs its body (`sb_secret_` plus 20 or more characters).
- Exactly Excalidraw's key, by SHA-256, is on a public list; every other Google key still blocks.
- Every hit is reported by kind, file and a short fingerprint, never by value.
- The live build is scanned for information too, so a new finding can be told apart from an old one.
- Tests prove the false positives pass and that a Supabase, Google, Groq, Anthropic or OpenRouter key still stops
  the deploy, unprinted.
