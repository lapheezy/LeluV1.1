# LÉLU V1.1 — OPEN-SOURCE ECOSYSTEM, FIRST INTEGRATION PASS

Date **2026-11-06** · branch `claude/master-integration` · commits `06fa205`, `fa87541`, `ccca94d`.

This report covers what was built, what was verified against upstream, and what
was **not** achieved. The chat connection is implemented and unit-proven but its
live end-to-end behaviour is **NOT_VERIFIED** — see §9.

## 1. Actual repository state (verified, not assumed)

| Fact | Value |
|---|---|
| Branch | `claude/master-integration` |
| HEAD at start of this pass | `ccca94d` (tree `d8ea1d2`) |
| Working tree at start | clean |
| Tests at start | 1390 tests, 1388 pass, 0 fail, 2 skipped |
| Tests now | see §10 |
| TypeScript | exit 0 |
| Subsequent commits after `ccca94d` | `06fa205` (this pass) |
| Pushed | **no** — no authorization given |

`cloud_git fetch` ran against `github.com/lapheezy/LeluV1.1`; no remote work
was overwritten and no other session's changes were touched.

## 2. Existing intelligence architecture (extended, not rewritten)

`src/core/operational-intelligence/` retains `types`, `model`, `dependencies`,
`collector`, `planner`, `index`. Two modules were added:

- `repositories.ts` — the verified catalog (provenance, licence, boundary, state).
- `declarations.ts` — dependency-declaration coverage: `declared` /
  `no_dependencies` / `undeclared`, where **undeclared is never promoted to ready**.

The server surface gained one route and one field:

- `GET /api/integration/repositories` — catalog + coverage, with an explicit note
  that a listing is not an installation.
- `GET /api/integration/intelligence` now returns `dependencyDeclarations`.

## 3. Chat integration points (as they actually are)

```
AIService.sendMessage → runtime.process → AIRouter.route
  ├ 0    TimeResolver
  ├ 0.5  CognitiveStateResolver
  ├ 1    BrainResolver            (identity, executive status, memory)
  ├ 1.2  IntelligenceResolver     ← ADDED (this pass)
  ├ 1.5  SurfaceResolver
  ├ …    planning, reasoning, tools, engineering, creative, avatar, project
  └      research → provider
```

`IntelligenceResolver` reads `/api/integration/{intelligence,explain,plan}` — the
same surface the studio panels read — and returns `handled: false` whenever the
surface is unreachable, so the provider keeps the turn instead of the stage
describing a state it never read. It imports no adapter and no orchestrator.

## 4. Repository-by-repository verification

26 records. `PRESENT` = a LÉLU adapter produced real evidence; `ADAPTED` = a
boundary exists, runtime unconfigured; `PLANNED` = boundary identified, nothing
built; `UNVERIFIED` = identity cannot be pinned; `UNSUITABLE` = unmaintained,
unlicensed, or redundant.

