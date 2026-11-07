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
| 1920×1080 | **UNVERIFIED** at this commit | The first run was void (the dev server was killed at its time limit mid-run). A rerun is in progress. |
| 844×390 (phone, landscape) | **PARTIAL** at this commit | First run: render, return, tap → chat, no obstruction and one canvas all PASS. Touch drag FAILED (the drop covered a control, so she correctly refused it and went back). Fixed by `nearestFree` (snap to the nearest free spot, unit-tested). The live rerun is in progress. |

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

- `npm run typecheck` (`tsc -b --force`): exit 0.
- `tests/avatar-presence.test.ts`: 5/5 PASS.
- `chat-surface`, `companion-mode`, `self-view`: 53/53 PASS (`chat-surface`'s Phase 2 assertion updated to the new design).
- **Full `npm test`:**

  | | Pass | Fail | Skipped |
  |---|---|---|---|
  | After | 1719 | 3 | 4 |
  | Baseline (Step 2) | 1714 | 3 | 4 |

  The same 3 failures by name: the camera-transition tests in `spatial-experience.test.ts`, which are pre-existing. The +5 are the new tests.
- `npm run build`: exit 0.
- `oxlint` on the avatar files: 0 errors and 5 fast-refresh warnings (pure helpers exported next to the component).

## Voice and expression regression

- **PASS (unit):** the existing `lelu-character`, `companion-mode`, `chat-surface` and voice-related suites pass in the full run. The presence still feeds `useLeluActivity` into the same `LeluCharacter` → `LeluBody` chain.
- **UNVERIFIED (live):** speaking and listening animation with real audio. There is no microphone or speaker in this headless browser.

## Remaining limitations

1. 1920×1080 and the landscape rerun are pending at this commit.
2. On phones, when Chat or Studio fill the screen, she rests small (76×104) at the least obstructive edge with a reduced frame rate (12 fps). A long-run GPU and frame measurement under a phone sheet (the Phase 2 stall scenario) has **not yet been re-run** with a visible presence.
3. Cosmos and worlds: in the Genesis v2 world view she is hidden here because `LeluV2Presence` stands her in the world. Spatial Cosmos destinations use the same 2D presence. There is no animated "walking into" 3D space.
4. The ⤓ return button is 36 px on phones, below the 44 px touch-target guideline.
5. No physical iPhone or Safari test.
