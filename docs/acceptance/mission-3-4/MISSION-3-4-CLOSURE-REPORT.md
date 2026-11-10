# MISSION 3.4 — LIVING ENVIRONMENT RENDERING, SURFACE MOUNTING & POST-RESTORE COGNITION
## Closure report

Branch: `claude/mission-3-4-surface-rendering`
Base: `de2687e` (Mission 3.3 tip)
Date: 2026-11-08
Status: **PARTIALLY COMPLETE** — rendering, identity, save and restore-into-DOM are proven; post-restore *mutation* and pointer selection are not, for reasons recorded in §22.

Every classification below is `PASS`, `PARTIAL`, `FAIL`, `BLOCKED` or `NOT TESTED`, with the evidence file that supports it.

---

## 1. Starting branch, SHA and working-tree state — PASS

| Item | Observed |
| --- | --- |
| Shared worktree | `68fd4f9`, 5 pre-existing modified paths, left untouched |
| Mission 3.3 worktree (`wt-live`) | clean at `de2687e` before edits |
| Remote `claude/mission-3-3-live-continuity` | `de2687e` |
| Remote `claude/mission-3-2-...` | `2690408` |
| Remote `claude/master-integration` | `ce768e08` |
| Ancestry | `2690408` is an ancestor of `de2687e` |

The five original paths in the shared worktree were never staged, edited or reset. Mission 3.4 work happened only inside `wt-live`.

## 2. Mission branch and final SHA — PASS

`claude/mission-3-4-surface-rendering`, created at `de2687e` (no branch, commit or ref outside this one was moved). Final commit SHA is recorded in the hand-off message and in `git log -1`.

## 3. Canonical SHA before and after — PASS

Before `ce768e08`, after `ce768e08` (unchanged). Mission 3.4 never wrote to `claude/master-integration`, never merged, never force-pushed.

## 4. Mission 3.3 ancestry and evidence preservation — PASS

* Tag `m3.3-checkpoint` → `de2687e` created before any edit.
* Mission 3.3 evidence under `docs/acceptance/mission-3-3-live-continuity/` is untouched (snapshots `snapshot-mw8c7qrp`, `snapshot-mw8cao1i`, seven view IDs).
* Mission 3.4 adds a new directory only; no 3.3 file is modified.

## 5. Rendering-pathway root-cause analysis — PASS

Traced path: model tool call → `ToolDispatcher` → `EnvironmentOrchestrationEngine` → `WorkspaceEngine` → state → presentation adapter → `LivingSystemUI` → React → DOM.

Findings at each boundary:

1. **Data produced** — `WorkspaceEngine.getState().views` contained the composed views correctly (verified by importing the live singleton in the page).
2. **Owner** — `WorkspaceEngine` (singleton). Unchanged, single instance.
3. **Hand-off** — `LivingSystemUI` subscribes to the workspace store; it was correct.
4. **Render trigger** — `GenesisScene.tsx` mounts `LivingSystemUI` only when `surface.cosmosRendered && visualState.interfaceFocus === "visual"`.
5. **What prevented mounting** — the tested application path boots the v1 workspace with `interfaceFocus: "genesis"`, so the surface layer was **never mounted at all**. There was no `[data-workspace-view]` because there was no host element — not because rendering failed.
6. **Restored state delivery** — `restoreSnapshot` re-opened persisted views, but (a) it did not request the visual surface, and (b) views were re-opened through `openView`, which hardcoded `revision: 1`, discarding saved revisions.

**Conclusion: the engine was never broken. Two connections were missing — the scene/interface hand-off, and the revision field on the restore path.**

## 6. Files changed and why — PASS

| File | Change | Why |
| --- | --- | --- |
| `src/core/workspace/WorkspaceEngine.ts` | optional `revision?: number` on `upsertView` / `openView` inputs; new views use `input.revision ?? 1` | let an authoritative stored revision be restored instead of being reset to `1` |
| `src/core/orchestrator/EnvironmentOrchestrationEngine.ts` | import `VisualEngine`; new private `presentWorkspace()` that dispatches the **existing** `genesis-show-surface` `{panel:"visual"}` event (idempotent, guarded for non-browser); called after `composeEnvironment`, after `persistToStorage()` in `mutateSurface`, and in `restoreSnapshot`; `restoreSnapshot` now passes `revision: view.revision` | request the real presentation layer through the channel chat/voice already use — no new renderer, no second engine, no new registry |

