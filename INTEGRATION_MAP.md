# LÉLU V1.1 — INTEGRATION MAP (Phase 1 forensics)

> Evidence-only. Every claim below cites the file and line that proves it.
> Nothing in this document is inferred from a component "rendering".

## 1. Repository state at the time of this audit

| | |
|---|---|
| Branch | `claude/avatar-3d-world` |
| HEAD | `ae52880` (merge of Claude's Supabase work with Codebuff's test/boot fixes) |
| Tracked working tree | clean |
| Divergence vs `origin/claude/avatar-3d-world` | `0 0` — in sync |
| Untracked (pre-existing) | `artifacts/`, `public/spatial-probe.html`, `scripts/{chrome-exit-probe,crash-forensics,diagnose-spatial,reproduce-browser-crash,spatial-browser,studio-death-probe,studio-repro,validate-session3d2}.mjs` |

### Provenance of recent commits

| Author | Commits | What they are |
|---|---|---|
| Claude | `435fd34` | Cosmos home + spatial nav, recovery audit, Freebuff secret aliases — **the interface under discussion** |
| Claude | `abec038`, `5a56142`, `fafc58a` | Supabase browser-key identity fixes (config only, no UI) |
| Codebuff | `a1f8390`, `3e6ceae`, `07f28ea`, `ed46cb3`, `526987a` | Test repair, chat floating layer, provider stop/stream semantics |
| Codebuff | `cf9f002` | `crypto.randomUUID` shim — the white-screen fix |

No commit in this session changed a legacy panel's design, deleted a component, or replaced the window manager.

## 2. The integration map

| System | Existing implementation (verified) | Status | Required action |
|---|---|---|---|
| **Cosmos workspace** | `home/CosmosHome.tsx` (349 L) + `home/SpatialNav.tsx` + `home/HomeSheets.tsx`; mounted from `GenesisInterface` | Working, and it is the home | Keep as the single home. Verify it stays reachable from every panel (Phase 4) |
| **Spatial windows** | `GenesisModuleHost.tsx` (457 L) — inline / expanded / minimized, drag, resize, raise, persisted geometry; mounted at `GenesisInterface.tsx:763`. **No overview/switcher/preview code at all** (`grep -c "overview\|switcher\|preview" GenesisModuleHost.tsx` → 0) | **Real manager, one only.** Missing: overview with *live* previews, maximize distinct from expand, window switcher | Extend this host (Phase 3). Do not add a second manager |
| **Application Library** | `home/homeCatalog.ts` (groups + `PRIMARY`), `HomeSheets.tsx` library sheet | Visual shell real; launches through `homeActions.openApp → openPanel(id)` | Categories/search/recents/active indicators exist or need wiring; verify each card reaches a working app (Phase 7) |
| **Browser** | `GenesisBrowserPanel.tsx` (496 L): address bar, `go()`, raw `<iframe src={current}>` on `background: white`, `readForLelu()` → `AIService`; optional Neko WebRTC mode | **Not a browser.** No back/forward, no reload, no tabs, no embed-block detection, white rectangle when a site refuses framing | Rebuild inside this panel (Phase 5). Neko is unconfigured (`VITE_NEKO_URL` absent) |
| **Chat** | `GenesisChat.tsx` + `chat/chatExpand.ts` + `chat/chatLayout.ts`; surface decision in `surface/Surface.ts` | Working, including the phone floating layer (measured `[8,227,374,525]`) | Keep; verify coexistence with windows and avatar (Phase 8) |
| **Notifications** | **Two surfaces, one name**: `GenesisNotificationCenter` (ephemeral toast stack, 6 s auto-dismiss, mounted `GenesisScene.tsx:483`) and `GenesisNotificationsPanel` (improvement-queue approvals, registered `GenesisInterface.tsx:90` as the `notifications` panel) | Conflicting: the panel is the "old Genesis Core" surface the user sees | Merge into one notification surface; keep approve/reject/defer and the queue's backend (Phase 9) |
| **Avatar** | **Two presences, both claiming canonical**: `LeluCompanion.tsx` (FACE behind the chat / WINDOW docked) mounted `GenesisScene.tsx:71`; `LeluV2Presence.tsx` ("the ONE authoritative LÉLU avatar") mounted `GenesisV2Scene3D.tsx:85`. Plus `GenesisAvatarPanel` + `ProceduralAvatarPreview` | Fragmented; two renderers, three surfaces | Unify into one presence with placement modes (Phase 6) |
| **Studio / Sketch / Render / Video** | `GenesisVisualStudio`, `GenesisSketchPanel`, `GenesisRenderPanel`, `GenesisVideoPanel`, `GenesisAvatarPanel` — all registered in the one panel registry | Structurally routed through the module host, but each is a legacy-styled panel | Restyle onto the Cosmos window chrome; verify execution (Phase 7) |
| **Tool registry** | `AgenticTools`, `TaskExecutor`, `BrowserTool` (which drives the panel), research providers | Backend intact; UI surfacing is per-panel and inconsistent | Audit registration → handler → result → surfacing (Phase 7) |
| **Mobile runtime** | `Surface.ts` (screen ownership), `chatLayout`, `useVisualViewport`, module host mobile sheet rules (`< 720 px`) | Chat adapted; **no window overview, no previews, no expand-from-preview** | Build the iOS-style switcher on the existing module state (Phase 3) |
| **Navigation / persistence** | `SpatialNav` mounted `GenesisInterface.tsx:751`; `GenesisDock` still owns `MODULE_CATALOG`; `GenesisMobileMenu` exists; layout restore in `home/homeActions.ts` | One live nav, two vestigial shells (`GenesisDock` rail, `GenesisMobileMenu`) | Delete or fold the vestigial shells; keep `MODULE_CATALOG` as data (Phase 2) |

