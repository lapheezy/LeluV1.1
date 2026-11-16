# Mission 15.3 — LÉLU's presence: adaptation, forms, actions and runtime (WP01-P02)

Prompt `M15.3-WP01-P02` v2.0, dated 2026-11-16.
Branch `claude/charming-hamilton-icbyrb`, base `37225795e476a5d0a1c82d75db82aa0d90c510ee` (the M15.2 WP03 closeout). Repository: <https://github.com/lapheezy/LeluV1.1>.

The brief: LÉLU already has an avatar-adaptation architecture. Find it, find why she was stuck in one presentation, frozen or hidden on other screens, and short of her actions, then make the existing system work. No second avatar system was built.

---

## 1. The existing architecture (audit)

| Role | File | What it is |
|---|---|---|
| Approved asset | `leluverse/assets/characters/lelu_character/rig/v005_faceshapes_mvwaqbim/lelu.glb` | 49.5 MB, SHA-256 `80089844…62e2ce`. It is the active rig `fj_mvx5ruga_571dd5` in `manifests/character.json` (the export jobs record that hash as their source). The manifest lists **31 animation slots**. |
| Model source | `src/core/avatar/LeluModelSource.ts` | The one download path (Forge `lelu_character`). The model plus the 31 clip files gives `key`, `glb` and `clips[]`. |
| Body and controller | `src/app/scene/genesis/avatar/LeluBody.tsx` | The one body: parse once, textures fitted to 1024², `LeluMotion` (clips), `LeluLife` (sofa, walk off), `AvatarBehaviour` (gaze, face, mouth), and command performance. |
| Overlay renderer | `avatar/LeluCharacter.tsx` → `LeluCharacter3D.tsx` | The one canvas over the interface: framer, frame cap, still capture. |
| **Adaptation authority** | `avatar/LeluCompanion.tsx` | Her one presence, mounted once (`GenesisScene`). It decides **where** she is (`presencePlacement.choosePlace`, `spatialPresence.planPresence`) and **how** she is framed. |
| World presence | `src/app/scene/genesis/LeluV2Presence.tsx` | The same body standing in her 3D world, walking by `core/avatar/LeluSpatial`. |
| Form store | `src/core/avatar/LeluCharacterStore.ts` | Look and **form** (`embodied` / `hologram`). |
| Hologram | `src/core/avatar/LeluRig.ts` (shader `uHolo`) | Implemented only for the **2D image rig**. |
| Action contract | `src/core/avatar/AvatarCommandBus.ts` | 15 kinds; a command resolves only when a live renderer measures her body moving. |
| Language and model entry | `core/router/AvatarResolver.ts`; tools `avatar.gesture`, `avatar.companion` | `avatar.move` and `avatar.animate` **do not exist on any branch** (all remote branches were searched). `avatar.gesture` is the animation contract. |

### Capability matrix: before this work

