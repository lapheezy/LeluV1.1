# MISSION 5.6 — LIVE AUTONOMY COMPLETION & COSMOS STABILITY

Completion/reliability mission on an isolated branch. Nothing was rebuilt, no
provider policy was changed, canonical was never written to, and no model
execution is claimed that did not happen.

**Outcome: the code gates pass and the renderer behaviour is now measured, but
the live autonomy cycle could not run because every permitted provider refused
the day's requests.** That is recorded below with the providers' own error text.

## 1. Starting state — and a discrepancy that had to be resolved first

The directive named `a2f0e03` as the Mission 5.5 commit. Verified against the
remote before touching anything:

| Claim | Verified reality |
|---|---|
| Mission 5.5 branch | `claude/mission-5-5-autonomy-activation` @ **`5619efd`** |
| `a2f0e03` | head of **`claude/live-autonomous-activation`**, merge-base `61b27c8` |
| `a2f0e03` contains `toolSchemasForRequest` | **no** (`grep` = 0 matches) |
| `5619efd` contains it | yes |

So the mission was based on **`5619efd`** — the branch the directive names, the
one that actually carries the verified 5.5 fix. `a2f0e03` is a sibling branch
that never received it; basing 5.6 there would have silently discarded the fix
this mission is supposed to build on.

Branch: `claude/mission-5-6-live-autonomy-completion`. Working tree clean.
Canonical `ce768e08…` untouched. All earlier acceptance evidence preserved.

## 2. Gate A — provider capacity and tool reliability

**What changed (and why).** Mission 5.5 fixed the 413 by scoping the offered
tools. It left one defect: on a size refusal the resolver retried the *same*
request with **no tools at all**, which is exactly how a model ends up
describing work it cannot do. Degradation is now two steps:

```
full tool set  →  reduced set (≤3, environment family first)  →  no tools
```

`reducedToolSchemas()` is a filter over the existing derived list, never a
second list, and it can never invent a schema. The six environment tool ids,
the registry ∩ executor ∩ gate intersection and the fail-open narrowing are all
unchanged.

`tests/provider-rung-budget.test.ts` pinned the old two-attempt behaviour; its
assertion was **updated to the new contract** (three attempts: schemas → reduced
non-empty set → none) rather than deleted or loosened.

**Live capacity.** Measured, not assumed, with the mission's non-Anthropic
policy intact:

| Provider | Result |
|---|---|
| Groq (`openai/gpt-oss-120b`) | credential valid; a tiny direct probe returned 200, but real turns got **429 "Rate limit reached for model … today"** — the daily allowance |
| OpenRouter | key valid; turns **429 "free-models-per-day"** |
| GitHub Models | `/api/model/status` reports it configured, the adapter says **"token missing"** at call time — a real discovery/config mismatch |
| Cerebras / Mistral / Fireworks / Gemini | not configured |
| Anthropic | **excluded by mission policy** — not enabled, not used, not suggested |

The app behaved correctly under this: the registry parked each provider in
cooldown and `ProviderResolver` answered *"No AI providers are available."* No
completion was invented. **Live model turns: BLOCKED.**

## 3. Gates B–E and J — the cycle itself

Every instruction was sent through the **real Chat Universe composer** in the
running app (guest session, no injected responses). What came back each time was
the app's own provider notice. The Cosmos did render (one chat surface, "1 tool
used · 1 issue", *"I did not change the scene: there are fewer than two objects
to arrange"*) — that line comes from the deterministic path and is **not**
counted as model-selected autonomy.

| Gate | Status |
|---|---|
| B complete environment construction | **BLOCKED** (provider) |
| C self-inspection & correction | **BLOCKED**; structural channel audited: `CognitiveContext` injects `describeWorkspace(...)`; there is no screenshot channel to the model, so visual inspection is not claimed |
| D continuous evolution | **BLOCKED** |
| E persistence & continued work | **PARTIAL** — 33 `lelu.*` keys written in a real session (`layout.v2`, `spatial.portals.v1`, `projects.v1`…), `persistToStorage` writes `environment.snapshots`/`revisions`; no environment existed to save/restore, so that half is **not** demonstrated. Cross-device persistence does not exist (localStorage only) |
| J complete autonomy acceptance | **BLOCKED** — sequence sent, no provider answered |
| F Cosmos as universal surface | **PARTIAL** — audited only, nothing rebuilt, no second presentation engine |

