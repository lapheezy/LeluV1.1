# Mission 5.2 — Spatial Visual Acceptance

Date: 2026-11-07
Repository: lapheezy/LeluV1.1
Executed on: `freebuff/phase-2-2` (worktree of the cloud runner)

## 1. Starting commit

`3d914dd` — the verified Mission 5.1 checkpoint. Confirmed as an **ancestor** of the
working branch (`git merge-base --is-ancestor 3d914dd HEAD` → true). The working
branch head at mission start was `7a2bf49`, which contains the spatial phases
2.3–2.10 plus the 2.10 reveal/Studio fixes, and has merged `3d914dd` (`88ceda9`).

`origin/claude/master-integration` (the local remote-tracking ref) was stale at
`1031053`; the real remote tip is `3d914dd`. This was checked directly:
`git ls-tree 3d914dd` **does** contain `src/app/scene/spatial/PortalRegistry.ts`,
`SpatialNavigator.tsx`, `SpatialPortals.tsx`, `SpatialExperience.tsx` and
`src/app/scene/genesis/layout/moduleLayout.ts`. Mission 5.1 is genuinely integrated.

## 2. Ending commit

`750466a` — the evidence commit, pushed to `claude/master-integration`
(`3d914dd..750466a`, fast-forward, no force, no remote history rewritten).

To make that push possible, this branch's own **unpublished** commits were rewritten
once to drop 18 Playwright trace archives; the tree is otherwise byte-identical to
`d3eb456` (`git diff --name-only` shows only `docs/acceptance/**/traces`). The
pre-rewrite branch is kept locally as `backup/pre-trace-drop`. Payload fell from
1,521.7 MB / 2,125 objects to 111.3 MB / 571 objects.

## 3. Files changed

No application code was changed in this mission. Everything below is acceptance
evidence plus the report itself:

- `docs/acceptance/MISSION-5-2-SPATIAL-VISUAL-ACCEPTANCE.md` (this file)
- `docs/acceptance/spatial-phase-2-11/screenshots/*.png` (27 captures)
- `docs/acceptance/spatial-phase-2-11/run-*.json` (per-viewport metadata)

The harness used lives in the git-ignored `.lelu-sandbox/` directory.

## 4. Browser tooling used

- Playwright 1.62.0 with its bundled Chromium (`chromium-1234`), **headless**.
- Software GL: `--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader`.
  Reported renderer: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`.
- `--no-sandbox --disable-dev-shm-usage`.
- Runtime libraries from a local sysroot (`LD_LIBRARY_PATH=/tmp/sysroot/usr/lib/x86_64-linux-gnu:/tmp/sysroot/lib/x86_64-linux-gnu`).
- Fonts: `fonts-dejavu-core` extracted into the sysroot and pointed at with
  `FONTCONFIG_FILE=/tmp/lelu-fonts.conf`. **Without this the app renders with no
  glyphs at all** (all text blank, boxes intact) — that is an environment gap, not
  an application defect.
- Served the production build (`bun run build`) with `vite preview --host 127.0.0.1`.

This resolves the Mission 5.1 restriction: the earlier 328×528 ceiling was the
Cloud Browser panel's iframe, not the application.

## 5. Actual viewport sizes

| Device | Requested | Verified `innerWidth × innerHeight` | DPR | Mobile/touch |
| --- | --- | --- | --- | --- |
| Small iPhone | 375×812 | 375×812 | 2 | yes |
| Standard iPhone | 390×844 | 390×844 | 2 | yes |
| Large phone | 430×932 | 430×932 | 2 | yes |
| Desktop | 1440×900 | 1440×900 | 1 | no |
| Large desktop | 1920×1080 | 1920×1080 | 1 | no |

Each context sets `isMobile`/`hasTouch` for the phone viewports. Screenshots are
`deviceScaleFactor` 2 (i.e. 750×1624 px files) on phones and 1 on desktop.

## 6. Screenshot evidence

`docs/acceptance/spatial-phase-2-11/screenshots/`, named `<W>x<H>-<NN>-<state>.png`:

| State | 375 | 390 | 430 | 1440 | 1920 |
| --- | --- | --- | --- | --- | --- |
| `01-genesis-shell` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `02-cosmos` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `03-portal-ring` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `04-portals-and-layout` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `05-creation-studio` | ✓ | ✗ | ✓ | ✓ | ✓ |
| `06-chat-open` | ✓ | ✗ | ✓ | ✓ | ✓ |

27 captures. `05`/`06` on 390×844 are missing because that run was cut short by the
runner's five-minute command cap, not by an application failure.

**What the evidence shows** (inspected, not inferred): at 375×812 the shell renders
with its full dock, the cosmos view renders a lit 3D Earth, the spatial navigator
draws its category ring and "LÉLU's room", and the portal panel renders
`NEW PORTAL` (destination select, optional name, **Create**), `PORTALS` with its
status line, `LAYOUT` with **Auto-arrange** and **Regenerate layout**, and
`0 placed · 0 pinned`.

Shot `375x812-04-portals-and-layout.png` shows all of that simultaneously, at true
375×812. This is the first time the portal surface has been visually confirmed at
real phone dimensions.

## 7. Dynamic portal-ring results

- The ring is present and interactive in the navigator at all five viewports.
- Portal rows and the built-in destinations switch the navigator between
  `LÉLU's room` and the world catalogue; the panel can open with the ring live.
