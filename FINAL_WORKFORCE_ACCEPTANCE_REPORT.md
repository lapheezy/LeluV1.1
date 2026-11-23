# FINAL WORKFORCE ACCEPTANCE REPORT — LÉLU V1.1 (WP07 / WP08)

* **Workforce branch:** `integration/lelu-four-workforce-consolidation` (fast-forwarded; also on `claude/lelu-v1-1-workforce-consolidation-bh0jrc`)
* **Baseline:** `096b46b81fa83b1397b4cd3535e874ecf7279246`
* **Tested code commit:** `3cbedff4d5b6ea685e96e9aac3aebf9f9f7fb0ab`
* **Final commit:** the commit that adds this report (evidence and documentation only on top of `3cbedff4`); its SHA and the remote verification are recorded in §9 by the commit after it, and in the session summary.
* No force-push, no history rewrite, no source branch deleted (all 71 remote heads still exist).

Companion reports: `UNIFIED_WORKFORCE_SOURCE_AUDIT.md`, `CLAUDE_FREEBUFF_INTEGRATION_LEDGER.md`,
`ARCHITECTURE_RECONCILIATION_REPORT.md`, `PERFORMANCE_ACCEPTANCE_REPORT.md`,
`FULL_SYSTEM_TEST_REPORT.md`, `CONTABO_DEPLOYMENT_READINESS.md`. Evidence:
`docs/acceptance/workforce-consolidation/`.

## 1. Facts — inventory

71 remote heads were audited after a full unshallow fetch. 280 non-merge
commits on 34 branches were not in the baseline; they formed 12 independent
lineages plus the old Jules/Codelazr and Mission 2.15 lines. After this work
**every one of the 71 heads is an ancestor of the workforce branch**
(`git merge-base --is-ancestor`, checked for each).

## 2. Completed work — merge history

| # | Merge | Source tip | What it brought | Conflicts |
|---|---|---|---|---|
| 1 | `ea3af4d0` | `543da7c8` group A (Freebuff/Codebuff) | Cosmos referent continuity + verification, perception, hair | 2 (CosmosObjectTools fused) |
| 2 | `9e6d1bf3` | `4e9dd24c` Freebuff memory M22.2–M22.7 | memory sovereignty, deletion propagation, tombstones | 4 (one memory path fused) |
| 3 | `eefe18c4` | `d2131ea7` M23.0 | speech-outcome ledger | 6 (cherry-pick originals) + 1 re-apply |
| 4 | `5bbc6299` | `13b826d4` ASRE core | ASRE/NRE/temporal | 1 |
| 5 | `dfe8a01f` | `ac381643` Mission 14 | continuity engine, outbox, email auth | 4 (unions) |
| 6 | `aa48d9eb` | `9c70cbe7` M16.3 WP04 | couture creative objects | 4 + routing fix |
| 7 | `c363c343` | `7795eb72` M17 COE | camera authority, projection integrity | 5 |
| 8 | `a19736ec` | `b291a885` Claude M15.3 | mobile/avatar/first paint | 5 |
| 9 | `607f87a5`, `d4462bc8` | `8db351e1`, `7d37d882` | self-study improvements | 1 |
| 10 | `d62303e8` | `38918ce2` character pipeline | ASRE service, character, foundry | 1 + build fix |
| 11 | `dd0020e3` | `7f265c2b` jolly-davinci | golden geometry, M25 wardrobe, self tools | 3 + 2 fixes |
| 12 | `95dd9011` | `6f0ebb69` Mission 2.15/5.2 | ancestry only (content present/superseded) | 1 |
| 13 | `1bba65d0` | `a0458dbc` Jules S02 | verify-script fixes; 4 hunks refused | 7 |
| 14 | `fd4b40c1`, `a136a2fb`, `03924d67`, `29ddd9fa` | Jules S03, Codelazr ×2, open-session-4210 | ancestry only | 6–11 each |
| 15 | `66849f1a` | `448770bd` M22.9 | ancestry only (cherry-picked earlier) | 2 |

Post-merge fixes on the combined tree: `3d6051b0` (build 379 s → 6 s; self-awareness
test), `4b87a535` (`/api/self` on server.ts; Creative Objects panel), `3cbedff4`
(entry chunk 2.8 MB → 515 kB; env template). Every resolution is explained in
its commit message and in the ledger.

## 3. Intentionally excluded

Only these hunks, each with a reason (ledger J1/J2): Jules' `MemoryEngine.supersede`
change (reverses a deliberate rule), `verify-development` loosening (weakens
acceptance), CI step-list replacement and deletion (baseline CI is newer), and a
`classifyProviderFailure` alias (re-adds a renamed name; unused). Superseded, not
lost: M15.3 `orbClearance` (M17.1 measured lift), jolly `leluFaceColour` (pipeline
`face.ts`), Mission 2.15 `GenesisModuleHost` (evolved version on baseline).

