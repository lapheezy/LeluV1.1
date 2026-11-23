# CLAUDE × FREEBUFF INTEGRATION LEDGER (WP02 / WP07)

Contribution → destination on `integration/lelu-four-workforce-consolidation`.
Baseline: `096b46b8`. Every merge below is a real `git merge --no-ff` (no
squash, no rebase, no force-push), so each source tip is an **ancestor** of the
workforce branch; where a merge took none of a branch's content, the reason is
stated and the content was verified present or superseded. Per-commit evidence:
`UNIFIED_WORKFORCE_SOURCE_AUDIT.md` and
`docs/acceptance/workforce-consolidation/source-audit-commits.json`.

Legend — **Integrated**: content now on the branch. **Present**: already on the
baseline (by ancestry, `-x` cherry-pick or identical blobs). **Superseded**:
a newer implementation of the same behaviour is kept, named below.
**Refused**: deliberately not taken, reason given.

## Freebuff (and lapheezy/"LÉLU Engineering" sessions)

| # | Contribution (source tips) | Area | Destination | Decision | Conflicts and how they were resolved | Verification |
|---|---|---|---|---|---|---|
| F1 | Cosmos object reconciliation "group A": conversation-scoped referents/selections (`continuity.ts`), post-operation verification with one safe retry (`verification.ts`), follow-up compilation; measured feature replication (`perception/*`); hair reconstruction + reference photos — `integration/m16-3-wp05-reconciliation` `543da7c8` | Cosmos, spatial, avatar | `ea3af4d0` | Integrated (M22.10 had left it out) | `CosmosObjectTools.ts`: canonical M17.3 spatial intent and group A were two implementations of `cosmos.object.position` → **fused**: pronouns use group A's conversation-scoped resolver, names use M17.3's ambiguity-refusing matcher, placement uses M17.3, every result is judged by group A's verifier. `FeatureUnderstanding.ts` typecheck repair from `2bcc3c66` applied. | 134/134 cosmos/spatial/perception tests |
| F2 | Memory sovereignty, cognitive-context scoping, deletion ledger, checkpoint/self-chat leak fixes, deletion proofs + residue cleaning, automatic forgetting on every read path, server tombstones — `freebuff/m22-2…m22-5`, `m22.6/memory-integrity-deletion-propagation`, `m22.7/universal-memory-erasure` `4e9dd24c` | Memory | `9e6d1bf3` | Integrated | One memory write path extended twice (voice provenance vs. conversation origin) → **fused signature** `MemoryBridge.learn(prompt, response, taskId, conversationOrProvenance, {sourceType, provenance})`; `MemoryEngine` keeps structured `LearnProvenance` *and* origin records; corrections checked before reinforce. Migration `202611200001_memory_tombstones.sql` added, **not applied**. | 421/422 memory/sovereignty/voice/runtime tests (1 pre-existing skip) |
| F3 | M23.0 speech-outcome ledger ("account for every voice turn"), echo-guard fix, evidence — `m23.0/embodied-conversational-experience` `d2131ea7` | Voice | `eefe18c4` | Integrated (`96c99b0e`, `42b1aed3`, `d2131ea7`); the line's 15 voice commits **Present** (M22.10 `-x` cherry-picks) | Kept the baseline in the 6 cherry-pick-conflict files; re-applied `96c99b0e` 3-way onto M22.9's persistent runtime: ledger resets in the de-duplicated `start()` (local + LiveKit), diagnostics carry both field sets. | 154/155 voice/speech tests |
| F4 | ASRE core: decomposition, hypotheses, reconstruction, NRE (voxels, Morton, snapshots, VXZ), model-capability registry — `temporal-studio/asre-core` `13b826d4` | Spatial engine | `5bbc6299` | Integrated | `.gitignore` union | 121/121 temporal + cosmos-object tests |
| F5 | Mission 14.3–14.5 continuity: self-model, mission ledger, cognitive pulse, continuity tools, local-first outbox, Supabase continuity transport, email auth, broker health, budget hardening — `freebuff/8994d7…`, `mission-14.3/14.4/14.5` `ac381643` | Cognition continuity, persistence | `dfe8a01f` | Integrated | All four conflicts additive → union (Bootstrap, CosmosNavigation, SupabasePersistence, ProjectStore). Checked: continuity authorities do not include `memory_items`, so tombstones are not bypassed. | Full suite 2797/2803, 0 fail |
| F6 | Creative continuity: couture objects (garments, products, pattern pieces + components), creations in the live Cosmos, hit-testing, self-placement, deterministic creative operations — `freebuff/400773…`, `m16-3/wp04-creative-continuity` `9c70cbe7` | Creation, Cosmos | `aa48d9eb` | Integrated | Unions in Bootstrap/DirectCompiler/AIRouter/DirectResolver. **Integration defect fixed**: the couture compiler claimed every "rotate it"/"show every object" ahead of Cosmos rules → `coutureOwns()` routes a sentence to the store its names resolve in (pinned by `tests/workforce-object-authority-routing.test.ts`). | Full suite 2860/2866, 0 fail |
| F7 | Camera authority rules, ring in front of the camera + room volumes, renderer-reported pixels, "demand" cadence for slow machines, capability re-reads — `freebuff/m17-coe-wp03…`, `freebuff/m17-coe-wp06-projection-integrity` `7795eb72` | Rendering, projection | `c363c343` | Integrated | `cameraAuthority` is a rule layer on `cameraOwnership` (not a second authority); drift also yields to M22.12 flights; one `paintWorld` expression satisfies both `?perf-world` (M22) and WP06; Home Cosmos button uses the single `cosmosViewBus` door. | 201/201 render/camera/cosmos tests |
| F8 | Capability expansion, earlier Freebuff Missions 6–8 — `freebuff/capability-expansion`, `freebuff/1fb0099…`, `freebuff/44c122…` | Workforce | baseline | Present (ancestors of baseline) | — | — |

