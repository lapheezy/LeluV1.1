# LÉLU — AUTONOMY CLOSURE REPORT

Consolidated report. One branch, one set of measured results, explicit status per gate.
Status vocabulary: **VERIFIED** (directly observed, reproducible) · **PARTIAL** (some behaviour proven, remainder named) · **BLOCKED** (specific external/environmental dependency) · **FAILED** (tested, expected behaviour did not occur) · **NOT TESTED** (no valid evidence).

Branch: `claude/autonomy-closure-consolidated` (worktree `wt-closure`)
Base: `cd0cf3b` — Mission 5.8/5.9 provider-resilience lineage (newest)
Date: 2026-11-09

---

## 1. Executive verdict

The consolidated work is **PARTIALLY COMPLETE**. Mission 3.4's central claim is now proven on the newer lineage and its two real defects are fixed:

- **Surfaces are connected to the presentation layer.** `composeEnvironment`, `mutateSurface` and `restoreSnapshot` now request the ONE System environment through the existing `genesis-show-surface` channel. Measured: compose → host `[data-workspace="lelu-system"]` present, 4 `[data-workspace-view]` nodes, engine IDs 1:1.
- **Revisions are exact across a genuine reload.** `restoreSnapshot` passes the stored revision, and a spec rebuilt by a visualizer tick is no longer counted as a change (it was: engine 7 → DOM 11 without content changing). Measured: engine `[r1,r1,r1,r5]` → DOM `[r1,r1,r1,r5]`, same IDs, revised text present.
- **Pointer selection works with real mouse input** (verified in a settled session on two different surfaces, including an SVG chart body), and selection now happens on press rather than click so it cannot be lost between down and up.
- **Phones no longer lose the field.** The System environment outranks the expanded chat in `resolveSurface`, and surfaces lay out as a real scrollable column. Measured: mount + geometry valid at 390×844, 375×812 and 430×932.

What is **not** closed, and is not claimed: a live model turn in this session, post-restore model cognition, the fresh-session first interaction (blocked by the sign-in gate remaining above the field), 360×640 geometry, touch selection, browser/engineering autonomy, voice, Sapiolingo, and 3D/media/Earth Core. Each is classified below with its evidence.

---

## 2. Historical mission reconciliation

Ancestry was resolved from the repository, not from report prose.

| Obligation | Origin | Current implementation | Evidence | Remaining work | Status |
|---|---|---|---|---|---|
| Model-selected `environment_compose` executes | Mission 3.2 `2690408` | Present; tool path via ToolSchemas → Dispatcher → EnvironmentTools → engine | 3.2 report; `tests/environment-integration.test.ts` | Re-run live this session | PARTIAL (previously verified on 3.2 branch) |
| Model creates, mutates, restores same environment | Mission 3.3 `de2687e` | Present | 3.3 report | Same | PARTIAL |
| Surfaces mount after compose/restore | Mission 3.4 `3e1f4e4` | **Not in the 5.x lineage**; ported here (idempotent `presentWorkspace`) | `desktop.json` steps composed/mounted/restore | — | VERIFIED |
| Revision continuity through restore | Mission 3.4 (reported r8→r9/r11) | **Root cause found and fixed**: `openView` re-created views at revision 1 (3.4), and on this lineage `changesContent` compared specs by reference, so every visualizer tick incremented | `desktop.json` restoreEngine/restoreDom; `tests/revision-presentation-continuity.test.ts` | — | VERIFIED |
| Pointer selection of surfaces | Mission 3.4 (reported FAIL) | Handler was correct; 3.4 measured presses swallowed by the sign-in gate, and by cards moving during layout settle | `probe-select.json`, `body-select.json`, `overlay.json` | Fresh-session case below | PARTIAL |
| Mobile workspace rendering | Mission 3.4 (0 nodes at 390×844) | Two causes: phone `chatOwnsScreen` unmounted the scene, and desktop spatial slots placed cards at negative x | `mobile.json` | 360×640 overflow | PARTIAL |
| Provider truthfulness + broker contract | Mission 5.8 `cd0cf3b` | 2xx non-JSON refused as contract violation; capability from evidence | 5.8 report + `tests/broker-contract.test.ts` | Live capability probe not re-run | PARTIAL |
| Two-step size degradation | Mission 5.6 `59f9137` | Present in `ProviderResolver` (full → reduced → none on size refusal) | source + existing tests | Pre-send prevention below | PARTIAL |
| Per-turn tool scoping | Mission 5.5 `5619efd` | Present | `tests/tool-schema-scoping.test.ts` | — | VERIFIED (suite) |
| Unified canonical integration | `claude/unified-*`, `0cd2d3d` | In lineage | commit map §3 | Merge proposal only | PARTIAL |
| Live autonomy end-to-end | Missions 3.x/5.x | Not exercised in this session | — | Needs provider headroom | NOT TESTED |

