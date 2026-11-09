# ENV PROBE 2 — Anthropic and Supabase after env update

Diagnostic only. No application code was modified.
No secret value is recorded anywhere in this file — names, SET/MISSING, and
character counts only.

- Probe run (UTC): `Wed Sep  9 00:07:41 UTC 2026`
- `stat -c %y /home/user`: `2026-09-09 00:07:26.294377326 +0000`
  (the home directory was created ~15s before the probe, i.e. this is a fresh
  container — the environment was read as delivered, not as mutated by a
  previous session)
- Session type: `CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE=cloud_default`,
  `CLAUDE_CODE_ENTRYPOINT=remote`, `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1`

---

## STEP 1 — presence check

### Anthropic

| Name | Result |
| --- | --- |
| `ANTHROPIC_API_KEY` | **MISSING** |
| `VITE_ANTHROPIC_API_KEY` | **MISSING** |
| `CLAUDE_API_KEY` | **MISSING** |
| `ANTHROPIC_MODEL` | **MISSING** |
| `ANTHROPIC_BASE_URL` | SET (25 chars) — value is the non-secret default endpoint `https://api.anthropic.com` |

### Supabase

| Name | Result |
| --- | --- |
| `SUPABASE_URL` | **MISSING** |
| `VITE_SUPABASE_URL` | **MISSING** |
| `NEXT_PUBLIC_SUPABASE_URL` | **MISSING** |
| `SUPABASE_PUBLISHABLE_KEY` | **SET (46 chars)** |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | MISSING |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | MISSING |
| `SUPABASE_ANON_KEY` | MISSING |
| `UPABASE_PUBLISHABLE_KEY` (typo name, checked deliberately) | MISSING |
| `SUPABASE_SERVICE_ROLE_KEY` | MISSING |

### Other AI providers

| Name | Result |
| --- | --- |
| `GROQ_API_KEY` | SET (56 chars) |
| `OPENROUTER_API_KEY` | SET (73 chars) |
| `CEREBRAS_API_KEY` | SET (52 chars) |
| `FIREWORKS_API_KEY` | SET (25 chars) |

### Every other credential-shaped name present in the environment

(names only, no values, no lengths — listed to show what *does* arrive)

`GEOAPIFY_API_KEY`, `GITHUB_TOKEN`, `GOOGLE_NEWS_API_KEY`, `GUARDIAN_API_KEY`,
`INSTAGRAM_ACCESS_TOKEN`, `NEWSDATA_API_KEY`, `NEWS_API_KEY`, `YOUTUBE_API_KEY`

No `.env`, `.env.local`, `.env.development`, or `.env.production` file exists in
the repo, and no shell profile (`~/.bashrc`, `~/.profile`, `/etc/environment`)
sets any `ANTHROPIC*` or `SUPABASE*` variable. So the environment above is
exactly what the platform delivered.

---

## FINDING 1 — the Anthropic key is not reaching the container

Ten user-configured credentials arrive intact (Groq, OpenRouter, Cerebras,
Fireworks, Geoapify, GitHub, Google News, Guardian, Instagram, NewsData, News,
YouTube). Environment delivery itself is working.

Against that, the Anthropic result is a clean split:

- every **credential-named** Anthropic variable is absent —
  `ANTHROPIC_API_KEY`, `CLAUDE_API_KEY`, `VITE_ANTHROPIC_API_KEY`
- the one **non-credential** Anthropic variable survives —
  `ANTHROPIC_BASE_URL`, arriving with the default endpoint value

That split is the signature of the Claude Code runtime reserving its own auth
variables rather than of a mis-typed or mis-saved key. `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` are the variables the Claude
Code CLI itself reads to authenticate. A user-supplied `ANTHROPIC_API_KEY`
injected into a managed remote session would redirect the session's own
inference — and its billing — onto that key, so the credential-shaped names are
filtered out of the session environment before the container starts.
`CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1` in this session states that the host,
not the container, owns Claude authentication here.

Two consequences worth being explicit about:

1. **This is not evidence that the user's API key is invalid, unfunded, or
   mis-entered.** Nothing in this probe touched the key's validity. The key
   never became visible to the container, so it was never tested.
2. **Setting it again under the same name will not change the result**, in this
   or any future cloud session. If it was configured twice (e.g. once as
   `ANTHROPIC_API_KEY` and once as `CLAUDE_API_KEY`), both names are absent
   here, and re-saving either one is not a fix.

