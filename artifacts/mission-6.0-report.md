# Mission 6.0 — Runtime efficiency, progressive activation, intelligence readiness

Branch `mission/6.0-runtime-efficiency` (cut from `perf/lelu-render-architecture` @ `1e7cabd`).
Canonical branch untouched. Checkpoint before any edit:
`artifacts/checkpoints/mission-6.0-base-*` (sha256 in `mission-6.0-base.sha256`).

## 1. Starting state

- HEAD `1e7cabd` (Mission 5.9 delivery), clean working tree, production build verified.
- Node modules had to be reinstalled (`npm ci`, lockfile untouched) after a workspace restore.
- Recovery checkpoints for 5.8, 5.9 and 6.0 all present and preserved.

## 2. Mission 5.9 baseline (re-measured before changing anything)

| metric | value |
|---|---|
| static boot chunks | 156 |
| static boot bytes | 1.65 MB |
| source modules on boot graph | 144 (1.04 MB) |
| boot-graph cycles | 0 |
| emitted chunks | 1440 |
| tests | 1974 / 1968 pass / 0 fail / 6 skipped |

## 3. Phase A — vendor graph audit (measured, reverted)

New instrument: `scripts/audit-bundle.mjs` (chunk distribution, largest chunks, fan-in,
package attribution, static/dynamic boundaries).

Findings:
- **1440 chunks, median 4.8 KB, total 24.39 MB.** 648 chunks under 4 KB; 480 of them
  import the same 1 KB runtime shim; 223 import `react`. One chunk per module.
- A shared chunk named `LatencyProbe` is **1312 KB and statically imported by 71 modules**.
- three: 1099 KB across 12 chunks (`three.core` 365 + `three.module` 348 + extras).
- Lazy-only payloads are large but correctly lazy: `studioExport.worker` 2145 KB,
  `exceljs` 908 KB, `cytoplasm`/`cytoscape` 425 KB, `pptxgen` 360 KB, `katex` 253 KB —
  none of them on the boot graph.

Attempts and results (all reverted):

| attempt | chunks | boot bytes | verdict |
|---|---|---|---|
| baseline | 1440 | 1.65 MB | — |
| `codeSplitting.minSize: 24000` | 1440 | 1.65 MB | **inert** — silently ignored by Rolldown 1.1.5 |
| `advancedChunks.minSize + minShareCount` | 1440 | 1.65 MB | inert (option reaches Rolldown: it warns about the deprecated name) |
| `groups: [/node_modules/]` | 1192 | **12.63 MB** | **rejected** — swallowed lazy-only libraries into a static chunk, an 8× boot regression |
| targeted groups (react, three, @supabase) | 1424 | 1.80 MB | **rejected** — 16 fewer chunks for +150 KB of critical path |

Conclusion: vendor consolidation is not available in this bundler version without
re-merging lazy code into the shell. Boot graph restored to 156 / 1.65 MB and verified.
**Gate A (vendor graph): PARTIAL — measured, no accepted change.**

## 4. Phase B — render ownership

Already delivered in Mission 5.8 and re-verified by tests, not rebuilt: one
`SceneRenderManager` + one `SceneRenderBudget` decide every surface's frame loop;
profiles are `full` / `balanced` / `light`; suspension is expressed as named occluders;
context loss and visibility are handled; `render-manager.test.ts` (21 tests) covers
profiles, recovery, occlusion and surface registry.

Mission's requested four-tier model (Full/Balanced/**Reduced**/**Minimal**) is **not
implemented**: the existing three tiers map to Full/Balanced/Minimal, and adding a
fourth tier without measured hardware behaviour would be a claim, not a control.
**Gate B: PARTIAL.**

## 5. Phase C — progressive intelligence activation (delivered)

New: `src/core/runtime/readiness.ts`, `src/core/runtime/domProbes.ts`,
`src/app/scene/genesis/runtime/ReadinessDashboard.tsx`, `tests/runtime-readiness.test.ts`.

- Ten subsystems with the mission's seven states and an **explicit dependency graph**.
- **A claim can never produce READY.** `claim()`/`begin()` mean "the code arrived";
  only `confirm(id, evidence)` marks READY, and evidence is required — an empty
  evidence string is recorded as DEGRADED, not READY.
- **Failures are isolated**: a failed subsystem marks only its dependents DEGRADED,
  with the reason; everything else keeps its state; a throwing listener cannot stop
  the report (`fail()` is tested not to throw).
- **Idempotent**: same state twice does not publish a new snapshot; listeners are a set;
  the bootstrap bridge installs once; the DOM probes attach once.
- Chat priority is structural: `chat` depends only on `shell`, not on `cognition`.
- 13 tests: initial states, claim-never-ready, no downgrade of READY, evidence required,
  failure isolation, dependent DEGRADED (not FAILED), listener set semantics, reset,
  operational gating, snapshot identity, acyclic dependency graph.

