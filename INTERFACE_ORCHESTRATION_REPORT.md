# LÉLU v1.1, Phase 2: Cosmos intelligence and full interface control

LÉLU can now inspect, design, preview and transform her own environment through native
front-end capabilities. That covers windows, typography, themes, materials, lighting, the
backdrop and 3D objects in the Cosmos. The user stays the final authority: nothing she
proposes is applied until they approve it.

Path: **LÉLU CORE → Spatial Intelligence → Interface Orchestration Engine**
(`src/core/interface/`), reached through her existing tool registry. No React component,
stylesheet, backend or build is touched to make an ordinary interface change.

## 1. Audit: what existed and what was missing

| Existing system | State before this phase | What this phase did |
|---|---|---|
| `GenesisCore.modules` (window manager) | Real windows with position, size and z-order, and move/resize/raise actions. But `setModulePresentation` / `openModule` / `expand` / `minimize` / `restore` **discarded the geometry**, contradicting their own comments | Geometry is preserved across presentation changes. Added `rotation` and `group`, plus one atomic `applyModuleLayout` |
| `UIOrchestrator` + `genesis-*` window events | Open, close and focus panels only | Kept unchanged. The new engine sits beside it |
| `GenesisTheme` / inline styles | Hard-coded colours, no tokens | Every shared glass value and the window and chat chrome now read CSS variables, with the **original values as fallbacks** |
| `ToolDispatcher` / `ToolRegistry` / `ApprovalGate` / timeline | Real tool execution and human approvals | New `interface.*` family in the same table. Proposals also appear in the existing timeline, whose Approve / Reject buttons drive them |
| Genesis v1 canvas (`GenesisController`) | Native cosmos, camera driven by `cosmos-navigate` | New scene layer inside the same canvas. The camera is driven through the existing event |
| `world.*` tools (LÉLUVERSE room) | Server-persisted 3D room | Left alone: that is a separate world. The new scene layer is the live Cosmos |
| `IntentDetector` | "Redesign my workspace. Make **it** organic…" was routed to a **sandbox code project** | Interface-design requests are now routed to the model and her interface tools. Real project and code requests still route as before (`project-interpretation` 6/6) |

No new dependencies were added. Nothing was replaced.

## 2. What was built

### Engine: `src/core/interface/` (framework-free, unit-tested)

| File | What it does |
|---|---|
| `DesignTokens.ts` | **Token schema:**<br>• palette<br>• typography (fonts, modular scale, weights, tracking, line height, alignment, heading case, text animation, mobile scale, rationale)<br>• materials (opacity, blur, borders, radius, window shape, shadow, glow, texture, gradient, density)<br>• lighting<br>• motion<br>• backdrop<br><br>**Validation:** every value is validated and clamped. Colours must be hex, enums are closed, and no CSS can be injected.<br><br>**Other:** WCAG contrast warnings, and `tokensToCssVariables` (phone-aware, honours reduced motion) |
| `FontLibrary.ts` | 26 fonts (system stacks and SIL OFL), each with character and use-case notes. Custom fonts are accepted only from https font files with a declared permitting licence |
| `SpatialModel.ts` | **Model:** windows as geometry (rect, z, rotation, group, presentation) and their relationships (left of / above / overlapping …).<br><br>**Solver:** move, resize, transform, open, minimize, maximize, restore, close, raise, group, ungroup, arrange.<br><br>**Arrange strategies:**<br>• `relations` ("browser beside chat, projects above browser")<br>• `grid`, `columns`, `focus`, `cascade`<br>• `organic` (ellipse with tilts, no overlap)<br>• `fit` (resolves overlap **while keeping the arrangement**)<br><br>**Phone rules:** the chat stays full-screen, one tool sheet at a time, the composer is never covered, and nothing sits under the notification lane.<br><br>**Guard:** `contradictedClaims` catches a description that disagrees with its own geometry |
| `SceneModel.ts` | **Object kinds:** planet (atmosphere, rings, moons), moon, star, nebula, crystal, flora, orb, river, particles, artboard, light, and glTF model.<br><br>**Each object has:** materials, animations (spin, orbit, bob, pulse, sway, drift), and links to a conversation, module or project.<br><br>**`populate`** creates one linked object per real workspace |
| `EnvironmentLibrary.ts` | Starting points expressed in the same change format LÉLU writes herself: Cosmos Garden, Plain/River, Celestial Cosmos, Creative Studio. Plus five reasoned typography systems and `recommendEnvironment` (advisory only) |
| `InterfaceOrchestrator.ts` | The engine: inspect → propose (built in isolation and previewed) → human decision → apply. Details below |

