# ARCHITECTURE RECONCILIATION REPORT (WP03)

Final tree: the workforce branch head named in `FINAL_WORKFORCE_ACCEPTANCE_REPORT.md`.
Method: conflict-by-conflict reading of both sides, static-import tracing from
`src/main.tsx`, a registration probe that boots every registrar Bootstrap
calls, the full test suite after every merge, and the production server
(`bun server.ts`) in a real browser. Claims below cite the check that supports
them; anything not checked is listed as not checked.

## 1. The ten required verifications

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | One authoritative runtime initialization path | **Holds.** `src/core/Bootstrap.ts` is the single bootstrap; every new line (continuity, couture, ASRE, Foundry, self tools) was merged *into* it rather than adding a second boot. | Bootstrap conflict resolutions in `dfe8a01f`, `aa48d9eb`; probe test 4 asserts the probe's registrar list equals Bootstrap's `register*Tools()` calls |
| 2 | No duplicate tool registrations | **Holds, with one documented pattern.** No registrar replaces another registrar's tool; the only cross-registrar re-registration is the creative kit adding a `profile` to existing definitions. The builtin catalogue pre-declares 10 ids (`environment.*`, `studio.*`, `agent.delegate`) that their owning registrar re-declares; risk levels are identical (verified), so approval boundaries are unchanged. 250 definitions, 219 executors, 0 executors without a definition. | `tests/workforce-registration-integrity.test.ts` (4 tests) |
| 3 | No competing memory authorities | **Holds.** Voice provenance and memory sovereignty both extended the ONE write path (`MemoryBridge.learn → Brain.learn → MemoryEngine.learn`); they were fused into one signature, not two paths. The new Mission 14 continuity engine syncs projects/conversations/knowledge/spatial/navigation/graph — not `memory_items` — so it cannot resurrect a tombstoned memory. | `9e6d1bf3`, `dfe8a01f`; 421 memory tests |
| 4 | No duplicate agent execution pathways | **Holds.** Delegation still runs through `Shaman.dispatch → AgentRunner.run` (`agent.delegate`) and the one `dispatchToolCall`; ASRE, Foundry, couture and continuity tools all joined `BY_ID` in `ToolDispatcher`. Live: delegation turn produced a sourced reply (Workflow B). | `ToolDispatcher.ts` `BY_ID`; `workflows.json` |
| 5 | No circular dependencies | **Not newly introduced on the entry path** (the static-import trace from `src/main.tsx` terminates; the build reports no cycles as errors). A full-repo cycle analysis was **not** run. | `trace.py` run, `vite build` |
| 6 | No disconnected UI systems | **One found and fixed**: Freebuff's Creative Objects panel was mounted unconditionally over the Home. It now follows the CosmosObjectsDock rule. M15.3's `orbClearance` was not wired in because M17.1's measured lift already owns that obstacle. | `4b87a535`, `a19736ec` |
| 7 | No orphaned integrations | **Holds for tools** (probe test 3). **One production-only orphan found and fixed**: `/api/self/*` was mounted on `server.ts` but every route 404'd there. `/api/asre` is mounted in both Vite and `server.ts`. | `4b87a535`; `curl /api/self/changes` → 200 |
| 8 | No broken provider routing | **Holds.** Broker `/api/model/groq/chat/completions` 5×200 (0.24–0.38 s); `anthropic` is `POLICY_DISABLED` (403); unconfigured providers report `UNCONFIGURED`; the Cerebras key in this environment is rejected upstream (401 — a key problem, not routing). Operation-labelled budgets from the self-study line are on all three `gatedGenerate` calls. | `logs/broker-groq-timing.txt`; `/api/model/status` |
| 9 | No conflicting state ownership | **One collision found and fixed**: CosmosObjectStore (Claude) and CreativeObjects (Freebuff) both answered "rotate it". `coutureOwns()` sends a sentence to the store its names resolve in. Camera: `cameraAuthority` (Freebuff) is a rule layer over `cameraOwnership` (Claude), and the planet drift also yields to M22.12 flights. Selections: Cosmos and couture selections are separate stores by design (different object types). | `aa48d9eb`, `c363c343`; `tests/workforce-object-authority-routing.test.ts` |
| 10 | No dead or misleading feature controls | **Partially checked.** Fixed: the Home Cosmos button now opens *and frames* the Cosmos (single door). Observed, not fixed: the reply to "rotate it" reads "turn the it 90°" (wording); the gear request "12 and 24 teeth" was built as 14:28 because the builder enforces its minimum tooth count — the reply shows the parameters it used. A full audit of every control was **not** performed. | `workflows.json` |

## 2. The six shared files

| File | Final ownership | What each workforce contributed |
|---|---|---|
| `src/core/tools/ToolDispatcher.ts` | One table `BY_ID` | Claude core + studio/forge/world/agentic/interface/environment/atelier/creative-kit/cosmos-object executors; Freebuff Mission 8 command-center executors (additive, never shadowing); ASRE executors (C3). Jules' Session 02 version: every id present. |
| `src/core/tools/ToolRegistry.ts` | Singleton registry | Builtin catalogue + Mission 8 definitions (no overwrite); registrars add the rest. Jules' `interface.*` ids live in `InterfaceTools.ts`. |
| `src/core/orchestrator/EnvironmentTools.ts` | Registrar for `environment.*` | Session 02 (Jules/Codelazr) by content; same risk levels as the builtin declarations. |
| `src/core/orchestrator/EnvironmentOrchestrationEngine.ts` | Canonical | Session 02/03 integrated earlier by content (Mission 10 / 3.3); no newer conflicting implementation arrived in this consolidation. |
| `src/core/interface/InterfaceTools.ts` | Canonical | Owns `interface.inspect/propose/recommend/revert/themes`. |
| `src/core/Bootstrap.ts` | Single boot | Adds: continuity tools + ContinuityEngine (autoProcess off) + CognitivePulse + provider-health probe; couture tools; ASRE, Foundry, self tools. |

## 3. Constraint checks

* **LangChain / LangGraph:** not present (`grep -ri langchain package.json src` → none).
* **Anthropic:** no new Anthropic dependency or call was added. The pre-existing `@anthropic-ai/sdk` dependency and the `anthropic` broker entry remain from before this mission; the runtime reports the provider `POLICY_DISABLED` and the broker answers 403. The older `DEPLOY_CONTABO.md` still describes Anthropic as primary — that text predates the free-first policy and is superseded by `CONTABO_DEPLOYMENT_READINESS.md`.
* **Free-first / no paid dependencies:** no package was added: `bun.lock` and `package-lock.json` are unchanged from the baseline, and the only `package.json` change is 11 new `scripts` entries (personality/voice verification, LÉLU 2 research, M23 hair evidence) — no dependency lines. Paid services stay behind spend authorization: ElevenLabs STT/TTS answered `402 spend_not_authorized`, nothing sent; the research workflow stopped rather than switching to a paid provider.
* **Capability and approval boundaries:** no tool's risk level was lowered by any re-registration (probe test 1).

## 4. Known architectural debt (not changed here)

* Two object domains (CosmosObjectStore, CreativeObjects) with a routing rule between them; a later unification would need a shared object model.
* The client probes `localhost` ports 11434/8080/1234/8000 for local model servers on every load (8 refused requests per page load in a browser with none).
* `src/core/voice/VoiceEngine.ts` (~3 k lines) and `ToolDispatcher.ts` (~3 k lines) remain very large single modules.
