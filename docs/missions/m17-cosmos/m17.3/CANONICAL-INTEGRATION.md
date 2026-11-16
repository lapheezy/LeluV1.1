# M17.3 → canonical integration (`integration/lelu-four-workforce-consolidation`)

Integration and runtime-validation record for bringing the completed M17.3
Spatial Intelligence and World Continuity delivery into the canonical
four-workforce branch. No new features; two defects were fixed, both
described below with their evidence.

## 1. Refs (independently re-checked, full history — the clone was unshallowed first)

| | SHA |
|---|---|
| M17.3 delivery (`claude/intelligent-lovelace-5l7zoz`) | `1590aec61f541e5980fe85b69740b32d3e41560a` (unchanged, not rewritten) |
| Canonical start (`integration/lelu-four-workforce-consolidation`) | `d8fb056b66f1d6906e71ad4e89c98c57beb19d1a` |
| Merge base (the only one) | `8101ec2bd55b114d2bc8381d3ed6dd7f4af52d3a` |

* 70 commits on the M17.3 lineage absent from canonical (60 commits + 10 merges); 3 canonical-only commits. Matches the reported 70/3.
* Diff `canonical...M17.3`: **819 files, +153,610 / −1,052**. GitHub's compare page reported 300 files / +121,383 / −114: its file list is capped at 300 files, so its totals are partial. The real figures are the ones above.
* `git cherry`: 0 of the 70 commits are patch-equivalent to anything in canonical, and none of the 3 canonical commits are in the M17.3 lineage — no work is duplicated under another SHA.
* `claude/charming-hamilton-icbyrb` has 11 further commits (M15.3) that are NOT in the M17.3 lineage; they are out of scope and were not merged. Freebuff's WP06 branch was not touched.

## 2. Strategy

One `--no-ff` merge of `1590aec` into canonical. The lineage already contains
its own reconciliation merges (Freebuff consolidation, Creative Kit, master
integration, VoxCPM2 reconciliation, Home Studio); cherry-picking 70 commits
would have re-resolved those and discarded their recorded decisions. The merge
keeps both histories and both parents verbatim.

## 3. Canonical-only commits (all preserved as ancestors of the result)

| Commit | Subject | Preserved |
|---|---|---|
| `1cfd498` | Open the Cosmos, and let the camera find what is in it | yes — with one semantic reconciliation (C6) |
| `4ea29fc` | Make the Cosmos objects visible, touchable and redrawn | yes |
| `d8fb056` | Put objects where they can be seen: fix the ring's depth and normalize old placements | yes |

## 4. M17.3 implementation commits

| Commit | Work package |
|---|---|
| `1fefa62` | WP01 spatial intent (spatialIntent.ts, CosmosObjectStore.match, cosmos.object.position relation/direction/degree, DirectResolver object-vs-window routing) |
| `f67653c`, `5368f03` | WP02 world continuity (InterfaceJourney stops a 3D region being left at the jump) |
| `3c7ea1a`, `1590aec` | WP03 regression and acceptance evidence |

Earlier unmerged mission work carried by the same lineage (all new to
canonical): Workspace Steward / Chat Universe stages, Freebuff workforce
consolidation, Creative Kit acceptance, Chat Universe environments and
workflows, master integration, Mission 15 Home Universe, M17/M17.1 interface
ecosystem, Home Studio + spatial bar, M17.2 Neural Map. Full ledger in §11.

## 5. Conflict inventory and resolution

Textual conflicts (4 files) — all are two sides extending the same Cosmos object authority:

