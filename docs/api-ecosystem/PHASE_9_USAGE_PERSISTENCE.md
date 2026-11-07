# Phase 9: Persistent Usage and AI Budget Enforcement

**Status:** PASS. All acceptance checks pass, and the limitations listed below are stated plainly.
**Branch:** `claude/gallant-ritchie-v7i0fn`. Started at `f6c182f`. `847f029` is preserved in the history.
**Commits:** `d256337` (first migration draft) → `847f029` (gate, sync, UI) → `34bdf8d` (schema applied, all paths gated) → `7d1f9d3` (pre-hydration and unreachable-account rules) → `251be20` (send-time attribution) → this report.

## 1. Migration and schema

File: `supabase/migrations/202611070001_usage_records_and_budgets.sql`. It was applied as migration `usage_records_budgets_reservations` to **lelu-v11-test** (`ugshflwlyakipeduifkd`) first. Production **Lelu** (`nrehsldbfxthspikaxvr`) got it only after the test project passed every check below.

| Object | Purpose | Access (RLS, `authenticated` only) |
|---|---|---|
| `usage_records` | One row per AI or knowledge-source call. Tokens are `NULL` when the provider didn't report them. `cost_usd` is set only when `cost_kind='reported'` (a CHECK constraint enforces this). | select and insert own rows only. **No update or delete policy**, so spent budget can't be "refunded". |
| `usage_budgets` | Per-user caps: requests, tokens and reported $ per day or month. Applies to one provider or source, or `*` for all of them. | owner: all |
| `usage_reservations` | In-flight calls. `created_at = clock_timestamp()`, expiring after 10 minutes. | owner: select, insert, delete |
| `usage_daily`, `usage_monthly` | Aggregation views, `security_invoker = true`, so the caller's RLS applies. | select |

**How the approval prompt was resolved.** The first design used `SECURITY DEFINER` functions, plus `revoke` and `drop` statements. The Supabase connector treats statements like those as destructive and requires an interactive approval that never reached you; it timed out 4 times. The applied design has **no destructive statements and no functions**:
- Reservations are plain owner rows.
- Admission is **insert-then-rank**: insert the reservation, then read live reservations, then read usage.
- A call proceeds only if `used + reservations ranked earlier by the database clock + 1 ≤ cap`.
- Reading reservations before records means a call that settles in between gets counted twice (safe), never zero times.
- Two devices can never both take the last unit; the worst case is that both refuse.

I didn't bypass any authorization. The one earlier no-op entry named `usage_records_and_budgets` (a comment only) remains in the test project's migration history.

## 2. RLS and access verification

Live, with two real users created on the **test project only**. The users are `phase9-user-a@lelu.test` and `phase9-user-b@lelu.test`; their passwords are random and kept outside the repo. Script: `scripts/verify-usage-supabase.ts`. Result: **27 passed, 0 failed**, in [evidence/phase9/supabase-verification-test.json](evidence/phase9/supabase-verification-test.json).

| Check | Result |
|---|---|
| B reads A's record | 0 rows |
| B inserts a record as A | refused: *new row violates row-level security policy* |
| A updates or deletes its own record | 0 rows affected; value unchanged (append-only) |
| Anonymous read or insert | 0 rows / refused |
| B reads A's budgets; B deletes or forges A's reservations | 0 rows; 0 affected; refused |
| `usage_daily` as B | none of A's rows |

**Production** (no accounts created there): schema parity was confirmed by read-only SQL. RLS is on for all 3 tables, all 6 policies are present, and both views are `security_invoker`. Anonymous reads of all 5 objects return 0 rows, and anonymous inserts into `usage_records` and `usage_budgets` are refused ([production-anon-checks.json](evidence/phase9/production-anon-checks.json)). Supabase's security advisor raised **nothing about the new objects** on either project.

## 3. Budget enforcement

Every billed model path goes through one function, `gatedGenerate` in `UsageBudgetGate.ts`:
- chat turns, one reservation per tool-loop round (`ProviderResolver`);
- provider health probes (`ProviderHealth`, new state `skipped_budget`);
- source reading (`ingestSource`).

A test fails if any code calls `provider.generate(` outside the gate. On-device inference is exempt because it's free.

| Requirement | How | Evidence |
|---|---|---|
| Per-user, per-provider request and token caps | `usage_budgets`, the device ledger, and the account check | tests; live |
| Daily and monthly spending caps | Count **reported** cost only. A provider with no reported cost can't be held to a $ cap; the UI says so and suggests a request or token cap. | `evaluateAccountBudgets` tests |
| Reserve before dispatch, safe under concurrency | Device: reservation taken synchronously. Account: insert-then-rank. | **Live: 10 simultaneous calls from 2 devices, cap 4 → exactly 4 admitted**, 6 refused, refused reservations withdrawn |
| Reconcile with actual usage | Settle writes the provider-reported record under the reservation id, then deletes the reservation | live: 4 records, 0 reservations left |
| Failures and release | A failed call is settled as a failed request. A call stopped before sending is released. | live |
| Never estimate | Unreported tokens and cost are `NULL` / `unknown` | live: `input_tokens: null, cost_kind: unknown`; reported row `cost_usd: 0.00042, cost_kind: reported` |
| No silent switch to another provider | A budget refusal ends the chain with a chat notice; other providers are not tried | test; **real UI**, screenshot below |
| Existing per-source caps intact | Unchanged `ResearchResolver` check | full suite |

