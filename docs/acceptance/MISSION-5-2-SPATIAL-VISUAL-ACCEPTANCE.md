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

Evidence commit `0885651`, pushed to `claude/master-integration`
(fast-forward, no force, no remote history rewritten). It is the immediate parent of
the commit that carries this line; that successor changes nothing except this hash.

The earlier visual-evidence commit was `750466a`. To make the first push possible,
this branch's own **unpublished** commits were rewritten once to drop 18 Playwright
trace archives; the tree is otherwise byte-identical to `d3eb456`
(`git diff --name-only` shows only `docs/acceptance/**/traces`). The pre-rewrite
branch is kept locally as `backup/pre-trace-drop`. Payload fell from
1,521.7 MB / 2,125 objects to 111.3 MB / 571 objects.

## 3. Files changed

No application code was changed in this mission. Everything below is acceptance
evidence plus the report itself:

- `docs/acceptance/MISSION-5-2-SPATIAL-VISUAL-ACCEPTANCE.md` (this file)
- `docs/acceptance/spatial-phase-2-11/screenshots/*.png` — 27 viewport captures plus
  14 interaction captures
- `docs/acceptance/spatial-phase-2-11/run-*.json` — per-viewport metadata
- `docs/acceptance/spatial-phase-2-11/interactive-*.json` — machine-readable results
  of the interactive passes (portal create/travel/remove, agent channel, chat)

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

27 viewport captures, plus 14 interaction captures (`*-i*.png`) documented in §7–§9. `05`/`06` on 390×844 are missing because that run was cut short by the
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
- **PASS (user portals)**: two portals were created through the panel with real
  pointer input at 375×812 — `Site Survey → Studio` and `Field Notes → Galaxy`. The
  panel's own count went `1` then `2`, each creation was confirmed by its status line
  (`Portal “Site Survey” created.`, `Portal “Field Notes” created.`), and the ring
  carried ids `portal_studio_*` and `portal_galaxy_*`. Evidence:
  `375x812-i03-two-user-portals.png`, `interactive-375x812.json`.
- **PASS (agent portal)**: the agent channel created `Agent Relay → Projects` with
  `createdBy: "agent"` and answered `{ ok: true, portal, requestId }` on
  `lelu-portal-created`; the panel count went `2 → 3`. The same channel removed it
  (`{ ok: true }` on `lelu-portal-removed`) and the count returned to `2`. Evidence:
  `375x812-i04-agent-portal.png`.
- **PASS (travel)**: travelling through the `Site Survey` portal moved the persistent
  scene from `core` to `studio` and cleared the transition
  (`afterTravel.current = "studio"`, `bodyScene = "studio"`), on the same 3 canvases.
  Evidence: `375x812-i05-destination.png`.
- **PASS (removal)**: the panel's ✕ removed a portal, status `Portal removed.`, custom
  count `1 → 0`, and the remove button gone from the DOM. Evidence:
  `375x812-i15-removal-before.png`, `375x812-i16-removed.png`.
- **PARTIAL**: only one agent portal was created (the mission asked for two), and
  deterministic positions across a reload were not re-checked — registry unit tests
  cover id stability.

## 8. Agent-created portal results

**PASS for the agent channel; PARTIAL against the mission's count.** Executed live at
375×812 by dispatching the documented domain event from the page:

```js
window.dispatchEvent(new CustomEvent("lelu-portal-create", {
  detail: { destination: "projects", label: "Agent Relay", workspace: "default", requestId },
}));
```

It answered on `lelu-portal-created` with
`{ ok: true, portal: { id: "portal_projects_…", destination: "projects", label: "Agent Relay", createdBy: "agent" }, requestId }`,
and the panel count went `2 → 3`. `lelu-portal-remove` then answered `{ ok: true, id }`
and the count returned to `2`.

This is the channel `SpatialExperience.tsx` exposes to LÉLU — live execution, not only
the registry unit test. **Gap:** one agent portal, not the two the mission asked for,
and the event was dispatched by the harness rather than composed by the model inside a
conversation turn.

## 9. Conversation preservation during travel

**PASS for transcript continuity across a transition.** At 1440×900 the chat was
summoned from the spatial rail (`Summon the chat`), the composer carried its real
placeholder `Message LÉLU…` and was enabled, and `Survey at dawn, remember it.` was
typed and sent with Enter. With that message in the transcript, travelling to `Studio`
from the rail completed (`scene: "studio"`, `transition: ""`) and the message was
still in the document afterwards, composer still mounted, still 3 canvases. Evidence:
`1440x900-i23-chat-after-travel.png`, `interactive-chat-preserve-1440x900.json`.

**Not claimed:** LÉLU's reply was not awaited — the check is that the conversation
survives the transition, not that cognition completes. Continuity on the phone layout
was not exercised, where the rail deliberately hides while chat owns the screen.

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
- **Interactive pass at 375×812**: two portal creations, agent create, agent remove,
  portal travel to `Studio`, portal removal, Auto-arrange and Regenerate layout all
  succeeded with real pointer input (values in §7–§9). These runs used DPR 1 to fit
  the runner's per-command time budget; the visual captures remain DPR 2.
- Studio and Chat dock buttons were **not** reachable by their accessible names in the
  first pass (`NO studio`, `NO chat`). Chat was later reached reliably through the
  rail's `[data-spatial-control="chat"]` at desktop width; the Creation Studio panel
  remains unconfirmed. **PARTIAL** on Studio.

## 11. Desktop interaction results

