# MISSION 44.8 — PERSISTENT MEMORY, GOVERNANCE & EXECUTION CONTINUITY

Date: 2026-11-28 · Branch `mission/44-8-memory-governance-continuity` (from `ffc8641`)
Evidence: `docs/missions/evidence/mission-44-8/` · Previous: `MISSION-44-7-CONVERSATIONAL-RELIABILITY-CLOSURE.md`

Mission 44.7 made every operational claim prove itself against a tool result.
The most common sentence LÉLU writes is not one of those: it is a restatement of
something she remembers — and a memory carried no date, no source, no
indication that something newer contradicted it. An instruction remembered from
a past turn looked like permission to act. An objective stopped existing when
its conversation did.

This mission connected claim integrity to memory, governance and continuity. It
added no second memory system: every new module reads or writes one that already
existed.

---

## 1. Starting state (verified before any change)

| Fact | Value |
|---|---|
| Starting branch | `mission/44-7-claim-integrity` |
| HEAD at start | `ffc8641` ("Name the Mission 44.7 delivery commits in its report") |
| Remote agreement | `git ls-remote --heads origin` reported `ffc8641` for that branch — **identical** |
| Working tree | clean except the deliberate untracked `pw-probe.mjs` (never committed) |
| 44.7 delivery | `ef06352`, `aea64c9`, `184e844`, `ffc8641`, report and `evidence/mission-44-7/` on the remote |
| 44.6 / 44.5 / 44.4 / canonical | `9251a80` / `fd9169d` / `77ead33` / `543da7c` — untouched |
| Dependencies added | **none** |
| Providers | no Anthropic, no paid API, no LangChain/LangGraph; no Supabase schema change |

WP00 was completed first: the branch was created from `ffc8641` and pushed
before any implementation began.

## 2. Baseline (recorded, not assumed)

`docs/missions/evidence/mission-44-8/baseline-test.log`:

| Tests | Pass | Fail | Skipped | Suites | Duration |
|---|---|---|---|---|---|
| **2,408** | **2,400** | **0** | **8** | **34** | 248.2 s |

Identical to the 44.7 final run, down to the skipped count. Every figure below
is compared against this run.

## 3. Audit (WP01)

`docs/missions/evidence/mission-44-8/architecture-audit.md` is the full
inventory: 16 memory-related systems, what each stores, which is authoritative,
which is duplicated in name only, which is simulated, and the before/after data
flow.

The short version:

* **Authoritative:** `PatternMemory` + `IndexedDBStore` (durable facts),
  `MultiChatStore` (conversation history), `ProjectStore` (projects and their
  checkpoint). These are the only stores this mission writes through.
* **Read-time only:** `MemorySynthesizer` ranked and detected contradictions
  inside the prompt text for one turn and nothing carried that to the reply.
* **Simulated:** `src/app/scene/genesis/engines/MemoryEngine.ts` derives its
  "short/long-term" numbers from an array length. It is a visual, and is not
  counted as a memory system here.
* **Declared but unused:** `MemoryStore` names seven spaces; `PatternMemory`
  reads only `"user"`.
* **Disconnected:** `MemoryOrchestrator`'s registry served bands 6–7 only, never
  the memory a turn actually used; `ProjectStore.checkpoint` existed but nothing
  wrote step-level progress to it.
* **Absent:** provenance on a recalled fact, any instruction ledger, any
  measurement over a window.

## 4. What was missing, and what was built

| Gap | Module | What it does |
|---|---|---|
| A recalled fact has no date, source or conflict state | `src/core/memory/MemoryProvenance.ts` | reads recalled records as `current / historical / stale / conflicting / superseded / incomplete`, with source conversation, recorded-at, retrieved-at, verified, inference, superseded values and reasons |
| Memory claims cannot be checked the way tool claims are | `ProviderResolver` + `memory.recall` | when a reply attributes something to memory, the provenance note is attached; `memory.recall` now returns each record with its date, source and any conflict |
| An instruction is indistinguishable from permission | `src/core/governance/StandingInstructions.ts` | records instructions, classifies them, and refuses to authorize anything by construction |
| Repeated corrections get acknowledged again | same module + `ProviderResolver` | recurrence opens an investigation naming the owning system, and the investigation **leads** the reply |
| An objective dies with its conversation | `src/core/continuity/WorkContinuity.ts` | step ledger across conversations, idempotent, mirrored into `ProjectStore.checkpoint` |
| No measurement of memory or execution | `src/core/memory/MemoryObservability.ts` | content-free journal, minute/hour/day/project/agent/conversation, with measured/estimated/unavailable declared |

