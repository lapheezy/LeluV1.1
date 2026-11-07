---

# Part B — the agent's portal capability, and an independent renderer run

Same branch, same verified checkpoint (`3d914dd`), concurrent execution by a
second agent. **Part A above is the primary visual record** (27 captures at five
real viewports) and is left intact. Part B adds the one application change this
mission produced, an independent harness, and the measurements that corroborate
or qualify Part A.

## 17. Application code changed

Part A changed no source. Part B changed one file, because the acceptance target
did not exist:

| File | Change |
|---|---|
| `src/core/interface/InterfaceTools.ts` | `spatial.portal.create` and `spatial.portal.remove` tool definitions and executors. `lelu-portal-create` / `lelu-portal-remove` were only DOM events with a handler: `ToolDispatcher` is the sole source of tools a model is offered, so a conversation could not create or remove a portal at all. The executors ask the mounted interface over those existing events, await its structured reply, and return the registry's own answer — including refusals. |
| `tests/portal-tools.test.ts` | 6 tests: registration and risk, destination enum derived from the scene graph (no second list to drift), one executor per tool, refusal with no interface mounted, refusal to remove a built-in `scene:` identity, refusal without an id. |

No registry, layout engine, camera, scene, dock or Studio was added or rebuilt.

## 18. Independent run: what it confirms

Harness: `docs/acceptance/spatial-phase-2-11/scripts/` (`capture.mjs`,
`short-shot.mjs`, `README.md`), driving full Chromium 151 headless with
SwiftShader, libraries and fonts unpacked into a workspace prefix because
`sudo` is refused in this sandbox.

- **Fonts, independently reproduced.** Before `fonts-dejavu-core` +
  `FONTCONFIG_FILE`, `document.body.innerText` was **0 characters** while
  `textContent` held the real strings, and every glyph rendered as a blank bar.
  After it, the same capture reported **953 characters** and a legible frame.
  This confirms Part A §4/§15.5: an environment gap, not an application defect.
  Diagnostic frame: `freebuff-run/1440x900-probe-noblur.png`.
- **True CSS viewports, independently reproduced.** 375×812, 390×844, 430×932,
  1440×900 and 1920×1080 all mount the shell (`data-spatial-nav` present, 3
  canvases at `core`).
- **A second, environment-specific crash.** In this run the renderer trapped
  (SIGTRAP, `dmesg`: `traps: chrome-headless trap int3`) reproducibly when the
  portal panel was composited over the live WebGL canvas, at both 1440 and 390,
  with and without `backdrop-filter`. Part A saw one such crash at 430×932.
  Both are Chromium CHECKs in software compositing, not app errors — but they
  are the reason Part B could not add panel-level captures to Part A's set.
- **Reduced motion makes the run survivable.** With
  `prefers-reduced-motion: reduce`, a portal transition settles in ~5 s and a
  workspace arrival in ~10 s, instead of tens of seconds. Captures taken that
  way record it in metadata.

## 19. One nuance about the built-in ring

In Part B's runs, `localStorage["lelu.lelu.spatial.portals.v1"]` was **absent**
after mount, yet Part A's frames show the built-in ring rendered and switchable.
Both are true because `seedRing` deletes the seeded records again when
`persist()` returns false: the ring is correct **in session**, but the seeded
identities would not survive a reload on such a device. That is worth one
targeted check on a GPU browser (`seedRing` return value and the write it
attempts), and it is the reason this report does not claim reload-persistent
built-in portal identity. Nothing was changed blind.

## 20. Gates after merging the concurrent work

Run on the merged tree (this branch plus the 21 commits that landed while Part B
was in progress):

| Gate | Result |
|---|---|
| `npx tsc -b --force` | PASS — 0 errors |
| `bun run test` | PASS — see the final message for the exact counts of the merged tree |
| `bun run lint` | PASS — 0 errors; warnings unchanged from Part A's tree except where noted |
| `bun run build` | PASS — exit 0 |

`npx oxlint src/core/interface/InterfaceTools.ts` reports **0 warnings and 0
errors**. No test was skipped, weakened or deleted.

## 21. Addendum matrix — the agent's portal capability

| Requirement | Status | Basis |
|---|---|---|
| A tool exists that creates a portal through the canonical registry | **PASS** | new executors, registered by the existing `registerInterfaceTools()` |
| A tool exists that removes one | **PASS** | same |
| Destinations cannot drift from the scene graph | **PASS** | enum derived from `SPATIAL_DESTINATIONS`; test asserts equality |
| The tool refuses an unknown destination / built-in identity / missing id | **PASS** | 3 tests |
| The tool is advertised to a model (dispatcher + registry agreement) | **PASS** | executor present for each id; `ToolSchemas` derives from executors |
| A real conversation turn creates a portal | **UNVERIFIED** | no legible chat surface in this run |
| That portal appears in the ring and travels | **UNVERIFIED** | same |

Part B's contribution to the mission is therefore narrow and real: the agent's
portal capability now exists, is tested and honest about refusals. Everything
visual remains Part A's record, with its own UNVERIFIED list unchanged.