### Live gaps found during this phase, and fixed

Each was found by checking the database after a real UI run, not by a mock:

1. Health probes and source reading called providers directly, past the gate. All three paths now share `gatedGenerate`.
2. On a freshly signed-in device, a call could go out before the account's budgets loaded, and usage gating waited for data hydration, which timed out. Gating now starts with the session and waits for the account's budgets.
3. If the account can't be reached and **a budget covers the call**, the call is refused instead of being sent on the device's partial count. Calls no budget covers still go out offline and sync later.
4. A background call sent from the sign-in screen finished after sign-in and was attributed to the new user. Calls now belong to the user signed in **when the call was sent**.

**Final real UI run** (user B, iPhone 13 emulation, test project): the cap "All AI providers: 1 request/day" was saved at 04:16:45. **Zero AI records exist after that time**, and the next message from a fresh second device was answered with the notice.

## 4. Actual usage records (test project, user B, final run)

| Time (UTC) | Provider | ok | in | out | cached | reasoning | cost |
|---|---|---|---|---|---|---|---|
| 04:15:11 | Fireworks | ✗ | — | — | — | — | unknown (error: *HTTP 412, account suspended*) |
| 04:15:50 | OpenRouter | ✓ | 943 | 700 | 0 | 830 | reported $0.00 |
| 04:16:11 | OpenRouter | ✓ | 28,286 | 229 | 0 | 183 | reported $0.00 |
| 04:16:45 | **cap saved: all AI providers 1/day** | | | | | | |
| after | none | | | | | | |

Earlier runs recorded Fireworks with reported tokens: for example, 16,627 in / 121 out / 13,725 cached / 77 reasoning with unknown cost, and 18,289 / 173 / 13,664 / 113. Knowledge sources (Wikipedia, Wikidata, Wikimedia) were recorded per call with ok/failed, also in the account.

## 5. Screenshots (iPhone 13 emulation, real app, real account; test project)

| File | Shows |
|---|---|
| [before-signed-out-iPhone13.png](evidence/phase9/before-signed-out-iPhone13.png) | **Before:** "Not signed in: usage and budgets are kept on this device only." |
| [chat-signed-in-iPhone13.png](evidence/phase9/chat-signed-in-iPhone13.png) | Signed in, a real chat turn |
| [after-synced-iPhone13.png](evidence/phase9/after-synced-iPhone13.png) | **After:** "Synced to your account · totals above are across your devices", showing account rows recorded by other sessions |
| [budget-set-iPhone13.png](evidence/phase9/budget-set-iPhone13.png) | Budget set in the UI: all AI providers, 1 request/day |
| [chat-budget-notice-iPhone13.png](evidence/phase9/chat-budget-notice-iPhone13.png) | Fresh second device: *"I didn't send this to Fireworks: all AI providers: daily calls budget reached (1/1, 1 in flight)… stopped here instead of switching to another provider."* |

`ui-run-iPhone13.json` records the run. Its `providerCalls*` counters match only part of the broker's URLs, so they are **not** evidence. The database query above is.

## 6. Tests and checks

| Check | Result |
|---|---|
| `npm test` | **1408 pass, 0 fail, 4 skipped** (1366 at the Phase 0 baseline) |
| `tsc -b --force` | exit 0 |
| `oxlint` (changed files) | exit 0 |
| `tests/usage-budget.test.ts` | 24 offline tests: multi-user isolation, device and cross-device concurrency, failure and release, unknown usage, exhaustion, reset, offline, refresh and legacy ids, the chat path, gate coverage, attribution |
| `scripts/verify-usage-supabase.ts` | 27/27 live checks on lelu-v11-test |

## 7. Findings outside this phase (not changed)

- **Fireworks account suspended**: `HTTP 412: Account laelpheru is suspended, possibly due to reaching the monthly spending limit or failure to pay past invoices`. LÉLU fell back to OpenRouter. That's the existing chain handling a *failed* provider, which is different from a budget refusal.
- **Production security advisor**:
  - `trim_lelu_events()` and `rls_auto_enable()` are `SECURITY DEFINER` functions that anonymous and signed-in users can execute. The repo's `202611060001_revoke_trim_lelu_events_execute.sql` was never applied to production.
  - Leaked-password protection is off on both projects.
- `Supabase hydration timed out after 8000ms` appears on every sign-in in this container. That's existing behaviour, and it's what exposed gap 2.

## 8. Known limitations

- **Enforcement runs in the client.** The `/api/model` broker on the server doesn't check budgets, so a modified client could call it directly. Under RLS, records are append-only and owner-scoped. But a client that skips the gate won't write records either. Server-side enforcement in the broker is the next step.
- A token cap is checked against reported tokens before a call, so a single admitted call can exceed the cap by its own size. Request caps are exact.
- Cost caps count reported cost only (OpenRouter reported $0.00 for these free-tier calls; Fireworks reported none).
- Signed-out usage stays on the device and is never attributed to whoever signs in later.
- The two test users and their records remain on the test project. Delete them from Authentication → Users when you no longer need them.
