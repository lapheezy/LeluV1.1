# LÉLU — Phase 8: engine visibility (Memory, Providers, Knowledge, History, Workspaces, Logs) + dock

## Scope of this pass

Phase 7 closed the backend architecture (single AI stack, single set of
cognition/memory/planning/reasoning engines, kernel/constitution and the
duplicate `src/ai/` stack archived). The brief for this session was
explicit: **stop touching the backend, finish the product** — every
engine that already runs should be reachable from the interface, and the
interface itself should read like one AI OS instead of a scattered set of
buttons.

**Same constraint as every phase before this one: no network, no
`node_modules`, no `tsc`/`vite`/Playwright available to actually run.**
Verified by hand: bracket/paren-balance check on every touched file
(script output kept below), a full relative-import resolution walk
including the `lazy(() => import(...))` targets this pass adds, an
unused-import scan (import specifiers appearing only once in a file,
i.e. only in their own `import` statement), and cross-checking every new
field access against the real interface it reads from (`ResponsePattern`,
`AIProvider`, `Provider`, `GenesisUIState`) rather than assuming shape.
**None of this is a substitute for an actual `tsc` run.** That is still
the single highest-value thing the next session with real tool access
can do — see "Recommendation carried forward" below.

## What changed

### Backend: three new read-only accessors (no behavior change to the pipeline itself)

- **`core/AIRuntime.ts`** — added `aiProviderList()`, `knowledgeProviderList()`,
  `executionLogs()`. All three just map the existing private
  `AIProviderRegistry` / `ProviderRegistry` / `ExecutionLogger` instances
  to plain data — the UI layer still can't reach a live provider or
  mutate the log, only read a snapshot.
- **`core/AIService.ts`** — added `getMemories(limit)` (calls
  `Brain.recallAll()`, which already existed and was never surfaced
  anywhere), `getProviders()`, `getExecutionLogs()`. Same read-only
  contract as the rest of `AIService`'s public surface.

### Six new panels, all following the exact visual/motion contract `GenesisReasoningPanel`/`GenesisDiagnosticsPanel` established

| Panel | File | Data source | New plumbing? |
|---|---|---|---|
| Memory | `GenesisMemoryPanel.tsx` | `AIService.getMemories()`, polled 6s + on message count change | Yes (above) |
| Providers | `GenesisProvidersPanel.tsx` | `AIService.getProviders()`, polled 5s | Yes (above) |
| Knowledge & agents | `GenesisKnowledgePanel.tsx` | `state.cognition.agents` / `.nodes` | No — already streamed live via `GenesisBridge` |
| History | `GenesisHistoryPanel.tsx` | `state.messages` | No — already live |
| Workspaces (2D) | `GenesisWorkspacesPanel.tsx` | `state.cognition.workspaces` | No — already live, complements the 3D spheres `GenesisWorkspace.tsx` draws |
| Logs | `GenesisLogsPanel.tsx` | `AIService.getExecutionLogs()`, polled 2.5s | Yes (above) |

Four of six needed zero new backend work — the data was already flowing
through `GenesisBridge` into `GenesisCore`'s reducer and simply had no UI
reading it. That's worth remembering for Phase 9: **check what's already
live in `state.cognition` / `state` before building new plumbing.**

### Navigation: `GenesisDock.tsx` (new) replaces the inline button row

`GenesisInterface.tsx` used to have a flat, wrapping row of plain
`<button>` elements for chat/reasoning/diagnostics plus three hardcoded
workspace shortcuts. That's gone. `GenesisDock` is now the single list
of "what panels exist" (`DOCK_ITEMS`, grouped `core` / `intelligence` /
`system`) — a vertical icon rail pinned left on desktop, collapsing to a
horizontal scrollable bar pinned to the bottom under 720px width
(`matchMedia`, no new dependency). `GenesisCommandPalette.tsx` got
matching entries for every new panel so ⌘K and the dock can't drift
apart — they're still two separate lists by hand, not generated from one
source yet (see Phase 9 notes).

