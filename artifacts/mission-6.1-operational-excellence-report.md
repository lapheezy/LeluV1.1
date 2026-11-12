# Mission 6.1 — Operational excellence (evidence report)

Branch `mission/6.1-operational-excellence`, cut from `dae8216`
(`mission/6.1-runtime-validation`, which carries Mission 6.0).
Checkpoint: `artifacts/checkpoints/BASE-6.1-EXCELLENCE.txt`.
Canonical branch untouched. LangChain/LangGraph deliberately not installed.

## 1. Phase E finding — the "LatencyProbe" module (mission §7E)

The mission asked whether the 1.3 MB `LatencyProbe` chunk is unnecessary coupling.
Measured, it is **not LatencyProbe at all**:

| file | bytes | contents |
|---|---|---|
| `LatencyProbe-D2jUukBq.js` | **6 KB** | the real module (T0→T11 latency probe) |
| `LatencyProbe-Czwvwvzj.js` | **1310 KB** | a **shared** chunk named after its first module |

Signature census of the 1.3 MB chunk: Anthropic ×70, Groq ×72, OpenAI ×17,
Supabase ×48, `indexedDB` ×14, speech ×4, `new Worker(` ×1, `event-stream` ×1.
It is the whole intelligence core (providers, AIService, memory, tools) hoisted into
one shared module because **72 chunks import it**.

Consequences, measured:
- It is **not on the boot graph** (156 chunks / 1.65 MB verified this mission), so it
  costs nothing at first paint.
- It costs **1.31 MB the first time any panel, settings sheet or studio surface opens**,
  because all of them import it.

Verdict: legitimate shared code, wrong shape. The fix is not deletion — it is splitting
the provider set behind lazy boundaries so a settings sheet does not download every
provider adapter. **Not implemented**: it belongs with the provider-registry work and
needs its own measurement pass; a blind split risks the boot graph and the routing rules
the mission forbids touching. Classification: **UNVERIFIED as a defect, diagnosed**.

## 2. Performance baseline (measured, unchanged by this mission)

| metric | value | source |
|---|---|---|
| boot chunks | **156** | `scripts/measure-boot-graph.mjs` |
| boot bytes | **1.65 MB** | " |
| boot-graph cycles | 0 | `scripts/map-static-graph.mjs` |
| emitted chunks | 1440 (median 4.8 KB, 24.39 MB) | `scripts/audit-bundle.mjs` |
| largest shared chunk | 1310 KB, 72 importers | " |
| lazy-only heavyweights | worker 2145 KB, exceljs 908 KB, cytoscape 425 KB, pptxgen 360 KB | " |
| FCP / load (soft-GPU VM) | 2244 ms / 2385 ms | browser, Mission 6.0/6.1 |
| JS requests | 239 of 250 | " |
| vendor consolidation | **rejected** — blanket grouping regressed boot to 12.63 MB | Mission 6.0 |

No performance change was accepted in this mission: the one candidate (chunk
consolidation) was measured and rejected, and the provider-split needs its own pass.

## 3. Feature inventory and status

Classified strictly. "Verified" means observed working in this environment, not
believed working.

### Interface
| feature | class | evidence |
|---|---|---|
| Landing / home surface | **VERIFIED** | renders in browser: build stamp, App Library, Working-On, notifications |
| Sign-in gate + "continue without account" | **VERIFIED** | gate present, dismisses, app continues |
| Cosmos / Genesis world scene | **VERIFIED (mount)** | `cosmos READY — "Genesis world mounted at 384×661px"` |
| Genesis controller render (3D contents) | **PARTIALLY VERIFIED** | chunk loads (127 ms); frame quality unmeasurable on soft GPU (`fps 2, calls 0` = harness artefact) |
| Chat Universe surface | **VERIFIED (open)** | loads, conversation cards + composer present |
| Chat composer readiness reporting | **PARTIALLY VERIFIED** | probe fixed for both composers; READY transition not observed — browser session died |
| Spatial rail / navigation | **VERIFIED** | rail buttons present and labelled in accessibility tree |
| Notifications | **PARTIALLY VERIFIED** | surface renders; no delivery tested |
| Settings / preferences | **UNVERIFIED** | not opened before the browser became unusable |
| Workspace / files / studio / atelier panels | **UNVERIFIED** | chunks exist and are lazy; not exercised |
| Responsive / mobile layout | **PARTIALLY VERIFIED** | all runs at 384×661 (phone width) rendered correctly; no real device |
| Avatar / companion | **VERIFIED (mount)** | `button "Lélu — tap to talk, drag to move her"` |