| # | File | Canonical side | M17.3 side | Resolution |
|---|---|---|---|---|
| C1 | `CosmosObjectStore.ts` (transform) | `opts.history` (one undo step per drag); `setHazards` / `relocate` added above | `note` / `ref` provenance on a transform | Both: one signature `(id, change{…, note, ref}, opts{history})`; provenance records `note`/`ref`; commit honours `history`. `"transformed"` remains in `MOVED_ACTIONS`, so canonical's legacy-placement normalisation still leaves user-moved objects alone. |
| C2 | `CosmosObjectTools.ts` (schema) | new `side` parameter (left/right/up/down/front/behind) | `relation` / `direction` / `degree` / `distance` | M17.3's schema is the single model; `side` kept as a documented alias mapped onto the matching `relation`, so canonical-contract callers keep working. |
| C3 | `CosmosObjectTools.ts` (run) | `store.resolve` (newest partial match) + per-side offsets; relative scale = factor | ambiguity-safe `pick()` via `store.match`; `placeRelative` / `placeDirection`; "already there" | M17.3's resolution and placement (one placement implementation, no guessing); canonical's relative-scale semantics kept (`scale` computed once and passed through). |
| C4 | `DirectCompiler.ts` (cosmosPlan) | its own `side` regex + `near` regex for relative moves | `parseSpatialIntent` (one parser) | One parser: `parseSpatialIntent`. Canonical's duplicate regexes removed; the step carries canonical's `side` word as well for the six directional relations, so canonical's test (`args.side === "left"`) holds unchanged. Canonical's `/cosmos` argument commands, open/close/undo/redo/frame/relocate sentences and numbered turns are untouched and run before it. |
| C5 | `CosmosObjectsLayer.tsx` (controls) | Bring out / Only this / Duplicate / Take out / Take a part… / Remove / Done | adds "Neural" (opens the object's Neural Map card) | Canonical's list + M17.3's "Neural" button. |

Semantic conflict (auto-merged by git, found by the M17.1 browser run):

| # | Where | Problem | Resolution |
|---|---|---|---|
| C6 | `GenesisInterface.tsx` | Canonical `1cfd498` unmounted the Chat Universe whenever `HomeStore.immersive`. M17.1/M17.3 set `immersive` for every interface composition and the Cosmos interface, and reach the conversation from there through the Universe's own `lelu-open-universe` event — whose listener lives inside the Universe. Merged, that event was silently dropped: the interfaces' "Talk to LÉLU (same chat)", Home's draft hand-off and chat-from-a-composition did nothing (`verify-interfaces` crashed at O04 waiting for the Chat Universe). | The Universe stays mounted. Canonical's guarantee is kept by its own mechanism: entering the Cosmos (dock or `cosmos.view.open`) closes the Universe's open flag and a closed Universe renders `null`, so nothing is drawn over the scene (verified: 0 Universe dialogs in the DOM inside the Cosmos; the conversation is back after "‹ Back"). |

Auto-merged shared files reviewed with no change needed: `AIRouter.ts`
(M17.3's spatial-bar route first; canonical's `cosmos.(object|view).*`
construction rule), `CosmosObjectTypes.ts` (M17.2 `ref` field), the rest of
`GenesisInterface.tsx` (Workspace Steward handlers + `CosmosObjectsDock`).

Architecture after the merge: one `CosmosObjectStore`, one placement
implementation (`spatialIntent`), one parser for spatial sentences, one
dispatcher (`cosmos.object.*` / `cosmos.view.*` via `registerExecutor`), the
Neural Map remains a derived index (it reads `ref` from provenance, writes
nothing). No dependency was added; `package.json` / `bun.lock` are identical
on all three refs. No LangChain/LangGraph, no Anthropic call (checked in the
browser runs), Supabase blocked in every browser run without loss of core
function.

Known overlap left as is: canonical's Cosmos-objects dock reads the same
`immersive` flag, so it is also mounted (beneath the composition shell, not
visible in any screenshot) while an M17.1 composition is open.

## 6. The red CI on `1590aec` (run 43870715761)

Both failing jobs failed identically on the FIRST run of this lineage
(`cd27328`, M17.1, run 43786387073) — before any M17.2 or M17.3 code — so
neither is an M17.3 regression. Each failure was reproduced locally.

### Unit-test job — 10 failures (`resource-sandbox`, `sandbox-security`, `capability-ledger`)

* **Classification: existing baseline failure; actual product defect, exposed by the environment.**
* Mechanism: the resource sandbox isolates downloaded code with `unshare -rn`. Where that is not permitted (GitHub's Ubuntu runners), it falls back to an in-process `NETWORK_GUARD`. That guard replaced `net.Socket` while still importing the remaining modules; `node:tls` extends `net.Socket` at load, so every sandboxed child crashed on start (`Class extends value … is not a constructor`). It is not a Node 24 issue: the same crash reproduces on Node 22 and Node 24.
* Reproduced locally by shadowing `unshare` with a failing shim: exactly **10 failures**, the CI set. With a working `unshare`: 21/21.
* The guard also left `node:dns/promises` un-guarded: a sandboxed `dns.lookup` **resolved** under the fallback (a real isolation gap).
* Fix (`plugins/resourceApi.ts`, guard text only): create stdio and import every network module first, then disable; also disable `dns.promises`. Result without `unshare`, on Node 22 and on Node 24: **20/21** (was 11/21); with `unshare`: 21/21. TCP, UDP, DNS (callback and promises), HTTPS and fetch are all denied under the fallback.
* Remaining 1 (documented, test not edited): `sandbox-security › network: TCP, UDP, DNS and fetch all fail`. Under the fallback guard `net.connect` / `dgram.createSocket` are denied by a synchronous throw; the attack scripts only print on an async `error` event, so they print nothing and the assertion `^denied:` fails although no packet leaves. Making it pass would mean emulating sockets that emit async errors inside the guard — a design change to the sandbox, not an integration fix. With `unshare` available it passes.

### Mobile model-cache job — 2 failures

* **Classification: test-harness defects; the product behaves correctly.** Reproduced locally against the production server (`bun run serve`): the same 17/19.
* "repeat visit still returns all the bytes … 51380224 vs undefined": `scripts/verify-mobile-model-cache.mjs:191` compares the repeat fetch with `first.bytesReceived`, but `first` is the page-visit object (`{page, errors, swReady}`); the first fetch's result is `original`. The page did receive all 51,380,224 bytes both times. This line has been wrong since the script was created (`82a0cd0`, Nov 1).
* "after storage is cleared the model is fetched in full again — 0.0 MB": `Storage.clearDataForOrigin({storageTypes:"all"})` does not clear Chromium's HTTP cache. The recorded network entry is a 387-byte 304 revalidation against the unchanged ETag — the correct behaviour for the server's `max-age=0, must-revalidate` policy.
* Independent proof: a scratch copy with only those two harness lines corrected (`original.bytesReceived`; `Network.clearBrowserCache` after the storage clear) passes **19/19** on the same build. The repo script was left unchanged; the two-line correction is recommended to the script's owner.

### The jobs that passed on CI
Install, lint, typecheck, production build and the bundle check also pass locally on the integrated tree (§7).

## 7. Results (integrated tree vs both branch baselines)

Baselines were run from clean `git archive` exports of each ref with the same
`node_modules` (no dependency differs between the refs). Node 22.23.4.

| Gate | Canonical `d8fb056` | M17.3 `1590aec` | Ancestor `8101ec2` | **Integrated** |
|---|---|---|---|---|
| Unit/integration suite (`bun run test`) | 2235 · 2228 pass · **1 fail** · 6 skip | 2300 · 2294 · 0 · 6 | 2210 · 2203 · **1 fail** · 6 | **2325 · 2319 · 0 · 6** |
| Typecheck (`tsc -b --force`) | — | 0 (recorded) | — | **0 errors** |
| Lint (`oxlint`) | 0 errors | 0 errors | — | **0 errors**; no warning that exists on neither side |
| Production build (`tsc -b && vite build`) | — | OK (recorded) | — | **OK** |
| Bundle has no tests (`verify-no-tests-in-bundle`) | — | — | — | **PASS** (1768 files) |
| CI `scripts/verify-*.ts` loop, no provider keys (as CI) | 22 pass · 16 fail · 1 exit-3 | 22 · 16 · 1 | — | **23 · 16 · 1** — identical failing set (all need a live provider, a UI host or Supabase); the merge additionally passes `verify-engineering-agent` |

The canonical/ancestor suite failure is `tests/genesis-interface.test.tsx`
(`ERR_PACKAGE_PATH_NOT_EXPORTED` for an Excalidraw CSS subpath at import) —
deterministic on those refs, resolved by the M17.3 lineage; it passes on the
integrated tree.

Sandbox suites under CI's condition (no `unshare`), Node 22 and Node 24: 11/21 before → **20/21** after the guard fix (§6).

## 8. Browser verification on the integrated tree (Chromium; desktop + iPhone *emulation*)

| Check | Result |
|---|---|
| M17.3 spatial (`scripts/cosmos/verify-spatial.mjs`) | **44/44 VERIFIED** |
| M17.3 world continuity (`verify-world-continuity.mjs`) | **35/35 VERIFIED** |
| M17.1 interfaces (`verify-interfaces.mjs`) | **71/71 VERIFIED** (M17.3 baseline on the same machine: 71/71). First run under load: crashed at O04 → fixed by C6; a later run 68/71 on the three Room→Cosmos checks was the script's fixed 3 s wait: measured settle time is 4.9–7.5 s merged vs 6.3–7.2 s on M17.3 alone; a clean re-run of each gave 71/71. |
| M17.2 Neural Map (`verify-neural-map.mjs`) | **28/28 VERIFIED** |
| M17.2 Neural embedded (`verify-neural-embedded.mjs`) | **61/61 VERIFIED** |
| Mission 15 Home (`scripts/home/verify-home.mjs`) | **35 VERIFIED + 1 PARTIAL** — same as its record |
| Mission 15.2 spatial bar (`verify-spatial-hidden.mjs`) | **19/19** |
| Mobile model cache (`verify-mobile-model-cache.mjs`, production server) | 17/19 — the two harness defects of §6; 19/19 with the harness corrected (scratch copy) |

These scripts rewrite their own committed evidence; their outputs from this
run were kept outside the repository and the committed M17.x evidence is unchanged.

## 9. Live runtime acceptance (real app, real dev server and its server-side provider proxy)

Evidence categories are kept apart: everything below is a **browser** run;
the provider rows are **live-provider-backed**; the "offline" rows block every
`/api/model/*` call in the browser. Supabase was blocked in every run.

| # | Requirement | Result |
|---|---|---|
| 1 | Boots without a fatal runtime exception | PASS — 0 page errors |
| 2 | Main interface renders | PASS — Home with all modules |
| 3 | Chat opens | PASS — Home's Chat tile → Chat Universe |
| 4 | A message can be submitted | PASS |
| 5 | Response from an available, authorised provider | **PASS (live)** — `groq 200`, provider `Groq`: "A coral reef is a thriving underwater ecosystem formed by calcium-carbonate skeletons secreted by coral polyps." No request to Anthropic. See the quota note below. |
| 6 | Provider failure surfaced honestly | PASS — every model call blocked → "The network failed while I was reaching the model providers. Nothing was lost; ask me again once you're back online." With all providers rate-limited the reply was "I'm in offline mode right now …" — never a fabricated answer. |
| 7 | Local/offline functionality | PASS — time answered locally; `/cosmos list` ran with providers down |
| 8 | Cosmos opens | PASS — "Open my Cosmos" → `cosmos.view.open:done`; immersive dock; Chat Universe not drawn over it |
| 9 | Existing objects render | **PARTIAL** — dock shows "2 objects", the WebGL canvases are mounted; the meshes are not painted because the only GPU here is SwiftShader and LÉLU selects its `light` profile (no continuous WebGL) on a software renderer by design. Seeing them drawn needs a GPU device. |
| 10 | Spatial command reaches the authorised tool path | PASS — "Move the acceptance gear to the left of the acceptance cabin" → `cosmos.object.position:done`, 0 model calls; "Move the spaceship beside …" → "Not done", nothing moved |
| 11 | Position change reflected in the world | PASS in the store authority (gear [3.2, 0.9, 7.2] → [−7.2, 0.9, 9.97]; cabin at x −1.6, same y/z); on-screen confirmation as row 9 |
| 12 | Room → Cosmos → Room preserves state | PASS — objects/positions unchanged; conversation restored after "‹ Back"; the same chat keeps working; plus world continuity 35/35 and M17.1 71/71 |
| 13 | Reload keeps persistent state | PASS — conversation (10 messages) and moved positions survive reload |

Provider quota note: when this run started, all three Groq keys (three
separate organisations) had exhausted the daily token budget for the default
model `openai/gpt-oss-120b`, OpenRouter keys 1–3 had hit the free daily
request cap, and `GROQ_API_KEY_4`, `OPENROUTER_API_KEY_4` and the Cerebras key are
rejected (401). The live run therefore used the existing `GROQ_MODEL`
override (`openai/gpt-oss-20b`), set in the dev server's environment only — no
code or default changed. Much of the Groq budget is consumed by LÉLU's own
background self-study turns.

Physical iPhone: **not tested.** All "iPhone" results above are Chromium
device emulation.

## 10. Remaining limitations

* Seeing the Cosmos meshes painted (rows 9/11) needs a GPU device; not verifiable on this host.
* CI will stay red until (a) the mobile-cache harness gets its two-line correction and (b) the sandbox fallback either emulates async socket errors or the network check accepts a synchronous denial — both are test/harness decisions left to their owners.
* Default Groq model budget and OpenRouter free quota are exhausted for today; production chat falls back to "offline mode" until they reset unless `GROQ_MODEL` is pointed at a model with budget. Invalid keys: `GROQ_API_KEY_4`, `OPENROUTER_API_KEY_4`, Cerebras.
* Canonical's Cosmos-objects dock is also mounted (not visible) under M17.1 compositions, because both read `HomeStore.immersive`.
* `claude/charming-hamilton-icbyrb` holds 11 M15.3 commits that are not in this integration.

## 11. Commit-level ledger: the 70 commits integrated (oldest first)

| # | Commit | Date | Author | Type | Workstream | Subject |
|---|---|---|---|---|---|---|
| 1 | `de4a2653` | 2026-11-10 | lapheezy | commit | Freebuff VoxCPM2 voice (Nov 10) — reconciled as superseded in 5e938ee | Speak her replies in her own cloned voice with VoxCPM2 |
| 2 | `e1ee9ae1` | 2026-11-10 | lapheezy | commit | Freebuff VoxCPM2 voice (Nov 10) — reconciled as superseded in 5e938ee | Verify her voice chain without the chat surface |
| 3 | `157d9dfb` | 2026-11-10 | lapheezy | commit | Freebuff VoxCPM2 voice (Nov 10) — reconciled as superseded in 5e938ee | Keep the Universe on screen when a phone chat opens. |
| 4 | `d80a69ca` | 2026-11-14 | Claude | commit | Creative Kit acceptance — open-source expansion (Job 2) | Rasterise film visuals once, pause off-screen 3D views, add browser demo scripts |
| 5 | `2ed12f79` | 2026-11-14 | Claude | commit | Creative Kit acceptance — open-source expansion (Job 2) | Add partial browser-demo evidence (in progress, not accepted) |
| 6 | `9de23893` | 2026-11-14 | Claude | commit | Creative Kit acceptance — open-source expansion (Job 2) | Render Mermaid labels as SVG text so diagram PNG export is not tainted |
| 7 | `71fad1ad` | 2026-11-14 | Claude | commit | Creative Kit acceptance — open-source expansion (Job 2) | Update partial browser-demo evidence (in progress, not accepted) |
| 8 | `80514fbc` | 2026-11-14 | Claude | commit | Creative Kit acceptance — open-source expansion (Job 2) | Update partial browser-demo evidence (in progress, not accepted) |
| 9 | `50196672` | 2026-11-14 | Claude | commit | Creative Kit acceptance — open-source expansion (Job 2) | Size films to the device's measured encoder speed; verify frames with ffprobe |
| 10 | `369e0f28` | 2026-11-14 | Claude | commit | Creative Kit acceptance — open-source expansion (Job 2) | Add local-AI benchmark evidence and partial run-2 evidence (in progress, not accepted) |
| 11 | `ae74b0cd` | 2026-11-14 | Claude | commit | Creative Kit acceptance — open-source expansion (Job 2) | Update partial run-2 evidence (in progress, not accepted) |
| 12 | `89fda781` | 2026-11-14 | Claude | commit | Creative Kit acceptance — open-source expansion (Job 2) | Push MediaRecorder frames explicitly; add the film window acceptance script |
| 13 | `bda61998` | 2026-11-14 | Claude | commit | Workspace Steward / Chat Universe stages / browser / reflow | Workspace Steward: one plan for every window, operated by LÉLU's own tools |
| 14 | `18222d80` | 2026-11-14 | Claude | commit | Creative Kit acceptance — open-source expansion (Job 2) | Fit generative previews to their window, label window close buttons, add mobile check |
| 15 | `20bf848f` | 2026-11-14 | Claude | commit | Workspace Steward / Chat Universe stages / browser / reflow | Chat Universe stages: cinematic, board, gallery, present and 3D from the same conversation |
| 16 | `dd624875` | 2026-11-15 | Claude | commit | Creative Kit acceptance — open-source expansion (Job 2) | Accept Job 2 in the browser: demonstrations, connector matrix, local-AI evaluation, report |
| 17 | `cb93eb34` | 2026-11-15 | Claude | commit | Workspace Steward / Chat Universe stages / browser / reflow | Browser: tabs, full-height pages, reader, beside chat, to board |
| 18 | `f0c4d421` | 2026-11-15 | Claude | commit | Workspace Steward / Chat Universe stages / browser / reflow | Every app reflows by its window width; bar clears the dock; viewport settle |
| 19 | `77b987b8` | 2026-11-15 | Claude | commit | Workspace Steward / Chat Universe stages / browser / reflow | Gate fixes: lint back to baseline, browser opens idle again, tests pin the new phone contract |
| 20 | `1ac41491` | 2026-11-15 | Claude | commit | Workspace Steward / Chat Universe stages / browser / reflow | Evolution Trail: the build's visual checkpoints as a Chat Universe conversation |
| 21 | `509d7fcf` | 2026-11-15 | Claude | merge | Master integration (Claude + Freebuff) | Merge claude/chat-universe-evolution-skidcz into the master integration |
| 22 | `4facdcdc` | 2026-11-15 | Claude | merge | Master integration (Claude + Freebuff) | Merge Claude's Job 2 acceptance work (claude/lelu-open-source-expansion-qz626l) |
| 23 | `ac54e77b` | 2026-11-15 | Claude | commit | Master integration (Claude + Freebuff) | Lazy-load the inline editors in chat artifact cards |
| 24 | `a1706f39` | 2026-11-15 | Claude | merge | Freebuff workforce consolidation (merge) | Merge Freebuff workforce consolidation: inline artifacts, page reading, inline 3D, keyless connectors, engine view |
| 25 | `58552c4b` | 2026-11-15 | Claude | merge | Creative Kit acceptance — open-source expansion (Job 2) | Merge Creative Kit acceptance (open-source expansion): film encoder sizing, Mermaid export, preview fitting, browser demos |
| 26 | `5e938eed` | 2026-11-15 | Claude | merge | VoxCPM2 reconciliation merge | Reconcile freebuff/44c122e (VoxCPM2 voice identity, Nov 10) — superseded, history preserved |
| 27 | `b0e7e782` | 2026-11-15 | Claude | commit | Master integration (Claude + Freebuff) | Reconcile the two direct planners; research boards stay in the conversation |
| 28 | `611f73be` | 2026-11-15 | Claude | commit | Master integration (Claude + Freebuff) | Add the master-integration demo script; partial evidence (in progress, not accepted) |
| 29 | `015afdaa` | 2026-11-15 | Claude | commit | Chat Universe environments + workflows 1–16 | Chat Universe environments: find, make, transform and stage real work |
| 30 | `64a7d540` | 2026-11-15 | Claude | commit | Master integration (Claude + Freebuff) | Keep a viewer that cannot load inside its own card (offline crash fix) |
| 31 | `cd4b9324` | 2026-11-15 | Claude | commit | Master integration (Claude + Freebuff) | Integration checkpoints in the Evolution Trail; provider and offline evidence |
| 32 | `fc0169c2` | 2026-11-15 | Claude | commit | Master integration (Claude + Freebuff) | Master integration report: Claude and Freebuff work in one branch |
| 33 | `611be872` | 2026-11-15 | Claude | commit | Chat Universe environments + workflows 1–16 | Workflow fixes: reply-driven auto-staging, named split pairs, DOI sources, browser hand-off |
| 34 | `5239c2e2` | 2026-11-15 | Claude | commit | Chat Universe environments + workflows 1–16 | Research workflow: overflow watcher ignores deliberate scrollers; reports compose findings |
| 35 | `bc5ca5f8` | 2026-11-15 | Claude | commit | Chat Universe environments + workflows 1–16 | Workflows 2-3 verified; environment panels keep their children's size |
| 36 | `cc5c84b9` | 2026-11-15 | Claude | commit | Chat Universe environments + workflows 1–16 | Data workflow: findings computed from the chart, presentation played in Present |
| 37 | `4a8a3ac7` | 2026-11-15 | Claude | commit | Chat Universe environments + workflows 1–16 | Workflow 6 script; lint clean on the new environment modules |
| 38 | `a40159f6` | 2026-11-15 | Claude | commit | Chat Universe environments + workflows 1–16 | Film workflow: verify the rendered WebM's own bytes (EBML signature, size) |
| 39 | `4d92e131` | 2026-11-15 | Claude | commit | Chat Universe environments + workflows 1–16 | Commands in words are process, not content (boards, research prefill) |
| 40 | `eea1e0aa` | 2026-11-15 | Claude | commit | Chat Universe environments + workflows 1–16 | Phone: a maximised window owns the screen only while it is on top |
| 41 | `d486d288` | 2026-11-15 | Claude | commit | Chat Universe environments + workflows 1–16 | Browser hand-off is pull-based; iPhone workflow fixes |
| 42 | `8d0fc9d0` | 2026-11-15 | Claude | commit | Chat Universe environments + workflows 1–16 | Evolution Trail: workflow checkpoints 9-16; existing trails gain new checkpoints |
| 43 | `5a02ef8a` | 2026-11-15 | Claude | commit | Chat Universe environments + workflows 1–16 | Master integration acceptance report; production perf measures the real environments |
| 44 | `4f1afebd` | 2026-11-15 | Claude | merge | Chat Universe environments + workflows 1–16 | Merge claude/chat-universe-evolution-skidcz (latest Claude work) into Mission 15 branch |
| 45 | `9c301763` | 2026-11-15 | Claude | merge | Master integration (Claude + Freebuff) | Merge integration/lelu-master-integration into the Mission 15 Home branch |
| 46 | `14c89245` | 2026-11-15 | Claude | commit | Mission 15 Home Universe | Home Universe: one composition engine, twelve working layouts, a design studio |
| 47 | `fe0cc0d4` | 2026-11-15 | Claude | commit | Mission 15 Home Universe | Mission 15 Home Universe: research, evidence and the merge regression fix |
| 48 | `6574ea74` | 2026-11-15 | Claude | merge | Mission 15 Home Universe | Merge the latest Claude Home Universe work into the Cosmos branch |
| 49 | `376ac69a` | 2026-11-15 | Claude | merge | Home Studio + spatial bar (claude/charming-hamilton-icbyrb, partial) | Merge remote-tracking branch 'origin/claude/beautiful-euler-m3v9i5' into claude/charming-hamilton-icbyrb |
| 50 | `145f7c6a` | 2026-11-15 | Claude | commit | Mission 17 / M17.1 interface ecosystem | Mission 17: LÉLU's interfaces as one ecosystem — Room, Legacy UIs, continuous compositions |
| 51 | `94e96cb5` | 2026-11-15 | Claude | commit | Home Studio + spatial bar (claude/charming-hamilton-icbyrb, partial) | Home Studio: all sixty concepts working; research, blend, merge, create; themes, fonts, elemental borders |
| 52 | `6bf290ec` | 2026-11-15 | Claude | commit | Home Studio + spatial bar (claude/charming-hamilton-icbyrb, partial) | Spatial bar off the Home: side tab, menu entry, or ask LÉLU |
| 53 | `cd27328e` | 2026-11-16 | Claude | commit | Mission 17 / M17.1 interface ecosystem | M17.1-WP01: close the interface ecosystem's acceptance gaps |
| 54 | `faff46ad` | 2026-11-16 | Claude | merge | Home Studio + spatial bar (claude/charming-hamilton-icbyrb, partial) | Merge Claude's spatial-bar fix and Home Studio work into the Cosmos branch |
| 55 | `b827c785` | 2026-11-16 | Claude | commit | M17.2 Neural Map (WP01, WP02) | M17.2-WP01: make the Cosmos part of LÉLU's Neural Map |
| 56 | `24e703e6` | 2026-11-16 | Claude | commit | M17.2 Neural Map (WP01, WP02) | M17.2-WP02: the Neural Map inside every interface (work in progress) |
| 57 | `49f7c719` | 2026-11-16 | Claude | commit | M17.2 Neural Map (WP01, WP02) | M17.2-WP02: WP01 check — chat turns now legitimately update the chats/projects partitions |
| 58 | `35c285b3` | 2026-11-16 | Claude | commit | M17.2 Neural Map (WP01, WP02) | M17.2-WP02: evidence so far (WP02 run json, WP01 regression shots) |
| 59 | `dddbae8b` | 2026-11-16 | Claude | commit | M17.2 Neural Map (WP01, WP02) | M17.2-WP02: regression evidence (M15 home rerun, M17.1 rerun shots) |
| 60 | `d2a14b3e` | 2026-11-16 | Claude | commit | M17.2 Neural Map (WP01, WP02) | M17.2-WP02: report addendum (integration matrix, acceptance, O09 routing finding) |
| 61 | `09400c7a` | 2026-11-16 | Claude | commit | M17.2 Neural Map (WP01, WP02) | M17.2-WP02: re-run evidence in progress |
| 62 | `178b4db7` | 2026-11-16 | Claude | commit | M17.2 Neural Map (WP01, WP02) | M17.2-WP02: WP01 check counts /build's real Studio artifact update; re-run evidence |
| 63 | `d8d17913` | 2026-11-16 | Claude | commit | M17.2 Neural Map (WP01, WP02) | M17.2-WP02: WP01 re-run screenshots |
| 64 | `0cf6d634` | 2026-11-16 | Claude | commit | M17.2 Neural Map (WP01, WP02) | M17.2-WP02: WP01 regression re-run 28/28 |
| 65 | `4b828fdb` | 2026-11-16 | Claude | commit | M17.2 Neural Map (WP01, WP02) | M17.2-WP02: report — WP01 re-run 28/28; M17.1 Room→Cosmos failure reproduced on the pre-WP02 base |
| 66 | `1fefa62d` | 2026-11-16 | Claude | commit | M17.3 WP01 spatial intent | M17.3-WP01: spatial intelligence — objects vs windows, relative placement, no guessing |
| 67 | `f67653cd` | 2026-11-16 | Claude | commit | M17.3 WP02 world continuity | M17.3-WP02 (in progress): world-continuity transition check, not yet run to completion |
| 68 | `5368f034` | 2026-11-16 | Claude | commit | M17.3 WP02 world continuity | M17.3-WP02: world continuity — a 3D region being left stops at the jump |
| 69 | `3c7ea1a4` | 2026-11-16 | Claude | commit | M17.3 WP03 regression and acceptance | M17.3-WP03: regression run in progress (partial logs) |
| 70 | `1590aec6` | 2026-11-16 | Claude | commit | M17.3 WP03 regression and acceptance | M17.3-WP03: regression and evidence on the final code (5368f03) |

## Evidence in this folder

`integration/verify-live-integration.cjs` (the §9 run), `integration/live-integration.json` (its results and every model call it saw), and screenshots `01-home`, `02-provider-reply`, `03-cosmos-after-move`, `04-providers-down`.