| Project | Upstream | Licence | State |
|---|---|---|---|
| Qwen3-Coder | QwenLM/Qwen3-Coder | repo NOASSERTION; weights Apache-2.0 | PLANNED |
| OpenHands | OpenHands/OpenHands | MIT | ADAPTED |
| OpenCode | anomalyco/opencode | MIT | ADAPTED |
| Pipecat | pipecat-ai/pipecat | BSD-2-Clause | PLANNED |
| whisper.cpp | ggml-org/whisper.cpp | MIT | PLANNED |
| Silero VAD | snakers4/silero-vad | MIT | PLANNED |
| Kokoro | hexgrad/kokoro | Apache-2.0 | PLANNED |
| LiteLLM | BerriAI/litellm | MIT (core), EE dir separate | PLANNED |
| Temporal | temporalio/temporal | MIT | PLANNED |
| OpenTelemetry Collector | open-telemetry/opentelemetry-collector | Apache-2.0 | PLANNED |
| Infisical | Infisical/infisical | MIT (core), EE dir separate | PLANNED |
| OPA | open-policy-agent/opa | Apache-2.0 | **PRESENT** |
| OpenFGA | openfga/openfga | Apache-2.0 | PLANNED |
| Semgrep | semgrep/semgrep | LGPL-2.1-or-later | **PRESENT** |
| Trivy | aquasecurity/trivy | Apache-2.0 | **PRESENT** |
| Gitleaks | gitleaks/gitleaks | MIT | **PRESENT** |
| Open-Eagle-Eye MCP | stuchapin909/Open-Eagle-Eye | MIT | PLANNED |
| Argus | — | UNVERIFIED | UNVERIFIED |
| OpenCam | — | UNVERIFIED | UNVERIFIED |
| Browser Use | browser-use/browser-use | MIT | PLANNED |
| Neko | m1k1o/neko | Apache-2.0 | ADAPTED |
| LiveKit | livekit/livekit | Apache-2.0 | PLANNED |
| LiveKit Agents | livekit/agents | Apache-2.0 (weights separate) | PLANNED |
| iOS ReplayKit FrameAccess | Iotric/iOS-ReplayKit-FrameAccess | NOASSERTION | UNSUITABLE |
| webrtc-replaykit | zhangqibin/webrtc-replaykit | BSD-3-Clause (bundled) | UNSUITABLE |
| pmndrs/xr | pmndrs/xr | MIT | PLANNED |

**Corrections to the brief's assumptions:**

- OpenHands' current organisation is `OpenHands`, not `All-Hands-AI`.
- OpenCode's maintained upstream is `anomalyco/opencode`, not `sst/opencode`.
- **Argus** does not identify one project. Candidates are NVIDIA ISAAC ROS
  `isaac_ros_argus_camera` (Apache-2.0, Jetson-only) and
  `NVIDIA-AI-IOT/argus_camera` (BSD-3-Clause). Neither is recorded as the target.
- **OpenCam** is ambiguous; the only candidate found (`MoffysDev/OpenCam`) is
  GPL-3.0, which cannot be bundled.
- **"Webbridge / webrtc-replaykit"** could not be verified at all. The surviving
  ReplayKit demo is unmaintained since 2020; the FrameAccess sample is unlicensed
  and unmaintained since 2022, and both need a native shell LÉLU does not ship.

## 5. Existing capabilities that make repositories redundant

| Repository | Already present | Decision |
|---|---|---|
| LiteLLM | `ProviderRegistry`, `AIRouter`, `ProviderModels` | Not adopted; would duplicate routing in-process |
| OpenFGA | `RelationshipStore` + `policy.ts` | Not adopted; would duplicate authorization |
| Temporal | `WorkflowStore`, `EngineeringOrchestrator` | Deferred; local work already completes |
| Browser Use | `BrowserTool`, in-app browser | Assessed only; no second browser stack |
| LiveKit Agents | SHAMAN, Executive Board | Transport only, and no media server exists |
| Infisical | `plugins/loadEnvFiles.ts` | Deferred; no rotation need yet |
| OpenTelemetry | `integrationState` span buffer | Exporter unconfigured, not urgent |

## 6. Licensing and dependency concerns (recorded, not resolved)

1. **Semgrep is LGPL-2.1-or-later** — it must stay an executed binary, never be linked into LÉLU's bundle.
2. **OpenCam (candidate) is GPL-3.0** — incompatible with bundling; excluded.
3. **Qwen3-Coder's repository declares no SPDX licence** although its weights are Apache-2.0 — the repo and the weights are separate licence facts.
4. **LiteLLM and Infisical carry mixed trees** (`ee/` enterprise content) — only the MIT core is usable.
5. **ReplayKit projects are unlicensed/unmaintained** — no basis to ship.
6. **Compute is not free**: Qwen3-Coder (30B MoE), Kokoro (82M), Pipecat (Python sidecar), LiveKit (media server + TURN), Temporal (server + DB) are self-hostable software with real hardware and bandwidth costs.
7. **Python sidecars are not possible in this deployment** — the app serves through a Vite/Node plugin runtime, which excludes Pipecat, whisper.cpp server, LiteLLM proxy and LiveKit Agents without a new runtime.
8. **Semgrep/Gitleaks scope noise** remains (`.tools/trivy-cache`, `generation_logs`).
9. **86 Trivy dependency findings** remain open and were deliberately not auto-upgraded.

