# Known limitations

Nothing here is hidden in another document. Each item says what is not covered,
why, and what it would take to close it.

| id | Limitation | Why it exists | Risk | To close it |
|---|---|---|---|---|
| **L1** | The newest user message is never scrubbed by the payload gate. | A user who retypes a deleted fact is making a new statement; silently deleting their own words would be a different bug. | Low — the user chose to say it. | Explicit "re-teach" affordance if desired; not a leak path. |
| **L2** | Conversation transcripts are not rewritten when a single memory is deleted. | The transcript is the user's own dialogue. Rewriting it would falsify history. | Medium — a copy of the statement remains in `lelu.multichat.workspace.v1`. | Recall is already blocked (payload gate). Rewriting would require a transcript-editing policy the mission did not authorise. |
| **L3** | Derived stores (SelfModel, knowledge library, identity, daily record) are filtered when read into context, not rewritten on disk. | They are derived views, rewritten continuously by learning; a targeted rewrite could corrupt identity state. | Medium — text can persist on disk, but is filtered from every prompt path audited. | A derived-store scrubber with per-key schema knowledge; needs its own mission. |
| **L4** | Telemetry/activity keys (`lelu.usage.v1`, `lelu.lelu.runtime.activity.v1`, `lelu.lelu.selfstudy.trace.v1`, `lelu.lelu.improvements.v1`, notifications) and the user profile (`lelu-user`) were not audited for user text and have no deletion mechanism. | They are not on the prompt-assembly paths that were audited, and their schemas are varied. | Medium — a tool result or objective title could echo user text. | Per-key content audit and a scrubber; flagged as P09/P10 in the inventory. |
| **L5** | A legacy `window.name` payload (pre-M22 builds) is only migrated into swept backends when first read. | KvStore treats `window.name` as read-only legacy; nothing can enumerate a dormant value. | Low — dormant, and the read path migrates it into a swept store. | One-time startup migration of `window.name` into KvStore; not implemented. |
| **L6** | The cloud mirror delete (`SupabasePersistence.forgetMemory`) is implemented but **not exercised** — no Supabase account in this environment. | Requires live credentials and a test account. | Medium — a row could survive; it is unrecallable (id cannot be restored, text filtered) but it still exists. | Run the delete against a real account and inspect the row count. |
| **L7** | The OG surface deletes `memory_items` rows server-side with no tombstone (`src/og/lib/memories.functions.ts`). | It is a separate surface with its own auth and no access to this client's ledger. | Medium — an OG-only deletion is invisible to the ledger, so a copy elsewhere cannot be proven to quote it. | A server-side tombstone table, or routing OG deletion through the app's ledger when the client is present. |
| **L8** | Fingerprints are 32-bit FNV-1a hashes of six-token windows, not cryptographic proof. | The ledger must stay small and local; the mission explicitly calls six-token hashes evidence aids. | Collisions are possible in principle. The consequence is over-removal of an unrelated sentence, never under-removal of a matching one. | Larger hash space and/or more windows per statement; measured cost to be checked first. |
| **L9** | Guard removal is sentence-granular and can take an unrelated fact with the deleted sentence. | Partial text of a deleted statement is still the deleted statement. | Low — over-removal only, bounded to the sentence. | Span-level redaction with a stable placeholder; risks leaving a readable ghost. |
| **L10** | Only progress/report write failures were exercised for storage errors; quota exhaustion mid-batch was not simulated. | The harness forces one key to throw; simulating a full quota needs a different shim. | Low — the failure mode is the tested one (raise, no false report). | A quota shim that fails after N bytes. |
| **L11** | The boot healer runs once per page load; residue written *after* boot is cleaned on the next boot (or by the panel's dry run), not immediately. | Continuous scanning would cost more than it protects. | Low — such text is already unreadable to the model through the guard. | A write-time hook on ProjectStore.checkpoint (deliberately not added: new coupling). |
| **L12** | The M22 lineage is not contained in `integration/m16-3-wp05-reconciliation`; promotion cannot fast-forward. | Divergent histories (`aa8b1bd` base). | Process risk, not a code risk. | An authorised merge/cherry-pick or a rebase decision by the owner. |

## Claims this mission does **not** make

- It does not claim **universal** memory deletion. Three pathways are named as
  uncovered in `persistence-inventory.json`.
- It does not claim the cloud mirror is verified. It is implemented, contained,
  and unproven against real infrastructure.
- It does not claim the browser run exercises quarantine buttons; that is covered
  by tests and scenario F.
- It does not claim atomicity across projects. The guarantee is documented
  per-project and per-run in `migration-reliability-performance.md`.
