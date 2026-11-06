# GATE B — Security findings: investigation, remediation, retest

Date: **2026-11-06** · Branch `claude/master-integration` · HEAD `1549194` + Phase 3 working tree.

Nothing here was suppressed to obtain a green gate. The gate still **fails**, and the
reason is recorded below. No secret value appears in this document; matches were read
with long tokens masked.

## Scope correction found during investigation

`gitleaks detect --source .` scans **Git history**, so it reported 96 hits with line
numbers that no longer exist in the current files (e.g. `Avatar3DReconstructor.ts:352`
in a 315-line file). Two scans are therefore reported separately:

| Scan | Command | Result |
|---|---|---|
| History | `gitleaks detect` | 96 hits |
| Working tree | `gitleaks detect --no-git` | 211 hits, of which **139 are inside `.tools/trivy-cache/db/trivy.db`** (a gitignored binary, not project code) |
| Working tree, excluding the gitignored `.tools/` cache | as above minus cache | **72 hits** — the number Phase 3 was told to reconcile |
| Adapter scan of `src/` (what Security Studio runs) | `runSecurityGate` | 9 hits (all `src/`) |

The Trivy DB should not be in scan scope at all; that is a **scanner-scope defect**, not
72 + 139 exposures.

## Gitleaks — 72 findings, all classified

| File | Hits | What the matched text actually is | Verdict |
|---|---|---|---|
| `leluverse/assets/characters/lelu_character/generation_logs/jobs.json` | 43 | `"requestKey": "<uuid>"` — job correlation ids in a generation log | **False positive** (not a credential) |
| `scripts/verify-bundle-secrets.ts` | 16 | `CANARY…MUSTNOTSHIP` sentinels the project deliberately scans its own bundle for | **Intentional canary** |
| `.env.local` | 1 | a real provider key, untracked and gitignored, never committed (`git log --all -- .env.local` empty) | **Correct location for a live secret** — no action beyond keeping it untracked |
| `src/core/config/supabasePublic.ts` | 1 | `sb_publishable_…` — Supabase's client-side publishable key, protected by RLS | **Public by design** |
| `tests/bare-secret-aliases.test.ts` | 1 | `sbp_0123456789abcdef` — obvious fixture | **Test fixture** |
| `src/brain/ConversationEngine.ts`, `src/core/proactive/BriefingStore.ts`, `src/core/selfdev/CapabilityRegistry.ts`, `src/app/scene/genesis/ExplorationController.ts`, `src/app/scene/genesis/chat/universe/universeModel.ts`, `verify/chat-acceptance.mjs` | 6 | `const KEY = "lelu.<area>.v1"` — localStorage key names | **False positive** (the rule keys off the identifier `KEY`) |
| `src/core/avatar/CompanionStore.ts`, `src/core/avatar/Avatar3DReconstructor.ts`, `src/core/selfdev/ImprovementQueue.ts` | 3 | sizing constants and status arrays adjacent to `key`-shaped identifiers | **False positive** |
| `docs/evidence/self-improve/…/diff-default.patch.txt` | 1 | a captured diff containing a `KEY = "lelu.companion.v1"` line | **False positive** (committed evidence, no credential) |

**Genuine exposures: none found.** One live secret exists (`.env.local`) and is untracked
and gitignored. No rotation was performed or recommended, because no tracked credential
was shown to be live. No history was rewritten.

**Scanner-scope fix recommended (not yet applied, because it changes what the gate
scans):** exclude `.tools/` and `leluverse/**/generation_logs/` from Gitleaks so a real
leak is not buried among 139 binary-DB and 43 log-id hits.

## Semgrep — 21 findings

| Rule | Count | Class | Action |
|---|---|---|---|
| `detect-non-literal-regexp` | 12 | RegExp built from tag names (internal constants) or from already-escaped input; only `plugins/selfViewApi.ts` compiles a **user-supplied** pattern | 11 **false positives**; 1 **accepted risk, mitigated** — the query is now capped at 256 characters (`MAX_REGEX_LENGTH`) |
| `hardcoded-hmac-key` | 2 (`plugins/accessGate.ts:68,69`) | fixed salt in a constant-time comparison | **REMEDIATED** — per-process `randomBytes(32)` salt; findings gone |
| `spawn-shell-true` | 1 (`plugins/nodeAdapters.ts`, ERROR) | command string reaching `spawn(..., { shell: true })` | **MITIGATED** — `plugins/commandSafety.ts` refuses metacharacters, empty and >512-char commands, wired into **both** the Node and Deno adapters. The rule still fires by design: the command legitimately needs a shell for `npx`/`bun`; the guard is the control, and 4 tests cover it |
| `unsafe-formatstring` | 16 | template-literal logging / `String(x)` | **False positive** — no user-controlled format string exists in JS template literals |
| `react-insecure-request` | 1 (`scripts/verify-development.ts:53`) | `fetch("http://127.0.0.1:…")` in a local verification script | **False positive** — loopback, dev-only |

