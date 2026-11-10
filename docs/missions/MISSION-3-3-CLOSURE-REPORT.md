# MISSION 3.3 — Live Model Continuity, Persistence & Regression Closure

Date: 2026-11-08 · Branch: `claude/mission-3-3-live-continuity` · Base: `2690408` (Mission 3.2)

---

## 1. Baseline (verified before any change)

| Item | Value |
|---|---|
| Starting branch | `claude/mission-3-2-live-model-tool-execution` @ `2690408` |
| Mission 3.3 branch | `claude/mission-3-3-live-continuity` @ `2690408` |
| Checkpoint tag | `m3.2-checkpoint` → `2690408` |
| Remote 3.2 tip | `2690408` (`ls-remote`, verified) |
| Canonical `claude/master-integration` | `ce768e08` — untouched |
| Shared worktree | `claude/m52-acceptance-completion` @ `68fd4f9`, 4 dirty paths + untracked `wt-live/` preserved |

The shared worktree was never reset, cleaned or absorbed. Mission 3.2 evidence is
byte-for-byte intact.

**Correction to my own first attempt:** an early git call omitted `-C wt-live` and
read the shared worktree instead. The checkout was refused by git (local changes),
so nothing was switched or lost; the branch was then created correctly in `wt-live`.

---

## 2. Files changed and why

**No production source file was changed in this mission.** The single reported
"regression" was a test-runner mismatch, not a product defect (§4), so the correct
repair was to verify with the project's own runner rather than edit code or tests.

Added (evidence only): `docs/acceptance/mission-3-3-live-continuity/` (JSON traces,
scripts, screenshots) and this report.

---

## 3. Regression reproduction

Reproduced exactly as reported, with the runner I had used in Mission 3.2 (`bun test`):

- `bun test tests/cognitive-behavior.test.ts tests/api-ecosystem.test.ts` → **40 pass, 2 fail**,
  `[test] outbound network call blocked: http://127.0.0.1:PORT/api/sources/discover`.
- `bun test tests/chat-transcript.test.ts` → **0 pass, 1 fail**,
  `ENOENT … /src/app/scene/genesis/chat/chatTranscript.tsx`.

---

## 4. Repair and root cause — regression **PASS**

The project's authoritative command is `bun run test` =
`tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs --test --test-concurrency=1 …`.

| Run | Command | Result |
|---|---|---|
| Targeted trio | project runner | exit 0 |
| Full suite | `bun run test` | **1838 tests, 1832 pass, 0 fail, 6 skipped** (210 s) |
| Full suite | `bun test` (wrong runner) | 1845 tests, 53 fail |

Root cause of the 53: `bun test` is not this suite's runner. It resolves
`…/chat/chatTranscript` to a `.tsx` specifier that does not exist (the `ENOENT`), and it
does not honour `--test-concurrency=1`, so `tests/cognitive-behavior.test.ts`'s deliberate
`globalThis.fetch` throw-stub stays installed for later files — `api-ecosystem.test.ts`
alone is 18/0, and fails only when contaminated. Under the project runner each file is
isolated and the guard never leaks.

**No test was deleted, skipped, weakened, or filtered.** The 6 skips are the same
environment-conditional skips recorded before (baseline 4 skips on the 3.1 lineage; the
2.15.6/5.6 lineage adds 2 more). The +8 test count versus Mission 3.1's 1830 comes from
the merged 5.5/5.6 lineage, so the totals are not a like-for-like comparison.

---

## 5. Typecheck / lint / build

- `bunx tsc -b --force` → **exit 0**
- `bunx oxlint` → **exit 0, 0 errors**, 134 pre-existing warnings
- `bun run build` → **exit 0** (`✓ built in 7.71s`; one pre-existing chunk-size warning)

---

## 6. GitHub Models broker — final classification: **BLOCKED**

Unchanged from Mission 3.2 and re-confirmed: `POST /api/model/githubModels/chat/completions`
returns `200` with a four-byte body `OK\r\n`; the same stub is returned by the upstream host
**with no Authorization header at all**, while OpenAI/Anthropic/Groq answer genuine `401`s
from this host. `GitHubModelsProvider` surfaces it as "returned no usable content".