| Capability | State before | Evidence |
|---|---|---|
| Full-body 3D form | **Implemented**, but only when she happened to have room | `framing = place === "hero" \|\| height < 150 ? "face" : "full"` |
| Face-only form | **Implemented**, but tied to the Home hero spot | same line |
| Holographic form | **Disconnected.** The store and shader exist, but only the never-mounted `LeluCharacter2D` read them. The 3D path never received `form`, and nothing in the UI or tools ever called `setForm`. | `LeluCharacter.tsx` (2D only), no `setForm(` callers |
| Interface-specific adaptation | **Missing.** No context profiles existed; Home vs everything else only. | — |
| On app screens (Browser, Studio, Code) | **Broken: hidden** ("yielded" when windows cover more than 50%), yet her canvas kept drawing | measured: `vis=false`, avatar 1.2–2.3 fps |
| Beside a phone sheet (Chat, Browser, Studio, Code) | **Broken: frozen** on a captured still on every device | measured: 0 avatar fps, `still=true` |
| Over a covered Cosmos (Universe workspace mode) | **Broken: frozen while visible.** Her frame cap obeyed the Cosmos's occlusion budget. | `FrameCap: if (mode === "paused") return` |
| Framing switch | **Broken: rebuild.** `life` (tied to framing) was a dependency of her model load: every face↔full switch tore down the controller and rebound 31 clips. | `LeluBody` effect deps |
| Gestures over the interface | **Working** (wave, dance, bow, nod, shrug, heart, cheer, jump, sit, stand, leave, return) | `COMMAND_CLIPS` |
| Gestures in her world | **Broken.** `life={false}` sent dance, bow, jump, sit and move to a face-view hand-off that never runs in the world. | `LeluBody.perform` |
| Move to a location, face something | **Missing** as commands. In the world she walked only by her own planner and by dragging; "move" played the walk clip in place. | — |
| Plain-word commands without a model | **Missing.** The intent gate needs "avatar" or "your…", so "dance" reached nothing offline. | `IntentDetector` |
| App Library over her (phone) | **Broken.** She drew above the sheet and took the Render tile's touches. | M15.2 WP03 §5.1 |
| WebGL probes | **Leaking.** `LeluCharacter.webglAvailable` and `SystemEnvironment.probeGpu` never released their contexts; Chromium keeps 16 and drops the oldest. | context trace |

### Root causes

1. **"Only one style."** The 3D path had no form input, the form store had no writer, and framing was a by-product of placement rather than of the interface.
2. **"Disappears or freezes on other screens."**
   - *Hidden:* a deliberate yield when windows cover more than half the screen.
   - *Frozen while visible, desktop:* her frame cap followed the *Cosmos* occlusion budget, although she is drawn *above* the surfaces that occlude the Cosmos.
   - *Frozen, phones:* paused on a still beside every full-screen sheet, on every device.
3. **"Restricted actions."** Full-body commands were dropped in her world, movement had no target or destination, and the plain-word path was gated behind a model.

---

## 2. What changed (the existing system, completed)

