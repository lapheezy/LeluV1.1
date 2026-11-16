# MISSION 5.4 / 5.4B.1 — Spatial Interaction Completion (blocked on targeting)

Status: **INCOMPLETE — Mission B still FAILS.** 5.4B.1 removed a real geometric
defect (overlapping interactive mouths) and proved the new invariant, but a
measured canvas click attributed by the renderer's own raycaster to
`scene:files` still ended with `media` active. Per the stop condition, Missions
C–G were not started and B is not marked complete.

See §8 for the 5.4B.1 work; §3–§6 describe the 5.4 baseline.

## 1. Starting state (verified before editing)

| Fact | Value |
|---|---|
| True remote tip of `claude/master-integration` (`git ls-remote`) | **`91f5361`** |
| Commits on top of Mission 5.3's `ae5a9cb` | **1** — "Step 3: one persistent LÉLU presence moving through the interface (retires the avatar window)" |
| Starting tree hash | `1c42ab0fd45c0caa8fcb6c16e1d74146eec50a62` |
| Mission branch created from it | `claude/mission-5-4-spatial-interaction` |

The local `origin/claude/master-integration` ref was stale at `1031053`, which is
an **ancestor** of `ae5a9cb`; `ls-remote` was used as the authority. The
concurrent avatar-presence commit (`91f5361`) was **not** overwritten — the
mission branch starts at it. Earlier concurrent work already merged before this
mission (`1031053` Creation Studio engine, `f0e0781` Mission 5.2 execution) is
present unchanged.

## 2. What was implemented

### 2.1 `src/app/scene/spatial/portalField.ts` (new, pure)

One placement model shared by the ring, the probe and the tests: a deterministic
ring slot per built-in destination, extra portals orbiting their destination's
slot on the golden angle, plus `duplicatePortalIds()` and `collidingPortalIds()`
so a stale or coincident object is detectable rather than invisible.

Rationale, measured: portals used to sit at each destination's own camera
target. In the wide view that projected eleven portals into overlapping points
and produced this failure — a click aimed at `scene:studio` started a transition
to `scene:portal`. A field you cannot aim at is not an interactive field.

### 2.2 `src/app/scene/spatial/SpatialPortals.tsx`

- **Readable identity**: each portal carries an in-world label (`drei <Html>`)
  rendering its registry label as a real `<button>` (`data-portal-select="<id>"`,
  `aria-label="Travel to …"`). The chip, the seam and a keyboard Enter all call
  **one** `select()` — one selection path, one travel call.
- **Interactive region**: a hit disc (`spatial-portal-hit-<id>`) over the
  portal's mouth. The handlers previously lived only on the torus, whose centre
  is a **hole**; a measured click at a portal's projected centre raycast through
  it and did nothing.
- **Conflict refusal**: a click while another destination is in flight is
  ignored rather than rebasing the path.
- **Selection state** with removal-safe clearing (a portal removed while
  selected leaves no ghost).
- **Two read-only probes** (same convention as `SpatialLayer`):
  `__leluPortalField()` — registry ids, the mesh each claims to have drawn, its
  world position, projected screen point, hit-surface presence, duplicates and
  collisions; `__leluPortalPick(x,y)` — what the renderer's own raycaster says
  is under a screen point.

### 2.3 `src/app/scene/genesis/render/GenesisRenderer.tsx`

`<SpatialPortals />` is now a **sibling** of the `GenesisWorld` root instead of a
child. The root rotates on its own axis every frame; a ring framed from the
camera inside a rotating parent drifts out of the view axis — measured: eleven
portals reported on screen but projected up to 770 px right of where they were
framed.

### 2.4 Tests

- `tests/portal-field.test.ts` (new, 7 tests): one drawn object per identity, no
  coincident slots, a second portal to the same environment never stacks, removal
  leaves no stale placement, rename follows without changing identity, a
  reloaded field equals the saved one, Core/Cosmos are the world and not portals.
- `tests/spatial-experience.test.ts`: the "portal geometry is stable between
  emitted frames" invariant previously asserted a literal memo dependency list
  from 5.3. It now asserts the same property against the new geometry — built
  from the registry list, framed by the **scene pose**, with no `useFrame`-driven
  geometry — which is stricter than the literal it replaced.

## 3. Measurements (running app, Chromium, 1440×900, software compositor)

From `measurements/portal-click.json` and `measurements/interaction.json`:

| Measurement | Result |
|---|---|
| Registry portals | 11 |
| Portals placed / drawn / hit-surface present | **11 / 11 / 11** |
| Duplicate identities | `[]` |
| Coincident placements | `[]` |
| Label chips in the DOM | 11 |
| Portals on screen (Core view, camera settled) | **11 / 11** |
| Ring centred (screens) | galaxy 720,649 · planet 914,614 · portal 1046,522 · agents 1075,402 · browser 991,292 · studio 821,226 · research 618,226 · projects 447,292 · files 363,404 · media 393,524 · conversation 526,615 |