- **PASS (rendering)**: built-in ring, labels legible, one navigator instance.
- **UNVERIFIED**: user-created ring entry, agent-created ring entry, removal
  updating the ring, travel transition and destination environment, deterministic
  positions across reloads. The mission requires at least 2 user + 2 agent portals;
  those were **not created**, because the first pass put the identity gate on top of
  the Create control and the second pass hit the runner's time cap.

## 8. Agent-created portal results

**UNVERIFIED.** No instruction was sent through the conversation and no
`lelu-portal-create` execution was observed. Registry unit tests
(`tests/spatial-portals.test.ts`) still pass, but that is not live execution.

## 9. Conversation preservation during travel

**UNVERIFIED.** The chat panel was not opened in a state where travel could be
exercised; no transcript continuity claim is made.

## 10. Mobile interaction results

Real pointer/touch input via Playwright, not DOM dispatch.

- 375×812: identity gate **dismissed** ("Continue without an account"), cosmos
  button **clicked**, spatial navigator **opened**, "Portals and layout"
  **opened** — all four confirmed by the resulting frames.
- 390×844: gate, cosmos, navigator and portal panel all succeeded; the run then hit
  the time cap.
- 430×932: the first attempt at DPR 2 crashed the renderer part-way through the
  portal step; the re-run completed all six states. One crash, not reproducible on
  retry, recorded here rather than hidden.
- Studio and Chat dock buttons were **not** reachable by their accessible names at
  the time of the run (`NO studio`, `NO chat`); the frames labelled `05`/`06` at 375
  were captured but should be treated as shell frames, not proof that those panels
  opened. **PARTIAL**, and the selector/labelling mismatch is a real finding worth
  fixing next.

## 11. Desktop interaction results

1440×900 produced all six frames; the gate click reported a timeout in that run
(accessible-name matching), so its panel frames are shell-level only. 1920×1080
produced five frames. Desktop interaction is therefore **PARTIAL**: rendering and
layout at both desktop sizes are confirmed, panel-level interaction is not.

## 12. Performance measurements

Measured with `requestAnimationFrame` over 2 s while the spatial scene was live:

| Viewport | Idle fps | Spatial fps |
| --- | --- | --- |
| 375×812 | 2 | 4 |
| 1920×1080 | 0 | 1 |

**These are not application benchmarks.** Rendering here is SwiftShader CPU
rasterization inside a shared VM, which is the same class of distortion Mission 5.1
was warned about. They are recorded only to show the environment's ceiling, and no
smoothness verdict is drawn from them.

## 13. Memory measurements

- JS heap during a full session: **391 MB** (1440×900), **527 MB** (375×812).
- Canvases: 3 live at once (cosmos backdrop, spatial scene, avatar).
- Spatial probe: `nodes: 29`, `objects: []`, one camera object with a stable
  position and `updatedAt` advancing — i.e. one camera owner, no duplicate camera.