`GenesisCore.tsx`'s `GenesisPanel` union gained `"memory"` and
`"providers"`; `"history"`, `"agents"`, `"workspaces"`, `"logs"` already
existed in the type (defined, never rendered) — this pass is what
finally gives them a component.

`GenesisInterface.tsx` was rewritten around the dock: the old ad-hoc
workspace-button row is now a compact status card (top-left) showing
live workspaces + active destination, and every panel — including the
three that already existed — is now lazy-loaded and routed through one
`AnimatePresence` block keyed by `state.activePanel`.

### Full product surface after this pass

Chat · History · Workspaces · Reasoning & Planning · Knowledge & Agents ·
Memory · Providers · Engine Diagnostics · Execution Logs — nine panels,
one dock, one command palette, all reading from the AI stack Phase
3–7 already built.

## What did *not* get touched, on purpose

- **Project/Files/Browser/Tools panels** named in earlier briefs — there
  is no `ProjectEngine`, file-system abstraction, embedded browser, or
  standalone tool-invocation surface anywhere in `src/`. Building these
  panels would mean inventing the backend they'd read from, which is
  exactly the "stop touching the backend" instruction this session was
  given. Flagging so it's a conscious gap, not a missed one.
- **`GenesisWorkspace.tsx` (the 3D spheres)** — untouched. The new 2D
  Workspaces panel is a complement, not a replacement; they share
  `focusWorkspace`/`selectDestination` so clicking either stays in sync.
- **Settings panel** — no settings/config store exists yet to back one.

## Recommendation carried forward (repeated from every phase since 3, still true)

Get this into a real `npm install && npx tsc -b --noEmit` at the start of
the next session, before adding anything else. Nine phases of
hand-verification is nine phases of accumulated risk on things a
30-second compile would catch instantly — most likely candidates for a
real error, ranked by suspicion: `AIService.getMemories()`'s loose
`any`-typed sort/map (functionally safe against the real
`ResponsePattern` shape, confirmed by reading `brain/ResponsePattern.ts`
directly, but untyped code is exactly where a rename elsewhere in the
codebase would silently break something this method reads).

---

# Directive for Phase 9 — Genesis mutation, the evolving core, and Avatar / Freespirit personas

This is the brief as given for the next session. Recorded verbatim in
intent, organized here against the actual codebase so the next pass can
act on it directly instead of rediscovering `GenesisCore`'s shape from
scratch.

## Stay focused on

1. **UI** — refining what's already built in Phases 6–8, not new backend engines.
2. **Genesis mutation** — Genesis should visibly *change* in response to
   what the system is doing, not just sit there while panels open over it.
3. **The evolving core** — `GenesisCore.tsx` / `GenesisCore.tsx` (the 3D
   mesh, not the state hook of the same name — see naming note below)
   should feel like it's alive and responding, not a static centerpiece.
4. **A transforming interface** — the chrome around Genesis (dock, cards,
   panels) should itself shift in tone/color/motion to match what mode
   the system is in, not stay visually static while only content changes.
5. **Two persona modes for the whole interface/core:**
   - **Avatar version** — a more anthropomorphic/character presentation.
   - **Freespirit version** — Genesis (and by extension the interface
     chrome) takes the form of an animal, an item, a textile pattern, or
     a background/environment instead of a fixed "character" — i.e. a
     shapeshifting, less-humanoid presentation with several selectable
     variants within it.

## What already exists to build on

- **`GenesisCore.tsx`'s state hook (`useGenesis`)** is the single state
  machine for the whole Genesis layer — `GenesisUIState` already tracks
  `mode: GenesisMode`, `thinking`/`speaking`/`listening`/`online`,
  `ecosystem` (a `biodiversity`/`vegetation`/`biomass`/`stability`/
  `adaptation`/`extinction` block — this already sounds like it was built
  toward exactly this kind of mutation and is currently under-read by
  the UI). Check what `GenesisMode` already contains before inventing a
  parallel concept — it may already be most of what "avatar vs.
  freespirit" needs, just not surfaced as a user-facing switch yet.