| Area | Change | Files |
|---|---|---|
| Form store | `form` and `framing` gain `"auto"`, the default (the interface decides); an explicit choice wins. `setFraming` added. | `LeluCharacterStore.ts` |
| Presentation profiles | Pure `contextOf` + `choosePresentation`, read by her one presence. Home: portrait. Chat: full when roomy. Creative: full. Engineering and Browser: compact hologram. World: full. | `avatar/presentationProfile.ts` (new) |
| Hologram, on her real 3D model | A shader stage on her own materials (luminance → cyan ramp, Fresnel edge, scanlines, flicker, rare glitch bands, translucency), a dissolve between forms, and a projector disc and cone at her feet in full framing. The 3D twin of the 2D rig's design. Same model, skeleton, clips and face. | `avatar/holoMaterial.ts` (new), `LeluBody.tsx` |
| Presence authority | `LeluCompanion` decides framing and form per interface; never hidden when windows crowd (compact at the least obstructive edge); her canvas is drawn at its real size. Exposes `data-context`, `data-form`, `data-presentation-reason` and `data-low-power`. | `LeluCompanion.tsx` |
| Freeze | Her rate no longer follows the Cosmos occlusion (a covered Cosmos lowers her to about 12 fps; she stops only when not in view or when the page is hidden). Beside phone sheets she is live. The low-power rest on a still is now **only** for a device measured "light" (`restsOnStill`, §4). | `LeluCharacter3D.tsx`, `LeluCompanion.tsx` |
| No rebuild | `life` removed from the model-load dependencies; her life is attached to the controller she already has. | `LeluBody.tsx` |
| World actions | A world view performs full-body gestures (only a real face view hands them off). Movement and turning are owned by the presence that owns her position. | `LeluBody.tsx`, `LeluV2Presence.tsx` |
| Movement contract | `AvatarCommand.target { place }`, with places viewer, home, core, studio, lab, vault, away, left, right and center. `decline(id, reason)` gives an honest refusal. | `AvatarCommandBus.ts` |
| World movement | Named places resolve to free points in her room. The walk is confirmed on measured arrival (or "stopped N cm short where the room left space"), or declined when blocked; turning is confirmed within a measured angle. A command from a chat covering her world brings the world into view so she can be watched. Per-frame step cap 0.05 → 0.25 s (real pace on slow devices). | `LeluV2Presence.tsx` |
| Overlay movement | Left, right or middle of the screen, searched along that side and never over a control; confirmed by her measured element position or declined with the reason. "Home" = her own placement judgement. | `LeluCompanion.tsx` |
| Plain words, no model | `parseAvatarPresenceCommand` covers form, framing, auto, move, turn and gestures. It is conservative: verb-first instructions only. AIRouter runs it first; `AvatarResolver.executeDirect` executes through the store or the bus. The Earth "show me <place>" shortcut leaves these phrases alone. | `core/router/avatarPresenceCommand.ts` (new), `AvatarResolver.ts`, `AIRouter.ts`, `ExplorationController.ts` |
| Model tools | `avatar.companion` gains `form` and `framing`; new `avatar.move` (to a place, or `face: true`). Both go over the same bus and store. | `ToolDispatcher.ts`, `ToolRegistry.ts`, `ToolSchemas.ts` |
| Person's control | The Avatar panel gets a **Presence** section (form: Auto / Embodied / Hologram; framing: Auto / Full body / Face). It has no second canvas: her presence on screen is the preview. | `GenesisAvatarPanel.tsx` |
| App Library | Under an open modal sheet she stays visible and live but below it, and her body does not take touches; she returns in front when it closes. | `LeluCompanion.tsx` |
| Probes | Both probes release their context (`WEBGL_lose_context`); the overlay probe is asked once per page. | `LeluCharacter.tsx`, `SystemEnvironment.ts` |
| Asset reuse | A parsed second copy (her world while the companion holds the shared one) is kept and reused on the next world visit instead of decoding 48 MB again. | `LeluBody.tsx` |

Nothing was added as a second controller, store, renderer, registry, event bus or interface manager. No dependency, paid API, account or model call was added. Voice files were not touched.

---

## 3. Measurements, before and after (`scripts/avatar/measure-avatar-runtime.mjs`)

Measured with Chromium and **SwiftShader**, a software GPU in a container: the whole page runs at about 2 fps whenever the Cosmos draws, so absolute frame rates are **not** device numbers. Before and after were taken on the same machine with the same script. The route was Home → Chat → Home → Browser → Home → Studio → Home → Code → Home → her world → Home. Raw data: `m15-home/avatar-15.3/measure-{before,after}-{desktop,phone}.json`, with a picture per screen.

**desktop (1440×900)**, first ready 19735 → 18888 ms

| Screen | Shown, before → after | Presentation after | Avatar fps, before → after | Page fps, before → after | Long tasks (ms), before → after | WebGL contexts created (cum.), before → after |
|---|---|---|---|---|---|---|
| home | live → live | home: face/embodied | 2.3 → 1.3 | 2.3 → 1.7 | 319 → 420 | 12 → 9 |
| chat | live → live | chat: face/embodied | 2.3 → 2.3 | 2.3 → 2 | 717 → 730 | 12 → 9 |
| home-2 | live → live | home: face/embodied | 1.3 → 1.7 | 1.3 → 1.7 | 1033 → 563 | 12 → 9 |
| browser | hidden → live | browser: face/hologram | 2 → 0.9 | 1.7 → 0.9 | 1464 → 1096 | 12 → 9 |
| home-3 | live → live | home: face/embodied | 1.7 → 1.7 | 1.5 → 2 | 367 → 2740 | 13 → 12 |
| studio | hidden → live | creative: full/embodied | 2.3 → 1.9 | 1.9 → 1.6 | 999 → 1197 | 15 → 12 |
| home-4 | live → live | home: face/embodied | 1.7 → 1.3 | 1.7 → 1.7 | 614 → 495 | 15 → 12 |
| code | hidden → live | engineering: face/hologram | 1.7 → 1.3 | 1.3 → 1.3 | 1200 → 1087 | 15 → 12 |
| home-5 | live → live | home: face/embodied | 2 → 0.7 | 2 → 1.3 | 549 → 554 | 15 → 12 |
| world | hidden → hidden | world: full/embodied | 0 → 0 | 0.7 → 0.2 | 5747 → 5511 | 18 → 15 |
| home-6 | live → live | home: face/embodied | 2.3 → 1.3 | 1.7 → 2 | 4021 → 7418 | 21 → 19 |