## 4. Gate G — renderer stability, measured

A 5.6-minute interactive session (19 samples, pills + Cosmos + scrolling) was
run with CDP performance metrics:

| Metric | Start | End |
|---|---|---|
| Survived | — | **338 s, 0 crashes, 0 page errors** |
| JS heap | 141.2 MB | **407.5 MB** (+266 MB) |
| Event listeners | 8,961 | **17,424** (+8,463) |
| DOM nodes | 1,150 | 1,055 (stable) |

Listeners nearly doubled while nodes stayed flat: **the growth is retained
listeners, not DOM**. That is consistent with the Mission 5.5 ~3-minute
terminations being resource growth in the renderer/browser process rather than a
deterministic app crash — but the crash **did not reproduce**, so the cause is
recorded as **not definitively identified**. Timeouts were deliberately not
raised to paper over it.

Mitigation that is real rather than cosmetic: the cycle probe now writes every
completed turn to disk immediately, so a renderer death mid-cycle loses no
evidence. Viewports: **4/4 PASS**, not blank, live composer (see Gate I).

## 5. Gate H — memory and reflection

Wiring unchanged and re-verified: `Bootstrap.ts:215` starts `DailyReflection`,
`CognitiveLoop.ts:375` calls `runDueReflections`, `AgenticTools` exposes manual
reflection. In a real session the reflection/self-study keys are written
(`lelu.lelu.reflection.last.v1`, `.history.v1`, `selfstudy.trace.v1`) and the
provider-less cycle fails gracefully. Not verified: that completed environment
work informs later turns (needs a model turn). No duplicate memory system added.

## 6. Gate I — regression and mobile

| Check | Result |
|---|---|
| `bunx tsc -b --force` | **exit 0** |
| `bun run build` | **exit 0** |
| `bun run lint` | **exit 0** — 133 warnings, 0 errors |
| `bun run test` | **exit 0 — 1838 tests, 1838 pass, 0 fail** (338.7 s) |

Baseline note: Mission 5.5 reported 1835/1833/2-skipped. This run adds 3 tests
and reports 1838/1838/0 — the two conditional skips (a runtime lacking
IndexedDB) executed and passed here, which the log's skip note confirms is
environment-dependent, not a behaviour change.

Mobile (fresh load, real app): 360×640, 375×812, 390×844, 430×932 — **all PASS**
(no white screen, app shell, live composer, cosmos control, no duplicate
surfaces). **Physical-device testing was not performed.**

## 7. Files changed

- `src/core/tools/ToolSchemas.ts` — `reducedToolSchemas()`, `REDUCED_TOOL_LIMIT`
- `src/core/router/ProviderResolver.ts` — two-step degradation (`full | reduced | none`)
- `tests/tool-schema-scoping.test.ts` — +3 tests (8 total)
- `tests/provider-rung-budget.test.ts` — contract updated to the two-step retry
- `docs/acceptance/mission-5-6/` — probes, logs, evidence JSON, screenshots

No provider priority, model id, credential or canonical branch was modified. No
existing tool removed, no registry/dispatcher/engine duplicated.

## 8. Remaining blocker, stated once

**One working provider with a usable daily allowance, outside Anthropic.** Groq's
credential is good; its free daily tokens are spent. OpenRouter's free daily
allowance is spent. The GitHub Models token is rejected. When any one of those is
restored (or another non-Anthropic provider is configured), gates B, C, D and J
can run as written — the harness, the scoped tool offering and the per-turn
evidence capture are already in place.

## 9. Merge-readiness

**Merge-ready as a reliability change; not complete as a milestone.** The tool
degradation fix is additive, unit-pinned and green on every code gate. The
autonomy claim is not made: no complete
UNDERSTAND → … → REMEMBER cycle ran, and none is implied by the evidence here.
