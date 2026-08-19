# LÉLU — Phase 6: Genesis Evolution & AI Operating System (pass 1)

## Scope of this pass

The Phase 6 brief asks for a broad, open-ended evolution: every engine
surfaced, every panel upgraded, one cohesive "AI Operating System" feel,
achieved without regressing performance or turning the interface busy.
That is not a single-pass job on a ~210-file app with no compiler
available — so this pass picked a concrete, verifiable slice of it instead
of spreading thin across all of it, the same discipline Phases 3-5 used.

**Same environment constraints as Phases 3-5: no network access, no
`node_modules`.** `npm install` / `tsc -b` / `vite dev` / Playwright were
not available. Verification here is: a bracket-balance check plus
`node --check` on every changed/added file, and a full relative-import
resolution walk over the same set (every `from "./X"` / `"../Y"` resolved
to a real file on disk, no orphans introduced). That is "provably wired
and syntactically sound," not "known to compile" — see caveats below. It
did catch one real bug before it left the sandbox: an early draft of
`GenesisCommandPalette.tsx` referenced `React.KeyboardEvent` without
importing `React` (the file only imported named hooks) — fixed by
importing `KeyboardEvent` as a named type import instead.

## What changed

**New: `app/scene/genesis/GenesisTheme.ts`**
Not a new design language — a name for the one that already existed.
Every value in it was copied verbatim out of `GenesisInterface.tsx` /
`GenesisReasoningPanel.tsx` (the glass/blur panel background, the cyan
border, the 24px/16px radii, the uppercase 11px letter-spaced label
style). New Phase 6 components import from here instead of re-typing the
same `rgba(...)` strings a fourth and fifth time, so the "one design
language" goal is enforced by import rather than by convention alone, and
a future palette change happens in one place. Existing files were **not**
retrofitted to use it — that would touch working code for a cosmetic win
with no compiler to catch a regression, out of scope for this pass.

**New: `app/scene/genesis/GenesisNotificationCenter.tsx`**
`state.notifications` and `notify()` have existed on `GenesisCore.tsx`
since before this pass, and `GenesisChat.tsx` already calls
`notify("Lélu Error", ...)` on failure — but nothing ever read the array.
Notifications accumulated in state and were invisible to the user. This
is the missing read side: a toast stack (top-right, capped at 4 visible,
auto-dismiss after 6s, click-to-dismiss). Paired with a new
`dismissNotification(id)` action added to `GenesisContextValue` /
`GenesisCore.tsx` — without it the notification list could only ever
grow.

**New: `app/scene/genesis/GenesisDiagnosticsPanel.tsx`**
`EngineRuntime` / `EngineRegistry` track ~36 simulation engines (Gravity,
Memory, Knowledge, Consciousness, Curiosity, Wisdom, ...) and
`GenesisCore.tsx` has stored `state.engineStatuses: EngineStatus[]` since
the runtime was first wired up in an earlier phase — also never rendered
anywhere. This closes that gap the way the brief asks: "expose useful
state without overwhelming the user." Default view is a one-line
summary (`N/M live`, error count if any); the full per-engine list with
id/priority/error and a status dot is one click away, filterable by
all/enabled/disabled/error. Read-only by design — `EngineRegistry` has no
live enable/disable API, and adding one is a runtime-safety decision that
belongs in a pass with a real build to verify against, not bolted on
blind from the UI layer.

**New: `app/scene/genesis/GenesisCommandPalette.tsx`**
The brief names a "command palette" explicitly. Everything it needs
already existed on the Genesis context (`openPanel`, `focusWorkspace`,
`selectDestination`, `clearConversation`) — this is a single searchable
entry point over actions that previously only existed as separate buttons
scattered across `GenesisInterface.tsx`. Cmd/Ctrl+K to open, Esc to close,
arrow keys + Enter to run, click also works. The workspace list inside it
is read live from `state.cognition.workspaces`, so it can never drift
from what the quick-action buttons already show — one source of truth,
two entry points into the same actions.

**Changed: `app/scene/genesis/GenesisCore.tsx`**
- `GenesisPanel` union gained `"diagnostics"`, alongside the existing
  `"chat" | "reasoning" | ...`, following the exact pattern Phase 5 used
  to add `"reasoning"`.
- `GenesisContextValue` gained `dismissNotification(id: string): void`,
  implemented with the same `setState(current => ({...}))` convention
  every other action in this file already uses.

**Changed: `app/scene/genesis/GenesisInterface.tsx`**
- Mounted `GenesisNotificationCenter` as a persistent overlay (renders
  regardless of which panel is active).
- Added a "Diagnostics" quick-action button next to the existing
  Open chat / Reasoning / Core / Research / Create row, and mounted
  `GenesisDiagnosticsPanel` in the same `AnimatePresence` region the
  chat/reasoning panels already share — mutually exclusive with them,
  same pattern Phase 5 established for the reasoning panel.
- Mounted `GenesisCommandPalette` (it renders its own trigger button
  inline in the quick-action row, plus a portal-less fixed overlay when
  open).