### 4.1 What each module refuses to do

* `StandingInstructions.authorityOf()` takes no parameter that can make it say
  `allowed: true`. A record may be `recorded`, `investigating`, `applied` or
  `verified` — and still refuses, which is asserted for every status.
* `WorkContinuity` records `persisted: false` when storage refused the write, so
  a step cannot be reported as durably saved when it was not.
* `MemoryObservability` reports `unavailable` for a metric nothing measured, and
  `storeBytes: null` for whole-store consumption, which it cannot see.
* `MemoryProvenance` never upgrades: a record older than seven days is labelled
  historical in the note even when it is the only record and nothing
  contradicts it.

## 5. Governance integration (WP03)

The five things the mission separates are now separate in code:

| Step | Where | Evidence |
|---|---|---|
| remembering an instruction | `StandingInstructions.record()` | `lelu.instructions.v1`, survives reload (verified in the browser) |
| understanding it | `kind` + `systemFor()` | `standing-preference`, `project-requirement`, `correction`, `temporary`, `unresolved-defect`, `failed-implementation`, each mapped to the system that owns the behaviour |
| being authorized | `AutonomyGate` + `ApprovalGate` + `EngineeringAuthorization` | untouched; `authorityOf()` returns `grants: []` and names the three requirements |
| executing | `ToolDispatcher` | unchanged |
| verifying the outcome | `investigation.result` / `verifiedAt` | `verified` is only reachable through `markInvestigated`, and the note says when it has not been verified |

A remembered instruction raises no autonomy level: asserted directly
(`tests/mission-44-8-acceptance.test.ts`, scenario D).

## 6. Verification

`docs/missions/evidence/mission-44-8/final-test.log`:

| Check | Result |
|---|---|
| `npx tsc -b --force` | **exit 0** |
| `npx oxlint` (new and changed files) | **0 errors, 0 warnings** |
| `npm run build` | §6.2 |
| Full suite | §6.1 |
| New suites | `memory-provenance` 15, `memory-governance` 16, `work-continuity` 12, `memory-observability` 12, `memory-failure-recovery` 9, `mission-44-8-acceptance` 8 |

### 6.1 Full suite

| | Tests | Pass | Fail | Skipped | Suites | Duration |
|---|---|---|---|---|---|---|
| Baseline | 2,408 | 2,400 | 0 | 8 | 34 | 248.2 s |
| Final | **2,480** | **2,472** | **0** | **8** | **34** | 262.3 s |

**+72 tests**, 0 failures. Every historical test still runs and still passes;
the skipped 8 are the same eight that were skipped at baseline (capability-gated
cases, not exclusions added here). No test was weakened, skipped or suppressed,
and no assertion was edited to reach green — the only test edits in this mission
are the new files plus two assertions corrected while the code was being written
(a minute-vs-hour window boundary, and a `since` field that should report the
oldest retained event rather than the first inserted one).

### 6.2 Build and lint

* `npm run build` — **exit 0**, `vite` 7.57 s (`tsc -b` clean beforehand). The
  output carries the same `INEFFECTIVE_DYNAMIC_IMPORT` notes as before this
  mission; none is in a file this mission touched.
* `npx oxlint` — **0 errors**, 483 warnings repo-wide (identical to the 44.7
  figure); each new module reports 0 warnings on its own.
* `npx tsc -b --force` — **exit 0** (run after every edit batch, including the
  final one).

### 6.3 Two defects found by running, not reading

**D1 — the investigation did not reach the reply.** Recorded in the browser:
after the second correction the ledger held `status: investigating`,
`kind: correction`, `system: verification (project_validate / Mission evidence)`
— and the reply said "Acknowledged. The instruction stands and I'm following
it." The context block was in the request; it was advice the model ignored.
Fixed in `bd96fdc`: `ProviderResolver` prefixes the reply with
`StandingInstructions.recurrenceFor(prompt)`. Re-verified live: the third
correction is answered with the investigation first. This is the mission's own
failure mode, found by doing what the mission said to do — reproducing the
workflow and checking the behaviour, not the record.

**D2 — the new stores wrote to double-prefixed keys.** `KvStore` prefixes every
key with `lelu.`; the three new modules named their keys `lelu.…`, so they wrote
to `lelu.lelu.work.v1` and friends. Caught by tests not sharing state. Fixed
before commit. Effect in production would have been isolation from every other
reader of the same namespace and no way to clear or migrate the data later.

## 7. Browser acceptance (WP08 A–G)

`docs/missions/evidence/mission-44-8/live-acceptance.md`, screenshot
`browser-recurrence-investigation.png`. Summary of what the product did:

