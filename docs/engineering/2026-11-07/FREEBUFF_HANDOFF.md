# Handoff to Freebuff: Claude's work, Steps 0–3 (2026-11-07)

- Branch: `claude/master-integration`. This handoff is the commit that adds this file; its parent is `f36c77f`.
- Rule that held throughout: no force-push, no reset of other sessions' work. Every push was fetch → rebase → push.
- **All verification is Chromium emulation.** No physical iPhone or Safari test was run.

## 1. What landed (oldest first)

| Step | Commits | What | Report |
|---|---|---|---|
| Phase 2 lifecycle | `7816eeb` … `a329bcb` | Multi-step tool turns finish. Orchestrator replies are delivered (`AIService.deliverReply`), activity is published finished, task tool events route to the conversation, the planner sees the conversation's artifacts, and artifact refinements bypass `ProjectResolver`. | `docs/audit/2026-11-06/PHASE_2_CHAT_MOBILE_REPORT.md` |
| Step 0 | `efa99e6` | Ecosystem state, branch audit and capability map | `docs/architecture/2026-11-07/ECOSYSTEM_PHASE_0_STATE.md` |
| Defects | `7c21434`, `3eff810`, `1d28486`, `558d0fb` | Universe markdown and no overflow; revisions keep content a re-sent spec omits; avatar textures fitted to 2048² (240 → 96 MB per mount) | `docs/audit/2026-11-07/evidence/*` |
| Step 1 | `e052061` | "Your worlds" row in the spatial navigator lists world-engine environments; choosing one opens the Genesis v2 world view | `docs/audit/2026-11-07/evidence/saved-worlds/NOTES.md` |
| Step 2 | `dacf192`, `db988c8` | React Flow (`graph`) and Excalidraw (`drawing`) as **Creation Studio artifact kinds**, lazy-loaded editors in the artifact window | `docs/architecture/2026-11-07/STEP_2_GRAPH_DRAWING.md` |
| Step 3 | `91f5361`, `f36c77f` (+ this commit) | **One persistent avatar presence** replaces the face, hero and window presentations and the floating window | `docs/acceptance/avatar-step-3/REPORT.md` |

## 2. Step 3 in one paragraph

`LeluCompanion` is now one presence with **one** `LeluCharacter`, so one canvas and one WebGL context per session. It is positioned by `presencePlacement.choosePlace`, in this order:

1. Genesis v2 world: hidden and paused.
2. Your dragged spot, unless it covers a control.
3. The Home hero slot.
4. The existing `spatialPresence.planPresence`.
5. The least obstructive edge.

She moves by `translate3d` transitions and is never re-mounted. You drag her body (there is no title bar); a tap opens chat; ⤓, Escape or Home returns her to her own place. Placement lives in the existing `CompanionStore`.

Beside a phone's full-screen sheet she is **paused on one captured frame**, above the sheet. A live loop there stalled the page in software GL.

Measured over Home → Studio → graph → drawing → Home:

| | Before | After |
|---|---|---|
| Avatar canvases | 3 | 1 |
| Avatar WebGL contexts | 3 | 1 |
| Texture MB uploaded | 300 | 108 |

Final acceptance on the final code (`docs/acceptance/avatar-step-3/final/`):

| Viewport | Result |
|---|---|
| 1440×900 | 15/15 |
| 390×844 | 14/14 |
| 375×812 | 14/14 |
| 430×932 | 14/14 |
| 844×390 | 14/14 |
| 1920×1080 | **not re-run on the final code** |

1920×1080 was stopped at the owner's request. Its last run, on the previous commit, was 14/15 plus 1 UNVERIFIED, because the world view was still loading at this size.

## 3. Files Claude changed in YOUR lanes (please review)

| File (lane) | Change | Why |
|---|---|---|
| `src/app/scene/genesis/avatar/LeluCompanion.tsx` (avatar) | **Rewritten** as the single presence | Step 3 |
| `src/app/scene/genesis/avatar/presencePlacement.ts` (avatar, new) | Pure placement rules | Testable; lint |
| `src/app/scene/genesis/avatar/LeluCharacter3D.tsx`, `LeluCharacter.tsx` (avatar) | `paused` (`frameloop="never"`) and `onStill` (one captured frame) | World view, phone sheets |
| `src/app/scene/genesis/avatar/LeluBody.tsx` (avatar) | The shared model fits its textures to 2048² once at parse | 240 → 96 MB per mount |
| `src/app/scene/genesis/chat/universe/chatUniverse.css` (chat) | **Removed** `html[data-lelu-universe="open"] [data-testid="lelu-companion"] { visibility:hidden }`; `.lch`, `.lch-scrim` and `.lsn` are unchanged | It hid the new presence inside the Universe |
| `src/app/scene/genesis/chat/universe/UniverseChatWindow.tsx`, `chatUniverse.css` (chat) | Markdown via the shared `ChatMarkdown`; no thread overflow | Defects |
| `src/app/scene/spatial/SpatialNavigator.tsx` (spatial) | One line: `<SavedWorlds compact={compact} />` | Step 1 |
| `vite.config.ts` (shared) | `optimizeDeps.include: ["@xyflow/react", "@excalidraw/excalidraw"]` | Dev-only duplicate-React crash on first editor open |
| `package.json` / `bun.lock` (shared) | `@xyflow/react` 12.12.1 and `@excalidraw/excalidraw` 0.18.1 (MIT) | Step 2 |