No second `WorkspaceEngine`, no second `EnvironmentOrchestrationEngine`, no parallel store, no demo surfaces, no screenshot-as-UI. `LivingSystemUI` and `GenesisScene` were **not** modified.

## 7. LivingSystemUI mounting evidence — PASS

`docs/acceptance/mission-3-4/retry-compose.json`, `chain3.json`, `chain4.json`.

| Stage | `interfaceFocus` | `[data-workspace="lelu-system"]` host | `[data-workspace-view]` count |
| --- | --- | --- | --- |
| Boot (before any environment turn) | `genesis` | absent | 0 |
| After model `environment_compose -> ok` | `visual` | present | 5 |
| Fresh boot (new browser process) | `genesis` | absent | 0 (engine: 2 default views) |
| After model `environment_restore_state -> ok` | `visual` | present | 5 |

Mounting is owned by the existing hierarchy (`GenesisScene` → `LivingSystemUI` → `SystemWorkspace`); the change only requests the focus the existing controller already implements.

## 8. Engine-to-DOM surface identity mapping — PASS

Captured from `chain2.json` (compose) and `chain4.json` (restore). Engine IDs are from the live `WorkspaceEngine` singleton; DOM IDs are the `data-workspace-view` attributes.

| Engine surface ID | DOM surface ID | Revision (engine) | `data-revision` (DOM) | Title | Rendered & visible |
| --- | --- | --- | --- | --- | --- |
| `view-executive` | `view-executive` | 1 | 1 | Lélu · Live Execution | yes |
| `view-providers` | `view-providers` | 8 | 8 | Providers | yes |
| `view-memory` | `view-memory` | 3 | 3 | Memory | yes |
| `view-3f851b81` | `view-3f851b81` | 1 | 1 | Notes Workspace | yes |
| `view-71170c30` | `view-71170c30` | 1 | 1 | Research Board | yes |

5 engine views, 5 DOM nodes, **1:1, no duplicates, no phantom DOM surfaces without engine ownership**. Same mapping after restoration (`chain4`: providers r9, memory r4, both composed views r1).

## 9. Rendered surface count and visibility measurements — PASS

From `retry-compose.json` (1440×900, real `getBoundingClientRect`):

| View | Box (x, y, w×h) | Visible |
| --- | --- | --- |
| `view-providers` | 374, 108, 462×416 | true |
| `view-memory` | 58, 162, 302×302 | true |
| `view-46770120` Notes Workspace | 58, 468, 302×65 | true |
| `view-423838f6` Research Board | 720, 576, 302×65 | true |
| `view-executive` | 1037, 144, 302×65 | true |

All non-zero, inside the viewport, none clipped to zero area. Screenshots: `shots/d1-composed.png`, `shots/f1-restored.png`.

## 10. Revision before-and-after measurements — PARTIAL

* Root cause found and fixed in code: `openView` hardcoded `revision: 1`; restore now passes the stored `revision` (`WorkspaceEngine` accepts it).
* Authoritative increment path confirmed: `WorkspaceEngine.updateView` increments when `changesContent` — covered by the configured suite's workspace-engine tests (all passing).
* DOM `data-revision` equalled engine revision in **every** capture, including restored values (`view-providers` r8→r9/r11 across restores, `view-memory` r3→r4), i.e. **restored revisions are no longer reset to 1**.
* **Not proven live:** a model-issued `mutate_surface` turn followed by an observed increment. Every attempt to run that turn was refused upstream (see §22). No revision value was manufactured in the UI to mask this.

## 11. Save and snapshot evidence — PASS (pathway), with one notation

`chain2.json`: `EnvironmentOrchestrationEngine.saveSnapshot` produced `snapshot-mw8ddug9` containing all five views with their revisions (`view-executive:1, view-providers:8, view-memory:3, view-3f851b81:1, view-71170c30:1`), persisted under `lelu.environment.snapshots`. Save was invoked **through the engine's own pathway** (not a model turn, and not a UI hack); Mission 3.3 already proved the model-selected `save_state` tool, and `saveSnapshot` is the method that tool calls.

Notation: called with `{name, category}`, the stored `name` field recorded that object rather than the string label (“field-lab-v1”). This is an argument-shape detail of the direct call, not a state-integrity problem: the snapshot id, environment and per-view revisions are correct. The model tool path passes the expected shape.

## 12. Fresh-process boot evidence — PASS