### Intelligence
| feature | class | evidence |
|---|---|---|
| Provider registry | **VERIFIED (registration)** | readiness evidence: "9 AI, 35 knowledge providers" |
| Real model response | **UNVERIFIED** | preview has no `/api` backend; no key path |
| Streaming to chat | **UNVERIFIED** | requires a real reply |
| Cognition loop | **PARTIALLY VERIFIED** | `agents INITIALIZING — "Cognition loop started (observation cycle 0, self-study running)"` |
| Memory read/write | **UNVERIFIED** | readiness honestly reports `memory DEGRADED — "no read/write verified"` |
| Tool registry / dispatcher | **PARTIALLY VERIFIED** | registrars run (`0 tasks`); no invocation performed |
| WorkflowEngine execution | **VERIFIED (tests)** | `WorkflowEngine.run()` exercised at 9 call sites in `tests/workflows.test.ts` + control-flow/learning suites |
| TaskEngine / TaskExecutor | **VERIFIED (tests)** | `autonomy-end-to-end`, `agentic-execution` suites |
| ApprovalGate | **VERIFIED (tests)** | agent-bounds / agentic suites |
| Agents (Shaman, Executive, AgentRunner) | **PARTIALLY VERIFIED** | registered and covered by tests; no live orchestration turn |
| Personality / cognition architecture | **UNVERIFIED** | not exercised |

### Voice, infrastructure
| feature | class | evidence |
|---|---|---|
| VoiceEngine / VoiceBridge / VOX | **UNVERIFIED** | module loads; no microphone or audio path available in this VM |
| Supabase persistence | **PARTIALLY VERIFIED** | `persistence: connecting` in provider evidence; no round trip |
| GitHub integration | **UNVERIFIED** | credential-dependent |
| PWA / service worker | **PARTIALLY VERIFIED** | manifest request 403 through the preview proxy (infrastructure, pre-existing) |
| Offline behaviour | **UNVERIFIED** | not exercised |
| Background workers | **PARTIALLY VERIFIED** | `studioExport.worker` 2145 KB builds and is lazy; not run |

## 4. Defects found and fixed during this mission

None in product code. Two defects were found and fixed in Mission 6.0 and are carried
here: the diagnostics overlay swallowing taps, and the composer probe using the first
DOM match instead of the first *usable* one.

Outstanding defect (documented, not fixed): **first-panel cost of 1.31 MB** (see §1).

## 5. Failure injection (Phase G)

| scenario | result |
|---|---|
| subsystem failure isolation | **VERIFIED (unit)** — `tests/runtime-readiness.test.ts`: failure degrades only dependents |
| listener/report failure containment | **VERIFIED (unit)** — a throwing listener cannot break reporting |
| no false READY | **VERIFIED (unit)** — evidence required; claim never ready |
| provider unavailable / timeout | **UNVERIFIED** — no backend |
| network drop, worker crash, WebGL loss, storage failure | **UNVERIFIED** — not reachable in this environment |

## 6. Regression

- `tsc -b --force`: **0**
- `vite build`: **0** (4.4 s), boot graph **156 / 1.65 MB**
- Full suite: **1987 tests, 1981 pass, 0 fail, 6 skipped** (Mission 6.0 baseline preserved,
  no test weakened, none changed in this mission)

## 7. Why the browser gates could not be completed

The Cloud browser session became unusable mid-mission: `connectOverCDP: Timeout 10000ms`
on every Playwright call, then `preview_evaluate` exceeding its 10 s cap on a tab running
at 2 fps under a software rasteriser. The earlier Mission 6.0 browser evidence (readiness
registry, dashboard, shell/cosmos READY, 2.4 s FCP) stands; the chat-READY transition and
every interactive flow after it do not have browser evidence.

This is an environment limitation, not a passing result.

## 8. What this mission did not do

No new dependencies. No LangChain/LangGraph (mission explicitly forbids it; the 6.1 audit
records there is none to integrate). No orchestration changes, no agent changes, no memory
changes. No performance change accepted, because the measured candidate made boot worse.

## 9. Recommended next steps, in order of measured value

1. **Split the 1.31 MB shared intelligence chunk** — lazy providers behind the existing
   registry, measured against the 156 / 1.65 MB boot graph after each step. First-panel
   latency is the largest remaining user-visible cost.
2. **A real backend for verification** — without `/api/model/status` and one provider key,
   cognition, memory, tools and streaming can only ever be PARTIALLY VERIFIED.
3. **Restore browser automation** so chat-READY and interactive flows can be closed.

## 10. Commits

- `dae8216` (parent branch) LangChain/LangGraph audit — none present
- this branch: report only

## 11. Rollback

`git checkout mission/6.0-runtime-efficiency` restores 6.0 exactly; this branch adds one
document. No product code changed.