**phone (393×852)**, first ready 15692 → 14267 ms

| Screen | Shown, before → after | Presentation after | Avatar fps, before → after | Page fps, before → after | Long tasks (ms), before → after | WebGL contexts created (cum.), before → after |
|---|---|---|---|---|---|---|
| home | live → live | home: face/embodied | 1.7 → 2.3 | 2.7 → 2.3 | 406 → 288 | 13 → 9 |
| chat | still (frozen) → still (low-power rest) | chat: face/embodied | 0 → 0 | 60.2 → 54.2 | 1610 → 2090 | 13 → 9 |
| home-2 | live → live | home: face/embodied | 1.7 → 2 | 2 → 2 | 2431 → 2769 | 16 → 12 |
| browser | hidden → still (low-power rest) | browser: face/hologram | 0 → 0 | 59.6 → 49.6 | 2404 → 1265 | 16 → 12 |
| home-3 | live → live | home: face/embodied | 1.7 → 1.7 | 1.7 → 2 | 3124 → 3024 | 19 → 15 |
| studio | hidden → still (low-power rest) | creative: full/embodied | 0 → 0 | 59.6 → 31.9 | 4139 → 4370 | 21 → 18 |
| home-4 | live → live | home: face/embodied | 2.3 → 2.3 | 2 → 2.7 | 3363 → 4057 | 25 → 21 |
| code | hidden → still (low-power rest) | engineering: face/hologram | 0 → 0 | 59.9 → 23.6 | 1765 → 3740 | 25 → 22 |
| home-5 | live → live | home: face/embodied | 1.7 → 2.7 | 1.7 → 2.3 | 2872 → 4054 | 28 → 25 |
| world | hidden → still (low-power rest) | world: full/embodied | 0 → 0 | 59.9 → 59.9 | 3185 → 1912 | 31 → 26 |

How to read it:

- **Shown.** Before, she was *hidden* on every app screen (desktop and phone) and a *frozen still* beside phone sheets. After, she is shown everywhere except inside her world (where the world itself shows her), presented for each interface.
- **WebGL contexts created (cumulative) fell** on both devices: desktop 21 → 19, phone 31 → 26. That comes from releasing the two probes. Her own canvas is **one context for the whole session**, before and after (owner trace: `lelu-companion-character` × 1). The remaining growth is the Cosmos scene canvas, re-created on each return to Home. That belongs to the Cosmos lifecycle and is outside this package.
- **Texture uploads.** Her overlay uploads about 24 MB once. Her world view uploads its own copy (about 101 MB at 2048²) because it is a separate WebGL context; re-entering the world now reuses the parsed copy instead of decoding 48 MB again.
- **Phone page rate on app screens is lower than before** (Studio 59.6 → 31.9, Code 59.9 → 23.6). That is the cost of her being *shown* there at all (a still of her composited over the sheet); before, she was hidden. Recorded, not hidden.
- **Desktop return from the world** had a larger long-task total in this run (4.0 → 7.4 s). That transition is dominated by tearing down the world scene and remounting the Cosmos; run-to-run variance in this container is large. Recorded as an open performance item; no improvement is claimed.