`chain3.json`, `chain4.json`: a **new browser process** (persistent profile, new Chrome instance, fresh page) boots with `interfaceFocus: "genesis"`, no `[data-workspace]` host, 0 `[data-workspace-view]` nodes, and only the 2 default engine views (`view-executive`, `view-providers`). Expected default state confirmed before restoration.

## 13. Restore evidence — PASS

| Run | Model tool call | Latency | Snapshot |
| --- | --- | --- | --- |
| `chain3.json` | `environment_restore_state -> ok` | 37.0 s | `snapshot-mw8ddug9` |
| `chain4.json` | `environment_restore_state -> ok` | 38.1 s | `snapshot-mw8ddug9` |

The restore was selected by the external model (Groq, `openai/gpt-oss-20b`) from a natural-language request and executed by the production `ToolDispatcher`. No executor was called by hand for these turns.

## 14. Post-restore DOM rendering evidence — PASS

`chain3.json` / `chain4.json`, immediately after the model restore:

* `interfaceFocus`: `visual`
* host `[data-workspace="lelu-system"]`: present
* DOM count **5** = engine count **5**
* IDs identical to the saved environment: `view-executive`, `view-providers`, `view-memory`, `view-3f851b81`, `view-71170c30`
* revisions restored (no reset to 1): `providers r9/r11`, `memory r4`, composed views `r1`
* all nodes `visible: true` with real boxes
* no stale pre-reload components: the process was terminated and restarted, so nothing survived except localStorage snapshots

**Restored engine state *and* restored visible surfaces.**

## 15. Genuine model continuation traces — PARTIAL

* Model turns that succeeded, all through the real provider stack with production tool contracts: `environment_compose -> ok` (×3), `environment_restore_state -> ok` (×2).
* **Not completed:** a follow-up `mutate_surface` turn on the restored environment. Five attempts were made with progressively cheaper prompts (separate turn, chained turn, combined single-message restore+mutate). The final attempt returned **no tool call at all**; upstream refused with `Groq failed 413: Request too large` and `GitHub Models returned no usable content` (`chain5.json`).
* No scripted responses were injected and no mock provider was used; the failure is a provider-capacity failure, so the gate stays PARTIAL rather than being papered over.

## 16. Tool-selection and dispatcher evidence — PASS (for the turns that ran)

`[ProviderResolver] Tool environment_compose -> ok` and `[ProviderResolver] Tool environment_restore_state -> ok` are emitted by the production dispatch path after the model returns `tool_calls`; the resulting engine state and DOM mutations are the observable result. Tool contracts used unchanged: `environment_compose`, `restore_state{snapshotId}`, `mutate_surface{viewId,title,text}`.

## 17. Pointer interaction evidence — FAIL (capability absent, documented, not imitated)

Real `page.mouse.click` at the centre of `view-3f851b81` (a mounted, visible 302-wide surface), then read back:

* all five DOM nodes: `data-selected="false"`
* engine `WorkspaceEngine.getState().selectedId`: `null`

Clicking a mounted surface does not select it. The attribute exists and is wired to engine state, but no pointer handler promotes a click to selection in this surface layer. Per mission rules this is reported as an unsupported behaviour rather than imitated with a synthetic class toggle. Focus/reposition/resize are likewise not claimed. Content interaction was exercised only at the level of engine-driven text (surfaces render title/text from engine state).

## 18. Desktop and mobile viewport evidence — PARTIAL

* Desktop 1440×900: 5 mounted, visible surfaces with the boxes in §9. PASS.
* Mobile 390×844 (`shots/e3-mobile.png`, `shots/d3-mobile-restored.png`): after the viewport change the `[data-workspace-view]` query returns **0 nodes** in both runs, i.e. the system workspace does not present these surfaces in the small-viewport layout (or swaps to a layout without them). Conservatively: **mobile surface presentation NOT TESTED / failing to present**. This was browser-emulated viewport resizing, not a physical device.

## 19. Full test results — PASS

`bun run test` (the configured runner — not `bun test`), exit `0`:

```
ℹ tests 1838
ℹ suites 15
ℹ pass 1832
ℹ fail 0
ℹ cancelled 0
ℹ skipped 6
ℹ todo 0
ℹ duration_ms 230250
EXIT=0
```

Identical to the Mission 3.3 baseline (1838 / 1832 / 0 / 6). No test deleted, skipped, weakened or re-thresholded; no new test file was added by this mission.

## 20. Build, lint and typecheck results — PASS (with one measured delta)