## Claude

| # | Contribution (source tips) | Area | Destination | Decision | Conflicts and resolution | Verification |
|---|---|---|---|---|---|---|
| C1 | Mission 15.2 WP03, M15.3 WP03–05 (phone leaves world, first-paint, early walks, avatar forms/actions, spatial-nav/avatar commands), Cosmos integration report — `claude/cosmos-integration-audit-t9ouny` `b291a885` (contains `charming-hamilton`) | Mobile, avatar, Cosmos | `a19736ec` | Integrated; `75100701` **Present** as `2d8fc85` | Baseline kept in camera/rooms (it has 75100701 + M22.12); LeluCompanion imports union; M15.3 `orbClearance` **Superseded** by M17.1 measured lift. | Full suite 2958/2964, 0 fail |
| C2 | Self-study improvements 1–3, staged personality changes, background allowance (operation-labelled budgets, continuation rounds), development record, self-tests, `block-supabase` — `claude/lelu-improvement-3-finish-lexgtc` `8db351e1`, `claude/cool-mccarthy-dliwu9` `7d37d882` | Learning, provider routing | `607f87a5`, `d4462bc8` | Integrated | `ProviderResolver`: operation/continuation arguments added to the baseline's newer request bodies on all three `gatedGenerate` calls. | Full suite 2993/2999, 0 fail |
| C3 | Native ASRE service, Forge-filed geometry, scheduler, persistent character identity + variations, temporal creation, volumetric intelligence, TripoSR worker, reference pipeline (face/skull/hair/wardrobe), agent tools — `claude/lelu-character-pipeline-gb87lc` `38918ce2` (contains `blissful-cray`, `mission5-lelu-asre-integration`) | Character, spatial | `d62303e8` | Integrated | `.gitignore` union; `face.ts` parameter properties rewritten as fields (tsconfig `erasableSyntaxOnly`). `/api/asre` mounted in dev and production. | 3075/3086 (1 probe failure fixed in-commit), 4 new env skips (Blender/CC0) |
| C4 | LÉLU 2 golden geometry, M25 fidelity, Outfit B/looks, OutfitDirector, Character Foundry tools, self-change awareness + playbooks, M25 round 3 (wardrobe hairstyles/purses, rotating room) — `claude/jolly-davinci-9w3rle` `7f265c2b` (contains the three `experiment/*`) | Character, self-awareness | `dd0020e3` | Integrated | Round 3's removal of Genesis Core/satellites kept + Freebuff `CreativeObjects3D` kept; golden bead work + pipeline jewelry/harness rules fused; `leluFaceColour` **Superseded** by `face.ts`. Fixed `listChanges` for merge commits. | 3195/3208; 3 failures inherited from `7f265c2b` itself |
| C5 | Mission 2.15 / 5.2 mobile-spatial closure (Codebuff on `claude/` names) — `claude/mission-2-15-5…` `6f0ebb69` ⊇ 7 sibling branches | Mobile windows | `95dd9011` | Present / Superseded (ancestry only, tree unchanged) | `GenesisModuleHost.tsx`: baseline's evolved version kept (see audit §4). | tree identical |
| C6 | Master integration, open session, intelligent-lovelace (M17.3), chat-universe evolution, integration-performance, avatar-3d-world, interface-control, evolution-* (delegation, truthful board), lelu-worker-recovery, open-source-expansion, gallant-ritchie, sharp-knuth, beautiful-euler — all `claude/*` ancestors of the baseline | Everything up to M22.12 | baseline | Present | — | — |

