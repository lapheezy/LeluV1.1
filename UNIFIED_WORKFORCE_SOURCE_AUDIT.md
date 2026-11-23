# UNIFIED WORKFORCE SOURCE AUDIT (WP01)

Repository `lapheezy/LeluV1.1`. Audit taken 2026-11-23 from `git ls-remote` (71 heads) after a full unshallow fetch. Baseline = canonical `integration/lelu-four-workforce-consolidation` at **`096b46b8`** ("Record M22.12…").

Method, per branch: ancestry (`git merge-base --is-ancestor`), ahead/behind counts, and patch-equivalence (`git cherry` + stable patch-ids of every canonical commit since 2026-10-25, plus `(cherry picked from commit …)` trailers). For every one of the 280 non-merge commits not in the baseline, each file it touched was also compared blob-for-blob against the baseline tip ("content-present" / "partial" / "unique"). Raw data: `docs/acceptance/workforce-consolidation/source-audit-commits.json`.

Uncommitted work: the session's clone was clean; agent workspaces of other sessions are not reachable from this container, so work that exists only there could not be audited (see Outstanding blockers in the final report). Recovery reports and mission artifacts were treated as content: they ride along with their commits.

## 1. Branch and HEAD inventory (before integration)

| Branch | HEAD | Date | Author | Ancestor of baseline | Ahead | Behind | Patch-unique | Workforce | Destination on workforce branch |
|---|---|---|---|---|---|---|---|---|---|
| `claude/avatar-3d-world` | `616f2512a6` | 2026-11-05 | Codebuff | yes | 0 | 479 | 0 | Claude | already in baseline |
| `claude/beautiful-euler-m3v9i5` | `fe0cc0d470` | 2026-11-15 | Claude | yes | 0 | 53 | 0 | Claude | already in baseline |
| `claude/blissful-cray-lqhs6g` | `ed5777ee64` | 2026-11-17 | Claude | no | 56 | 49 | 56 | Claude | merge `d62303e8` |
| `claude/charming-hamilton-icbyrb` | `f29071614a` | 2026-11-16 | Claude | no | 33 | 49 | 33 | Claude | merge `a19736ec` |
| `claude/chat-universe-evolution-skidcz` | `5a02ef8afb` | 2026-11-15 | Claude | yes | 0 | 67 | 0 | Claude | already in baseline |
| `claude/cool-mccarthy-dliwu9` | `7d37d882e6` | 2026-11-17 | Claude | no | 36 | 49 | 36 | Claude | merge `d4462bc8` |
| `claude/cosmos-integration-audit-t9ouny` | `b291a88592` | 2026-11-22 | Claude | no | 35 | 49 | 35 | Claude | merge `a19736ec` |
| `claude/evolution-board-truthful-status` | `7f912ff5c9` | 2026-10-28 | lapheezy | yes | 0 | 620 | 0 | Claude | already in baseline |
| `claude/evolution-delegation` | `a985f22f11` | 2026-10-29 | lapheezy | yes | 0 | 615 | 0 | Claude | already in baseline |
| `claude/evolution-fix-test-portability` | `98e8e82671` | 2026-10-28 | lapheezy | yes | 0 | 621 | 0 | Claude | already in baseline |
| `claude/evolution-no-tests-in-bundle` | `b1b1d22bcb` | 2026-10-29 | lapheezy | yes | 0 | 616 | 0 | Claude | already in baseline |
| `claude/gallant-ritchie-v7i0fn` | `ce768e08ce` | 2026-11-07 | Claude | yes | 0 | 279 | 0 | Claude | already in baseline |
| `claude/intelligent-lovelace-5l7zoz` | `1590aec61f` | 2026-11-16 | Claude | yes | 0 | 29 | 0 | Claude | already in baseline |
| `claude/jolly-davinci-9w3rle` | `7f265c2b46` | 2026-11-20 | Claude | no | 110 | 49 | 110 | Claude | merge `dd0020e3` |
| `claude/lelu-character-pipeline-gb87lc` | `38918ce2a5` | 2026-11-18 | Claude | no | 105 | 49 | 105 | Claude | merge `d62303e8` |
| `claude/lelu-improvement-3-finish-lexgtc` | `8db351e182` | 2026-11-17 | Claude | no | 41 | 49 | 40 | Claude | merge `607f87a5` |
| `claude/lelu-integration-performance-eai80a` | `7e78a3f439` | 2026-11-14 | Claude | yes | 0 | 106 | 0 | Claude | already in baseline |
| `claude/lelu-interface-control-d2sfdl` | `3eccc6d2a9` | 2026-11-05 | Claude | yes | 0 | 663 | 0 | Claude | already in baseline |
| `claude/lelu-open-source-expansion-qz626l` | `dd624875af` | 2026-11-15 | Claude | yes | 0 | 107 | 0 | Claude | already in baseline |
| `claude/lelu-v1-1-workforce-consolidation-bh0jrc` | `096b46b81f` | 2026-11-22 | Claude | yes | 0 | 0 | 0 | Claude | already in baseline |
| `claude/lelu-worker-recovery-4fio20` | `b00cfefc86` | 2026-11-13 | Claude | yes | 0 | 175 | 0 | Claude | already in baseline |
| `claude/master-integration` | `fd649b9c88` | 2026-11-09 | Codebuff | yes | 0 | 246 | 0 | Claude | already in baseline |
| `claude/mission-2-15-1-closure` | `febc5fac6e` | 2026-11-08 | Codebuff | no | 7 | 336 | 7 | Claude | merge `95dd9011` |
| `claude/mission-2-15-2-mobile-spatial-closure` | `78815d259a` | 2026-11-08 | Codebuff | no | 8 | 336 | 8 | Claude | merge `95dd9011` |
| `claude/mission-2-15-3-renderer-mobile-validation` | `e618923801` | 2026-11-08 | Codebuff | no | 9 | 336 | 9 | Claude | merge `95dd9011` |
| `claude/mission-2-15-4-mobile-presenter-integration` | `0af24d7af4` | 2026-11-08 | Codebuff | no | 11 | 336 | 11 | Claude | merge `95dd9011` |
| `claude/mission-2-15-5-mobile-placement-closure` | `6f0ebb69d1` | 2026-11-08 | Codebuff | no | 13 | 336 | 13 | Claude | merge `95dd9011` |
| `claude/mission-2-15-spatial-world` | `5daaf69a68` | 2026-11-08 | Codebuff | no | 6 | 336 | 6 | Claude | merge `95dd9011` |
| `claude/mission-5-2-acceptance-completion` | `68fd4f99ed` | 2026-11-07 | Codebuff | no | 5 | 336 | 5 | Claude | merge `95dd9011` |
| `claude/mission-5-2-acceptance-evidence` | `47785f4ea7` | 2026-11-07 | Codebuff | no | 4 | 336 | 4 | Claude | merge `95dd9011` |
| `claude/mission5-lelu-asre-integration-mm6xau` | `55c89aae19` | 2026-11-18 | lapheezy | no | 80 | 49 | 80 | Claude | merge `d62303e8` |
| `claude/open-session-rbwmdw` | `e7b667bac8` | 2026-10-30 | Claude | yes | 0 | 567 | 0 | Claude | already in baseline |
| `claude/open-session-rbwmdw-4210273077145561833` | `b7c2ea0c90` | 2026-11-07 | google-labs-jules[bot] | no | 1 | 567 | 1 | Claude | merge `29ddd9fa` |
| `claude/sharp-knuth-l3d7i3` | `1ff382995b` | 2026-11-22 | Claude | yes | 0 | 3 | 0 | Claude | already in baseline |
| `codelazr/environment-orchestration-session-02-5152285862774985386` | `0a2050c67a` | 2026-11-08 | google-labs-jules[bot] | no | 5 | 567 | 5 | Jules/Codelazr | merge `a136a2fb` |
| `codelazr/environment-orchestration-session-02-recovered-8798102482818388694` | `59df30fc71` | 2026-11-08 | google-labs-jules[bot] | no | 2 | 567 | 2 | Jules/Codelazr | merge `03924d67` |
| `experiment/lelu-2-golden-geometry` | `d4667d785e` | 2026-11-19 | lapheezy | no | 91 | 49 | 91 | Claude/lapheezy experiment | merge `dd0020e3` |
| `experiment/m25-complete-character-fidelity` | `c19298697c` | 2026-11-20 | Claude | no | 109 | 49 | 109 | Claude/lapheezy experiment | merge `dd0020e3` |
| `experiment/m25-visual-fidelity-reconstruction` | `d88dd00fd2` | 2026-11-19 | lapheezy | no | 92 | 49 | 92 | Claude/lapheezy experiment | merge `dd0020e3` |
| `freebuff/1fb0099bf53a9ab2f6fe75bd` | `1549194802` | 2026-11-06 | Codebuff | yes | 0 | 448 | 0 | Freebuff | already in baseline |
| `freebuff/400773963b8c2504ea15ec77` | `2068472f9f` | 2026-11-16 | lapheezy | no | 7 | 100 | 7 | Freebuff | merge `aa48d9eb` |
| `freebuff/44c122e89826b555c8003299` | `157d9dfb64` | 2026-11-10 | lapheezy | yes | 0 | 204 | 0 | Freebuff | already in baseline |
| `freebuff/8994d7c2e03123fc8927b6fc` | `4582382036` | 2026-11-16 | Codebuff | no | 13 | 103 | 13 | Freebuff | merge `dfe8a01f` |
| `freebuff/capability-expansion` | `4b272cee73` | 2026-11-14 | lapheezy | yes | 0 | 105 | 0 | Freebuff | already in baseline |
| `freebuff/m17-coe-wp03-responsive-canvas` | `e0126bf694` | 2026-11-16 | lapheezy | no | 3 | 96 | 3 | Freebuff | merge `c363c343` |
| `freebuff/m17-coe-wp06-projection-integrity` | `7795eb72e2` | 2026-11-16 | lapheezy | no | 9 | 96 | 9 | Freebuff | merge `c363c343` |
| `freebuff/m22-2-global-cognitive-context-elimination` | `15528aabb1` | 2026-11-19 | LÉLU Engineering | no | 18 | 96 | 18 | Freebuff | merge `9e6d1bf3` |
| `freebuff/m22-3-genesischat-browser-acceptance` | `92ea2d26fb` | 2026-11-19 | LÉLU Engineering | no | 20 | 96 | 20 | Freebuff | merge `9e6d1bf3` |
| `freebuff/m22-4-memory-deletion-browser-verification` | `e7521b9a62` | 2026-11-20 | LÉLU Engineering | no | 23 | 96 | 23 | Freebuff | merge `9e6d1bf3` |
| `freebuff/m22-5-historical-memory-residue` | `12d24071bc` | 2026-11-20 | LÉLU Engineering | no | 25 | 96 | 25 | Freebuff | merge `9e6d1bf3` |
| `integration/lelu-four-workforce-consolidation` | `096b46b81f` | 2026-11-22 | Claude | yes | 0 | 0 | 0 | other | already in baseline |
| `integration/lelu-master-integration` | `fc0169c264` | 2026-11-15 | Claude | yes | 0 | 77 | 0 | other | already in baseline |
| `integration/m16-3-wp05-reconciliation` | `543da7c8d7` | 2026-11-19 | Codebuff | no | 15 | 96 | 15 | Freebuff/LÉLU Engineering (lapheezy sessions) | merge `ea3af4d0` |
| `jules-246569610287923701-3250dd82` | `a0458dbc96` | 2026-11-09 | google-labs-jules[bot] | no | 7 | 567 | 7 | Jules/Codelazr | merge `1bba65d0` |
| `jules-3488608177676003568-d30852ca` | `7fb4f23dac` | 2026-11-09 | google-labs-jules[bot] | no | 4 | 567 | 4 | Jules/Codelazr | merge `fd4b40c1` |
| `m16-3/wp04-creative-continuity` | `9c70cbe745` | 2026-11-16 | lapheezy | no | 12 | 100 | 12 | Freebuff/LÉLU Engineering (lapheezy sessions) | merge `aa48d9eb` |
| `m22.5/learning-integrity-candidate` | `8aa24ce156` | 2026-11-19 | lapheezy | no | 17 | 96 | 15 | Freebuff/LÉLU Engineering (lapheezy sessions) | merge `eefe18c4` |
| `m22.6/memory-integrity-deletion-propagation` | `21cb99dfe6` | 2026-11-20 | LÉLU Engineering | no | 27 | 96 | 27 | Freebuff/LÉLU Engineering (lapheezy sessions) | merge `9e6d1bf3` |
| `m22.6/voice-runtime-release-qualification` | `afcfd8c7f4` | 2026-11-19 | lapheezy | no | 20 | 96 | 16 | Freebuff/LÉLU Engineering (lapheezy sessions) | merge `eefe18c4` |
| `m22.7/live-voice-qualification` | `8fe502382f` | 2026-11-20 | lapheezy | no | 22 | 96 | 17 | Freebuff/LÉLU Engineering (lapheezy sessions) | merge `eefe18c4` |
| `m22.7/universal-memory-erasure` | `4e9dd24c44` | 2026-11-20 | LÉLU Engineering | no | 29 | 96 | 29 | Freebuff/LÉLU Engineering (lapheezy sessions) | merge `9e6d1bf3` |
| `m22.8/real-time-conversational-intelligence` | `43db0a06c3` | 2026-11-20 | lapheezy | no | 25 | 96 | 17 | Freebuff/LÉLU Engineering (lapheezy sessions) | merge `eefe18c4` |
| `m22.9/persistent-voice-runtime` | `448770bd9b` | 2026-11-22 | Claude | no | 30 | 96 | 18 | Freebuff/LÉLU Engineering (lapheezy sessions) | merge `66849f1a` |
| `m23.0/embodied-conversational-experience` | `d2131ea7b5` | 2026-11-20 | lapheezy | no | 32 | 96 | 20 | Freebuff/LÉLU Engineering (lapheezy sessions) | merge `eefe18c4` |
| `main` | `44bdd93689` | 2026-10-08 | Claude | yes | 0 | 686 | 0 | other | already in baseline |
| `mission-14.3/independent-runtime-acceptance` | `9363966444` | 2026-11-16 | Codebuff | no | 17 | 103 | 17 | Codebuff (Mission 14) | merge `dfe8a01f` |
| `mission-14.4/local-first-continuity` | `b17c1190d5` | 2026-11-16 | Codebuff | no | 22 | 103 | 22 | Codebuff (Mission 14) | merge `dfe8a01f` |
| `mission-14.5/real-cloud-continuity` | `ac38164334` | 2026-11-16 | Codebuff | no | 31 | 103 | 31 | Codebuff (Mission 14) | merge `dfe8a01f` |
| `mission/6.1.6-multi-step-orchestration` | `2b8eef8b84` | 2026-11-13 | lapheezy | yes | 0 | 175 | 0 | other | already in baseline |
| `mission/chat-universe-reinforcement-1` | `326e1bd8e7` | 2026-11-13 | lapheezy | yes | 0 | 191 | 0 | other | already in baseline |
| `temporal-studio/asre-core` | `13b826d49a` | 2026-11-17 | lapheezy | no | 9 | 96 | 9 | Freebuff/LÉLU Engineering (lapheezy sessions) | merge `5bbc6299` |