| Check | Result |
| --- | --- |
| `bunx tsc -b --force` | exit 0, 0 errors |
| `bunx oxlint` | exit 0, **0 errors**, **136 warnings** (1233 files, 251 ms) |
| `bun run build` | exit 0 (only the pre-existing >500 kB chunk advisory) |

Note: the historical Mission 3.3 lint count was 134 warnings; this run reports 136. Errors remained 0 in both. The delta is recorded here rather than rounded away.

## 21. Screenshots and sanitized logs — PASS

```
docs/acceptance/mission-3-4/
  MISSION-3-4-CLOSURE-REPORT.md
  probe-system-scene.json  verify-mount.json  retry-compose.json
  full-chain.json  chain2.json  chain3.json  chain4.json  chain5.json
  scripts/{probe-system-scene,verify-mount,retry-compose,full-chain,chain2,chain3,chain4,chain5}.mjs
  shots/{probe-system,r1-compose,r2-mobile,v1-after-compose,v2-mobile,v3-after-mutate,
         c1-composed,d1-composed,e1-restored,e3-mobile,f1-restored}.png
```

Logs contain provider names, model ids, tool names, latencies and rate-limit reasons only. No API keys, `Authorization` headers, tokens or cookies. No `git` credentials captured.

## 22. Remaining blockers and unsupported capabilities

1. **Post-restore `mutate_surface` (BLOCKED by provider capacity).** Groq: `429 TPM 8000` on `gpt-oss-120b`/`gpt-oss-20b`, then `413 Request too large`; GitHub Models: `returned no usable content` (upstream answers `OK\r\n`); OpenRouter: `429`. One cognition turn costs 35–56 s and 4k+ tokens, so consecutive turns inside a single 5-minute shell window cannot both be scheduled. Anthropic stays disabled.
2. **Pointer selection (FAIL — unsupported).** Click on a mounted surface leaves `data-selected="false"` and engine `selectedId: null`. Presented as a genuine capability gap.
3. **Mobile surface presentation (NOT TESTED).** 390×844 viewport yields zero `[data-workspace-view]` nodes.
4. **Revision under restore is monotonic, not identical** to the saved value (`providers` saved r8, restored r9/r11 across runs, varying). IDs are exact; revisions never regress to 1. If bit-exact revision parity on restore is a requirement, the remaining write path that touches revisions during restore needs its own trace — deliberately not "fixed" blind.
5. **Snapshot name label** recorded as the argument object in the direct `saveSnapshot` call (§11).

## 23. Final merge recommendation — DO NOT MERGE YET

The mission's central claim is now true and reproducible: a model-created environment and a model-restored environment **both appear as real mounted surfaces with matching engine identity**, and restoration survives a full process restart with the presentation restored. The change is 2 files, ~25 lines, reuses the existing channel, and leaves the suite, typecheck, lint and build green.

Two completion criteria are unmet: a model-driven mutation of the restored environment with an observed revision increment, and pointer interaction. Merge recommendation: **hold** until the continuation turn runs once on a provider with headroom (or a throttled retry schedule), and until selection is either implemented or formally declared out of scope for this surface layer.

---

### Gate summary

| # | Section | Classification |
| --- | --- | --- |
| 1 | Starting state | PASS |
| 2 | Mission branch/SHA | PASS |
| 3 | Canonical unchanged | PASS |
| 4 | 3.3 ancestry preserved | PASS |
| 5 | Root-cause analysis | PASS |
| 6 | Files changed | PASS |
| 7 | LivingSystemUI mounting | PASS |
| 8 | Engine↔DOM identity | PASS |
| 9 | Visibility measurements | PASS |
| 10 | Revision increment (live) | PARTIAL |
| 11 | Save/snapshot | PASS |
| 12 | Fresh-process boot | PASS |
| 13 | Restore (model-selected) | PASS |
| 14 | Post-restore rendering | PASS |
| 15 | Post-restore continuation | PARTIAL |
| 16 | Tool selection/dispatch | PASS |
| 17 | Pointer interaction | FAIL (unsupported) |
| 18 | Desktop / mobile | PARTIAL |
| 19 | Test suite | PASS |
| 20 | Build/lint/typecheck | PASS |
| 21 | Evidence package | PASS |
| 22 | Blockers | recorded |
| 23 | Merge recommendation | HOLD |

**Mission 3.4: PARTIALLY COMPLETE — rendering, identity, save and restore-into-DOM proven; post-restore mutation and pointer selection unproven, with the exact blocker recorded.**
