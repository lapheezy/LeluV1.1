# MISSION 5.4B.11 — CANONICAL REPLAY, CHAT UNIVERSE RECONCILIATION & SPATIAL INTEGRATION

Replay-and-reconciliation mission. No portal interaction code was rewritten, no second
interaction system was created, and canonical was never modified directly.

## 1. Verified canonical starting HEAD

`ce768e08cebd71eaa05418c5942ad637a8ac0596` — re-verified against `git ls-remote` at the start
of this mission, unchanged from the 5.4B.10 reading.

## 2. Verified source branch HEADs

- `claude/mission-5-4b-10-spatial-hardening` → `c7ef650b1e05f0f03577f74fc8210a7ac73983b4`
- `claude/mission-5-4-spatial-interaction` → `fff0f86c5e273eab5798fefd1156a207a71e9915`

Merge base with canonical: `91f5361`. Source was 57 behind / 11 ahead (plus the 5.4B.10
evidence commit).

## 3. Replayed commit list

All 11 interaction commits plus the 5.4B.10 evidence commit were replayed in original logical
order with `git cherry-pick`, one commit at a time, onto a branch created at canonical:

| # | Original | Replayed | Subject |
|---|---|---|---|
| 1 | 382088d | 5ab6a13 | Give the portal field a shape you can aim at and a mouth you can click |
| 2 | d8ab1c8 | f51eb12 | Derive each portal mouth from its neighbours so a click has one owner |
| 3 | c58247a | d38b115 | Record what the portal handler actually receives, and prove the camera never settles |
| 4 | 8b4b7a0 | f51a766 | Trace the lost portal click to the interface layer, not the raycast |
| 5 | 91f12f0 | f4c94f3 | Measure why a click still cannot reach a portal, pixel by pixel |
| 6 | 7c91d7d | 2a01c8e | Give the pointer back to the world, and let a portal outrank the core body |
| 7 | 498eca1 | 8c7788d | Measure where a portal press is lost, and prove it is not the raycast |
| 8 | d21c87d | 3340fb1 | Let a portal activation complete on pointer release, not only on a synthetic click |
| 9 | defa243 | 6c9724e | Record ten live portal attempts: activation fixed, travel still never lands |
| 10 | 1a22433 | a7e413b | Time spatial transitions by the wall clock so travel actually arrives |
| 11 | fff0f86 | e3ca703 | Make a press own its portal from pointer-down to release |
| 12 | c7ef650 | 61b27c8 | Extend spatial acceptance to swap, retap, touch and low-FPS, and map the canonical merge |

**Conflicts during replay: zero.** No file required manual resolution, and no canonical feature
was removed to make the replay apply.

### Correction to the 5.4B.10 prediction

Mission 5.4B.10 reported that `GenesisChat.tsx` and `GenesisInterface.tsx` conflicted and that
our 5.4B.4 routing edits collided with canonical's chat rewrite. **That was wrong.**
`git log 91f5361..fff0f86 -- src/app/scene/genesis/GenesisChat.tsx src/app/scene/genesis/GenesisInterface.tsx`
is empty: the spatial work never touched the chat surfaces. The earlier `merge-tree` reading was
misinterpreted, and the replay confirms there was nothing to reconcile there.

## 4. Final integration branch and remote HEAD

- Branch: `claude/mission-5-4b-11-canonical-integration`, created at canonical `ce768e0`.
- 12 commits ahead of canonical, 0 behind.

## 5. Files changed (application and tests)

`src/app/scene/spatial/`: `SpatialPortals.tsx`, `portalField.ts`, `portalTrace.ts`,
`pressOwnership.ts`, `tweenDriver.ts`, `SpatialNavigator.tsx`.
Also `src/app/scene/genesis/materials/GenesisCore.tsx`,
`src/app/scene/genesis/render/GenesisRenderer.tsx`, `src/index.css`, and the tests
`portal-field.test.ts`, `portal-press-ownership.test.ts`, `spatial-experience.test.ts`,
`tween-driver.test.ts`, `tween-driver-lagsmoothing.test.ts`.
Everything else in the replayed range is acceptance evidence under `docs/acceptance/`.

No chat, orchestration, registry, provider or workspace file was added, deleted or rewritten.

## 6. SpatialNavigator.tsx reconciliation

This was the only file changed independently on both sides, and it needed **no** manual merge
because the two changes occupy different regions and different props.

- Canonical's contribution survives intact: `useUniverseOpen()`, the `composerLift`/`liftOverflowsTop`
  import, the chat-composer clearance `useEffect` with `navRef`/`lift` measurement, the
  `transform: translateY(-lift)` and `data-spatial-composer-clearance` attributes, and
  `hidden = surface.chatOwnsScreen || universeOpen`.
- The spatial mission's contribution survives intact: the three panel surfaces are decoration and
  no longer own the pointer (`pointerEvents: "none"`), with the routing rationale comments, so a
  portal behind a pill/chip panel can be pressed.
- Result in the integrated file: **5 × `pointerEvents: "none"`, 0 × `pointerEvents: "auto"`**,
  and 2 references to `composerLift`. Neither side accepted wholesale.

## 7. Chat Universe integration decisions