**Direct click, measured:** a canvas point resolved by the raycaster to
`spatial-portal-hit-scene:files` was clicked; a `portal-open` transition started
with `destination: "portal"` — **not** `files`. A second run resolved to a point
over a DOM chip instead of bare canvas. In the earlier anchor-based layout, a
click aimed at `scene:studio` also travelled to `scene:portal`.

Conclusion: clicks **do** reach portal meshes and **do** start real transitions,
but selection is **not reliably the portal that was aimed at**. That is a FAIL
against Mission B's "selecting the portal identifies its actual registry
destination", and it is reported as such.

## 4. Acceptance matrix

| Requirement | Status | Basis |
|---|---|---|
| A. Every registry portal has a visible 3D representation | PASS | 11/11 drawn, probe reads the real scene graph |
| A. Distinguishable identity (unique visual/identifier, labels, hover) | PARTIAL | 11 unique slots + 11 labels + hover/selection feedback; mesh appearance differs only by accent/size, not verified visually per mesh |
| A. Visual updates on create/remove/rename; no stale objects | PASS (unit) / PARTIAL (live) | pure model + registry tests; live create/remove not exercised this mission |
| B. Clicking a 3D portal starts a transition | PASS | `portal-open` started from a canvas click |
| B. The selected portal is the one aimed at | **FAIL** | clicked `files`, travelled to `portal` |
| B. Rapid repeat / conflict / removal-during-interaction | PARTIAL | conflict guard implemented; rapid run started a transition, not measured to completion |
| B. Travel after reload | UNVERIFIED | probe did not complete this pass |
| C. Conversation continuity across real travel | UNVERIFIED | not attempted |
| D. Creation Studio artifact lifecycle in the environment | UNVERIFIED | not attempted |
| E. Manual and pinned placement, persisted | UNVERIFIED | existing drag/pin + `ModuleLayoutStore` untouched, not exercised |
| F. Lifecycle/performance measurements | UNVERIFIED | not attempted |
| G. Capability presentation contract + one integration | UNVERIFIED | not attempted |
| Gates | see §5 | |