`InterfaceOrchestrator` rules:
- **Applying:** an approved change is versioned, persisted and snapshotted. Undo, redo and restore work across reloads.
- **Permission scopes:** layout, typography, theme, materials, environment, scene and library. The user sets each to "ask me" or "never".
- **Destructive changes:** closing windows, removing linked or many Cosmos objects, and deleting saved themes need a **second explicit confirmation**.
- **Stale proposals:** a proposal built on an older version is refused rather than applied over newer changes.
- **Superseding:** a newer LÉLU proposal supersedes her older undecided one.
- **Saved themes:** a design can be saved as a reusable theme. Saving changes nothing on screen.
- **Out of scope:** code, credentials, security settings and project data stay behind `project.*` and its own authorization.

### Tools (in `ToolDispatcher`, registered at boot)

| Tool | Risk | What it does |
|---|---|---|
| `interface.inspect` | 0 | Shows the environment, windows and their relationships, the design system, the scene, workspaces, history and capabilities |
| `interface.propose` | 1 | Constructs a change and previews it. It never applies anything |
| `interface.revert` | 1 | Proposes restoring an earlier version |
| `interface.themes` | 1 | List or save themes; propose applying a theme; propose deleting a theme (destructive) |
| `interface.recommend` | 0 | Suggests an environment for a kind of work (research, coding, creative, project management, conversation) |

There is **no approving tool**, and a test asserts that.

### Front-end bridge (`src/app/scene/genesis/interface/`)

**`InterfaceRuntime`** registers the live host and applies the theme:
- **Windows:** the real windows are every module in `GenesisCore` plus the chat, measured from the DOM.
- **Workspaces:** the real conversations and projects.
- **Applying layouts:** approved layouts go through `applyModuleLayout` in a single update. The chat is placed through `lelu-interface-chat-layout`.
- **Theme:** effective tokens are compiled to CSS variables on `<html>` and fonts are loaded. The original look sets nothing.
- **Persistence:** it records where windows actually are, including the user's own drags, and restores them after a reload, re-fitted to the current viewport.
- **Links:** selecting a Cosmos object opens the workspace it links to.

**`InterfaceConsentBar`** is where the user decides:
- Shows the description, rationale, scopes, change list, notes and warnings.
- Approve & apply, Reject, Preview / Show current, and Hide panel (to inspect the whole preview).
- The destructive-change checkbox.
- After applying: "Applied · Undo".
- **History:** every version (with restore), undo and redo, scope permissions, and the decision log.
- Also reachable from the command palette.

**`InterfaceLayoutPreview`** draws proposed window geometry as labelled outlines. Real windows do not move until approval.

**`InterfaceSceneLayer`** renders inside the v1 Cosmos canvas:
- the environment dome, inside the native sky;
- token lighting and fog;
- every object, with hover, and click or tap that opens its link.

### Fixes to existing code that these features needed

- **Panels inside module windows** now render embedded (`ModuleWindowContext`). Before, a panel's own `GenesisWindowFrame` floated a second window. On phones that was a fixed 780px sheet that covered the host window's title bar, so the window could not be dragged by touch. On desktop it made the browser panel render offset and clipped inside its window.
- **Module content areas** are `position: relative`.
- **The theme's motion transition is switched off while the user drags or resizes**, so dragging is never laggy.

## 3. Verification

### Automated: `tests/interface-orchestration.test.ts` (18 passing, no network)

All 18 go through the real `ToolDispatcher`. They cover:
- **Acceptance tests 1–5 and 7**, at the engine level.
- **Phone layouts:** under every strategy, one sheet, no overlap, chat full width, composer clear, no tilt, off-screen drags clamped.
- **Invariants:**
  - nothing applies without a human;
  - the timeline's `approval_resolved` reaches the same gate;
  - reject restores the live state;
  - destructive changes need the second confirmation;
  - the chat cannot be closed;
  - stale proposals are refused, and older ones are superseded;
  - blocked scopes are refused;
  - CSS-injection attempts are clamped or refused;
  - unlicensed fonts are refused;
  - deleting a theme is a destructive proposal;
  - reload persistence and undo / redo / restore.