- The newer Chat Universe is preserved untouched: `ChatUniverse.tsx`, `UniverseChatWindow.tsx`,
  `universeModel.ts`, `universeOpen.ts`, `chatUniverse.css` are byte-identical to canonical.
- Portal routing needed no adaptation: the `conversation` destination already resolves into the
  current chat architecture. Canonical hides the world rail while the Universe is open, which the
  integrated file keeps, so spatial navigation and the Universe rail never compete.
- No duplicate chat host, no competing navigation state, no stale reference to a removed component.

## 8. Proof the legacy chat architecture was not reintroduced

- `src/app/scene/genesis/MultiChatTabs.tsx`: still absent.
- `grep -rniE "MultiChatTabs|multi-chat-tabs|chatTabs|tabStrip" src`: **zero matches**.
- `ChatUniverse` is mounted once, at `GenesisInterface.tsx:870`.
- Live DOM after the portal opened the conversation destination: `dialogCount: 1`
  (`aria-label="Chat Universe"`), `tablists: 0`, `legacyTabs: false`, `replacementChars: 0`.
- `tests/old-chat-panel-removed.test.ts` and the rest of the chat suite: **69/69 pass**
  (old-chat-panel-removed, chat-surface, chat-transcript, cosmos-chat-experience, mission-10-3).

## 9. Live portal acceptance on the integrated branch

Fresh page load per row, real CDP mouse input, pixel verified inside the target mouth immediately
before pressing, no app handler called. Evidence: `accept-batch1.json`, `accept-batch5.json`,
`accept-batch2.json`.

| Destination | Attempts | Arrived correctly | Wrong destination | Lost after valid claim | Claim == release | Duplicate activation |
|---|---|---|---|---|---|---|
| Files | 5 | **5** | 0 | 0 | 5 | 0 |
| Studio | 5 | **5** | 0 | 0 | 5 | 0 |
| Conversation (Chat Universe) | 1 | **1** | 0 | 0 | 1 | 0 |

Travel times: Files 685–2806 ms, Studio 1250–1503 ms, Conversation 1348 ms.

One earlier Files run contained a `no-claim` load (press delivered where no mouth was claimed) and
one load lost its browser under two concurrent software-rendered Chromium instances; both were
harness artifacts, are preserved rather than hidden, and were superseded by the clean 5/5 run.

## 10. Low-FPS and transition results

- 6× CPU throttle (`Emulation.setCPUThrottlingRate`), `lagSmoothing(0)` retained in `tweenDriver.ts`:
  arrived at the correct scene in **1209 ms**, claim == resolution, no premature commit, no
  duplicate transition, no stale transition state.
- Sequential tap on the integrated branch: arrived in **1579 ms**, one activation only.
- Transition lifecycle is unchanged from the accepted baseline; unit coverage in
  `tests/tween-driver.test.ts` (monotonic progress, completes exactly once) and
  `tests/tween-driver-lagsmoothing.test.ts`.
- The page-side progress series under throttle again captured few samples, so monotonic progress is
  evidenced by those unit tests, not by the sampler.

## 11. Full regression on the integrated branch

| Gate | Command | Result |
|---|---|---|
| Typecheck | `bunx tsc -b --force` | exit 0 |
| Build | `bun run build` | exit 0 (built in 21.4 s) |
| Lint | `bun run lint` | exit 0 — 128 warnings, **0 errors** |
| Tests | `bun run test` | exit 0 — **1823 tests, 1821 pass, 0 fail, 2 skipped** |
| Chat suite | focused run | 69/69 pass |

The integrated count (1823) exceeds both the source branch (1756) and mission 5.4B.9 (1743)
because canonical's own suites are included. No test was skipped, weakened or removed by this
mission.

## 12. Remaining blockers

- **None that block integration.** The replay applies cleanly onto current canonical.
- The `conversation` destination opens the Chat Universe dialog; it does not auto-open a
  conversation window (`windows: 0` in the live trace). Opening a window remains the Universe
  rail's own action and was not exercised by this portal probe — stated as unverified, not as passing.
- The live neighbour-swap and second-tap gaps documented in 5.4B.10 are unchanged and not
  re-claimed here.
- Mission 2.15.x mobile window placement remains a separate workstream and is **not** addressed.

## 13. Canonical merge-readiness decision

**READY — safe to merge into `claude/master-integration` after human review.**

The integration branch is canonical `ce768e0` plus 12 replay commits, with zero conflicts, zero
removed canonical features, zero changes to the Chat Universe or orchestration code, and a passing
full suite plus live 11/11 portal acceptance. It was deliberately **not** merged or pushed into
canonical by this mission; merging requires explicit authorisation.

## Status

| Criterion | Result |
|---|---|
| Replay without rebuilding | yes — 12 cherry-picks, 0 manual resolutions |
| Chat Universe preserved | yes — files byte-identical, single host, 69/69 chat tests |
| Legacy chat panel not reintroduced | proven by grep, tests and live DOM |
| SpatialNavigator reconciled, neither side discarded | yes — both sides present in one file |
| Live portal acceptance | Files 5/5, Studio 5/5, Conversation 1/1, 0 wrong destinations |
| Low-FPS / transitions | correct destination, no premature or duplicate commit |
| Full regression | pass, 0 fail |
| Canonical modified? | no |