## 4. The freeze: what was measured and what was decided

| Test (phone 393×852, Chat Universe open, SwiftShader) | Page fps | Her fps |
|---|---|---|
| She is live (12 fps target) | 2.0–2.6 | 2.0–2.6 |
| Her element hidden, her canvas still drawing | **42.2** | 3.7 |
| All backdrop-filters and filters removed, she is live | 1.7 | 1.2 |
| Her drop-shadow removed | 2.5 | 2.5 |
| Her transform and transition removed | 2.5 | 2.0 |
| **A plain 2D canvas changing 4 times a second instead of her** | **7.2** | — |

The cost is the **software compositor** re-compositing any visible animated element over that sheet. It is not drawing her (hidden but drawing, the page holds 42 fps), and not her blur or transform. A real GPU composites this cheaply; this could not be measured here.

Decision:
- **On a real GPU she stays live beside phone sheets** (12 fps).
- **Only on a device the render manager measured as "light"** (software renderer, no WebGL, or data saver) does she rest on a frame of herself, re-captured with her current form and framing, and resume as the sheet closes. This is `presentationProfile.restsOnStill`, unit-tested.
- Before, the rest applied on **every** device.
- The desktop freeze (stopping with the Cosmos's occlusion) is removed outright.

## 5. Evidence

| Check | Result |
|---|---|
| Typecheck (`npm run typecheck`, `tsc -b --force`) | exit 0 |
| Lint (`npm run lint`, oxlint) | exit 0; **0 errors**, 178 warnings (= the WP03 baseline) |
| Production build (`npm run build`) | exit 0 |
| Focused tests | `tests/avatar-forms-actions.test.ts` 8/8 (new); `tests/avatar-presence.test.ts` 5/5 (existing, unchanged); `tests/lelu-character.test.ts` 8/8 |
| Full suite (`npm test`) on the final code | **2274 tests, 2268 pass, 0 fail, 6 skipped** (283 s) |
| Browser acceptance (`scripts/avatar/verify-avatar-presence.mjs all`) | Clean full run on the final code: **41/45**. The four failures:
- **Two world walks timed out** ("walk to the Studio", 3.78 m walked; "come closer", 8.21 m walked). Late in a long session this container renders her world below 1 fps. In a dedicated actions run on the same final code, all 10 overlay and world actions passed, each confirmed by measurement.
- **Tablet: her touches returned late after the sheet closed.** This was a real lag: her sheet check was tied to animation frames. **Fixed** (timer-coalesced check); App Library rerun **8/8**.
- **Stress loop: one zero-frame sample** in a 1.5 s window right after a transition whose long tasks block the whole main thread. Resampled at 3 s: **0/12 frozen** (2/2). |

**One existing test was revised**, not weakened: `tests/chat-surface.test.ts` "Step 3".
- **Why:** it pinned, in source text, the two freezes this mission was asked to remove (`paused={inWorld || underSheet}` and "stop when the Cosmos is paused").
- **Kept:** every invariant of Step 3 (never unmounted under a sheet; hidden *and* paused in a world; above a phone sheet).
- **Added:** the measured light-device rule and "a covered Cosmos no longer freezes her".

**One near-miss:** this session's new tests were first written over the existing `tests/avatar-presence.test.ts`. It was restored byte-for-byte from git before anything ran, and the new tests live in `tests/avatar-forms-actions.test.ts`.

## 6. Objectives

| ID | Objective | Status |
|---|---|---|
| O01 | Adaptation code and ownership identified | VERIFIED (§1) |
| O02 | Canonical asset verified | VERIFIED: v005 `lelu.glb` = active rig `fj_mvx5ruga_571dd5` (SHA-256 matches); 31 slots; running app reports this model key and 32 clips (rig + 31) |
| O03 | Full-body form | TEST-VERIFIED (Chromium) |
| O04 | Face-only form | TEST-VERIFIED (Chromium) |
| O05 | Holographic form | TEST-VERIFIED (Chromium): a real shader on her 3D model plus a projector; it was only 2D before |
| O06 | Transitions keep identity and state | TEST-VERIFIED: same model key and same canvas element through every form change and 12 screen transitions |
| O07 | Per-interface adaptation (Home, Chat, Cosmos/world, Studio, Code, Browser) | TEST-VERIFIED on desktop and phone sizes |
| O08 | Movement and animation exposed | TEST-VERIFIED: wave, dance, move left, return (overlay); walk to the Studio, face you, come closer, dance, go back (world), each confirmed by measurement. Not every one of the 31 clips was exercised individually. |
| O09 | Reacts to real events | TEST-VERIFIED: activity sequence observed through a real chat turn; tool-activity reactions are pre-existing code, not newly exercised |
| O10 | App Library without isolating her | TEST-VERIFIED at four viewports: Render tile receives its touch; she stays visible and animating under the sheet; she takes her touches again when it closes |
| O11 | Render contexts and loops | VERIFIED: her overlay is 1 context per session; her world view is the one in-world body; probes released |
| O12 | No freezes on transitions | TEST-VERIFIED (desktop live everywhere; 12-transition stress 0 frozen). **PARTIAL for phones on real GPUs**: the live path there is unit-tested logic, not device-measured |
| O13 | Reuse, cleanup, reactivation | PARTIAL: no rebuild on framing change; world copy reused; the Cosmos canvas re-creation remains (out of scope) |
| O14 | No regressions | TEST-VERIFIED: full suite green; chat, Cosmos, workspace and creative flows exercised by the acceptance run |
| O15 | Typecheck, oxlint, build, focused, full suite | VERIFIED (§5) |
| O16 | Desktop, tablet, phone portrait and landscape evidence | TEST-VERIFIED (viewport emulation) |
| O17 | Physical iPhone Safari | **NOT VERIFIED**: no device, Safari or WebKit here |
| O18 | Performance before/after | VERIFIED as measured (§3, §4), including the regressions |
| O19 | Git provenance and push | recorded in the session's final report |
| O20 | Mission 15 docs and register | VERIFIED: this report; cross-links in `MISSION-15-HOME-UNIVERSE.md` and `docs/audit/MASTER_IMPLEMENTATION_ROADMAP.md` |

## 7. Limitations and open items

1. **No physical iPhone.** Every result is Chromium with a software GPU.
2. **Phones on a real GPU**: she is live beside sheets by design, but that frame rate was not measurable here.
3. **On "light" devices beside phone sheets** she rests on a still. That is intended low-power behaviour, and it is labelled `data-low-power="rest"`.
4. **Cosmos canvas re-created on each return to Home** (about +3 WebGL contexts per trip on phones). This belongs to the Cosmos lifecycle, not the avatar.
5. **The world transition is slow here** (5–8 s with multi-second long tasks), dominated by the world scene.
6. **The Avatar panel's own "3D" preview is the old procedural figure, not her model** (pre-existing). The new Presence picker deliberately draws no second canvas.
7. **Movement vocabulary is a named set of places**: in the world, the person, her spot, the Core, Studio, Lab, Vault and away; over the interface, left, right, middle and her spot. There is no free point-and-go yet. "Point at an object" and "present a created object" have no captured clip in her 31-slot library and were not invented.
8. **In-world first command**: in this container the world can run below 1 fps right after loading, and a long first walk can then exceed the 45 s confirmation window. She reports that honestly rather than claiming success.

---

**Follow-up:** see [`MISSION-15.3-WP02-AVATAR-PERFORMANCE.md`](MISSION-15.3-WP02-AVATAR-PERFORMANCE.md) (2026-11-16) for the performance root cause and fixes, world-movement reliability, and the real Avatar-panel preview. It also corrects this report's §3 "phone page rate regression": in a settled A/B the figures were not reproducible.
