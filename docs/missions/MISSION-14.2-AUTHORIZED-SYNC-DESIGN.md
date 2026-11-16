# Mission 14.2 — Continuity Security Hardening & Authorized Sync Readiness

**Prompt:** `M14.2-WP02-P01`
**Scope:** local truthfulness, local reliability, deterministic security evidence, and an unactivated Supabase design.
**Cross-device sync:** **BLOCKED**. No remote mission write exists in this work package.

## 1. Current state (verified in this tree)

| Concern | Canonical owner | Current behaviour |
|---|---|---|
| Mission records | `src/core/projects/MissionLedger.ts` | One durable local record per workstream, persisted through `KvStore` under `lelu.missions.v1` (browser prefix `lelu.lelu.missions.v1`). |
| Byte storage | `src/core/storage/KvStore.ts` | `localStorage` → `sessionStorage` → `window.name`; failures are contained and reported. |
| Cloud persistence | `src/core/persistence/SupabasePersistence.ts` | The only Supabase client. Hydrates and mirrors memories, projects, agents, questions, knowledge, improvements, UI state, news preferences, preferences, conversations and messages. **No mission table or mission adapter.** |
| Status facade | `src/core/persistence/PersistenceState.ts` | Domain-aware snapshot for cloud-backed stores and the mission ledger. |
| Mission tools | `src/core/cognition/ContinuityTools.ts` | `mission.find/list/record/update/brief`; canonical id resolution happens inside the ledger. |
| Dispatch authorization | `src/core/tools/ToolDispatcher.ts` | Permission and approval checks at dispatch time; real-project writes require a human authorization. |
| Final-round boundary | `src/core/router/finalRound.ts` | Tool results are nonce-delimited untrusted evidence; no tools are offered. |
| Schema convention | `supabase/migrations/202608240001_lelu_runtime.sql` | Per-user rows, `user_id = auth.uid()` RLS, `id, user_id` primary keys. |

No authenticated Supabase session was available during this work package, and the user has not authorized MissionLedger cloud persistence. Therefore:

- no mission data was written to Supabase;
- no account, project, database, key, or alternate backend was created;
- no local write is labelled remotely synchronized;
- the remote-sync gate is closed.

## 2. Persistence truthfulness

`PersistenceState` previously said, in the `connected` state:

> "Local and cloud state are in sync."

That sentence spoke for every domain while only the cloud-backed stores had connected. It is removed.

The snapshot now carries two explicit domains:

```ts
domains: {
  cloud: { local, remote, synchronized, detail };
  missionLedger: { local, remote, synchronized, detail };
}
```

MissionLedger remote states are `local-only`, `signed-out`, `queued`, `synchronizing`, `synchronized`, `conflict`, `failed`, or `offline`, but `synchronized` is possible **only** when all of these hold:

1. `MissionSyncGate.available()` is true;
2. the record count is greater than zero;
3. every record's sync label is `synchronized`.

`PersistenceState` obtains the gate decision from `MissionSyncGate`; it never derives it from `SupabasePersistence.getStatus()`. A connected Supabase client therefore reports cloud-backed stores as connected while saying mission records remain local-only.

The local-only detail names the reason: no mission adapter is registered and the remote-sync gate is closed. It does not promise that records will "sync when the connection returns."

## 3. Local MissionLedger hardening (implemented)

### 3.1 Stable identity and revisions

- `MissionRecord.revision` starts at `1` and is incremented by `touch()` on every local mutation.
- `MissionRecord.updatedAt` remains the provenance timestamp.
- `mergeRemote` accepts a record when `updatedAt` is newer, or when timestamps tie and the remote revision is higher.
- `formatMission` prints the revision and its sync label, with `(not synchronized)` whenever the label is not `synchronized`.

### 3.2 Duplicate integrity

- A duplicate's `duplicateOf` points at the root canonical record.
- A duplicate is `abandoned`; it is never deleted.
- `MissionLedger.update()` now refuses a direct write to an abandoned duplicate. `mission.update` already resolves the canonical record, and `mission.duplicate` uses `markDuplicate`.
- A remote record whose `duplicateOf` is absent from the local + incoming set is refused rather than imported as an orphan.
- The existing self-reference, missing-target, and cycle checks remain in `canonicalTarget`.

### 3.3 Recovery and reload