Verification of *where* the filtering happens (reading the parent process's
environment via `/proc`) was correctly blocked by the sandbox and was not
worked around. The cause above is therefore the best-supported explanation
from the observed evidence, not a directly confirmed mechanism.

### What actually unblocks it

- **Anthropic through the app, in a cloud session:** supply the key under a name
  the Claude Code CLI does not claim. The app's resolver
  (`src/core/Environment.ts`) walks `import.meta.env.VITE_<NAME>` → a
  `__LELU_<NAME>__` global → `process.env.VITE_<NAME>` → `process.env.<NAME>`,
  so the provider will read any name it is told to read — but
  `src/providers/AnthropicProvider.ts:74` currently asks only for
  `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY`, both reserved. Accepting one
  additional, non-reserved alias in that `resolveFirst` call is the smallest
  change that makes a cloud session able to use the key. **That is an
  application-code change and was deliberately NOT made here**, per the
  diagnostic-only scope of this probe.
- **Anthropic locally:** unaffected. A local `.env` / shell export of
  `ANTHROPIC_API_KEY` outside a managed remote session is not filtered.
- **Platform-side:** if the key must keep its canonical name in cloud sessions,
  that is an Anthropic platform limitation to raise with support, not something
  fixable from inside this repo.

---

## FINDING 2 — Supabase is one variable short

`SUPABASE_PUBLISHABLE_KEY` is present (46 chars) and **is** usable by the app:
`SupabasePersistence.ts:126-128` resolves `VITE_SUPABASE_PUBLISHABLE_KEY`, and
the resolver's last rung strips the `VITE_` prefix and accepts the bare
`SUPABASE_PUBLISHABLE_KEY`. The key name is fine as configured.

The URL is the blocker. `SUPABASE_URL`, `VITE_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_URL` are all absent, and
`SupabasePersistence.ts:129-133` sets `status = "disabled"` and returns when
either the URL or the key is empty. So Supabase persistence is off, and it is
off *only* for want of the project URL.

**Fix: set `SUPABASE_URL` (the `https://<project-ref>.supabase.co` value) in the
environment settings.** No code change is required — the bare name resolves. A
Supabase project URL is not a secret. This one is entirely in the user's hands
and needs no platform involvement.

---

## STEP 2 — live Anthropic proof: NOT RUN

The step is conditional on an Anthropic key being present. No Anthropic key is
present under any name the provider reads, so its precondition is not met.

`AnthropicProvider.generate()` rejects before any network call when the key is
empty (`src/providers/AnthropicProvider.ts:260`), and `isAvailable()` requires
`this.apiKey.length > 0` (line 227). A run would therefore have produced a local
"missing key" error, not an HTTP status — no 401/404/400 to distinguish, and no
information beyond what STEP 1 already establishes.

The `bun install` this step depends on was declined by the operator during the
probe, so no dependency install, live call, or latency measurement was
performed. **No Anthropic latency or response text exists in this report because
none was measured.**

---

## STEP 3 — full chain: NOT RUN

`scripts/verify-providers.ts` and the `RegisterAIProviders` chain check both
require installed dependencies, and `bun install` was declined (see above). No
pass/fail total and no `CHAIN:` line were produced, and none are invented here.

What can be stated without running them, from the environment alone:
Anthropic holds fallback priority 7 (`Environment.ts:228`) and requires a key
(`requiresApiKey`, `AnthropicProvider.ts:227`). With no key resolvable, it
cannot report available, so **Anthropic did not join the fallback chain.** Groq
(p1), OpenRouter (p2), Cerebras (p3) and Fireworks (p5) all have keys present
and are the providers actually carrying the chain.

---

## Summary

| Question | Answer |
| --- | --- |
| Did Anthropic answer? | **No — and it was never asked.** No Anthropic key reached the container, so no request was made. |
| Is `SUPABASE_URL` set? | **No — MISSING.** This is the sole reason Supabase persistence is disabled. |
| Is `SUPABASE_PUBLISHABLE_KEY` set? | **Yes — SET (46 chars)**, under a name the app resolves correctly. |
| Is the user's Anthropic API key faulty? | **Unknown, and not implicated.** It was never visible to the container and never tested. |