**Not touched:** `spatialPresence.ts` (used as is), `LeluV2Presence`, assets, voice, cognition, memory, personality, the layout store, `home/**`, PortalRegistry.

## 4. Open items for Freebuff's lanes

Each item was found with evidence and **not fixed** by Claude.

1. **App Library tiles do not receive pointer input** (Home). The sheet is drawn, but hit-testing at the Documents tile reaches the Home section beneath it, and Playwright never sees the tile as clickable. The e2e scripts open the library through the tiles' handlers. See `STEP_2_GRAPH_DRAWING.md`.
2. **The spatial navigator's group panel opens over the bottom of workspace windows** on desktop, by default.
3. **The module layout gives the Creation Studio library a tiny tile** that clips its artifact cards.
4. **React Flow node drag by touch does not engage** under CDP touch emulation: events arrive, but the node does not move. Connecting by touch works. Needs a physical device. Evidence: `docs/audit/2026-11-07/evidence/step2-graph-drawing/touch-probe.mjs`.
5. **Pre-existing test failures (3).** `spatial-experience.test.ts` — "travel records current…", "a transition is interruptible…", "a repeated travel request…" — fail because GSAP calls `requestAnimationFrame` under Node when a test defines `window`. They are identical before and after every Claude step. Fix in `tweenDriver.ts`, or polyfill rAF in that test.
6. **Phones: worlds are not reachable.** The "Your worlds" row exists only in the desktop navigator; on phones "Spatial" opens the App Library.
7. **Portals to created worlds:** `PortalRegistry` accepts only the fixed `SpatialSceneId`s. This is your listed next item.
8. **1920×1080 performance in software GL:** Home renders at about 1 fps, and stalls happen with the presence off too (`docs/acceptance/avatar-step-3/phone-sheet/MEASUREMENTS.md`).

## 5. Things that will bite you

- **Typecheck:** `tsc --noEmit -p .` checks **nothing**: the root tsconfig is `"files": []` with references. Use `npm run typecheck` (`tsc -b --force`).
- **Installs:** use `bun install` / `bun add`. `npm install` pruned 144 packages that this bun-managed tree keeps.
- **Dev server:** a long-running Vite dev server is killed by this environment after 2 hours, and a killed server mid-run looks like an app failure. Restart before long runs. Never edit served files during a live run.
- **Avatar phone-sheet stall:** in software-GL emulation, **any** avatar drawing beside a full-screen phone sheet stalls the page within about 15 s. That is why she is paused there. Do not re-enable a live loop there without re-measuring with `phone-sheet/sheet-fps.mjs`.
- **Excalidraw scenes are stored in `localStorage`** via `StudioStore`. Big image-heavy drawings can hit the quota; the editor now says "Not saved to this device" instead of failing silently.

## 6. How to re-verify

```bash
bun install --frozen-lockfile
npm run typecheck        # exit 0
npm test                 # 1724 pass / 3 fail (the 3 above) / 4 skipped
npm run build            # exit 0
npx vite --host 127.0.0.1 --port 5178 --strictPort &
LELU_CHROMIUM_PATH=/opt/pw-browsers/chromium node docs/acceptance/avatar-step-3/presence-e2e.mjs 390 844 /tmp/out
node docs/audit/2026-11-07/evidence/step2-graph-drawing/canvas-e2e.mjs 1440 900 /tmp/out2
```

## 7. Not verified, anywhere

- A model-initiated graph or drawing in a live chat turn. The tools are verified through the dispatcher only, and **Anthropic stays disabled**.
- Live voice: speaking and listening animation with real audio.
- Physical iPhone or Safari.
- Token and cost accounting. It lives on `claude/gallant-ritchie-v7i0fn` (usage ledger and budgets), which the owner said **not to merge yet**.

## 8. Suggested next steps (owner to decide)

1. Merge `claude/gallant-ritchie-v7i0fn` when its session is done. A dry-run against `a329bcb` merged cleanly.
2. Fix the App Library hit-testing (item 1). It blocks real-tap navigation on Home.
3. Run a physical iPhone pass over the presence, React Flow touch drag and Excalidraw.
4. Portals to created worlds, and worlds on phones.