- **`GenesisCore.tsx` (the 3D component, `app/scene/genesis/GenesisCore.tsx`,
  1263 lines)** — this is where the actual mesh/material/animation for
  Genesis lives today. Read this file fully before changing it; it's the
  single biggest file in the Genesis tree and almost certainly already
  has some reactive-to-state behavior worth extending rather than
  replacing.
- **`GenesisTheme.ts`** — one object of glass/radius/text/status tokens
  the whole 2D layer already imports from. A persona system needs a
  parallel per-persona theme (e.g. `genesisPersonaTheme(mode, variant)`
  returning a palette) so the chrome-transformation ask (#4 above) is a
  data problem, not a per-component rewrite.
- **`engines/` (the ~36-engine ambient `EngineRuntime`, separate from the
  AI/cognition engines)** — `AtmosphereEngine`, `BalanceEngine`, and
  others already exist and likely already drive some ambient visual
  behavior. This is probably the right place for mutation *triggers*
  (what state change should cause what visual shift), even if the
  *rendering* of a mutation lives in the 3D `GenesisCore.tsx`.
- **`CognitionRuntime.subscribe`** — already emits `"agent" | "workspace"
  | "knowledge" | "update"` events live. Reasoning/planning/provider
  activity already flows through here on every request (see
  `AIRouter.attachThinking`, `Brain.learn`). This is the natural signal
  source for "Genesis reacts to thinking/reasoning/provider switching" —
  no new backend event bus needed, subscribe to what's already emitting.

## Suggested shape (not prescriptive — verify against the actual
`GenesisCore.tsx` 3D file before committing to this)

- A `persona` block on `GenesisUIState`: `{ form: "avatar" | "freespirit";
  variant: string }`, where `variant` is only meaningful when
  `form === "freespirit"` (e.g. `"fox"`, `"lantern"`, `"woven-cloth"`,
  `"aurora-field"` — animal / item / textile / background, per the
  brief). Persisted via `core/memory` (there's already an
  `IndexedDBStore` — reuse it rather than introducing `localStorage`,
  which is also just more consistent with how the rest of the app
  persists state).
- A `GenesisPersonaSwitcher` — likely a dock item or a control inside
  whatever "Settings"-shaped panel eventually exists — that changes
  `persona.form`/`variant` and nothing else; every other component reacts
  to the change rather than being told about it individually.
- Mutation should be driven by *existing* signals, not new ones invented
  for this feature: `state.thinking`/`speaking`/`listening` (already
  updated live), `state.cognition.reasoning`/`.plan` (already populated
  every request), `state.engineStatuses` (already tracks per-engine
  enabled/error), and provider identity on the latest message
  (`message.provider`, already on every `GenesisMessage`). Map a handful
  of these to mutation states (idle / thinking / speaking / reasoning-
  deep / error) before reaching for anything new.
- Whatever "freespirit variant" rendering turns out to need (swapped
  geometry, swapped material/texture, swapped particle system) should be
  additive to the existing `GenesisCore.tsx` render tree — branch on
  `persona.form`/`variant`, don't fork the file. A full second render
  path is exactly the "duplicate systems" failure mode Phases 1–2 spent
  their whole scope eliminating.

## Still true from every phase before this one

No `node_modules`, no compiler, no way to watch this actually render.
Genesis mutation and a persona system are the most *visual* work this
project has scoped yet — this is the phase where the lack of a build
environment will hurt the most, because "does the transition look right"
isn't something bracket-balance checking can answer. **Strongly
recommend this phase starts with getting `npm install && npm run dev`
running somewhere real, even briefly, before writing 3D/animation code
that then can't be watched.**