Contradictory reports were resolved by source inspection: the 3.4 “selection FAIL” was **not** a selection-store defect (direct `selectView` paints `data-selected="true"`; real presses select in a settled session). It was an overlay/timing artefact, proven by `overlay.json` (gate at z 600 above the card) and `body-select.json` (press → selected).

---

## 3. Branch and commit map

| Ref | SHA | Meaning |
|---|---|---|
| Merge base | `59f9137` | Mission 5.6 size degradation |
| `claude/mission-3-2-live-model-tool-execution` | `2690408` | 3.2 |
| `claude/mission-3-3-live-continuity` | `de2687e` | 3.3 (tag `m3.3-checkpoint`) |
| `claude/mission-3-4-surface-rendering` | `3e1f4e4` | 3.4 (tag `m3.2-checkpoint` at 3.2) |
| `claude/mission-5-7-provider-resilience-autonomy` | `0b89f54` | 5.7 |
| `claude/autonomy-closure` (5.8/5.9) | `cd0cf3b` | newest lineage; base of this work |
| `claude/master-integration` | `ae5a9cb` (local) / `origin/claude/master-integration` `91f5361` | canonical; **untouched** |
| `claude/autonomy-closure-consolidated` | this branch | consolidation |

3.2/3.3/3.4 and 5.7–5.9 are **sibling** lineages off `59f9137`; neither contains the other (verified with `merge-base --is-ancestor`). This work continues the newer 5.x lineage and re-implements the 3.4 connection on it rather than merging 555-file divergent trees.

---

## 4. Authoritative architecture map

One path, no parallel systems introduced:

```
input → AIService/AIRuntime → ProviderResolver (+ RequestBudget, capability evidence)
      → ToolSchemas (per-turn scoped) → ToolDispatcher → ToolRegistry
      → EnvironmentOrchestrationEngine
           ├─ WorkspaceEngine (only workspace state)
           └─ presentWorkspace() → genesis-show-surface {panel:"visual"}
      → GenesisSurfaceController → VisualEngine.interfaceFocus = "visual"
      → GenesisScene router → LivingSystemUI → [data-workspace-view] surfaces
Persistence: WorkspaceEngine + KvStore ("environment.snapshots"/"environment.revisions")
```

Verified singletons by inspection and by tests: one WorkspaceEngine, one EnvironmentOrchestrationEngine, one presentation channel. Anthropic remains disabled; no route was added to it.

---

## 5. Provider capability and resilience

- **BROKER_CONTRACT_VIOLATION for 2xx non-JSON** is implemented (`GitHubModelsProvider`, Mission 5.8); the 4-byte `OK\r\n` response can no longer be treated as a completion.
- **Capability is derived from recorded outcomes**, not from key presence (5.8 states configured / authenticated / completion-verified / tool-verified / capacity-limited / contract-violating / unavailable).
- **Anthropic**: POLICY_DISABLED, untouched.
- **This session**: no live provider call was made. No credential was created, read or printed. Provider behaviour in this closure is therefore **NOT TESTED**; the previously recorded Groq 429/413 and OpenRouter 429 remain the standing external blocker.

## 6. Request budgeting

- `src/core/router/RequestBudget.ts` measures the assembled request **before send**: system/history/prompt/tool-schema BYTES, counts, schema tier, `estimatedTokens` explicitly labelled `bytes/4`. Logged by `ProviderResolver` at the send boundary.
- Two-step degradation on a size refusal (full → reduced → none) preserves as many tools as possible instead of dropping them all.
- **Gap (PARTIAL):** the budget is measured and logged but does not *refuse or shrink* a request pre-emptively. There is no UTF-8 byte ceiling check against a per-model limit before the call, so a predictable 413 is still possible; recovery is reactive. This is the smallest remaining remedy inside the repository.

