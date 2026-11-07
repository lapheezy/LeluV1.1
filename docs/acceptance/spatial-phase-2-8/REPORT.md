# Phase 2.8 — camera ownership + universal world creation

Baseline `455a7d6`. Branch `freebuff/phase-2-2`. Not pushed, not merged.

## Mission 1 — desktop camera continuity

### What was actually wrong

The reveal's "hold" was released by two things that are not the user taking
the camera:

1. `SpatialRevealBridge` called `endSpatialCameraTakeover()` whenever the Chat
   Universe opened, so the autonomous exploration controller owned the camera
   again for the whole conversation.
2. `SpatialIntentBus` released the hold after **every** camera command,
   including the reveal's own `camera.focus`.
3. The bridge re-framed on every world appearance. On desktop the world never
   unmounts, so returning from chat re-ran the framing against the object's
   **live** world position — which the rotating cosmos had moved — producing a
   different pose each time (`(-1.89,-0.58,1.95)` then `(1.68,-0.58,5.27)`).

### The model now

`src/app/scene/genesis/cameraOwnership.ts` defines the three owners explicitly:

| Owner | Entered by | Left by |
| --- | --- | --- |
| `cinematic` | a reveal frames an object | a real gesture, or explicit release |
| `user` | OrbitControls `onStart` | `onEnd` → `autonomous` |
| `autonomous` | idle | a new reveal claims the camera |

Chat opening changes nothing. A camera command finishing changes nothing. The
one thing that ends a reveal is the user dragging, wheeling or panning.

Re-framing is now **once per request** (`requestedAt`), not once per world
appearance — so returning to the world keeps the framed view instead of
framing a rotating object from a new angle.

### Measured — PASS

Same procedure both viewports: create "Nova" in chat → close (reveal) → record
→ reopen chat → close with no command → record.

| Viewport | Before 2.8 | After 2.8 |
| --- | --- | --- |
| 1440×900 | delta **4.876**, camera re-framed from a new angle | delta **0.000**, same pose `(2.295,-0.581,5.112)` |
| 375×812 | delta 0 only because it *re-framed* on remount | delta **0.000**, restored pose `(4.301,-0.013,6.02)` |
| 430×932 | previously re-framed | not re-run this phase (unchanged code path; 375 and 1440 both measured) |

Evidence: `1440x900-continuity.json`, `375x812-continuity.json`, traces, and
screenshots 13/14 in `spatial-phase-2-7/screenshots/` (regenerated).

### A regression found and fixed inside this phase

Removing the per-appearance re-frame exposed that `cameraPoseMemory` had never
worked: `rememberCameraPose` ran only in the effect **cleanup**, by which time
OrbitControls has detached and `controlsRef.current` is null, so nothing was
ever stored; and the restore read `controlsRef.current` before OrbitControls
attached, so it returned early. The phone had been passing because the re-frame
masked both bugs. The pose is now saved during live frames (throttled, 400 ms)
and restored after the controls attach. That is why 375×812 now passes with a
restored pose rather than a second framing.

## Mission 2 — create from any surface

One pipeline, `src/core/spatial/placeInWorld.ts` → `SpatialIntentBus` →
graph commit + verify + `SpatialRevealIntent`. No second graph, no preview
scene, no local copy: the placed node is the same object the renderer draws.

| Surface | Action | Status |
| --- | --- | --- |
| Dashboard (`CosmosHome`) | "Place in world" in Active Workspaces (newest project, else the app you left open, else "Workspace") | **PASS** — measured: object `Jewelry`, revision 1→1, framed by the reveal (`Framed "Jewelry" — camera at (3.23,-0.73,3.89)`), screenshot `1440x900-21-dashboard-place.png` |
| Creation Studio | "Place in world" on every library card (title as name, kind accent as colour) | **WIRED + UNIT-TESTED, BROWSER-BLOCKED**: the automation could not re-enter the Studio panel after the reveal (the dashboard stayed immersive, and the app-library sheet did not expose a clickable "Studio"), so the click was never driven in a browser |
| Workspace (living system) | "In world" in every artifact header (`LivingSystemUI`) | **WIRED, UNVERIFIED**: the living-system environment is gated on `visualState.interfaceFocus === "visual"`, which the harness never entered |

Unit coverage: `tests/place-in-world.test.ts` (real commit, reveal targets the
committed id, two placements are two identities, refusal changes nothing).

## Mission 3 — cinematic transitions

**NOT DONE.** Deliberately not attempted: scene swapping is a hard render swap
by design (`GenesisScene` renders exactly one scene), and a crossfade over two
mounted canvases would double the GPU load on exactly the phones this phase is
protecting. Doing it properly needs one persistent canvas with per-surface
opacity — a structural change to the router, not a transition added on top.

## Mission 4 — verification

| Check | Result |
| --- | --- |
| `bun run test` | **1414 pass, 0 fail, 6 skip** (1420 tests; baseline 1403) |
| `bun run typecheck` | exit 0 |
| `bun run lint` | 0 errors, 109 warnings |
| `bun run build` | exit 0 (~5–6 s) |
| Desktop chat reopen, no command | **PASS**, delta 0.000 |
| Mobile world unmount/remount | **PASS**, delta 0.000, revision and object identity kept |
| Dashboard → Place in World → Reveal | **PASS** |
| Studio → Place in World → Reveal | **BLOCKED** (see above) |
| Workspace → Place in World → Reveal | **UNVERIFIED** (see above) |
| Companion tap-to-talk / return | **UNVERIFIED in browser this phase**; geometry measured (86×102, 114 px clear of nav, 2.2–2.9% of screen) and covered by `tests/spatial-continuity.test.ts` |
| 390×844 / 430×932 re-runs | not re-run this phase; 375×812 and 1440×900 measured |

## Limits

* No physical iPhone — viewport emulation only.
* Studio/Workspace place-in-world is wired through the same verified pipeline
  but its browser click path is unproven; treat those two rows as code-complete,
  behaviour-unconfirmed.
* The companion tap-to-talk was not driven in a browser this phase.
* 390×844 and 430×932 were not re-measured after the ownership change.