`MissionLedger` records a `MissionRecoveryReport`:

```ts
{
  loaded: number;
  rejected: number;
  duplicateIdsRemoved: number;
  source: "empty" | "storage" | "corrupt";
  storageError: boolean;
}
```

On load it:

- normalizes each record independently;
- counts malformed records instead of aborting the whole ledger;
- keeps the first valid copy of a duplicate id and counts later copies;
- reports a corrupt top-level payload without crashing;
- leaves the valid recovered records available for the next write.

A corrupt top-level payload is not silently treated as an empty authoritative ledger: `source: "corrupt"` is visible through `recoveryReport()`. The next local write replaces it, which is a user-triggered recovery step rather than an unreported wipe.

### 3.4 Write failure

`save()` still marks every record `memory-only` when `KvStore.set` returns false or throws. `create()` returns `durability: "memory-only"`. `mission.record` includes the warning that the record will not survive reload.

### 3.5 Aggregate sync labels

`syncSummary()` counts `total`, `local`, `queued`, `synchronizing`, `synchronized`, `conflict`, and `failed`. It reports stored labels only. It does not infer synchronization from durability or network status.

## 4. Authorization gate (implemented, closed)

`src/core/projects/MissionSyncGate.ts` owns the future remote-write decision. Every requirement defaults to `false`:

```ts
{
  authenticatedSession,
  identityKnown,
  accountAuthorized,
  userAuthorizedMissionStorage,
  schemaVerified,
  rlsVerified,
  adapterRegistered,
  ownerAttributable,
}
```

`available()` is true only when all eight are true. `evaluate()` returns the exact blockers. `reset()` closes the gate and forgets capability flags.

No adapter is registered in this build, so `adapterRegistered` is false independently of any session. `PersistenceState` reads this gate; it cannot open it. A future adapter must call the gate before any network write and must not maintain a second consent flag.

## 5. Proposed Supabase integration (not applied, not activated)

### 5.1 Ownership and schema

Reuse the existing authenticated Supabase identity from `SupabasePersistence` (`session.user.id`). Do not create another auth system.

Proposed table, for a future authorized migration only:

```sql
create table public.mission_records (
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  id text not null,
  revision bigint not null,
  schema_version integer not null default 1,
  record jsonb not null,
  device_id text not null,
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

alter table public.mission_records enable row level security;

create policy mission_records_owner on public.mission_records
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

This follows the existing migration convention: per-user composite key, RLS by `auth.uid()`, no service-role browser access. The table is per-user isolation, not a second database.

Why not `user_preferences`:

- a single JSON blob has no per-record revision or RLS row granularity;
- concurrent devices would overwrite unrelated missions;
- tombstones and per-record retry are impossible to audit;
- a partial write could lose the entire ledger.

Rejected.

### 5.2 Local queue and write path

Use the existing `KvStore` for a bounded local outbox at `lelu.missions.sync.v1`. This is not a new queue service; it is the same offline-first storage the ledger already trusts.

Each entry records `{missionId, revision, operation: "upsert" | "tombstone", attempts, nextAttemptAt}`. A mission mutation marks the record `queued` and appends/replaces one outbox entry for that id, so repeated edits coalesce to the newest revision.

Write algorithm:

1. Read the current authenticated user id from the existing Supabase session.
2. Evaluate `MissionSyncGate`; stop if closed.
3. Read the local record and outbox revision.
4. Idempotent upsert keyed by `(user_id, id)`; update only when `excluded.revision > mission_records.revision`.
5. On success, mark that exact revision `synchronized`; if the local revision advanced during the request, leave it `queued`.
6. On failure, mark `failed` with a bounded retry time. Never mark `synchronized`.
7. Never delete on absence from a remote page.

An interrupted request is not assumed to have failed. The outbox entry stays
pending until the next boot; the adapter reads the remote revision first, then
retries the idempotent upsert. A remote revision equal to the local one is the
acknowledgement, even if the original response was lost. This prevents both a
silent loss and a duplicate write.

### 5.3 Hydration and conflict handling

- Hydration reads all rows for `auth.uid()` in bounded pages.
- Local-only records not present remotely are uploaded, not deleted.
- Same id on both sides: higher `revision` wins; equal revision uses a deterministic tiebreak (`updatedAt`, then `device_id`) and records a `conflict` log entry on the losing local copy.
- A tombstone (`deleted_at`) wins over an older live revision; the local record becomes `abandoned`/tombstoned, not silently vanished.
- A conflict is surfaced in `PersistenceState.domains.missionLedger` as `remote: "conflict"`, never as connected.
- A local snapshot plus the outbox is the recovery set. Remote hydration never replaces a local record with a lower revision; a corrupt remote row is skipped and reported, never treated as an empty authoritative ledger.

### 5.4 Device identity

There is no existing installation identity suitable for sync. `RelationshipStore.deviceId` is an authorization subject for external-device grants, not a browser installation identifier; reusing it would conflate two security domains. Rejected.

Proposed: a random, non-secret id in `KvStore` under `lelu.device.v1`, generated once, used only as a tiebreak and diagnostic. It must not be treated as authentication. If a safer existing mechanism is introduced later, adapt it instead.

### 5.5 Sign-out, account switching, and isolation

- Sign-out closes the gate, stops retries, and keeps the local ledger intact.
- Account switch must not merge account A's local missions into account B. Before any hydration for a different `user_id`, quarantine the local mission ledger under a user-specific local key and start an empty local set for the new account, or refuse the switch until the user chooses. This is a required implementation decision before activation, not a detail to improvise.
- Every remote query is scoped by the authenticated `user_id`; a client-supplied id is never trusted.
- Remote rows are private; do not publish mission tables through realtime by default.

### 5.6 Migration and rollback

1. Apply the additive `mission_records` migration with RLS; no data backfill in the same step.
2. Deploy an adapter that is closed by default; register it only after the gate's identity/RLS checks pass.
3. Backfill from local only after explicit user authorization, idempotently, with `revision` preserved.
4. Rollback: disable the adapter, leave local data untouched, and retain the table read-only until export/cleanup is authorized. Dropping the table is a destructive data decision, never part of a code rollback.

### 5.7 Acceptance tests that cannot run yet

These remain **BLOCKED**, not passed:

- two independent browsers with the same authorized account;
- sign-in, hydration, local edit, remote visibility, and second-client hydration;
- offline edit, reconnect, retry, and no duplicate records;
- two-device conflict, deterministic winner, and visible conflict state;
- sign-out and account switch with no cross-account leakage;
- RLS denial for a second account reading the first account's rows;
- interrupted synchronization and idempotent retry;
- tombstone propagation and recovery.

A second tab in the same browser is not evidence for any of these.

## 6. Reuse / adapt / reject matrix

| Responsibility | Existing module | Decision | Why |
|---|---|---|---|
| Mission record ownership | `MissionLedger` | **Reuse** | Single local model; no second memory store. |
| Durable bytes | `KvStore` | **Reuse** | Offline-first, failure-reporting storage already owns this concern. |
| Auth identity | `SupabasePersistence` session | **Reuse** | Existing authenticated account; no second auth. |
| Cloud schema/RLS conventions | Existing Supabase migrations | **Adapt** | Additive per-user table following `auth.uid()` conventions. |
| Remote write eligibility | `MissionSyncGate` (new) | **Reuse** | One explicit gate; no implicit consent from connectivity. |
| Local outbox | `KvStore` key | **Adapt** | Small bounded outbox; not a queue service. |
| Device identity | `RelationshipStore.deviceId` | **Reject** | Authorization subject, not an installation id. |
| Device identity | New `KvStore` value | **Propose** | Random non-secret tiebreak id. |
| Mission blob in `user_preferences` | Existing adapter | **Reject** | No per-record revision, RLS granularity, or conflict handling. |
| Realtime mission broadcast | Existing Supabase realtime | **Reject for now** | Private records; polling on demand is enough for acceptance. |
| A second database / Convex | — | **Reject** | No deployed functions/dependency; unauthorized workaround. |
| New sync orchestration framework | — | **Reject** | The outbox plus adapter is sufficient. |
| Existing cloud status as mission status | `PersistenceState` | **Reject** | The bug this package removes. |
| Final-round untrusted framing | `finalRound.ts` | **Reuse** | Already a deterministic evidence boundary. |
| Dispatch authorization | `ToolDispatcher` | **Reuse** | Checks permission and approvals at execution time. |

## 7. Adversarial evidence matrix

| Vector | Evidence | Status |
|---|---|---|
| Malicious mission/tool result | Deterministic tests plus the earlier live Groq turn (only `mission.find` executed; no mutation or secret access). | **TEST-VERIFIED** for the deterministic boundary; live coverage partial. |
| Webpage content | Deterministic final-round test with webpage-labelled untrusted content. Live browser injection **BLOCKED** by provider tool-choice refusal (`400 tool_use_failed: Tool choice is none, but model called a tool`). | **PARTIAL / BLOCKED** for live. |
| File content | Deterministic final-round test with a failed file tool result; cannot be upgraded to success. Live provider route **BLOCKED**. | **PARTIAL / BLOCKED** for live. |
| Repository content | Deterministic final-round test with repository-labelled untrusted content. Live route **BLOCKED** by provider/tool-choice/GitHub Models contract failures. | **PARTIAL / BLOCKED** for live. |
| Change ownership from retrieved content | `mission.update` resolves the canonical record; source text cannot select an owner write; canonical id and owner remain unchanged. | **TEST-VERIFIED** |
| Destructive writes from retrieved content | `project.apply` and `repo.rollback` are not permitted without the separate human authorization/destructive grant. | **TEST-VERIFIED** |
| Approval bypass | A forged `approvalId` does not lift the risk boundary; the dispatch is refused. | **TEST-VERIFIED** |
| Environment/secret access | Mission writes are redacted; the final round is told not to reveal credentials; no tool path was granted by retrieved text. Live exfiltration was not attempted. | **PARTIAL** (deterministic boundary only). |
| Unapproved/unknown tool | `system.shell` is not permitted and dispatch refuses it. | **TEST-VERIFIED** |
| Canonical mission identity manipulation | Duplicate redirect and orphan-merge refusal; stable id survives reload. | **TEST-VERIFIED** |
| Final-round manipulation | Nonce-delimited evidence, failed/missing status preservation, trusted final guard. | **TEST-VERIFIED** |

No test here establishes universal prompt-injection immunity.

## 8. Test and build evidence (this worktree)

| Check | Result |
|---|---|
| Focused MissionLedger, persistence, gate, and adversarial tests | **55 passed, 0 failed** |
| TypeScript typecheck | **0 errors** (`tsc -b --force`) |
| Lint | **0 errors, 409 warnings** (no new warnings in the changed files) |
| Production build | **0 errors**, built in 22.76s |
| Full suite | **2,243 tests: 2,233 passed, 2 failed, 8 skipped**, 222.40s |

The two full-suite failures are the same two observed in the starting worktree and are outside this package:

1. `tests/genesis-interface.test.tsx` — Node 26 / `@excalidraw/excalidraw` package-exports resolution of `./index.css` (`ERR_PACKAGE_PATH_NOT_EXPORTED`), before any assertion runs.
2. `tests/sandbox-security.test.ts` — the environment's network denial returns an empty error string (`''`) where the test expects `/^denied:/`.

Neither file was changed by this work package. The provider-blocked live webpage/file/repository vectors remain **BLOCKED**; deterministic final-round coverage is the evidence available in this environment. No UI acceptance test or cross-device test was run.

## 9. Classification

- Persistence status truthfulness: **TEST-VERIFIED**
- Local mission reload/update/duplicate recovery: **TEST-VERIFIED**
- Local corrupt/partial recovery and failed-write honesty: **TEST-VERIFIED**
- Mission sync gate closed by default: **TEST-VERIFIED**
- Expanded deterministic adversarial coverage: **TEST-VERIFIED**
- Live webpage/file/repository injection: **BLOCKED**
- Supabase MissionLedger schema: **PROPOSED** (not applied)
- Remote hydration/queue/conflict/sync adapter: **NOT STARTED**
- Cross-device continuity: **BLOCKED**

## 10. Activation checklist (none satisfied)

Before any remote mission write:

- [ ] Existing authenticated session observed, with `session.user.id` recorded.
- [ ] The identity is the intended user and the account is authorized.
- [ ] User explicitly authorizes MissionLedger cloud storage.
- [ ] Additive schema applied and inspected.
- [ ] RLS proven for owner and non-owner accounts.
- [ ] Adapter registered and gated by `MissionSyncGate`.
- [ ] Account-switch isolation implemented.
- [ ] Two-client acceptance workflow passes.
- [ ] Rollback and export tested.

Until then, local-only is the correct state, and `PersistenceState` says so.