## 5. Gates (this branch, this commit)

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc -b --force` | **0 errors** |
| Unit/integration suite | `bun run test` | **1736 pass, 0 fail, 2 skipped** (see §5.1) |
| Lint | `bun run lint` | **0 errors, 130 warnings** (Mission 5.3 baseline 117 + 8 from merged Studio work + 5 introduced by this mission's new deps arrays) |
| Production build | `bun run build` | **exit 0**, `✓ built in 7.13s` |
| Portal tests | `bun test tests/portal-field.test.ts tests/spatial-portals.test.ts tests/portal-dispatch.test.ts` | **20 pass, 0 fail** |
| Spatial experience | `bun test tests/spatial-experience.test.ts` | pass (invariant updated, §2.4) |

### 5.1 How the suite was run

The suite is one command (`bun run test`, ~210 s). Two complete runs were killed
by the cloud runner's command limit mid-run (exit 137), so the **same file list**
was executed as two halves with the identical `tsx --test` invocation:

| Half | Files | Result |
|---|---|---|
| 1 | first 82 | 864 tests, **864 pass, 0 fail, 0 skipped** |
| 2 | remaining 82 | 874 tests, **872 pass, 0 fail, 2 skipped** |

A failure found along the way was mine, not a baseline failure: the new portal
field tests imported `bun:test`, which the real suite (tsx/Node) cannot load
(`ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'bun:'`). They were rewritten
on `node:test` and the file now passes in the Node runner (7/7) and in the suite.

## 6. Known-unfinished, exact next actions

1. **B — correct destination.** Portals can overlap in the camera plane when the
   camera is close (ring radius is `visibleHeight * 0.4`, the hit disc is
   `1.08 × radius`). Next action: raise the ring's angular separation for large
   `N`, or shard the ring into two concentric rows, and re-run
   `probe-portal-click.mjs` with `FULL=1` until `attempts[].matches` is true for
   two different destinations. File: `src/app/scene/spatial/portalField.ts`.
2. **C–G** were not started. Their evidence directories contain only the
   scaffolding harness (`probe-interaction.mjs` phases `chat|placement|stability`).

## 8. Mission 5.4B.1 — portal targeting

### 8.1 Baseline checked before editing

| Fact | Value |
|---|---|
| Mission branch / commit | `claude/mission-5-4-spatial-interaction` @ `382088d`, clean tree |
| Canonical HEAD (`git ls-remote`) | `ce768e0` — concurrent work, untouched by this branch |

### 8.2 Root cause (measured, not guessed)

Every portal's interactive mouth was sized from **its own** base radius
(0.9–1.15 world units × 1.08), while ring slots were spaced `2πR/N` with `R`
framed from the camera. At the framed ring size the mouths were wider than the
gap between slots, so neighbouring hit discs **overlapped**. All discs are
coplanar and equidistant from the camera, so the raycast is a tie broken by
scene traversal order: the portal that answered a click was decided by registry
order, not by where the pointer was. Enlarging the hit surfaces (the obvious
fix) would have made this worse.

The 5.4 source read confirms the second half of the story: handlers were on the
torus seam in an earlier revision, whose centre is a hole, so centre clicks
started nothing at all.

### 8.3 What changed

`src/app/scene/spatial/portalField.ts`

- Mouth size is now derived **from the distance to the nearest neighbour**:
  `hitRadius ≤ 0.45 × nearest`. For any pair at distance `d`, each mouth is at
  most `0.45·d`, so their sum is under `d` and they cannot both cover one
  pointer position. `clampMouths` applies this per portal, so a crowded cluster
  shrinks only the portals that are actually crowded.
- Extra portals to the same place cluster in orbits of six beside their
  destination's slot (`EXTRA_ORBIT`, opening outward), so a second portal never
  lands on the first and a crowded place grows outward instead of stacking.
- Built-in slots still come from registry order, so creating or removing a
  portal never moves an unrelated one, and a reload restores the same layout.
- `overlappingHitIds()` added: the geometric form of "this click is
  unambiguous", used by the probe, the tests and the acceptance matrix.

`src/app/scene/spatial/SpatialPortals.tsx`

- The hit disc uses `spec.hitRadius` from the layout instead of `radius × 1.08`.
- The ring is fitted to `min(visibleHeight, visibleWidth)` from the real drawing
  size, so a portrait viewport shrinks the ring instead of pushing portals off
  screen.
- The probe now reports `hitRadius`, `overlappingMouths`, and the identity of the
  canvas that draws the field (`data-spatial-canvas="genesis"`) — the page has
  more than one canvas, and a measurement that clicks the wrong one proves
  nothing.

### 8.4 Measured result — still FAIL

Live, 1440×900, after the change:

| Measurement | Result |
|---|---|
| Portals drawn / on screen | 11 / 11 |
| Duplicate identities / coincident placements | `[]` / `[]` |
| Overlapping interactive mouths (`overlappingHitIds`) | **`[]`** |
| Mouth radius | 0.46 world units at the framed ring |
| Click attributed by the raycaster to `scene:files` | travelled and landed on **`media`** |
| Click on `scene:studio` | portal projected off screen (`9538, -25794`) — no point to click |

So the geometric defect is gone and the field is fully drawn, but **the click
identity chain is still not established**. Two candidate causes remain, both
recorded rather than resolved:

1. **Screen-space separation is still insufficient at some camera poses.** The
   guarantee is in the ring plane; a grazing camera foreshortens that plane, so
   two mouths that do not overlap in world space can still overlap on screen.
   The fix would be to enforce the 0.45·d rule in the **projected** frame (or cap
   the ring's tilt), not only in the ring plane.
2. **The harness may still be clicking inside a different portal.** The recorded
   click point was 44 px from `files`' projected centre, and `studio` was
   projected far off screen while `onScreen` still reported 11 — the latter is
   inconsistent with the projection, which means the field was read while the
   camera was still moving. Neither the point nor the frame can be trusted until
   the camera is proven settled at click time.

### 8.5 Harness bugs found and fixed (they masqueraded as targeting failures)

- The navigator orb is a **toggle**, and the harness pressed it on every settle,
  so alternate attempts were clicking a screen with the home dashboard over the
  canvas. It now reads the app's published `data-immersive` state and presses
  only when the world is off.
- `window.__leluImmersive` is **not set in this build**, so an earlier "read the
  real state" fix silently fell back to blind toggling.
- The page has **three canvases**; the probe now matches the Genesis canvas by a
  stable attribute rather than by tag name.

### 8.6 Gates after 5.4B.1

| Gate | Result |
|---|---|
| `npx tsc -b --force` | **0 errors** |
| `tests/portal-field.test.ts` + `tests/spatial-experience.test.ts` | **29 pass, 0 fail** |
| New invariants | no overlapping mouths at 11, 22, 41, 64 portals and at portrait/desktop ring radii |

## 7. Environment limits (apply to every browser result above)

Headless Chromium with `--enable-unsafe-swiftshader` on a cloud VM: a software
compositor. Frame rate and timing are **not** real-device performance. The
compositor traps on long sessions with a panel over the canvas
(`traps: chrome-headless trap int3`), and the cloud runner restarted three times
during this mission, which is why each probe is short and writes immediately.
Three of the probe harnesses required fixes for their own bugs (field not
returned, chip-intercepting points, non-idle camera) — those fixes are in the
committed scripts and no app behaviour was changed to make a probe pass.