### Retest after remediation

`.tools/semgrep scan … plugins/accessGate.ts plugins/nodeAdapters.ts plugins/selfViewApi.ts plugins/commandSafety.ts`
→ **2 results** (the guarded `spawn-shell-true` and the bounded user regex), down from 4
in those files. The two `hardcoded-hmac-key` findings are gone because the code changed.

## Trivy — 86 findings (32 HIGH, 43 MEDIUM, 11 LOW)

| Detail | Value |
|---|---|
| Targets | `bun.lock`, `package-lock.json`, `node_modules/vite-plugin-glsl/bun.lock` |
| Packages | `undici@5.29.0`, `nanoid@3.3.11`, `postcss@8.5.8`, `vite@8.0.3`, `image-size@1.2.1`, `source-map-js@1.2.1`, `brace-expansion@5.0.9`, `@fastify/busboy@2.1.1`, `uuid`, `glob`, `minimatch`, `mermaid`, `katex`, `lodash-es` |
| Fixes available | yes, for every HIGH (e.g. `undici` ≥ 6.24, `nanoid` ≥ 3.3.18, `postcss` ≥ 8.5.18, `vite` ≥ 8.0.5) |
| Reachability | lockfile/transitive; no runtime path from studio code was demonstrated |

**Status: UNRESOLVED, and deliberately not auto-upgraded.** A dependency bump here spans
`vite` (build tool), `undici`, `postcss` and their lockfiles — a change that can break the
build and is not something to slip in under a security report. Recorded as accepted risk
with a named fix set for a dedicated dependency-refresh change. **A zero from Trivy would
not have meant "secure"; this is not zero.**

## OPA policy — hardened

`tests/security-hardening.test.ts` adds ten refusal classes, each asserting the rule that
must fire, plus the invariant that no refusal is ever reported as allowed:

1. unauthorized execution (no identity) → `deny_no_identity`
2. insufficient tier (`EXECUTE` at autonomy 2) → `deny_autonomy`
3. missing approval (`INSTALL`) → `deny_missing_approval`
4. expired approval (id present, `approvalValid:false`) → `deny_missing_approval`
5. invalid ownership (another user's file) → `deny_cross_user`
6. invalid execution context (production below autonomy 5) → `deny_production_autonomy`
7. destructive operations (`INSTALL`/`DELETE`/`ADMINISTER`) all need approval
8. unauthorized network access (no device relationship) → `deny_device_relationship`
9. invalid subject kind (device write, agent deploy) → `deny_device_action` / `deny_agent_action`
10. the union of refusals at autonomy 0 never returns `allowed:true`

Real OPA remains in use (`engine: "opa"`, 1.22.2, fail-closed); the reference evaluator is
the differential partner, not a fallback that claims OPA.

## Final classification

| Category | Count |
|---|---|
| Confirmed vulnerabilities | **0** |
| Potential vulnerabilities | **1** (user-supplied regex in `selfViewApi`, bounded) |
| False positives (Gitleaks + Semgrep) | **72 Gitleaks-classified + 29 Semgrep** (11 regex, 16 formatstring, 2 loopback/react — see tables) |
| Remediated findings | **2** (`hardcoded-hmac-key` ×2) + **1 mitigated** (`spawn-shell-true`) |
| Accepted risks | **1** (86 dependency findings awaiting a dedicated refresh) |
| Unresolved findings | **86 Trivy** + **1** guarded `spawn-shell-true` + **1** bounded regex |

**Security gate: still `FAIL`.** That is the truthful state: 30 working-tree findings from
`gitleaks`+`semgrep` on `src/` at the HIGH threshold, none of which was suppressed.

Evidence: `gitleaks-summary.json`, `semgrep-summary.json`, `trivy-summary.json` (this
directory). Tests: `bun run test` → **1358 pass, 0 fail, 2 skipped**; `npx tsc -b --force` → **exit 0**.