## 7. Integration order (dependency-driven, revised from the brief)

1. **Chat surface** (this pass) — done at the stage level.
2. **Engineering**: OpenCode first (local, MIT, no Docker), then OpenHands (Docker + model endpoint), then Qwen3-Coder as a provider entry.
3. **Security**: OPA already present; wire remaining scanner findings into Engineering Studio; OpenFGA only if relationship depth demands it.
4. **Voice**: Silero VAD (weights only) → whisper.cpp endpoint → Kokoro, each behind `VoiceEngine`; Pipecat only if a Python sidecar is added.
5. **Infrastructure**: OpenTelemetry exporter (cheap, bounded) → Temporal only for tasks that genuinely outlive a process.
6. **Perception/devices**: Open-Eagle-Eye MCP behind per-source authorization; LiveKit only with a deployed media server; ReplayKit requires a native shell — out of scope.
7. **Spatial**: pmndrs/xr evaluated last; iOS Safari lacks immersive WebXR.

## 8. Commits

| Commit | Content |
|---|---|
| `fa87541` | intelligence engine + planner (previous pass) |
| `ccca94d` | Phase 3A gate report + evidence |
| `06fa205` | chat stage, repository catalog, declaration guard, `/api/integration/repositories` |

## 9. First end-to-end demonstration — NOT VERIFIED

What was implemented and proven:

- The stage answers explanations, plans and snapshots from a stubbed live payload, and declines the turn when unreachable: **29 tests pass** (`tests/operational-chat-stage.test.ts` + `tests/operational-ecosystem.test.ts`).
- The live endpoints return correct data: `repositories-http.json` (26 records, 24 verified, 2 unpinnable, 4 PRESENT) and `snapshot-with-declarations-http.json` (`5 declared, 22 leaf, 0 undeclared of 27`).

What failed:

- In the running app, asking **"why can't you run OpenHands?"** in chat produced a **model-generated** answer ("System health is degraded…"), not the intelligence answer. The network log shows the resolver's `GET /api/integration/intelligence/explain` returned **200**, and a temporary `console.error` in the catch produced **no output** — so the stage did not throw. On a second identical message, no explain request was issued at all.
- Root cause is **not established**. Candidates: an earlier resolver claiming the turn before stage 1.2 on some phrasings, or the chat surface rendering a provider stream alongside the routed response.
- **No screenshot is claimed** for this. The conversation capture shows the wrong answer, so it is not presented as success.

This means acceptance criterion 1 ("existing operational intelligence works through normal Chat") is **not met**, and must not be reported as met.

## 10. Tests and checks (this pass)

| Check | Result |
|---|---|
| `npx tsc -b --force` | exit 0 |
| `tests/operational-chat-stage.test.ts` | 6 pass, 0 fail |
| `tests/operational-ecosystem.test.ts` | 23 pass, 0 fail |
| `tests/operational-intelligence.test.ts` | 30 pass, 0 fail |
| Full suite | 1419 tests, 1417 pass, 0 fail, 2 skipped (exit 0) — re-run after the final edit |
| Live routes | `/api/integration/repositories`, `/api/integration/intelligence` captured as JSON |

## 11. Limitations and next steps

1. Fix the live chat routing gap — instrument `AIRouter.route` to record which stage claimed the turn, then correct the ordering or the surface.
2. No repository was installed in this pass; `PRESENT` remains the only state backed by evidence, and OpenHands/OpenCode stay `NOT_CONFIGURED`.
3. The requirement table now covers all 27 reported capabilities, but new capabilities still need an explicit declaration; the guard reports omissions instead of assuming readiness.
4. Panels for the new intelligence views (Studio, Perception, Device) do not exist yet.
5. No push has been performed.