| Scenario | Result |
|---|---|
| A/C — objective stated in `c-44-8-a`, resumed in `c-44-8-b` | the reply named both completed steps **with their evidence** and the one remaining step, without re-executing anything |
| B — record survives reload | `lelu.instructions.v1` intact after a real page reload |
| D — instruction recorded, not authorized | `authority: preference`, autonomy level unchanged; the same turn did not claim a test it had not run |
| F — repeated correction | `timesSeen 2 → 3`, reclassified `correction`, investigation `pending (attempt 2)`, and after the D1 fix the investigation leads the reply |
| E/G | conflicts and measurements are covered by the executable acceptance suite; no UI panel was built for them |

## 8. Failure recovery (WP07)

`tests/memory-failure-recovery.test.ts` forces `localStorage.setItem` to throw —
a full quota or a private-mode browser — rather than stubbing our own code:

| Scenario | Assertion |
|---|---|
| interrupted memory write | `persisted: false` is returned; after a reload the record is gone, which is what the caller was told |
| step whose ledger write failed | `persisted: false`, in-session state still coherent |
| duplicate execution | second completion returns `duplicatePrevented`, evidence and attempts unchanged |
| conflicting updates | both records kept; newer is `conflicting`, older `superseded`; neither reported as current |
| stale retrieval | labelled `stale` with its age, not answered as current |
| failed authorization | refused before and after `verified` |
| concurrent conversations, one project | one ledger, one completion, second attempt prevented |
| interruption mid-step | no step left `active`; completed stays completed, in-flight returns to pending |

## 9. Limits of this delivery

1. **No observability UI.** `MemoryObservability.snapshot()` is unit-tested and
   is written by real turns, but nothing renders it. No browser screenshot of a
   measurement exists, and this report does not claim one.
2. **Provenance is attached only when the reply claims memory.** A recalled fact
   the model states without attributing it is not annotated; closing that needs
   a model-side classification (or every reply carrying dates), which is a
   larger change than this mission.
3. **Superseded text is still inside the record.** `MemoryEngine.supersede`
   writes "(Superseded earlier statement …)" into the content; `MemoryProvenance`
   parses it for the note, but the storage shape should eventually separate the
   value from its history.
4. **`PatternMemory` still reads only the `"user"` space** — six declared spaces
   remain unused. Not changed: doing so is a data-model migration.
5. **Instruction detection is pattern-based.** It deliberately ignores bare
   statements and decisions ("Use platinum"), and cannot understand an
   instruction phrased in an unusual way. A miss costs a record, not a wrong
   action.
6. **One project at a time per ledger lookup.** Two conversations working the
   same project converge on one ledger (tested), but nothing prevents two
   browser tabs from writing different steps within the same second; the
   last-write-wins is bounded by the coalesced store, not transactional.
7. **No host reboot test.** This VM has no init system; reload is covered in the
   browser, process termination was covered in 44.7 for the same storage layer.
8. **No physical phone.** Layout is unchanged by this mission and was accepted
   in 44.7 under Chromium emulation only.

## 10. Branch and commits

- Branch `mission/44-8-memory-governance-continuity`, created from `ffc8641` and
  pushed before any change
- `89b1afe` — provenance, instructions, continuity ledger, observability, and the
  wiring into `MemoryBridge`, `ProviderResolver`, `memory.recall`, `ApprovalGate`
- `bd96fdc` — the repeated-correction investigation leads the reply (defect D1)
- Report, evidence and the final suite log are in the delivery commit recorded in
  §11
- Nothing merged, deployed, or written to production; no branch deleted

## 11. Delivery

- Remote verified: `git ls-remote --heads origin mission/44-8-memory-governance-continuity`
  returns the same commit as local `HEAD` at each push.
- Working tree clean apart from the deliberate untracked `pw-probe.mjs`.
- Evidence in `docs/missions/evidence/mission-44-8/`: `architecture-audit.md`,
  `live-acceptance.md`, `baseline-test.log`, `midsuite-test.log`,
  `final-test.log`, `browser-recurrence-investigation.png`.
- Canonical (`freebuff/08af6cc9ef212913e6b7209b` = `543da7c`) unchanged; nothing
  merged, deployed, unpublished or deleted.

## 12. What this mission did not build

It did not add a memory panel, a new store, a new provider, a vector index or an
agent. The instruction was to integrate the existing systems into one coherent
architecture, and the five modules added are readers and recorders over systems
that already existed. Where a gap needed a new capability — a step ledger, an
instruction record, a provenance reading, a measurement journal — it is the
smallest module that could hold it, and every one of them declares what it
refuses to claim.