- No measurement of growth across 10 transitions was taken: **UNVERIFIED**.

## 14. Test results

On this tree (`7a2bf49` + evidence), unchanged source:

- `bun run test` — **1702 pass / 0 fail / 6 skipped (1708)**
- `npx tsc -b --force` — **0 errors**
- `bun run lint` — **0 errors, 117 warnings**. The Mission 5.1 baseline is 114
  warnings; the extra 3 come from the phase 2.9/2.10 spatial code already on this
  branch, not from this mission (no source changed here).
- `bun run build` — **0**, built in 4.78 s.

## 15. Remaining defects and blockers

1. **Push payload.** This branch carries 2,125 unique objects / 1,521.7 MB, almost
   all committed Playwright trace archives (`docs/acceptance/**/traces/*.zip`,
   53–124 MB each). Managed pushes were killed by the runner (`-1`, `137`). The
   remote is an ancestor, so the branch needs its unpublished trace blobs dropped
   before it can be sent; the remote itself is never rewritten and nothing is
   force-pushed.
2. **Identity gate sits above the spatial surface.** It must be dismissed before
   Create/Studio/Chat are reachable, and its accessible name does not match a
   literal string, which is why the first pass failed. It is the single biggest
   obstacle to scripted acceptance.
3. **Studio/Chat dock buttons** are not reachable by accessible name at run time.
4. **One renderer crash at 430×932 / DPR 2**, not reproduced on the retry.
5. Fonts are not present in this runner by default; without `FONTCONFIG_FILE` every
   glyph is blank.

## 16. Matrix

| Requirement | Status |
| --- | --- |
| Genuine viewport-capable environment | **PASS** — 375×812, 390×844, 430×932, 1440×900, 1920×1080, real dims verified |
| Genesis shell rendered at all five sizes | **PASS** |
| Cosmos home rendered at all five sizes | **PASS** |
| Spatial navigator / portal ring rendered | **PASS** at all five sizes |
| Portal panel (create/layout controls) rendered | **PASS** at 375×812, visually inspected |
| Built-in portals in ring | **PASS** (rendered, switchable) |
| User-created portals in ring | **UNVERIFIED** |
| Agent-created portals in ring | **UNVERIFIED** |
| Portal creation panel operation | **PARTIAL** — rendered, not operated |
| Portal removal updating ring | **UNVERIFIED** |
| Portal travel + destination environment | **UNVERIFIED** |
| Auto-arrange / regenerate operated | **PARTIAL** — controls rendered, not exercised |
| Pinned / manually positioned module | **UNVERIFIED** |
| Chat open during spatial navigation | **UNVERIFIED** (selector) |
| Creation Studio in spatial environment | **PARTIAL** — frame captured, panel not confirmed |
| Conversation preserved across travel | **UNVERIFIED** |
| Mobile touch interaction (real input) | **PARTIAL** — 4 of 6 steps confirmed at 375 |
| Desktop interaction | **PARTIAL** — rendering confirmed, panels not |
| Performance acceptance | **UNVERIFIED** — software rasterizer, not a valid benchmark |
| Memory growth across 10 transitions | **UNVERIFIED** |
| Duplicate scene/camera/avatar instances | **PASS** (1 camera object, 3 canvases, no duplicates observed) |
| Regression gates | **PASS** — 1702/0/6, tsc 0, lint 0 errors, build 0 |

Mission 5.2 is **not** closed: the visual surface is now proven reachable and
correct at true device sizes, but the interactive half of the acceptance list
(creation, removal, travel, agent channel, conversation continuity, performance)
remains unverified, and those gaps are listed rather than papered over.
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
| `bun run test` | PASS — **1712 pass, 0 fail, 2 skipped** |
| `bun run lint` | PASS — 0 errors, 117 warnings (Part A's tree also reported 117; no new warnings from Part B) |
| `bun run build` | PASS — exit 0, `✓ built in 5.11s` |

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