- 1440×900: all six viewport frames were produced. The gate click reported a timeout
  in that first run (accessible-name matching), so those panel frames are shell-level
  only.
- 1440×900 interactive pass: chat summoned from the rail, message typed and sent,
  travel to `Studio` completed, transcript preserved (§9).
- 1920×1080: five frames. Rendering and layout confirmed at both desktop sizes.

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
Gates were re-run on the **merged** tree, because `db988c8` brought
`src/core/interface/InterfaceTools.ts` and `tests/portal-tools.test.ts` on top of this
branch's evidence. These are the numbers for the code actually pushed:

- `bun run test` — **1715 pass / 0 fail / 6 skipped (1721)**, 165.6 s
- `bunx tsc -b --force` — **0 errors**
- `bun run lint` — **0 errors, 125 warnings** over 1125 files; warnings were 117
  before the merged Studio graph/drawing work
- `bun run build` — **0**, built in 6.35 s

`bun install` after the merge installed `@excalidraw/excalidraw` and `@xyflow/react`
from the updated lockfile. The lockfile came from the other branch and was not
modified here.

## 15. Remaining defects and blockers

1. **Push payload (resolved).** The branch carried 2,125 unique objects / 1,521.7 MB,
   almost all committed Playwright trace archives (`docs/acceptance/**/traces/*.zip`,
   53–124 MB each), and managed pushes were killed by the runner. Its own unpublished
   commits were rewritten once to drop them; payload is now 111.3 MB / 571 objects and
   the push is a fast-forward. The remote was never rewritten, nothing was
   force-pushed, and `backup/pre-trace-drop` keeps the pre-rewrite tip.
2. **Identity gate sits above the spatial surface.** It must be dismissed before
   Create/Studio/Chat are reachable, and its accessible name does not match a literal
   string, which is why the first pass failed. It remains the biggest obstacle to
   scripted acceptance.
3. **Studio dock button** is still not reachable by accessible name at run time; the
   chat was only reached through `[data-spatial-control="chat"]`.
4. **One renderer crash at 430×932 / DPR 2**, not reproduced on the retry.
5. Fonts are not present in this runner by default; without `FONTCONFIG_FILE` every
   glyph is blank.
6. The shared VM is heavily loaded (load average 5–7 on 8 cores during these runs);
   click timeouts of 8 s were too tight and were raised to 25 s. This is environment
   contention, not application latency.

## 16. Matrix

| Requirement | Status |
| --- | --- |
| Genuine viewport-capable environment | **PASS** — 375×812, 390×844, 430×932, 1440×900, 1920×1080, real dims verified |
| Genesis shell rendered at all five sizes | **PASS** |
| Cosmos home rendered at all five sizes | **PASS** |
| Spatial navigator / portal ring rendered | **PASS** at all five sizes |
| Portal panel (create/layout controls) rendered | **PASS** at 375×812, visually inspected |
| Built-in portals in ring | **PASS** (rendered, switchable) |
| User-created portals in ring | **PASS** — two created through the panel (`Site Survey`, `Field Notes`), count `1 → 2`, ids recorded |
| Agent-created portals in ring | **PARTIAL** — one portal (`Agent Relay → Projects`) created and removed live; the mission asked for two |
| Portal creation panel operation | **PASS** — destination, name, Create, status line and count all confirmed |
| Portal removal updating ring | **PASS** — `Portal removed.`, count `1 → 0`, remove button gone |
| Portal travel + destination environment | **PASS** — `core → studio`, transition cleared, same 3 canvases |
| Auto-arrange / regenerate operated | **PASS** — both pressed, each returned its own status line |
| Pinned / manually positioned module | **UNVERIFIED** |
| Chat open during spatial navigation | **PASS** at 1440×900 — summoned from the rail with a real click |
| Creation Studio in spatial environment | **PARTIAL** — frame captured, panel not confirmed |
| Conversation preserved across travel | **PASS** — message survived `core → studio` with chat open |
| Mobile touch interaction (real input) | **PASS** for the exercised steps at 375×812 — creation, agent channel, travel, removal, layout (DPR 1) |
| Desktop interaction | **PASS** for the rail and chat; the Creation Studio panel is still unconfirmed |
| Performance acceptance | **UNVERIFIED** — software rasterizer, not a valid benchmark |
| Memory growth across 10 transitions | **UNVERIFIED** — one chat-open transition held at 3 canvases; growth not sampled |
| Duplicate scene/camera/avatar instances | **PASS** (1 camera object, 3 canvases, no duplicates observed) |
| Regression gates | **PASS** — 1702/0/6, tsc 0, lint 0 errors, build 0 |

Mission 5.2 is **not** closed. The visual surface and the portal lifecycle — creation,
agent creation, travel, removal, both layout actions, chat during travel and
conversation continuity — are now verified with real input and recorded values. Still
open: the second agent portal, the Creation Studio panel, pinned/manual module
placement, memory growth across 10 transitions, and any valid performance benchmark
(software rasterization on a contended VM cannot supply one).

---

# Part B — the agent's portal capability, and an independent renderer run

Same branch, same verified checkpoint (`3d914dd`), concurrent execution by a
second agent. **Part A above is the primary visual record** (27 captures at five
real viewports) and is left intact. Part B adds the one application change this
mission produced, an independent harness, and the measurements that corroborate
or qualify Part A.

**Superseded in part.** Part A was extended after this merge with an interactive
pass (§7–§10) that verified portal creation, the agent channel, travel, removal,
both layout actions and conversation continuity with real input. Where Part B
still calls those unverified, §7–§9 and the §16 matrix are the later record.


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