### Panel registry — 28 entries, all through one door

`GenesisInterface.tsx:70-97` registers `reasoning, diagnostics, executive, memory, device, agents, knowledge, history, logs, browser, sketch, render, video, avatar, projects, settings, cognition, engineering, evolution, notifications, briefings, visualstudio, earth, identity, …`.

This is the important nuance: **routing is already unified** — every app opens through `openPanel()` into `GenesisModuleHost`. What is *not* unified is the **presentation**: **26** registered panels import `GenesisWindowFrame` and each composes its own header, typography, spacing and controls on top of it (verified: `grep -l GenesisWindowFrame src/app/scene/genesis/*.tsx` → 26 panel modules plus the frame itself). That shared-but independently-composed chrome is the bleed-through the screenshots show. The fix is one window chrome + an app surface contract, not a new router.

## 3. Two premises in the directive that the code contradicts

1. **There is no `AvatarPlacement` architecture.** `AvatarPlacement` / `avatarPlacement` returns **0 matches** across `src/`. Placement today is two hard-coded modes inside `LeluCompanion` (FACE in the chat's `data-lelu-face-host` layer, WINDOW docked right) plus a separate `LeluV2Presence` in the Gen V2 world. Phase 6 therefore means *creating* the placement runtime, not preserving one — and there is no user-adjustable position today at all.
2. **There is not "a mixture of window managers".** There is exactly one (`GenesisModuleHost`) and every panel goes through it. The real window gaps are: no overview with live previews, no distinct maximize, no switcher, no preview-scoped focus on mobile.

Recording both because the brief's item 2 ("two competing interface systems") is real at the *panel design* level, while item "spatial window manager" is a *completeness* gap, not a duplication one. The remedy differs.

## 4. Execution order, with a gate after each

| Phase | Scope | Gate (all must be measured, not asserted) |
|---|---|---|
| 2 | One window chrome + app surface contract; retire `GenesisDock` rail and `GenesisMobileMenu`; merge the two notification surfaces | Every one of the 28 panels opens with identical chrome; no legacy-styled panel reachable; notification approve/reject still mutates the queue |
| 3 | Overview with live previews, expand-from-preview, maximize/minimize/restore, switcher | iPhone 13: 5 apps open → overview lists 5 live previews → focus → expand → back to overview; desktop drag/resize/stack unchanged |
| 4 | Cosmos always reachable | Return to Cosmos verified from all 28 panels + from overview + from browser full screen |
| 5 | Real browser: history, tabs, reload, embed-block detection with a real fallback, session persistence, Read for LÉLU round-trip | Navigate, back, forward, reload, 3 tabs, a site that blocks framing shows the fallback (not white), Read for LÉLU returns a cited summary into chat |
| 6 | One avatar presence + placement runtime + drag/resize/hide/persist + state-driven animation | Avatar never intersects composer, nav, browser chrome or notification card at 390×844 and 1440×900, in every placement mode, across rotation |
| 7 | Every registered app is a working entry point; tool surfacing | Launch all apps; each shows real state; representative tool run returns a structured result visible in chat |
| 8 | Chat/Cosmos coexistence | Streaming reply + tool run while switching windows and scrolling: no input loss, no crash |
| 9 | Unified notifications | Read/unread, counts, category, navigate to origin, dismissal persisted |
| 10 | Mobile performance on a real device profile | Frame budget, no duplicate loops, no leaked listeners |
| 11 | Acceptance matrix A–G | Recorded pass/fail per line |
| 12 | Engineering report + evidence | Screenshots/recording per area |

## 5. What this pass deliberately did not do

- No files changed, nothing committed, nothing pushed (per the directive).
- No component deleted, no panel hidden with CSS.
- No claim that any panel "works" — only that it is registered and routed.

## 6. Evidence the interface is running

Dev server on port 3003 (reserved preview port), verified through the preview hostname:
`#root` 4 children, `[data-lelu-home]` present, 3 canvases, 0 page errors at 390×844 and 1440×900.
Screenshots: `artifacts/dev-full-phone.png`, `artifacts/dev-full-desktop.png`.