## 7. Model / tool execution evidence

- Tool wiring is covered by `tests/environment-integration.test.ts` with a **scripted** provider (labelled as such): model-shaped `toolCalls` → real dispatcher → real engine → workspace change.
- **No live model turn was executed in this closure run.** Every browser result in this report used the real engine path with model calls omitted (stated in each script header). Gate: **NOT TESTED** for live model reasoning in this session; the code path is unchanged from 5.8/3.3 where it was verified.

## 8. Surface selection and mobile evidence

Selection (desktop 1440×900, real mouse, settled session):
- `probe-select.json`: direct `selectView` → `data-selected="true"`; Playwright locator press → engine `selectedId` set; raw mouse press on header → engine + DOM agree.
- `body-select.json`: press on the **SVG chart body** of `view-providers` → `engineSelected=view-providers`, `data-selected=true`; press on a second surface's text body → selection moved to that surface. Real pointer input, both surfaces.
- `overlay.json` (fresh session): the exact reason 3.4 failed — `[data-lelu-signin-gate]`, `position: fixed`, `z-index: 600`, `pointer-events: auto`, sitting above the card's SVG. `desktop.json` `blockedBy.stack` repeats this after the guest button was pressed once.
- Code change: selection fires on `pointerdown` (ignoring nested controls), so a press spanning a re-render still selects. `onClick` retained.

Mobile (Chromium **emulated** touch — not a physical device):
- `mobile.json`: host present and 4 surfaces at 390×844, 375×812, 430×932, all inside the viewport; reflow preserves the same IDs.
- **FAILED:** 360×640 — at least one surface extends outside the viewport (`allInside:false`).
- **NOT TESTED:** touch tap selection and chat-open coexistence. The chat button press was blocked by the sign-in gate still being above the field in that run; no verified touch selection exists.

## 9. Revision and persistence evidence

Defined semantics (documented in code and tests):
1. create → `revision = 1`;
2. +1 **only** when content/title/kind actually changes; a spec is compared **by value**;
3. restore adopts the stored revision and is not itself a change;
4. a visualizer refresh with an identical spec is not a change.

Measured (`desktop.json`, genuine `page.reload()`, KvStore hydration):
- compose → r1,r1,r1; mutation → `view-providers` r4→r5 with `idPreserved` and revised text in the DOM;
- `saveSnapshot` → `snapshot-mw8iue8w` with 4 views; after reload `getSnapshots().length = 1`;
- fresh boot: **0** `[data-workspace-view]` nodes (clean start);
- restore → engine `[r1,r1,r1,r5]`, DOM `[r1,r1,r1,r5]` — exact, including a previously inflated surface.

## 10. Full post-restore cognition

- **VERIFIED:** save → fresh document → restore → same IDs/revisions/content rendered.
- **NOT TESTED:** a real model continuing the task after restore, selecting a restored surface and mutating it. The mechanism (`mutateSurface` after restore, presentation request) is exercised by unit tests and the engine path; the model half needs provider headroom.

## 11–15. Capability status (not exercised here)

| Area | Status | Basis |
|---|---|---|
| Browser / computer use | NOT TESTED | No workflow run in this closure |
| Engineering autonomy (repo inspect → edit → test → diff) | NOT TESTED | No loop run here; this report's own work is agent-driven, not LÉLU-driven |
| Voice / screen sharing | NOT TESTED | No microphone, TTS or capture session |
| Sapiolingo / ecosystem | NOT LOCATED | No Sapiolingo package exists in this tree; integration cannot be inspected |
| 3D / media / Earth Core | NOT TESTED | Existing modules untouched; no creative or geospatial run |

No claim in these rows is inferred from the presence of code.

## 16. Regression and build results

| Check | Result |
|---|---|
| `bun run test` (configured runner, final tree) | see §16a |
| `bunx tsc -b --force` | exit 0 |
| `bunx oxlint` | 0 errors, 134 warnings (baseline 134 for this lineage) |
| `bun run build` | exit 0 (only the pre-existing >500 kB chunk advisory) |
| New tests | `tests/revision-presentation-continuity.test.ts` — 10 tests, 10 pass |