## 4. Test, build, performance, browser — results

| Area | Result |
|---|---|
| Typecheck / lint / build / bundle hygiene | pass / 0 errors / pass (6 s) / pass |
| Full suite | **3,208 tests: 3,195 pass, 3 fail, 10 skipped** — the 3 fail identically on their source branch `7f265c2b` (M25 wardrobe data drift); skips need Blender, CC0 library, OPA, gitleaks, LiveKit, VoxCPM |
| Production server | healthy in 116–454 ms; ≈50 MB RSS idle; access gate verified |
| Workflows (live UI) | A pass · B pass with reservation · C partial (artifact made; synthesis hit a free-provider timeout) · D pass · E components pass, spoken loop unverified · F pass (no-approval path) |
| Browser | desktop + iPhone-13 profile: load ≈0.5 s, FCP 0.11–0.14 s, chat reply 5.7–7.9 s, reload and server-restart persistence pass, offline/online pass, mic permission (fake device) pass, 0 page errors |
| Performance vs baseline | same load/FCP; 24 MB vs 41 MB transferred and ~170 vs ~370 MB heap at 8 s (lighter avatar model); two regressions introduced by the merges found and fixed |

## 5. Failures and open items (not hidden)

1. **Production Supabase is missing 3 migrations; one is a security revoke** — `anon` can execute `trim_lelu_events()` on project "Lelu". Not applied by me (production write). Procedure: `CONTABO_DEPLOYMENT_READINESS.md` §3.
2. 3 inherited wardrobe/foundry test failures (M25 round 3 data drift).
3. Workflow C synthesis blocked by OpenRouter's 12 s budget; Cerebras key rejected (401) in this environment.
4. Voice: no physical microphone/speaker/iPhone here; server TTS is off by policy (ElevenLabs unpaid).
5. No live Contabo deployment (no host access).
6. Repo grew to 5.1 GB tracked; backups of `leluverse/assets` ~2.1 GB each.
7. Background probes of `localhost` model servers on every page load (8 refused requests).
8. Work that might exist only in other agents' local workspaces or uncommitted patches cannot be seen from here and is not claimed.
9. GitHub's default branch is still `claude/open-session-rbwmdw` (M22.10 already noted it; needs a repository admin).

## 6. Definition of done — status

| Item | Status |
|---|---|
| Claude's unique work integrated | **Done** (ledger C1–C6) |
| Freebuff's unique work integrated | **Done** (ledger F1–F8) |
| All relevant historical work accounted for | **Done** — every remote head is an ancestor; refusals listed |
| Architecture reconciled | **Done**, with the debt listed in the architecture report |
| Workforce branch contains the complete integrated application | **Done** |
| No critical build failures | **Done** |
| Full tests pass, exceptions explained | **3 failures, explained (inherited)** — not a clean pass |
| Core workflows end-to-end | A, D, F pass; B with reservation; C partial |
| Chat and memory together | **Pass** |
| Agent execution and delegation together | **Pass with reservation** |
| Cosmos and spatial together | **Pass** (software GL) |
| Voice independently qualified | **Partial** — STT relay, mic permission, suite; no physical audio loop |
| Mobile and desktop acceptance | **Emulated pass**; real iPhone outstanding |
| Production build succeeds | **Done** |
| Contabo deployment configuration verified | **Done offline** |
| Live deployment verified | **Not done** — steps in readiness report §6 |
| Final commit SHA confirmed on the remote | see §9 |
| Evidence committed and traceable | **Done** |

## 7. Exact deployment commands

See `CONTABO_DEPLOYMENT_READINESS.md` §5 (install twice, `verify.sh`,
`lelu-update`, rollback by SHA, backup/restore) and §3 (migrations).

## 8. Reproduce the acceptance

```bash
bun install --frozen-lockfile && npx tsc -b && npx vite build && npm test
HOST=127.0.0.1 PORT=4173 NODE_ENV=production bun server.ts &
LELU_CHROMIUM=<chromium> node docs/acceptance/workforce-consolidation/browser-acceptance.mjs desktop   # and: mobile
LELU_CHROMIUM=<chromium> node docs/acceptance/workforce-consolidation/workflows.mjs
LELU_CHROMIUM=<chromium> node docs/acceptance/workforce-consolidation/cosmos-probe.mjs
LELU_CHROMIUM=<chromium> node docs/acceptance/workforce-consolidation/perf-probe.mjs final=http://127.0.0.1:4173/
```

## 9. Remote verification

Filled in by the follow-up commit after the push.
