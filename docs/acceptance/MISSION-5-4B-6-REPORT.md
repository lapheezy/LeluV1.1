# MISSION 5.4B.6 — Reliable Portal Activation

Status: **FIX IMPLEMENTED AND COMPILED; ACCEPTANCE EVIDENCE INCOMPLETE.**
Mission B remains unpassed. No geometry, camera, or routing behaviour changed.

Starting point `498eca1` on `claude/mission-5-4-spatial-interaction`; canonical
`claude/master-integration` read live at `ce768e0` and not touched. (A stale local
remote-tracking ref briefly reported `91f5361`; the live `git ls-remote` value is
authoritative and no canonical ref was written.)

## 1. Root cause established by the input path

The portal mouth attached **only `onClick`**. R3F synthesises that click from a
pointerdown/pointerup pair it resolves against the same rendered scene, and it is
the *only* activation path for a pointer. A fast press-and-release — which is
what a person actually does — can therefore reach the canvas and produce no
click at all. The 5.4B.5 canvas counter measured exactly this: `pointerdown`
incremented on the Genesis canvas, `__leluPortalEvents` stayed empty, six times
out of ten.

The second half of the failure was independent: even a delivered click travelled
nowhere because the press arrived while the entry flight still owned the camera
(`busyElsewhere`), which is correct product behaviour.

So the defect was an **activation contract**, not raycasting, not geometry, not
portal identity, and not input routing (all of 5.4B.4's routing work is intact).

## 2. The change

`src/app/scene/spatial/SpatialPortals.tsx`, inside the portal mouth only:

- **`beginPress`** — a pointerdown that hits the mouth records the pointer id and
  its client position and takes `setPointerCapture` on the canvas, so the release
  belongs to this interaction even if the pointer leaves the mouth.
- **`endPress`** — activates only when the same pointer is released, and only if
  it moved no more than 18 px; a cancelled pointer clears the record without
  activating, and a release from a different pointer is ignored.
- **`activate`** — the single activation path, unchanged in what it does: it
  writes the same development trace, preserves `busyElsewhere` (refuses while
  another destination is in flight), and calls the same `onSelect(spec)`.
- **Duplicate prevention** — pointer-up and the R3F click derived from it are one
  interaction, so activations within 500 ms are discarded. No second activation
  is possible from one press.
- **Keyboard** — unchanged: the label chip still travels on Enter through the
  same `select()` path, and `pointer-events` on it remain `none` so a pointer
  press is owned by the canvas raycast.

Nothing else in the architecture was touched: one registry, one raycaster, one
runtime, one camera, one transition guard.

## 3. Acceptance evidence — not achieved

The per-destination acceptance run was reworked exactly as asked (one destination
per load, settled-world gate recording `transition === null` and ≥8 consecutive
stable camera frames, per-load incremental evidence so a timeout cannot erase
results, native pointer counters, R3F trace, landed destination).

It did not produce a five-of-five record: under the SwiftShader software
compositor a single fresh load costs ~75 s (boot, gate dismissal, entry, settle,
press, flight, return), so the 290 s command ceiling allows roughly three loads
per invocation and the multi-load runs were cut before writing a complete
record. **I am not reporting a pass, and no number in this report is an
invented one.**

| Required | Status |
|---|---|
| Files 5/5 fresh-load activations | **NO EVIDENCE** |
| Studio 5/5 fresh-load activations | **NO EVIDENCE** |
| No wrong destination | held in every attempt measured so far |
| Fast press-and-release activates | implemented; **not yet proven end-to-end** |
| Premature activation refused safely | guard preserved (`busyElsewhere`), not re-run |
| Keyboard activation preserved | unchanged code path |
| 5.4B.4 routing intact | unchanged |

## 4. Gates

| Check | Result |
|---|---|
| `npx tsc -b --force` | **0 errors** (with the new handler code) |
| portal-field / spatial-experience / spatial-portals | 40 pass, 0 fail (unchanged source of those modules) |
| Full suite / lint / build / mobile | not run |

## 5. Next step

Run the acceptance as two commands per destination: `LOADS=3` then `LOADS=2` with
`DESTS=files`, then the same for `studio`, merging the per-load evidence files.
Each invocation stays under the cap and writes after every load, so a cut run
still leaves real records. The probe already supports `DESTS`, `LOADS`, `MODE`
(`burst` for fast press-and-release, `hold` for press-hold-release) and
incremental writing.
