# Step 3: Unified avatar presence. Acceptance report

Branch: `claude/master-integration`. Start: `db988c8`. All results come from Chromium emulation; **no physical iPhone or Safari test was run.**

## Architecture: before and after

| | Before (`db988c8`) | After |
|---|---|---|
| Presentations | 3 (face portal behind the chat, hero portal on Home, floating **window** with a title bar and resize grip), each mounting its own `LeluCharacter` | **1 presence**, mounted once (`GenesisScene`), with **one** `LeluCharacter` |
| Moving between screens | portal swap: the canvas is destroyed and recreated | CSS `translate3d` and size transitions; the same DOM node and the same canvas |
| Positioning | window docking, or planner, or portal | `choosePlace`, in this order: world view (hidden) → your spot (unless it covers a control) → Home hero slot → existing `spatialPresence.planPresence` → least obstructive edge rest |
| Direct manipulation | drag the window's title bar; resize grip | drag **her body**; tap = talk; ⤓ = return her to her own place; Escape/Home key = return; Enter = talk. A drop on a control snaps to the nearest free spot. Persisted in the existing `CompanionStore` (no new store). |
| World view (Genesis v2) | component returned null (unmounted) | hidden **and paused** (`frameloop="never"`); canvas kept |
| Pointer input | the whole window | only her visible body; the layout box passes input through |

**Not changed:**

- `LeluBody`, `spatialPresence` (used as is), `LeluV2Presence`, assets, voice, cognition, memory, personality.
- Activity (expressions and animation) is still read from `useLeluActivity`.

## Measurements (desktop 1440×900, same route before and after)

The route is Home → Studio library → graph → drawing → Home. Files: `before-after/before-1440x900.json` and `before-after/after-1440x900.json`.

| | Before | After |
|---|---|---|
| Avatar canvases created over the route | **3** (ids 1 → 2 → 3) | **1** (id 1 throughout) |
| Avatar WebGL contexts created | 3 | **1** |
| Texture MB uploaded (all canvases) | 300 | **108** |
| JS heap at the end of the route | 648 MB | 562 MB |

## Live acceptance (`presence-e2e.mjs`)

Desktop uses real Playwright mouse input; phones use real CDP touch.

| Viewport | Result | Notes |
|---|---|---|
| 1440×900 | **PASS 15/15** | Includes the world view: hidden, frames 148 → 148 (no drawing), same canvas |
| 390×844 | **PASS 14/14** | |
| 375×812 | **PASS 14/14** | |
| 430×932 | **PASS 14/14** | |
| 1920×1080 | PASS 14/15 + 1 UNVERIFIED (earlier rerun) | The world-view check read her state while the v2 world was still loading at this size. Home runs at 1 fps here, and stalls occur with the presence off too (`phone-sheet/MEASUREMENTS.md`). |
| 844×390 (phone, landscape) | **PASS 14/14** (rerun) | After `nearestFree`: dragged to (76, 84) and kept through a reload. |

Checks per viewport:

- one presence on Home;
- a real drag moves her and places her;
- no title bar or resize grip;
- the placed spot survives a reload;
- "return" gives her back her own place;
- a tap opens the conversation;
- in chat she covers no composer or input;
- with a graph open she covers no node or graph control;
- with a drawing open she covers no Excalidraw tool;
- no horizontal overflow;
- **one canvas through every screen**;
- **one avatar WebGL context**;
- no page errors.

The check "her layout box blocks nothing outside her visible body" sampled 0 points in these runs, so it is **not meaningful evidence**. Body-only input is enforced in code: the outer box has `pointer-events: none`.

Screens are in `screens/` and before/after captures in `before-after/`.

## Commands

- `npm run typecheck` (`tsc -b --force`): exit 0 on the final code.
- `tests/avatar-presence.test.ts`: 5/5 PASS.
- `chat-surface`, `companion-mode`, `self-view`: 53/53 PASS (`chat-surface`'s Phase 2 assertion updated to the new design).
- **Full `npm test`:**

  | | Pass | Fail | Skipped |
  |---|---|---|---|
  | After (final code) | 1724 | 3 | 4 |
  | Baseline (Step 2) | 1714 | 3 | 4 |

  The same 3 failures by name: the camera-transition tests in `spatial-experience.test.ts`, which are pre-existing. The +5 are the new tests.
- `npm run build`: exit 0 on the final code.
- `oxlint` on the changed avatar files: **0 errors, 0 warnings** (final code). `LeluBody.tsx` has 2 warnings that predate this step.

## Voice and expression regression

- **PASS (unit):** the existing `lelu-character`, `companion-mode`, `chat-surface` and voice-related suites pass in the full run. The presence still feeds `useLeluActivity` into the same `LeluCharacter` → `LeluBody` chain.
- **UNVERIFIED (live):** speaking and listening animation with real audio. There is no microphone or speaker in this headless browser.

## Late fixes (after the first acceptance run)

These are found and fixed with measurement. See `phone-sheet/MEASUREMENTS.md`.

- **She was invisible under phone conversation sheets.**
  - Causes: an old Universe CSS rule hid the companion; a z-index tie with the sheet; and a canvas cleared while paused.
  - Now: visible at the edge, above the sheet, paused on one captured frame, at 60 fps page frame rate. Earlier phone results for "covers no composer" passed trivially because she was hidden; the final rerun on all six viewports re-tests them with her visible.
- **Layout box versus visible body:** input now goes only to her visible body.
- **Landscape drag:** a drop on a control snaps to the nearest free spot.
- **Code organisation:** the placement helpers moved to `presencePlacement.ts`, so lint is clean. The return button is now 44 px on phones.

## Final acceptance rerun

All six viewports against the final code: **in progress at this commit**. Results will be added in the follow-up commit.

## Remaining limitations

1. The final six-viewport rerun was in progress at this commit.
2. On phones, when a sheet fills the screen, she is shown as **one paused frame** at the edge. She does not animate there; she animates again when the sheet closes. A live loop beside the sheet stalled the page in this environment. Whether real iPhone GPUs tolerate a live loop is **UNVERIFIED** (no physical device).
3. Cosmos and worlds: in the Genesis v2 world view she is hidden here because `LeluV2Presence` stands her in the world. Spatial Cosmos destinations use the same 2D presence. There is no animated "walking into" 3D space.
4. ⤓ return button: 44 px on phones (fixed).
5. No physical iPhone or Safari test.
