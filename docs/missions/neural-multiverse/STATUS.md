# Neural Multiverse mission — status and final acceptance (2026-11-27)

Branch `claude/gallant-ritchie-wwievb`, continuing c9659905 (WP18 merge) and feac9308 (Neural Map foundation).

| Commit | Work package |
|---|---|
| c9659905 | Merge of WP18 conversational judgement (85000c80) |
| feac9308 | Foundation: one map, three aspects, 12 shared layouts, saved views |
| 4e9eab22 | WP11 companion no longer covers the Neural Map |
| d807be22 | WP12 V2 in ten real 3D views |
| 4c182960 | WP13 agent society + WP19 conversation registry, usage telemetry, resource control |
| 6f37ea16 | WP14 cognitive integration, WP15 Repository Agent / Governor, WP17 bounded self-development |
| 2f8a9a6e | WP16 verified 50-reference atlas |
| (this commit) | WP18 acceptance: test fixes, journal, playbooks, this report |

## What was built

**WP11.** A surface that owns the whole screen now marks itself with `data-lelu-covers-screen`. The standalone Neural Map and the Usage monitor both do. While one is open, the companion takes a new place, `away`: hidden, no pointer events, render paused. Every other placement is unchanged. Regression coverage is a unit test plus a real-app hit test on every header button, select, input and the stage, on desktop and iPhone.

**WP12.** V2 has ten WebGL views of the same real graph: Anatomical Core, Neural Sphere, Layered/Exploded, Neural Universe, Connectome Tractography, Glass Brain, Multiscale, Cognitive Circuit Board, Temporal Activation and Subsystem Constellation. They use react-three-fiber and drei, already dependencies. What each visual encodes:

- **Size:** lines of code.
- **Wiring:** static imports.
- **Bars:** git commits per day (change activity), with shallow-clone boundary commits excluded.
- **Particles:** one per real source file.
- **Glow:** live events on the one AgentEventBus.
- **Brain placements:** labelled as a metaphor.

**WP13.**
- `AgentDialogue` runs direct, group and private self-dialogue conversations. Every turn goes through `AgentRunner`, so it is a real model call through the provider chain, budget gate and resource policy.
- Each turn persists as the agent's own AgentStore task and execution, and the transcript is read back from those.
- Dialogue turns skip the router's keyword stages. Before this, they were answered with no model by the direct-tool and repository-acquisition stages.
- V3 draws measured "conversed" edges and each agent's real state (active, queued, paused, offline, failed, idle).
- Each agent has a workspace: profile, goals, tool grants, history, conversations, and controls for pause, step, end and terminate.

**WP14.**
- What the person is looking at (aspect, layout or 3D view, selection) reaches the self-state text her model reads every turn. Asked in a real chat turn, she answered: "You're looking at aspect V2 (your cognitive architecture) in the 3D "connectome-tractography" view."
- Diagnosis uses real data only: capability gaps, unimported subsystems, heavily used but unchanged subsystems, unreliable or unused agents, and unaccounted usage.

**WP15.** The Repository Agent role is distributed and used as it is:
- RepoExecutive discovers, researches and compares;
- ResourceIntelligence gives licence and class verdicts;
- RepoExecutor and EngineeringCouncil inspect, behind ApprovalGate.

The Governor is the existing chain:
- proposals enter `ImprovementQueue`;
- the Architect executive is consulted (plus the Sentinel for capabilities), and that consultation is recorded as the acknowledgment;
- AutonomyGate bounds execution;
- the owner approves, rejects, defers or requests changes;
- approved work goes to the existing SelfDevelopmentLoop sandbox.

No new agent or governor was created.

**WP16.** All 50 sources and images were checked live.
- **Embedded (3):** their publishers license reuse. #8 is CC BY-SA 4.0, #41 is Apache-2.0, #46 is CC BY 4.0.
- **View-only (47):** each with its exact reason.
- Output: `atlas/LELU_NEURAL_MAP_50_REFERENCE_ATLAS_VERIFIED.pdf` and `atlas/register.json`.

**WP17.** A bounded Observe → Diagnose → Research → Compare → Propose → Sandbox → Validate → Govern → Deliver → Learn cycle runs on CognitiveLoop's existing heartbeat.
- It runs at most every 6 h, makes no model call, and submits at most 3 proposals.
- A finding kind the owner rejects twice is not proposed again.
- It can also be run now from V2's Development panel or the `development.cycle` tool.

**WP19.**
- **ConversationRegistry** indexes every conversation type: user chat, voice, agent task, direct, group, self-dialogue, tool, browser, background, and an explicit "unattributed" record. Every settled model call reaches it.
- **UsageLedger** gained conversation and agent attribution, plus persisted minute (48 h) and hour (120 d) rollups with sampled gauges.
- **ResourcePolicy** is enforced in three places: at the gate (emergency stop, paused/terminated/throttled workloads, cooldown, concurrency, hourly and per-conversation/per-agent caps), in `gatedGenerate` (max call duration), and in AgentRunner (concurrent tasks, paused agents).
- **Plain-word control** works through `resources.control`: consequential changes are planned for approval first, and results are read back from the runtime.
- **Analytics** provides minute, hour, day, week and month series, ranges with capacity, breakdowns, alerts with recommendations, and CSV/JSON export.
- **Monitor:** open it from the Neural Map's **Usage** button, Settings → Usage, or `?monitor=usage`.