Wiring (no new scheduler, no competing manager):
- `runtimeKernel` marks `shell` at kernel start, installs the probes, and translates
  Bootstrap's existing per-step report into states. Providers/tools/agents are
  deliberately left INITIALIZING (an init call is not a working turn); memory is
  DEGRADED with the runtime's own health string and the note that no read/write was
  verified.
- `GenesisBridge` confirms `cognition` only when an assistant message with text
  actually arrives, and confirms `network` only when that reply names a real provider
  (not offline/local/fallback).

Browser evidence (production build, `?diagnostics`, 384×661 viewport):

```
shell      READY        "React root mounted; kernel started at 4854 ms."
cosmos     READY        "Genesis world mounted at 384×661px."
chat       NOT_INITIALIZED
cognition  INITIALIZING "Provider runtime initialized (OK — 9 AI, 35 knowledge providers…). Awaiting a verified reply."
memory     DEGRADED     "Runtime health: Overall: online | memory: online. No read/write verified."
tools      INITIALIZING "Tool registrars ran (OK — 0 tasks…). Awaiting a real invocation."
agents     INITIALIZING "Cognition loop started (…). Awaiting orchestration."
voice/workspace/network  NOT_INITIALIZED
operational: false (2/10 confirmed)
```

`window.__leluReadiness` mirrors the snapshot for support and acceptance scripts.

Two real defects were found *by* this verification and fixed:
1. the dashboard covered a 384 px viewport and swallowed taps → `pointer-events: none`;
2. the composer probe used `querySelector` (first match, possibly a hidden zero-size
   composer) and only knew the Genesis composer → it now selects among all matches,
   recognises both real composers (`.lcu-composer`, `.lcu-win-composer`) and rejects
   disabled/read-only/zero-size inputs.

## 6. Phase D — resource governance

Audited, not rebuilt: the render budget/manager own frames and occlusion; the runtime
owns timers and subscriptions; the avatar textures are fitted once per buffer
(1024², Mission 5.8/5.9). No new memory manager was introduced — inventing a second
owner is what this mission forbids. **Gate E: PARTIAL (audited, unchanged).**

## 7. Phase E — real-device validation

Not possible in this environment. The preview runs on a VM with a software rasteriser
and no `/api` backend. Recorded honestly:

| measurement | value | where |
|---|---|---|
| FCP | 2244 ms | cloud VM, soft GPU |
| DOMContentLoaded | 2179 ms | " |
| load | 2385 ms | " |
| full interface present | ~2.8 s | " |
| JS requests | 239 of 250 | " |
| transferred | 1378 KB | " |
| `__leluReadStats` fps | 2 (calls 0) | **not a performance result** |

**No mobile, no hardware GPU, no warm-vs-cold comparison, no LCP/TTI on real hardware.**
Phase E is **UNVERIFIED** for the device classes it asks about.

## 8. Phase F — failure injection

Covered by unit tests rather than live injection: subsystem failure isolation, dependent
degradation, listener failure containment, reset semantics, evidence-less confirmation
rejected. Live scenarios (provider timeout mid-stream, network drop, worker crash,
WebGL context loss on real hardware, refresh during init) are **UNVERIFIED** — no
backend in the preview and no browser automation available at the end of the session.

## 9. Tests and build

- `tsc -b --force`: 0
- `vite build`: 0 (4.4 s), boot graph unchanged at 156 chunks / 1.65 MB
- Full suite: **1987 tests, 1981 pass, 0 fail, 6 skipped** (13 new readiness tests)
- No existing test was weakened. No test assertion was changed in this mission.

## 10. Known limitations / unverified

- Chat READY was not observed in the browser after the probe fix: the CDP session kept
  timing out (`connectOverCDP: Timeout`), and the dock click toggled the Universe
  instead of leaving a composer mounted. **Chat readiness: PARTIALLY VERIFIED.**
- Cognition READY requires a real reply; the preview has no provider backend.
- voice, workspace, memory are NOT_INITIALIZED/DEGRADED by design until real use.
- Vendor consolidation blocked (see Phase A table).
- Four-tier render profiles not implemented.

## 11. Commits

See `git log` on `mission/6.0-runtime-efficiency` (this report is the last commit).

## 12. Rollback

- Everything on this branch is additive except two call sites (`GenesisBridge`,
  `GenesisScene`), so `git revert` of the mission commits restores 5.9 behaviour.
- Full pre-mission restore: apply `artifacts/checkpoints/mission-6.0-base-tracked.patch`
  (empty — tree was clean) and `mission-6.0-base-newfiles.tar.gz` over `1e7cabd`.

## 13. Recommended next mission

1. Vendor chunking with a bundler that honours `minSize` (or an explicit allowlist of
   statically-reachable packages, measured against the boot graph each build).
2. Real-device benchmark harness (LCP/TTI/heap) so Phases B/E stop being partial.
3. Complete the four-tier render profile with measured behaviour per tier.