## 2. Commits not in the baseline: 280 (non-merge)

| Status | Count | Meaning |
|---|---|---|
| unique | 236 | no patch-equivalent in baseline and at least one touched file differs |
| partial | 21 | some touched files already identical in baseline |
| cherry-picked(-x) | 16 | baseline carries a `cherry picked from` trailer for it |
| content-present | 7 | every touched file already identical in baseline |

## 3. Lineages (commits grouped by the exact set of branches that contain them)

| # | Commits | Earliest–latest | Status mix | Contained in | Sample subjects |
|---|---|---|---|---|---|
| 1 | 5 | 2026-11-07–2026-11-08 | partial 3, unique 1, content-present 1 | `codelazr/environment-orchestration-session-02-5152285862774985386` | feat: LÉLU environment orchestration & autonomous creation (; feat: LÉLU environment orchestration & autonomous creation ( |
| 2 | 4 | 2026-11-07–2026-11-07 | content-present 2, unique 1, partial 1 | `claude/mission-2-15-1-closure`, `claude/mission-2-15-2-mobile-spatial-closure`, `claude/mission-2-15-3-renderer-mobile-validation`, `claude/mission-2-15-4-mobile-presenter-integration`, `claude/mission-2-15-5-mobile-placement-closure`, `claude/mission-2-15-spatial-world`, `claude/mission-5-2-acceptance-completion`, `claude/mission-5-2-acceptance-evidence` | Restore the matrix rows that keep the mission honest about w; Correct the acceptance matrix where a later run proved a sta |
| 3 | 1 | 2026-11-07–2026-11-07 | partial 1 | `claude/mission-2-15-1-closure`, `claude/mission-2-15-2-mobile-spatial-closure`, `claude/mission-2-15-3-renderer-mobile-validation`, `claude/mission-2-15-4-mobile-presenter-integration`, `claude/mission-2-15-5-mobile-placement-closure`, `claude/mission-2-15-spatial-world`, `claude/mission-5-2-acceptance-completion` | Record a manual placement instead of losing it, and halve th |
| 4 | 1 | 2026-11-07–2026-11-07 | partial 1 | `claude/open-session-rbwmdw-4210273077145561833` | feat: complete LÉLU environment orchestration and session re |
| 5 | 7 | 2026-11-08–2026-11-09 | partial 3, unique 3, content-present 1 | `jules-246569610287923701-3250dd82` | feat(core): integrate session 02 environment orchestration a; feat(core): recover and finalize session 02 environment orch |
| 6 | 2 | 2026-11-08–2026-11-08 | content-present 1, unique 1 | `claude/mission-2-15-4-mobile-presenter-integration`, `claude/mission-2-15-5-mobile-placement-closure` | Record the presenter-routing fix and the unfilled placement ; Make the phone window use the same placement contract as the |
| 7 | 2 | 2026-11-08–2026-11-08 | partial 2 | `codelazr/environment-orchestration-session-02-recovered-8798102482818388694` | feat(core): recover and finalize session 02 environment orch; feat(orchestrator): activate environment orchestration and l |
| 8 | 1 | 2026-11-08–2026-11-08 | partial 1 | `claude/mission-2-15-1-closure`, `claude/mission-2-15-2-mobile-spatial-closure`, `claude/mission-2-15-3-renderer-mobile-validation`, `claude/mission-2-15-4-mobile-presenter-integration`, `claude/mission-2-15-5-mobile-placement-closure`, `claude/mission-2-15-spatial-world` | Give the registry's built-in ring real travel controls in th |
| 9 | 4 | 2026-11-08–2026-11-09 | partial 3, unique 1 | `jules-3488608177676003568-d30852ca` | feat(ci): recover session 3 and resolve live runtime verific; feat(core): recover and finalize session 03 |
| 10 | 2 | 2026-11-08–2026-11-08 | content-present 1, unique 1 | `claude/mission-2-15-5-mobile-placement-closure` | Record the drag and presenter findings, including the proof ; Let a live drag read the live window position and give phone |
| 11 | 1 | 2026-11-08–2026-11-08 | partial 1 | `claude/mission-2-15-2-mobile-spatial-closure`, `claude/mission-2-15-3-renderer-mobile-validation`, `claude/mission-2-15-4-mobile-presenter-integration`, `claude/mission-2-15-5-mobile-placement-closure` | Give phone windows a dock height so a sheet can actually be  |
| 12 | 1 | 2026-11-08–2026-11-08 | partial 1 | `claude/mission-2-15-3-renderer-mobile-validation`, `claude/mission-2-15-4-mobile-presenter-integration`, `claude/mission-2-15-5-mobile-placement-closure` | Name the module host, its presentation and its content for m |
| 13 | 1 | 2026-11-08–2026-11-08 | content-present 1 | `claude/mission-2-15-1-closure`, `claude/mission-2-15-2-mobile-spatial-closure`, `claude/mission-2-15-3-renderer-mobile-validation`, `claude/mission-2-15-4-mobile-presenter-integration`, `claude/mission-2-15-5-mobile-placement-closure` | Measure the overflow chain's min-content instead of hard-cod |
| 14 | 13 | 2026-11-15–2026-11-16 | unique 13 | `freebuff/8994d7c2e03123fc8927b6fc`, `mission-14.3/independent-runtime-acceptance`, `mission-14.4/local-first-continuity`, `mission-14.5/real-cloud-continuity` | Harden Mission 14 continuity and its verified push gate; Prove continuity tools in conversation and record real provi |
| 15 | 7 | 2026-11-15–2026-11-16 | unique 7 | `freebuff/400773963b8c2504ea15ec77`, `m16-3/wp04-creative-continuity` | Make a creation a real object that can leave the cosmos and ; Give fabric, patterns and construction a real engine |
| 16 | 4 | 2026-11-16–2026-11-16 | unique 4 | `claude/blissful-cray-lqhs6g`, `claude/charming-hamilton-icbyrb`, `claude/cosmos-integration-audit-t9ouny`, `claude/jolly-davinci-9w3rle`, `claude/lelu-character-pipeline-gb87lc`, `claude/lelu-improvement-3-finish-lexgtc`, `claude/mission5-lelu-asre-integration-mm6xau`, `experiment/lelu-2-golden-geometry`, `experiment/m25-complete-character-fidelity`, `experiment/m25-visual-fidelity-reconstruction` | M15.3 WP04: settled measurements; a phone can leave her worl; M15.3 WP04: report, gates (2294 tests, 0 fail; lint 0 errors |
| 17 | 9 | 2026-11-16–2026-11-16 | unique 9 | `mission-14.5/real-cloud-continuity` | Record M14.5 retry against current project secrets; Record M14.5 acceptance verdict |
| 18 | 5 | 2026-11-16–2026-11-16 | unique 5 | `mission-14.4/local-first-continuity`, `mission-14.5/real-cloud-continuity` | Document Mission 14.4 authority and continuity contracts; Normalize Mission 14.4 report whitespace |
| 19 | 29 | 2026-11-16–2026-11-16 | unique 28, partial 1 | `claude/blissful-cray-lqhs6g`, `claude/charming-hamilton-icbyrb`, `claude/cool-mccarthy-dliwu9`, `claude/cosmos-integration-audit-t9ouny`, `claude/jolly-davinci-9w3rle`, `claude/lelu-character-pipeline-gb87lc`, `claude/lelu-improvement-3-finish-lexgtc`, `claude/mission5-lelu-asre-integration-mm6xau`, `experiment/lelu-2-golden-geometry`, `experiment/m25-complete-character-fidelity`, `experiment/m25-visual-fidelity-reconstruction` | M15.3 WP04: device procedure (phone world from chat, rotatio; M15.3 WP04: 68-step run r1 in progress (partial output) |
| 20 | 5 | 2026-11-16–2026-11-16 | unique 5 | `m16-3/wp04-creative-continuity` | Judge a creative operation by the state it was asked to reac; Carry the creation a conversation is working on into the nex |
| 21 | 4 | 2026-11-16–2026-11-16 | unique 4 | `mission-14.3/independent-runtime-acceptance`, `mission-14.4/local-first-continuity`, `mission-14.5/real-cloud-continuity` | Add Mission 14.3 browser execution and offline evidence; Record the Mission 14.3 branch push result |
| 22 | 3 | 2026-11-16–2026-11-16 | unique 3 | `freebuff/m17-coe-wp03-responsive-canvas`, `freebuff/m17-coe-wp06-projection-integrity` | Give the camera one owner, so a framed view stays framed; Let a capable machine say what it is, and keep saying it |
| 23 | 6 | 2026-11-16–2026-11-16 | unique 6 | `claude/cool-mccarthy-dliwu9`, `claude/lelu-improvement-3-finish-lexgtc` | Self-study audit: why research does not become applied impro; Development record and Gate 2; self-study runs her own self- |
| 24 | 8 | 2026-11-16–2026-11-16 | unique 8 | `freebuff/m22-2-global-cognitive-context-elimination`, `freebuff/m22-3-genesischat-browser-acceptance`, `freebuff/m22-4-memory-deletion-browser-verification`, `freebuff/m22-5-historical-memory-residue`, `integration/m16-3-wp05-reconciliation`, `m22.5/learning-integrity-candidate`, `m22.6/memory-integrity-deletion-propagation`, `m22.6/voice-runtime-release-qualification`, `m22.7/live-voice-qualification`, `m22.7/universal-memory-erasure`, `m22.8/real-time-conversational-intelligence`, `m22.9/persistent-voice-runtime`, `m23.0/embodied-conversational-experience`, `temporal-studio/asre-core` | Pin the referent rules, the verdicts and the one bounded ret; Record WP06 delivery and remote verification |
| 25 | 6 | 2026-11-16–2026-11-16 | unique 6 | `freebuff/m17-coe-wp06-projection-integrity` | Ask the renderer which pixels are the object, not which pixe; Report where objects are drawn, not where a stale pose said  |
| 26 | 23 | 2026-11-17–2026-11-17 | unique 23 | `claude/blissful-cray-lqhs6g`, `claude/jolly-davinci-9w3rle`, `claude/lelu-character-pipeline-gb87lc`, `claude/mission5-lelu-asre-integration-mm6xau`, `experiment/lelu-2-golden-geometry`, `experiment/m25-complete-character-fidelity`, `experiment/m25-visual-fidelity-reconstruction` | feat(volume): volumetric intelligence - boundary/interior, f; feat(foundry): offline TripoSR CPU worker, NRE ingest, upstr |
| 27 | 24 | 2026-11-17–2026-11-18 | unique 23, partial 1 | `claude/jolly-davinci-9w3rle`, `claude/lelu-character-pipeline-gb87lc`, `claude/mission5-lelu-asre-integration-mm6xau`, `experiment/lelu-2-golden-geometry`, `experiment/m25-complete-character-fidelity`, `experiment/m25-visual-fidelity-reconstruction` | feat(asre): WP05 temporal creation - snapshots, diffs, undo/; feat(asre): WP04 persistent character identity with dependen |
| 28 | 1 | 2026-11-17–2026-11-17 | unique 1 | `temporal-studio/asre-core` | Add ASRE core: decomposition, hypotheses, layered and compon |
| 29 | 1 | 2026-11-17–2026-11-17 | unique 1 | `claude/cool-mccarthy-dliwu9` | Record the real self-correction attempt: no correction yet,  |
| 30 | 1 | 2026-11-17–2026-11-17 | unique 1 | `claude/lelu-improvement-3-finish-lexgtc` | Improvement 3: finish the development record, harden both ga |
| 31 | 25 | 2026-11-18–2026-11-18 | unique 24, partial 1 | `claude/lelu-character-pipeline-gb87lc` | feat(lelu-wp04): her skull vault constrained (conical crown ; checkpoint(lelu): canonical GLB regenerated through the M1-M |
| 32 | 4 | 2026-11-18–2026-11-19 | unique 4 | `freebuff/m22-2-global-cognitive-context-elimination`, `freebuff/m22-3-genesischat-browser-acceptance`, `freebuff/m22-4-memory-deletion-browser-verification`, `freebuff/m22-5-historical-memory-residue`, `integration/m16-3-wp05-reconciliation`, `m22.5/learning-integrity-candidate`, `m22.6/memory-integrity-deletion-propagation`, `m22.6/voice-runtime-release-qualification`, `m22.7/live-voice-qualification`, `m22.7/universal-memory-erasure`, `m22.8/real-time-conversational-intelligence`, `m22.9/persistent-voice-runtime`, `m23.0/embodied-conversational-experience` | Give LÉLU measured feature replication, not just description; Add Lélu hair reference photos (16) for 3D avatar |
| 33 | 11 | 2026-11-18–2026-11-19 | unique 10, partial 1 | `claude/jolly-davinci-9w3rle`, `experiment/lelu-2-golden-geometry`, `experiment/m25-complete-character-fidelity`, `experiment/m25-visual-fidelity-reconstruction` | docs(lelu2): measure the golden geometry work and state what; feat(lelu2.1): draw her hair as swept tubes without moving h |
| 34 | 6 | 2026-11-19–2026-11-19 | unique 6 | `freebuff/m22-2-global-cognitive-context-elimination`, `freebuff/m22-3-genesischat-browser-acceptance`, `freebuff/m22-4-memory-deletion-browser-verification`, `freebuff/m22-5-historical-memory-residue`, `m22.6/memory-integrity-deletion-propagation`, `m22.7/universal-memory-erasure` | Record M22.2 mission commit hashes; Add memory sovereignty to Lélu's memory pipeline |
| 35 | 17 | 2026-11-19–2026-11-20 | unique 17 | `claude/jolly-davinci-9w3rle`, `experiment/m25-complete-character-fidelity` | wip(m25c): pause - headpiece removal and catsuit hair to the; feat(m25c): Outfit B and three selectable looks in her exist |
| 36 | 3 | 2026-11-19–2026-11-19 | unique 3 | `integration/m16-3-wp05-reconciliation`, `m22.5/learning-integrity-candidate`, `m22.6/voice-runtime-release-qualification`, `m22.7/live-voice-qualification`, `m22.8/real-time-conversational-intelligence`, `m22.9/persistent-voice-runtime`, `m23.0/embodied-conversational-experience` | Refresh the PCI-FR 2.1 hair comparison for the final headpie; Replace the 2.1 hair shell with scalp-rooted volumetric lock |
| 37 | 3 | 2026-11-19–2026-11-19 | cherry-picked(-x) 3 | `m22.6/voice-runtime-release-qualification`, `m22.7/live-voice-qualification`, `m22.8/real-time-conversational-intelligence`, `m22.9/persistent-voice-runtime`, `m23.0/embodied-conversational-experience` | Repair the perception typecheck and close the M22.6 learning; Record M22.6 build, voice pipeline, learning-integrity and r |
| 38 | 3 | 2026-11-19–2026-11-20 | unique 3 | `freebuff/m22-4-memory-deletion-browser-verification`, `freebuff/m22-5-historical-memory-residue`, `m22.6/memory-integrity-deletion-propagation`, `m22.7/universal-memory-erasure` | Give memory deletion a way out, and stop checkpoint and self; Record M22.4 mission commit hashes |
| 39 | 2 | 2026-11-19–2026-11-19 | cherry-picked(-x) 2 | `m22.5/learning-integrity-candidate`, `m22.6/voice-runtime-release-qualification`, `m22.7/live-voice-qualification`, `m22.8/real-time-conversational-intelligence`, `m22.9/persistent-voice-runtime`, `m23.0/embodied-conversational-experience` | Record M22.5 learning-integrity audit and candidate verifica; Carry provenance, keywords and corrections through LÉLU's on |
| 40 | 2 | 2026-11-19–2026-11-19 | unique 2 | `freebuff/m22-3-genesischat-browser-acceptance`, `freebuff/m22-4-memory-deletion-browser-verification`, `freebuff/m22-5-historical-memory-residue`, `m22.6/memory-integrity-deletion-propagation`, `m22.7/universal-memory-erasure` | Record M22.3 mission commit hashes; Add a dev-only scene switch and prove browser isolation end  |
| 41 | 1 | 2026-11-19–2026-11-19 | unique 1 | `claude/jolly-davinci-9w3rle`, `experiment/m25-complete-character-fidelity`, `experiment/m25-visual-fidelity-reconstruction` | feat(m25): LÉLU visual fidelity — calibrated skin, repaired  |
| 42 | 2 | 2026-11-20–2026-11-20 | unique 2 | `freebuff/m22-5-historical-memory-residue`, `m22.6/memory-integrity-deletion-propagation`, `m22.7/universal-memory-erasure` | Record M22.5 mission commit hashes; Leave proof of a deletion, then clean what still quotes it |
| 43 | 2 | 2026-11-20–2026-11-20 | unique 2 | `m22.6/memory-integrity-deletion-propagation`, `m22.7/universal-memory-erasure` | Record the M22.6 commit hash and remote verification; Make forgetting automatic and stop every read path from serv |
| 44 | 3 | 2026-11-20–2026-11-20 | unique 3 | `m23.0/embodied-conversational-experience` | Record the M23.0 embodied-experience evidence package; Account for every voice turn instead of letting silence go u |
| 45 | 3 | 2026-11-20–2026-11-20 | cherry-picked(-x) 3 | `m22.8/real-time-conversational-intelligence`, `m22.9/persistent-voice-runtime`, `m23.0/embodied-conversational-experience` | Correct the evidence counts in the M22.8 record; Make her speech belong to the turn that asked for it |
| 46 | 2 | 2026-11-20–2026-11-20 | unique 2 | `m22.7/universal-memory-erasure` | Record the M22.7 commit hash and remote verification; Make a deleted memory unable to come back through the cloud |
| 47 | 4 | 2026-11-20–2026-11-20 | cherry-picked(-x) 4 | `m22.9/persistent-voice-runtime`, `m23.0/embodied-conversational-experience` | Keep her voice loaded instead of reloading it for every sent; Record the remote verification of the M22.9 voice candidate |
| 48 | 1 | 2026-11-20–2026-11-20 | unique 1 | `claude/jolly-davinci-9w3rle` | M25 round 3: hairstyles and purses as wardrobe items, coat h |
| 49 | 2 | 2026-11-20–2026-11-20 | cherry-picked(-x) 2 | `m22.7/live-voice-qualification`, `m22.8/real-time-conversational-intelligence`, `m22.9/persistent-voice-runtime`, `m23.0/embodied-conversational-experience` | Record the remote verification of the M22.7 voice candidate; Speak through an opt-in local voice and record the live voic |
| 50 | 1 | 2026-11-22–2026-11-22 | cherry-picked(-x) 1 | `m22.9/persistent-voice-runtime` | Keep her voice session alive through lost microphones, hidde |
| 51 | 2 | 2026-11-22–2026-11-22 | cherry-picked(-x) 1, unique 1 | `claude/cosmos-integration-audit-t9ouny` | Cosmos × Infinite Cosmos integration: first-paint sky, navig; Cosmos integration report: full suite result (2310 tests, 0  |

## 4. Duplicated / superseded work found

* **Voice line (15 commits of `m22.5…m22.9`)** — already cherry-picked onto the baseline by M22.10 with `-x` provenance; content verified there. Merged now for ancestry; the baseline's resolutions kept.
* **`75100701`** (Cosmos × Infinite Cosmos) — on the baseline as `2d8fc85`.
* **Mission 2.15 / 5.2 (7–8 Nov, Codebuff)** — every file identical on the baseline except `GenesisModuleHost.tsx`, whose baseline version contains the line's ideas in evolved form (dock-height sheet, named content host, `committedRect` manual placement, shared presenter contract).
* **Jules / Codelazr Session 02–03** — integrated by content by Mission 10 / Mission 3.3; every tool id and export of their versions of the six shared files (ToolDispatcher, ToolRegistry, EnvironmentTools, EnvironmentOrchestrationEngine, InterfaceTools, Bootstrap) exists on the baseline.
* **M15.3 `orbClearance`** — superseded by M17.1's measured lift on the same obstacle.
* **jolly-davinci `leluFaceColour`** — superseded by the character pipeline's `face.ts` landmark painting.
* **Branch families that are pure subsets** (no work of their own): `claude/blissful-cray`, `claude/charming-hamilton`, `claude/mission5-lelu-asre-integration`, the three `experiment/*` branches, `freebuff/1fb0099…`, `freebuff/44c122…`, `freebuff/8994d7…`, `freebuff/400773…`, `freebuff/m17-coe-wp03`, `freebuff/m22-2/3/4/5`, `m22.5`, `m22.6/*`, `m22.7/live-voice-qualification`, `m22.8`, `mission-14.3`, `mission-14.4` — each is an ancestor of a tip that was merged.

## 5. Incomplete or broken work found in the sources

* `claude/jolly-davinci-9w3rle` @ `7f265c2b`: three tests fail **on the branch itself** (foundry-m25c handbags, foundry source ordering, outfit-switching by occasion) — M25 round 3 changed the wardrobe/assets after those tests were written.
* `claude/lelu-character-pipeline-gb87lc`: `src/core/asre/reference/face.ts` used TypeScript parameter properties, which the shared `tsconfig` (`erasableSyntaxOnly`) rejects — the branch did not typecheck under the canonical configuration.
* `jules-246569610287923701`: its verify-development edits weaken acceptance checks; its MemoryEngine edit reverses a deliberate canonical rule (refused, see ledger).
* `plugins/selfJournalApi.ts` (from jolly-davinci): broken on the production `server.ts` router (404 for every `/api/self/*`), and blind to merge commits.