**Changed: `app/scene/genesis/GenesisChat.tsx`**
- Added a `MessageThinking` sub-component: assistant bubbles that carry a
  `reasoning` and/or `plan` snapshot (flowing per-message since Phase 5)
  now show a "Show reasoning" toggle. Expanding it shows the winning
  hypothesis's explanation and the plan's step list inline, under that
  specific message — this was Phase 5's own named "next step," not a new
  idea. Collapsed by default so it doesn't clutter the transcript.
- Narrows the `unknown`-typed `reasoning`/`plan` fields defensively at
  render time, matching the exact convention
  `GenesisReasoningPanel.tsx` already established (`ReasoningResultShape`
  / `PlanShape`-style local interfaces) rather than importing AI-core
  types into the chat subtree.

## What this does *not* claim to do

- **Still not verified by compilation.** Same caveat as every phase
  before this one. The bracket-balance + import-graph check catches
  syntax errors and broken paths, not type mismatches — the
  `React.KeyboardEvent` bug this pass caught by manual re-read is exactly
  the failure class a static check like this can miss if not re-read
  carefully. `tsc -b` the moment a build environment exists is still the
  single highest-value thing to do before shipping this.
- **The other ~30 engines (Memory, Research, Knowledge, Tools, Providers)
  are not individually surfaced yet.** `GenesisDiagnosticsPanel` shows
  every registered engine's on/off/error status generically, but that is
  not the same as a dedicated Memory browser, Knowledge browser, Provider
  monitor, or Tool workspace the brief lists by name. Diagnostics is the
  foundation those could read from (same `state.engineStatuses` /
  `engineRuntime` already wired into context) but each one is real,
  separate UI work.
- **The ~90-file Three.js scene graph itself is untouched.** This pass
  stayed entirely in the DOM overlay layer (`GenesisInterface` and its
  children), the same boundary Phase 5 respected for the same reason:
  without a running dev server, a change to the live render loop can't be
  visually verified before it reaches you, and "silently doesn't render"
  is the specific failure mode Phase 3 flagged for this exact class of
  change.
- **No performance profiling was possible.** The brief asks for lazy-
  loading heavy panels and avoiding unnecessary re-renders. The new
  panels (`GenesisDiagnosticsPanel`, `GenesisCommandPalette`,
  `GenesisNotificationCenter`) are imported eagerly at the top of
  `GenesisInterface.tsx`, matching how `GenesisReasoningPanel` already
  was — not lazy. Converting these to `React.lazy()` is straightforward
  but changes the app's suspense/loading-boundary behavior, which is
  another thing best confirmed against a running app rather than reasoned
  about statically.
- **Command palette has no fuzzy matching** — it's a plain
  case-insensitive substring filter over command labels. Fine for the
  current ~5 base commands + N workspaces; worth revisiting if the
  command list grows a lot.
- **Notification toasts are transient only.** There's no notification
  history/log view — once a toast auto-dismisses or is clicked away, it's
  gone. If diagnostics-worthy errors need a permanent record, that's a
  separate "activity log" panel, not an extension of the toast stack.

## Recommended next phase (in order)

1. **Get a real build environment** (`npm install` + `tsc -b` + `vite
   dev`) — this is the top item in every phase report so far and remains
   the single highest-leverage next step. Everything below benefits from
   being visually verified instead of statically reasoned about.
2. **Per-engine dedicated surfaces**, built on top of
   `GenesisDiagnosticsPanel`'s data source (`engineRuntime` /
   `state.engineStatuses` are already in context): a Memory browser
   reading `MemoryEngine` / `MemoryEvolutionEngine` state, a Knowledge
   browser reading `KnowledgeEngine`, a Provider monitor reading
   `src/providers/*` health — each one is its own panel following the
   `GenesisReasoningPanel` / `GenesisDiagnosticsPanel` pattern (glass
   panel, `onClose` prop, mounted in the same `AnimatePresence` region,
   own `GenesisPanel` union entry).
3. **Lazy-load the panel components** (`React.lazy` + `Suspense`) once a
   dev server can confirm the loading-state UI still looks intentional
   rather than a flash of blank space — this is the concrete version of
   the brief's "lazy-load heavy panels" ask, deferred this pass only for
   lack of a way to see it.
4. **Command history / recent commands** in `GenesisCommandPalette` —
   the data model (a `Command[]` list) already supports ranking recently-
   used commands to the top; not done this pass to keep the first version
   verifiable and small.
5. **Only after (1),** attempt the living-interface/panel-intelligence
   work on the Three.js scene graph itself (Genesis reacting visually to
   engine activity, panel auto-suggestion) — this is the piece every
   phase report has deferred for the same reason: it's the part that most
   needs eyes on a running app to get right, not more static reasoning.

## What's in this ZIP

- `src/` — Phase 5's tree plus this pass's additions/edits:
  `app/scene/genesis/GenesisTheme.ts`,
  `GenesisNotificationCenter.tsx`, `GenesisDiagnosticsPanel.tsx`,
  `GenesisCommandPalette.tsx` (new); `GenesisCore.tsx`,
  `GenesisInterface.tsx`, `GenesisChat.tsx` (changed). Everything else
  untouched.
- `_archive_orphaned/` — unchanged from Phase 3.
- `PHASE_3_REPORT.md`, `PHASE_4_REPORT.md`, `PHASE_5_REPORT.md` — prior
  passes, unchanged.
- `PHASE_6_REPORT.md` — this file.
