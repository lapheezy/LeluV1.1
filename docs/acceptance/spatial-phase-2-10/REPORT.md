# Phase 2.10 — Mobile Studio reachability and deferred reveal lifecycle

Starting checkpoint `ef1ea1d` (tree `5c18a6e`), baseline `3092cd8`.
Remote integrated: `claude/master-integration` at `095b7f9`.
Branch after this work: `freebuff/phase-2-2`, pushed to `claude/master-integration`.
No force-push. Ending commits: `ba9b8b6` (merge), `2c7b767` (both fixes),
`17ad0be` (exact preview hostname), report commit.

No new architecture: the same `placeInWorld → SpatialIntentBus → commit →
verify → reveal` path, the same Studio, the same scene and camera ownership.

## 1. Root cause — the Studio card action was outside the viewport

The phone sheet (`GenesisWindowFrame`, `narrow`) is `overflowY: hidden` and puts
its content inside `PinchZoomContainer`, whose inner wrapper carries
`transform: scale(1)`. Inside that, `.lst-library` used `height: 100%` against an
auto-height transformed parent, and `.lst-grid` was a **second** scroll container
(`overflow: auto`). So the card's Place-in-world action lived in a scroller whose
height came from a percentage chain inside a transformed wrapper: Chromium could
not scroll it into view at 375×812 and reported the element outside the viewport,
so a pointer or touch never landed. The button existed, was not `display: none`,
and had a real label — it was simply unreachable.

Fix (`src/app/scene/genesis/studio/studio.css`, phone only, `max-width: 720px`):

* `.lst-library { height: auto; }` — removes the percentage-height chain.
* `.lst-grid { grid-template-columns: 1fr; overflow: visible; }` — one scroller
  (the sheet body) instead of two, one column at phone width.
* `.lst-card`, `.lst-card-open`, card children: `min-width: 0` so a long title
  cannot push an action sideways.
* `.lst-card .lst-btn { align-self: flex-start; }` — the action sits in flow.

Nothing is hidden, removed or shrunk: titles, subtitles and button labels are
unchanged, and desktop keeps its existing grid and card presentation.

## 2. Root cause — the reveal framed an older object

`SpatialRevealIntent` used `requestedAt` (a millisecond timestamp) as the reveal's
identity, and the bridge keyed "already framed" on it. Two consequences:

1. Two placements in the same millisecond produced the same key, so the second was
   treated as already framed and never reached the camera.
2. A request was never *consumed*. A remount, or the world coming back after a
   panel, could re-frame an old request, and `window.__leluReveal` could still
   describe the previous object — which is exactly how a Studio placement read back
   as the earlier `Jewelry` frame.

Fix:

* `SpatialRevealIntent`: every request carries a stable unique `id`
  (`requestedAt` + monotonic sequence), `consume(id)` records that identity as
  framed, `isConsumed(id)` answers it. `latestRequest()` keeps its old meaning, so
  the world-return policy is unchanged and no dashboard/workspace behaviour moves.
* `SpatialRevealBridge`: keyed by `request.id`; a request that is already consumed
  is never framed again; after a successful frame the request is consumed once; a
  run superseded mid-flight neither consumes nor publishes a frame; a new request
  clears the previous `__leluReveal` and publishes `__leluRevealPending`, so a stale
  frame can never be read as the answer to a newer placement.

Tests added (`tests/spatial-reveal.test.ts`):

* two rapid reveals have distinct identities even in the same millisecond;
* a reveal is consumed once, only by its own id, idempotently, without erasing the
  world-return target.

## 3. Remote reconciliation

The remote `claude/master-integration` (`095b7f9`) had diverged; a fast-forward was
impossible, so it was merged (`ba9b8b6`), not forced. Four conflicts were resolved
by hand:

* `GenesisChat.tsx` — kept the incoming hook-order comment (same code path).
* `GenesisInterface.tsx` — kept `SpatialRevealBridge` **and** the incoming
  "unmount the nav while a conversation or window owns the phone screen" rule.
* `LeluCompanion.tsx` — adopted the incoming `plan`/`AvatarAnchor` placement model;
  removed this branch's superseded `collapsed`/`immersiveDock` leftovers and the
  now-unused `useImmersive` helper.
* `AIRouter.ts` — both resolvers are live in the merged router; kept `SpatialResolver`
  and `IntelligenceResolver`, imports and instances.
* `bun install` added `gsap@3.15.0`, which the remote branch had introduced.

## 4. Gates (merged tree)

| Gate | Result |
| --- | --- |
| `bun run test` | **1695 pass, 0 fail, 6 skip** (1701) |
| `bun run typecheck` (`tsc -b --force`) | **0** |
| `bun run lint` | **0 errors**, 115 warnings |
| `bun run build` | **0**, built in 4.72 s |

## 5. Live verification — what actually ran, and what did not

| Check | Result |
| --- | --- |
| Reveal identity/consume unit tests | **PASS** (in the suite above) |
| Desktop Studio/Workspace placement + reveal | **PASS in Phase 2.9** (`ef1ea1d`); not re-run after the merge |
| Card action reachable and clickable at 375×812 | **BLOCKED in this runner** |
| Reveal after closing the Studio panel on a phone | **BLOCKED in this runner** |
| 390×844 / 430×932 / 1440×900 live runs | **NOT RUN after the merge** |

The blocker is environmental, and it is recorded rather than papered over:

* Local Chromium (`chromium-1234`, software GL) is terminated by the runner within
  roughly 0.3–1.5 s of loading the built bundle: `Target page, context or browser
  has been closed` with the browser's `disconnected` event, at every viewport, with
  and without `isMobile`/`hasTouch`, with SwiftShader, with `--disable-gpu`, and
  with `--disable-webgl`. A trivial `about:blank` page survives. The same browser
  binary needed a user-space sysroot rebuilt with `apt-get download` before it
  would start at all in this session.
* The Browser panel preview hostname is rejected by the dev server
  (`Blocked request. This host ... is not allowed`), so the panel showed an error
  page instead of the app; restarting the preview with that exact hostname in
  `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` is required for panel-driven checks.
* The Browser panel was blocked by the dev server's host allowlist
  (`403 Blocked request. This host ... is not allowed`). Fixed at the source:
  `vite.config.ts` now allows only the exact hostnames in `LELU_ALLOWED_HOSTS`
  (unset behaves as before). Verified: the panel hostname went from **403 to
  200** and the panel rendered the live app at 328×528. The panel's Playwright
  bridge still fails before running any script with
  `The property 'options.mode' must be one of: 'strip'. Received 'transform'`,
  so panel-side scripted driving is unavailable until that bridge is fixed.

No screenshot or claim in this report substitutes for a real mobile interaction
that did not happen. The CSS fix is therefore **implemented and unit-level safe,
but visually unverified**, and the reveal fix is **unit-verified, not yet observed
in a live phone session**. That is the honest state of this phase.

## 6. Files changed

* `src/core/spatial/SpatialRevealIntent.ts` — unique request identity, consume-once.
* `src/app/scene/genesis/spatial/SpatialRevealBridge.tsx` — identity-keyed framing,
  supersede guard, stale-diagnostic clearing.
* `src/app/scene/genesis/studio/studio.css` — phone card layout reachability.
* `tests/spatial-reveal.test.ts` — two lifecycle tests.
* Merge resolution: `GenesisChat.tsx`, `GenesisInterface.tsx`,
  `LeluCompanion.tsx`, `AIRouter.ts`, `package.json`/`bun.lock` (gsap).
* `vite.config.ts` — exact preview hostname from `LELU_ALLOWED_HOSTS`.
