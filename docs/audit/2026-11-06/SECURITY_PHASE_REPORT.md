# Security phase — containment and the isolated Supabase test environment

Branch `claude/master-integration`; starting HEAD `eb1f2da`. Environment: Linux cloud
container, Node 22 / Bun, headless Chromium; production server = `bun run server.ts` on the
built `dist/`, configured with the **test** Supabase project only.

## Supabase test project

| Item | Result | Evidence |
|---|---|---|
| Project | `lelu-v11-test`, ref `ugshflwlyakipeduifkd`, us-east-1, separate from production (`Lelu`, `nrehsldbfxthspikaxvr`) | — |
| Production touched? | **No writes.** Reads only: migration list, table list, two migration scripts | — |
| Migrations | `lelu_runtime`, `project_metadata`, `proactive_question_lifecycle` (recovered from production), `revoke_trim_lelu_events_execute` (new) | schema check below |
| `lelu_runtime` variant | Applied **without its two `drop … if exists` lines**: the Supabase confirmation prompt could not be answered from the owner's app, the owner directed Claude to apply it, and on an empty database those lines drop nothing. Repo file unchanged | — |
| Schema check | 13 tables, 13 with RLS, 13 owner policies (`USING` and `WITH CHECK` on `auth.uid()`), trigger present, `projects.metadata` and `proactive_questions.lifecycle` present | SQL in the session |
| Security advisor | Flagged `trim_lelu_events()` (SECURITY DEFINER) as callable by `anon`/`authenticated` via RPC → revoked; advisor now clean | — |
| Test identities | `lelu-test-admin@example.com` (app_metadata `lelu_role=admin`), `lelu-test-user@example.com` (`lelu_role=user`); seeded with bcrypt hashes (Supabase refuses `example.com` sign-ups); passwords only in git-ignored `.lelu-runtime/test-supabase.env` | — |
| Auth, RLS, persistence | **23/23** real requests: sign-in both, wrong password refused, role from app_metadata, expiry present, refresh, write → read → reload (session restored from storage) → read → new session → read; admin cannot read/insert-as/update/delete the user's row; user cannot reassign its row; anonymous reads nothing and cannot write; a user cannot make itself admin via user_metadata; a forged admin JWT is rejected by PostgREST and by Auth; sign-out revokes the refresh token | `evidence/security/supabase-auth-rls-persistence.txt` (`scripts/verify-supabase-test-project.mjs`) |
| Not verified | A token that has actually *expired* (1 h lifetime) — only forged/invalid tokens were exercised | — |

**Production finding (not changed):** production has the same `trim_lelu_events()` RPC
exposure. Fix = `supabase/migrations/202611060001_revoke_trim_lelu_events_execute.sql`,
to be applied by the owner.

## Security containment

| Requirement | Implementation | Test | Result |
|---|---|---|---|
| Integration API requires identity | `plugins/requestGuard.ts` (Supabase-verified identity, role from `app_metadata.lelu_role`, per-user and per-address rate windows) called first in `handleIntegrationRoute` for **every** route; scan + policy need admin; the shared token is now an extra factor, never sufficient; workspace path only for admins | `tests/security-containment.test.ts` (anonymous, invalid, expired, standard user, header-claimed role, admin, 4th scan → 429) + live production run | PASS |
| Browse relay SSRF | `plugins/safeFetch.ts`: resolve and check every address (IPv4/IPv6 incl. mapped, NAT64, 6to4, CGNAT, metadata, reserved), refuse a name with ANY internal answer, socket pinned to the checked address (rebinding), manual redirects ≤ 5 with each hop re-checked, loop detection, ports 80/443/8080/8443, no credentials in URLs, text content types only | 11 fixture tests (public page, redirects to localhost / 10.x / 169.254.169.254 / fd00:: / ::ffff:127.0.0.1, name → internal, mixed answers, one resolution per hop, loop, depth, protocols, ports, malformed) | PASS |
| Streaming 2 MB cap | Body counted while streaming; download stops at 2 MB (crossing chunk trimmed); compressed bodies capped on wire and decoded size; one deadline for DNS + connect + redirects + body | 20 MB body: reader stops, server wrote < 8 MB; 60 MB gzip bomb capped; slow page times out; broken gzip fails cleanly | PASS |
| Browse relay identity | signed-in user, 30/min | anonymous/invalid/expired → 401, user → 200, 31st → 429 | PASS |
| Knowledge relay | signed-in user, 60/min (it spends the server's provider keys); booleans-only `/providers` stays public | anonymous → 401 | PASS |
| Production routes | `server.ts` now mounts `createBrowseApi()` and `createAiProxyApi()`; the GitHub Models `/api/ai` relay (server token, was anonymous) now requires a user | static test + live run | PASS |
| Autonomy | One threshold, L5 "Production" (`src/core/cognition/AutonomyPolicy.ts`): server `SERVER_APPLY_LEVEL` imports it; the page uses the server's `applyLevel`, falling back to the same constant (no hard-coded `can(5)`); L4 refused for request-apply | `tests/server-autonomy.test.ts` (7) + live: server reports `applyLevel 5` | PASS |
| Client tokens | `src/core/persistence/sessionAuth.ts` adds the Supabase bearer to browse, knowledge-relay and integration calls | typecheck + live UI (Security Center shows the refusal when signed out) | PASS |
| env.example | `VITE_DEFAULT_PROVIDER=fireworks`, matching `Environment.ts`; provider policy unchanged | — | DONE |

### Live production-server run (`scripts/verify-production-security.mjs`, real test-project identities)

19/19 — `evidence/security/production-server-security.txt`. Screenshot of the production
build with the Security Center signed out:
`evidence/security/production-security-center-signed-out.png` (desktop 1440×900, headless
Chromium, footer `production · eb1f2da+dirty`): it shows *"No Supabase access token was
presented"*. Visible defect, unchanged by this phase: the chat panel covers application
panels (Phase 2 / §9.3).

## Quality gates

| Gate | Result |
|---|---|
| `tsc -b` | exit 0 |
| `vite build` | exit 0 |
| Bundle secret scan | ALL CHECKS PASSED; test-project ref appears in 0 bundle files |
| `npm test` (project runner) | **1363 tests: 1359 pass, 0 fail, 4 skipped** (OPA/gitleaks absent). A first run had 5 failures: relay mechanics tests whose harness presented no identity, and a real ordering bug (the POST body was read only after the identity check, so an eagerly emitted body was missed) — both fixed, then re-run clean |
| `oxlint` on changed files | exit 0 |
| Security suite | 16/16 |
| Live production server (final code) | 19/19 |
| Live Supabase auth/RLS/persistence (final code) | 23/23 |

## Remaining

- **Owner action:** apply `202611060001_revoke_trim_lelu_events_execute.sql` to production;
  set `app_metadata.lelu_role = "admin"` on your own production account (until then nobody is
  admin there, so scans and policy probing are refused — fail-closed by design); rotate the
  Geoapify / Guardian / NewsData keys; set `LELU_ACCESS_PASSWORD` on any public deployment
  (the server warns that every page is open without it).
- **Open finding:** the Vite dev/preview proxy for `/api/ai` still attaches the GitHub token
  without identity (configuration, not middleware). Only reachable on a running dev/preview
  server; recommended fix: remove the proxy's `Authorization` header or replace it with the
  guarded middleware.
- **Not verified:** real token expiry; OPA/gitleaks tests (binaries absent — 4 skips).
- **Next phase:** mobile Chat ownership (Phase 2).