Classification: **infrastructure limitation, not a credential or code defect.** No model
content, no usage metadata, no tool calls are obtainable through that path here. Groq was
used for all live acceptance work. Anthropic remained disabled (`anthropic:false`).

---

## 7. Turn 1 — creation trace: **PASS**

Prompt typed with real pointer/keyboard input into `.lcu textarea` after the sign-in gate
was settled and detached:

> "Create a studio environment titled Research Studio with three surfaces: a central
> workspace, a research area, and a presentation area."

Model-selected tools, dispatched by the existing `ToolDispatcher` (console trace):

```
[ProviderResolver] Tool environment_compose          -> ok
[ProviderResolver] Tool environment_present_artifact -> ok
[ProviderResolver] Tool environment_save_state       -> ok
```

Surfaces created (engine state read from the live app):

| View ID | Title | Kind | Revision |
|---|---|---|---|
| `view-655cb8be` | Central Workspace | workspace | 1 |
| `view-4da30a7e` | Research Area | research | 1 |
| `view-1ad7ea82` | Presentation Area | presentation | 1 |
| `view-ac62bd07` | Research Studio | browser | 1 |

---

## 8. Turn 2 — modification trace: **PASS**

> "Change the surface view-655cb8be ('Central Workspace') so its text reads 'Research Board:
> sources, notes and open questions.' and its title reads 'Research Board'."

```
[ProviderResolver] Tool environment_mutate_surface -> ok
```

Same view ID, changed identity: the restored state later reads `view-655cb8be` →
**"Research Board"**. No duplicate view was created (the view count stayed 7).

---

## 9. Turn 3 — save trace: **PASS**

> "Save the current environment state as a snapshot named studio-v1."

```
[ProviderResolver] Tool environment_save_state -> ok
```

Snapshot `snapshot-mw8cao1i` ("studio-v1", 7 views) written. `environment_compose`'s own
`save_state` had already produced `snapshot-mw8c7qrp` ("Research Studio v1", 7 views).

---

## 10. Persistence evidence — **PASS (local)**

`localStorage["lelu.environment.snapshots"]` after a **fresh browser process** (new
Chromium launch, same profile — exactly what a reload leaves behind):

```json
[{"id":"snapshot-mw8c7qrp","name":"Research Studio v1","viewCount":7},
 {"id":"snapshot-mw8cao1i","name":"studio-v1","viewCount":7}]
```

Both snapshots contain the identical 7 view IDs, including the mutated
`view-655cb8be`. `WorkspaceEngine` itself is in-memory (no `lelu.*` workspace key), so
views correctly did **not** survive on their own — only the snapshot did.

---

## 11. Reload / restore trace: **PASS**

- Fresh boot engine state: `["view-executive", "view-providers"]` only.
- Model turn: `Restore the saved environment snapshot snapshot-mw8cao1i.` →
  `[ProviderResolver] Tool environment_restore_state -> ok`.
- After restore: `["view-executive","view-providers","view-memory","view-655cb8be","view-4da30a7e","view-1ad7ea82","view-ac62bd07"]`
- `sameIdsRestored: true` — byte-identical ID list to the pre-reload state.

Scope: **local persistence only.** No cross-device or server-side sync was tested or claimed.

---

## 12. Continuation after restore: **NOT TESTED**

The fifth turn (a model-directed mutation on the restored environment) was cut off by the
5-minute command ceiling before it ran. Restore succeeded and the restored state is live;
"continues working on the restored environment" is therefore **unproven**, not claimed.

---

## 13. Revision behaviour: **PARTIAL**

`mutate_surface` returned `ok` and the change is present in the snapshot, but the observed
`revision` on the mutated view is **1** both before and after restore — no increment was
observable through this path. Revision-increment correctness remains unproven.

---

## 14. Cosmos rendering and pointer interaction: **PARTIAL**

- Surfaces exist in the real engine with real IDs, kinds and revisions (§7).
- `[data-workspace-view]` elements were **empty** in every capture, including at 390×844,
  so the surface layer did not paint during these runs; screenshots therefore show the
  chat/Cosmos shell, not the composed surfaces.
- Real pointer input was used for every chat interaction (drag on the frontmost window
  moved it 88,64 → 104,84 in the first run). A pointer click **on a composed surface**
  could not be performed because no `[data-workspace-view]` element was rendered.