- **Two regressions found in live runs:**
  - `fit` keeps a real model's intended arrangement;
  - a description that contradicts its own layout is flagged.

**Regression check on existing suites:** all pass — `agentic-execution` 20, `agentic-live` 5, `anthropic-integration` 20, `runtime-integration` 19, `architecture-integrity` 6, `ui-truthfulness` 3, `world-tools` 1, `forge-tools` 1, `project-interpretation` 6. `genesis-interface.test.tsx` still fails 2/2 with the same pre-existing `React is not defined` error.

`tsc -p tsconfig.app.json` is clean, and `oxlint` reports nothing on the new code.

### Live, real model, real chat path: `scripts/verify-interface.ts`

The script sends the five acceptance requests verbatim through `AIService.chat`. **No request names a tool.** For each one it checks four things:
- the model chose `interface.propose` itself;
- nothing was applied before the decision;
- the proposal contains what was asked;
- approval applies it.

**Every turn was served by the Fireworks fallback.** Anthropic returned *"Your credit balance is too low to access the Anthropic API"*, and Cerebras rejects its key. Results on that weaker model, after the fixes below:

| Test | Result |
|---|---|
| 1 Typography | PASS |
| 2 Windows | PASS 3/3 runs after the fixes (was 0/2) |
| 3 Cosmos Garden | PASS |
| 4 Planets | PASS (linked through `populate`) |
| 5 Full redesign | PASS (was routed to a sandbox code project before the intent fix) |

The live runs found these defects. All are fixed:
- the project router intercepted redesign requests;
- `fit` re-gridded away the intended arrangement;
- the model attached a preset to every request, and made unlinked, oversized planets (the tool guidance is now explicit);
- the model's reply could claim a placement the plan did not make (now flagged back to LÉLU and shown on the consent bar).

### Live, real browser: Chromium with Playwright, 1440×900 and iPhone 390×844 with touch

The script drives the mounted app through the same dispatcher LÉLU uses, and approves by **clicking the consent bar's button**.

| Check | Desktop | iPhone |
|---|---|---|
| 1 Typography | Previewed, then applied (`--lelu-font-heading: Unbounded`, v1) | Same |
| 2 Windows | Before approval, windows did not move. After: chat (96, 64), Projects (693, 64), Browser (693, 480). Beside and above, no overlap, on screen | Chat stays full-screen. One browser sheet (top 104, bottom 505), Projects minimized. **Composer visible and reachable** |
| 3 Cosmos Garden | Garden backdrop, Fraunces/Nunito, organic tilted windows, 5 living 3D objects | Applied, chat unobstructed |
| 4 Planets | Three planets for the real workspaces, with labelled tap targets that open them | Rendered |
| 5 Transformation | Previewed (theme, materials, environment, scene, layout), then applied | Applied. Composer still reachable |
| Touch drag | n/a | Real CDP touch on the title bar: the window moved 104 → 224, exactly as dragged (fixed this phase) |
| 7 Reload | Version, theme and scene persisted. Open windows came back where they were (fixed this phase). History "Restore" returned to the original v0 look | Same |
| Crashes | None from this layer. Console errors are pre-existing provider 401s and blocked CORS research fetches | One `setPointerCapture` error, caused by the test's synthetic pointer events |

Software WebGL in the container renders the **unmodified** Genesis scene at about 2 fps. With the interface layer active it measured 1.5–2 fps, so the layer adds no measurable cost there. A real device GPU was not available to measure.

## 4. Limits, stated plainly

- **The 3D scene layer renders in the Genesis v1 Cosmos only.** Gen V2 and the LÉLU System scenes keep their own scenes. Theme, typography and window control apply in every scene.
- **The browser tests ran in Chromium with an iPhone viewport, touch and user agent.** They did not run in WebKit, so real iOS Safari still needs a manual pass.
- **Library fonts are fetched from Google Fonts.** Offline, the fallback system stack is used.
- **Panel interiors keep some inline colours of their own.** Themes reach their surfaces, borders, chrome, typography and text colours wherever those read the shared tokens. A deeply light palette would therefore leave some light-on-light text inside individual panels, so the River preset keeps a dark surface on purpose.
- **Phone layouts reserve the top 104px** for the existing notification lane, which spans the screen width on phones.
- **The Anthropic account needs credits.** Until then LÉLU runs on fallback providers. Spatial reasoning there is weaker, which the engine's guards partly compensate for.