## Acceptance results (final run)

| Check | Result |
|---|---|
| Full suite (`npm test`) | 3476 tests: 3441 pass, 29 skipped, 6 failed. 2 were regressions from this work (companion source assertions, registrar probe); both fixed and re-run green (41/41). The remaining 4 fail identically on the pre-merge base f354012a (see below). |
| Typecheck (`tsc -b --force`) | pass |
| Lint (`oxlint`) | exit 0; 255 warnings, all in pre-existing files, none in this work |
| Production build (`vite build`) | pass |
| Neural Map unit tests (`tests/neural-multiverse.test.ts`) | 26/26 |
| WP19 unit tests (`tests/usage-registry.test.ts`) | 7/7 |
| Multiverse in the app: 3 aspects × 12 layouts, saved views, 10 WebGL views (GPU draw calls, triangles and canvas pixels), WP11 hit tests desktop + iPhone (`scripts/neural/verify-multiverse.mjs`) | 62/62 |
| Agents and usage in the app: every conversation type registered and traced, real model-backed direct/group/self turns, multi-resolution usage, correct ranges, natural-language and UI controls changing the runtime, pause/throttle/terminate/emergency stop refused at the gate with the reason, persistence across a reload, export, overhead, iPhone (`scripts/usage/verify-usage.mjs`) | 31/31 |
| Cognition and development in the app: awareness in the self-state and in a real chat answer, the 10-stage cycle, proposals with the Architect's acknowledgment, owner decisions, real RepoExecutive research (`scripts/neural/verify-development.mjs`) | 8/8 |

**Pre-existing failures (not regressions).** All four fail identically at f354012a:
- `credential-exposure`: "no workflow hands a provider credential to a build";
- `foundry` ×2: "coat and catsuit handbags", "three sources ordered";
- `supabase-config`: "skipping is a remembered answer".

**Measured overhead.** Recording one call in the registry costs about 0.001 ms. A gauge sample takes about 4 ms and runs once per heartbeat, or every 15 s while the monitor is open. Computing system ranges takes about 0.2 ms.

**Flakiness seen and handled honestly.** After many runs, the free-tier providers sometimes all report unreachable. Turns then show as `offline`, never as a fabricated reply. The verifier reports any check that could not be exercised as UNVERIFIED, not as passed. On the final run, every check was exercised.

## What cannot be measured, and why

- **CPU %:** browsers have no API for it.
- **GPU utilisation:** WebGL has no counter. The 3D views report their own draw calls and triangles instead.
- **JS heap outside Chromium:** `performance.memory` is Chromium-only.
- **Provider quota headroom:** the broker does not forward the `x-ratelimit-*` headers; only 429s are counted.
- **Tokens or cost when a provider does not report them:** shown as unavailable.
- **Cross-origin bandwidth:** hidden by the browser.

## Remaining blockers

1. **Contabo is not verifiable from this container.** Port 22 is refused, HTTPS to 157.173.116.95 is reset by the egress proxy, and the repository names no public hostname. Nothing here claims live server work.
2. **Registry, policy and rollups are per device** (KvStore/localStorage), like the existing UsageLedger. Account-wide limits across devices would need a Supabase table. That is not built, because it requires your approval and a migration.
3. **Private self-dialogue is visible to the owner.** "Private" means no other agent sees it. Background reasoning is exposed only as structured events and summaries, never chain-of-thought.
4. **Background priority is per purpose, not per topic.** "Prioritise Neural Map development" is refused with that explanation instead of being faked.
5. **Atlas images:** 47 references are view-only until their publishers grant permission. A second set of 50 image references was not compiled.
6. **Voice sessions** are registered through the same `ai.chat(..., { surface: "voice" })` path VoiceEngine uses. No microphone exists here, so the voice path was exercised through that call, not through audio.

## Production deployment requirements

Nothing has been merged or deployed. To ship this:

1. **Approve and merge** `claude/gallant-ritchie-wwievb` into the production branch.
2. **Build:** `npm ci && npm run build`. Typecheck and build were verified here.
3. **No new environment variables, secrets or Supabase migrations.** The new usage fields are not synced (`UsageSync.toRow` maps columns explicitly), and all new state uses the existing KvStore/localStorage.
4. **Providers:** agent conversations, chat and research need at least one of the keys already handled by `deploy/contabo/inject-env.sh`. In this verification that was Groq, OpenRouter or Cerebras. Anthropic was not used.
5. **Deploy** with the existing Contabo path (`DEPLOY_CONTABO.md`: `deploy/contabo/install.sh` / the systemd unit and `healthcheck.sh`). This needs you, or someone with `ssh root@<vps>`, since this container cannot reach the server.
6. **After deploying, on the server's URL:**
   - open `?interface=neural-map` and `?monitor=usage` on desktop and iPhone;
   - run one agent conversation from a V3 agent's workspace;
   - check it appears in the monitor;
   - try the emergency stop and release it.
7. **Optional, needs approval:** account-wide usage limits (a Supabase table and RPC), and any of the 3 proposals her first development cycle submitted (they are waiting in the improvement queue).
