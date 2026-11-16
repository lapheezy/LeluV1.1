# Security threat model

Scope: the 16 integrations and the capability gateway in front of them. LÉLU
already had `PromptInjectionGuard`, `PersonalityGuard`, an autonomy gate, an
approval gate and a server-side model broker; this document covers what the new
surface adds and what remains.

## Assets

| Asset | Why it matters |
|---|---|
| Provider API keys | spend, and account takeover if leaked |
| Supabase session / service role | full data access |
| User files and repositories | confidential, irreversible if destroyed |
| Device sessions | camera/microphone/files on a person's phone |
| Execution credentials (engineering runtime token) | arbitrary command execution |
| Conversation content | private |
| Audit trail | proves what LÉLU did |

## Threats and controls

| # | Threat | Control actually implemented | Status |
|---|---|---|---|
| T1 | An agent calls a capability the user never authorised | identity + policy + autonomy floor at `AdapterRegistry` | **tested** |
| T2 | An agent raises its own authority | `deny_self_elevation` checked first, in both engines | **tested** |
| T3 | Cross-user data access | `deny_cross_user` on owned resources; owners keyed by existing Supabase id | **tested** |
| T4 | Prompt-injected arguments execute something else | every argument validated against the capability schema; unknown arguments refused | **tested** |
| T5 | A credential travels through a tool call into a log | `sanitizeArguments`; trace redaction by key and value shape | **tested** |
| T6 | Scanner findings leak the secret they found | findings carry rule + location, never `Match`/`Secret` | **tested** (real gitleaks run) |
| T7 | A scan "passes" because the scanner is missing | `ran:false` ⇒ `gatePassed:false`; summary says "did not run" | **tested** |
| T8 | Policy engine unavailable ⇒ everything allowed | missing binary/bundle/eval error ⇒ **deny** with `policy_unavailable` | **tested** |
| T9 | Two engines edit one workspace | workspace lock in `EngineeringOrchestrator` | **tested** |
| T10 | An unverified change is reported as done | `verify()` requires changed files inside allowed paths + a real test run with 0 failures | **tested** |
| T11 | Device used by an unauthorised session | `RelationshipStore.sessionMay`, expiry + revocation | **tested** |
| T12 | Scan endpoint used to read arbitrary files | target resolved inside the workspace; escape refused | code path; **not** unit-tested |
| T13 | CSRF against the integration API | same-origin check on POST; optional `LELU_ENGINEER_TOKEN` | code path; **not** unit-tested |
| T14 | Secrets in the served bundle | existing controls (`verify-bundle-secrets`, relay for Meshy); unchanged | pre-existing |
| T15 | Supply-chain compromise of an integration | licences verified; no new runtime dependency was added | partial |

## Deliberate design decisions

- **Policy fails closed.** A missing OPA binary, an empty decision document, or an
  eval error all produce a refusal labelled `engine: "reference"`, never an allow.
- **No secret is ever copied.** Infisical is not configured and nothing was
  migrated; no credential is written into a new store by this work.
- **Telemetry records actions, not conversations.** Prompt text is not traced.
- **Device grants are not model-reachable.** No tool exposes `grantDeviceSession`;
  only code the user drives can create one.

## Residual risk (accepted, documented)

| Risk | Impact | Mitigation | Owner action |
|---|---|---|---|
| In-process tuples not shared across instances | a revoked relationship could still be enforced from another instance's memory until restart | single-instance deployment today; OpenFGA adapter ready | configure `OPENFGA_API_URL` before horizontal scaling |
| `.env.local` holds a live provider key on disk | local compromise exposes spend | file is untracked and gitignored; never in history | move to Infisical/secret store when authorised |
| 74 Gitleaks findings triaged as fixtures/by-design | real exposure hidden among noise | triage table in `acceptance-report.md` | prune the canary strings in `scripts/verify-bundle-secrets.ts` from scan scope |
| No static analysis (Semgrep) | injection patterns uncaught | adapter + gate ready | install semgrep |
| No vulnerability DB (Trivy) | dependency CVEs unseen | adapter + gate ready | allow DB download |

## Not tested here (stated plainly)

- No penetration test was performed.
- No live provider credential existed, so "no key leakage during a real call" is
  argued from the code path and the broker tests, not observed live.
- The integration API's origin guard and token gate have no dedicated test yet
  (they mirror `engineerApi`, which does).