Historical totals are **not** reconciled by quoting: 1,838 was the 3.x-lineage count; this lineage carries 1,859 (the difference is pre-existing tests added by 5.7–5.9 plus this mission's 10). Both runs reported 0 failures and 6 skips.

### 16a. Final-run numbers

- `bun run test`: **1859 tests, 1853 pass, 0 fail, 6 skipped, exit 0** (224 s; `/tmp/closure-suite3.log`).
- Skips are pre-existing and named in the 5.8 report; none were added, removed or weakened here.

## 17. Remaining blockers, classified

| Blocker | Cause | Smallest remedy |
|---|---|---|
| Fresh-session first interaction blocked | `[data-lelu-signin-gate]` (z 600) remains above the field after the guest button; it reappears in the measured stack | In-repo: dismiss/close the gate through its own path before presenting a workspace; verify with `desktop.json`'s `blockedBy` check |
| Touch selection unverified | Same gate overlay in the mobile run | Re-run `mobile.mjs` once the gate is gone |
| 360×640 overflow | Column padding + card max heights exceed the short viewport | In-repo: reduce card max height / paddings below 640 px |
| Live model reasoning + post-restore cognition | Provider capacity (Groq 429/413, OpenRouter 429, GitHub Models contract stub) | External: an eligible provider with headroom; code path unchanged |
| Pre-send 413 prevention | Budget measured but not enforced | In-repo: byte ceiling + shrink before send |
| Browser, engineering, voice, Sapiolingo, 3D/Earth | Not attempted in this closure | Separate execution with the same evidence standard |

## 18. Files and commits changed

Source (5 files, +141/−9 before test/doc additions):
- `src/core/workspace/WorkspaceEngine.ts` — `revision` input; value-based spec comparison.
- `src/core/orchestrator/EnvironmentOrchestrationEngine.ts` — `presentWorkspace()` + 3 call sites; restore revision passthrough.
- `src/app/scene/genesis/surface/Surface.ts` — `systemEnvironmentActive` rule.
- `src/app/scene/genesis/surface/useSurface.ts` — passes the System-environment flag.
- `src/app/scene/genesis/LivingSystemUI.tsx` — press-to-select; phone column layout.

Tests: `tests/revision-presentation-continuity.test.ts` (10 tests).

Evidence: `docs/acceptance/autonomy-closure/` — `desktop.json`, `mobile.json`, `body-select.json`, `probe-select.json`, `overlay.json`, `first-press.json`, `diagnose-select.json`, `scripts/*.mjs`, `shots/*.png`.

Changelog contradiction found and documented: the 3.4 commit left a mangled `}    this.workspace.setLayout(...)` line; this port writes it correctly.

## 19. Canonical integration recommendation

**Recommend review-and-merge of `claude/autonomy-closure-consolidated` into canonical only after** the sign-in-gate interaction blocker and 360×640 are closed, because canonical currently has neither the 3.4 surface connection nor the revision fix.

Canonical was **not modified**: no merge, no rebase, no force-push, no reset. The proposal is a normal merge of this branch; the diff is §18 plus evidence.

## 20. What LÉLU can actually do right now, without a developer

From the acceptance evidence, in the running app as a signed-out guest:

- **She cannot be interacted with through a fresh guest session**: the sign-in gate's transparent full-screen layer stays above the workspace, so presses on surfaces do not land. This is the first thing to fix and it is inside the repository.
- **Once that layer is gone** (verified in a settled session): she can compose a real multi-surface workspace in the System environment, show it mounted and visible, select a surface by pressing it — including its chart body — revise it in place with the revision advancing once, save it, survive a full reload, and restore it with the exact same surface IDs, content and revision numbers.
- **On a phone** she can present that workspace as a scrolling column that stays inside 390/375/430-wide viewports, but 360×640 clips, and touch selection has not been demonstrated.
- **She cannot yet be shown to think with a live model in this build**, continue a task after restore, browse, engineer, speak, or work on Sapiolingo/3D/Earth Core: those were not exercised, and this report does not claim them.

That is the honest state: the workspace, revision and persistence spine is real and proven; the first minute with a new user is still broken by the sign-in gate; and live cognition is unproven in this session.