## Jules / Codelazr (recorded for completeness — WP03 shared files)

| # | Source | Destination | Decision |
|---|---|---|---|
| J1 | `jules-246569610287923701` `a0458dbc` | `1bba65d0` | Taken: verify-script robustness (flush, await consolidations, sign-in gate, placeholder, managed server). **Refused**: `MemoryEngine.supersede` change (reverses the deliberate "keep a corrected statement's unrelated facts" rule), `verify-development` loosening (weakens acceptance), CI step list (baseline CI is newer and runs every verify script), `classifyProviderFailure` alias (re-adds a name renamed away; unused). Seven shared-file conflicts → baseline (all ids/exports present). |
| J2 | `jules-3488…` `7fb4f23d`, `codelazr/…-5152…` `0a2050c6`, `codelazr/…-recovered-…` `59df30fc`, `claude/open-session-rbwmdw-4210…` `b7c2ea0c` | `fd4b40c1`, `a136a2fb`, `03924d67`, `29ddd9fa` | Present (ancestry only). Refused hunks: CI step deletion, the alias above. |
| J3 | `m22.9/persistent-voice-runtime` `448770bd` | `66849f1a` | Present (`-x` cherry-pick by M22.10) |

## Post-merge corrections (found only on the combined tree)

| Commit | Defect | Fix |
|---|---|---|
| `aa48d9eb` | Couture vs Cosmos object authority collision | `coutureOwns()` + routing test |
| `d62303e8`, `dd0020e3` | Registration probe out of sync with Bootstrap | probe mirrors Bootstrap and asserts it stays in sync |
| `dd0020e3` | `listChanges` blind to merge commits | `--diff-merges=first-parent` |
| `3d6051b0` | Production build 8 s → 379 s (Tailwind scanned 5 GB) | `source(none)`; build 6 s |
| `4b87a535` | `/api/self/*` 404 on `server.ts` only; Creative Objects panel covering the Home | router-agnostic attach; panel shown only with work |

## Not integrated

Nothing with unique runtime behaviour was dropped. The refused items are listed
above (J1/J2). Work that may exist only in other agents' local workspaces or
uncommitted patches cannot be seen from this container and is therefore **not**
claimed as integrated.