- Browser-emulated viewports only; no physical device was tested.

This is the single largest remaining gap and it is reported as PARTIAL, not PASS.

---

## 15. Duplicate-action / failure recovery: **PARTIAL**

Mission 3.2 captured a genuine post-tool 429 where the completed `environment_compose` was
**not** re-run on another provider (`ran: Array(1)`), the user was told what succeeded and
what did not, and no duplicate environment appeared. In this mission, five turns produced
exactly one set of view IDs — no duplication across create/mutate/save/restore. A
deliberately simulated failure matrix (invalid args, dispatcher throw, renderer failure)
was **not** run.

---

## 16. Command list (reproducible)

```bash
cd wt-live
bun run test                                   # 1838 tests, 1832 pass, 0 fail, 6 skipped
bunx tsc -b --force                            # exit 0
bunx oxlint                                    # 0 errors
bun run build                                  # see §5
bunx vite --port 4318 --strictPort --host 127.0.0.1   # dev server
node docs/acceptance/mission-3-3-live-continuity/scripts/continuity-full.mjs
node docs/acceptance/mission-3-3-live-continuity/scripts/restore-continue.mjs
```

---

## 17. Evidence files

`docs/acceptance/mission-3-3-live-continuity/`
- `continuity-full.json` — turns 1–3: prompts, tool traces, view state, snapshot IDs.
- `restore-continue.json` — fresh boot, persisted snapshots, restore trace, ID comparison.
- `live-a.json`, `live-a-run1.json` — earlier runs (including the mis-targeted first attempt).
- `scripts/continuity-full.mjs`, `scripts/restore-continue.mjs`, `scripts/live-continuity.mjs`.
- `shots/` — t1 create, mobile 390×844, mutate, save, restore.

No credentials, authorization headers, secret values or private user data are present.

---

## 18. Acceptance matrix

| Gate | Result | Basis |
|---|---|---|
| Regression green without weakened tests | **PASS** | project runner 1838/1832/0/6; tsc 0; lint 0 errors |
| Real model creation via production tool loop | **PASS** | compose + present_artifact + save_state, all `ok` |
| Real model inspection of created environment | **PARTIAL** | model snapshot tools (`save_state`) ran; no dedicated inspect tool exists |
| Real model modification, same environment | **PASS** | `mutate_surface -> ok` on `view-655cb8be`, no duplicate |
| Environment/surface identity preserved | **PASS** | identical 7 IDs before reload and after restore |
| Revision increments correctly | **PARTIAL** | change persisted; increment not observed |
| Persistence survives reload/restore | **PASS (local)** | snapshots in KvStore; fresh-process restore |
| Real model turn continues restored environment | **NOT TESTED** | cut off by command ceiling |
| Cosmos renders and responds to pointer input | **PARTIAL** | engine state real; `[data-workspace-view]` never painted |
| Provider failure does not duplicate mutations | **PARTIAL** | 3.2 429 evidence + no duplication here; matrix not run |
| Build, lint, typecheck | **PASS** | see §5 |
| Evidence committed and remotely verified | **PASS** | see §20 |

---

## 19. Remaining blockers and untested claims

1. **Surface rendering.** `[data-workspace-view]` was empty in all runs; without it, D and
   pointer-interaction proof cannot pass. Next step: find why the surface layer did not
   mount (lazy `LivingSystemUI`, or the composed views being opened while the chat dialog
   owns the scene) — a real rendering question, not a test artifact.
2. **Continuation turn** after restore (cut off by the 5-minute shell ceiling; needs its own run).
3. **Revision increment** on `mutate_surface`.
4. **GitHub Models** remains blocked by the upstream stub (infrastructure).
5. Cross-device persistence: not implemented/tested here; not claimed.

---

## 20. Final branch and merge recommendation

- Branch: `claude/mission-3-3-live-continuity`
- Base: `2690408`; Mission 3.2 preserved at `2690408`; canonical `ce768e08` untouched.
- Recommendation: **PARTIALLY COMPLETE — not yet safe to merge.** The regression is genuinely
  closed and creation → modification → save → reload → restore → identical IDs is proven
  with real model-selected tools; rendering of the composed surfaces and the continuation
  turn remain unproven.
