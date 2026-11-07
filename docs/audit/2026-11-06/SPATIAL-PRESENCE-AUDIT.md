# LÉLU V1.1 — Provider Reliability & Spatial Presence Audit

Date: 2026-11-06
Baseline: HEAD `fe2314b`, tree `d21c6ce`, working tree clean, branch `claude/open-session-rbwmdw`, not pushed.
Scope: Phase 2 (provider reliability, OpenCode configuration) and Phase 3–4 (spatial avatar, demonstration placement) of the approved roadmap.

This audit keeps PASS, FAIL and BLOCKED separate. A running animation is not proof of environmental
awareness, and a reachable provider endpoint is not proof that a conversation was generated.

---

## Phase 2 — Provider reliability & execution readiness

### Configuration change made

OpenCode was installed at `/usr/local/bin/opencode` (v1.19.5) but unconfigured. It is now running and wired in:

- Server: `opencode serve --port 4096 --hostname 127.0.0.1` (pid 353828).
- `OPENCODE_BASE_URL=http://127.0.0.1:4096` persisted in `.env.local` (not committed; no secret value is stored there)
  and passed to the Vite process.
- The existing adapter, backend, registration and routes were not rewritten.

### Results

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Diagnose the ordinary-conversation outage | **FAIL (narrowed)** | The poem turn was re-run live. Provider stage: **20,139 ms**, final owner/provider `offline`. The browser chain still exhausts its budget; it is not a missing provider. |
| 2 | Anthropic connectivity and real responses | **BLOCKED** | `ANTHROPIC_API_KEY` is absent from the running server (`/api/model/status`: `anthropic:false`). No request was possible, so no response was invented. |
| 3 | Groq provider connectivity | **PASS** | `POST /api/model/groq/chat/completions` → HTTP 200, model `openai/gpt-oss-120b`, content `"Two plus two equals four."` |
| 4 | OpenRouter connectivity | **PASS** | `POST /api/model/openrouter/chat/completions` (`openrouter/free`) → HTTP 200 in 2.742 s |
| 5 | Provider fallback behaviour | **PASS at provider boundary / FAIL in-app** | Both remote rungs answer when called directly; the in-app chain still ends `offline` after ~20 s instead of falling through to the answering rung. |
| 6 | Failures cannot masquerade as success | **PASS** | The turn returned the explicit offline notice with `metadata.success:false`; routing trace recorded `owner=offline provider=offline`. No partial text was presented as a poem. |
| 7 | OpenCode configuration proven live | **PASS** | `GET /api/integration/opencode/health` → `state:"healthy"`, HTTP 200, 53 ms, `contacted:true`. |
| 8 | OpenCode real dispatch | **PASS** | `POST /api/integration/opencode/run` → HTTP 200 in 5,077 ms, session `ses_e4d97b6faffecrudfLpUe9Twqh`, summary `"ready"`, `contacted:true`, no files changed. |
| 9 | Distinct operational vs conversational ownership | **PASS** | Operational turn still resolved by the surface stage; the poem turn passed every operational stage untouched and reached the provider stage (`intent:"chat"`). |

### Root-cause narrowing (measured, not assumed)

- A direct Groq probe with `max_tokens:16` returned empty content with `finish_reason:"length"`: the whole budget went to
  reasoning. With 300 tokens it answered normally. Reasoning models consume the ceiling before content.
- `openrouter/free` is an auto-routed alias that also spends tokens reasoning; a 32-token probe returned 200 with reasoning
  only. A small ceiling therefore looks like "no answer" while the provider is healthy.
- The in-app chain's provider stage is a flat ~20.1 s, then `offline` — a timeout budget being spent, not a rejected request.
  The chain must fall through to the next rung *before* the turn budget is gone; that is the remaining defect and it is
  deliberately left failing honestly rather than papered over.

### Follow-up — the chain's own budget (implemented later on 2026-11-06)

The "timeout being spent" reading above was directionally right but incomplete. Capturing the actual request bodies showed
what the budget was being spent on:

- The chain sent **86,331 characters carrying 87 tool schemas** on an ordinary "write me a poem" turn, with 17,816
  characters of system context.
- **OpenRouter** answered `429 free-models-per-day` with `X-RateLimit-Remaining: 0`.
- **Groq** answered `429 ... on tokens per day (TPD): Limit 200000, Used 199144, Requested 5786. Please try again in
  35m29s.` — 856 tokens left for the day.
- **Anthropic** answered `400 Your credit balance is too low to access the Anthropic API.`
- A **control probe** through the same broker, with one short message, answered in **452 ms** with a real four-line poem.

So no configured provider was reachable *for that request*, and the chain had no per-rung limit — every turn re-paid the
full refusal latency of rungs that could not answer today, then said `offline`.

What changed (two files, no new architecture):

| Change | File | Evidence |
|---|---|---|
| A per-rung deadline (12 s) inside a chain budget (20 s); a cut-off rung is recorded as that provider's failure, and the next rung starts while time remains | `ProviderResolver.ts` | `the chain stops starting rungs once its own budget is spent`; `a slow provider is cut off at its own budget and the next one answers` |
| The rung deadline never mutates the turn's signal, so a Stop stays a Stop and is not read as a fallback | `ProviderResolver.ts` | `the rung budget never turns a user Stop into a fallback` |
| A size refusal (413 / tokens-per-minute / context ceiling) is retried once without the 87 tool schemas | `ProviderResolver.ts` | `a request refused for its size is retried without the tool schemas` |
| A spent **daily** allowance (`free-models-per-day`, `tokens per day (TPD)`) is `quota-exhausted`: 15-minute cooldown, not 30 seconds, and no pointless smaller retry | `AIProviderRegistry.ts` | `a spent daily quota is classified apart from a transient rate limit`; `a spent daily allowance is not retried smaller` |

Live effect, measured after the change on a fresh page load: the first turn paid both refusals once (provider stage
**8,512 ms**, two 429s); the next turn reached the provider stage in **1 ms with zero provider calls**, because both rungs
were parked by their measured daily-quota failures. Before the fix every turn re-paid that ~8.5 s.

Honest result: **the chain is bounded and no longer pays repeatedly for dead rungs (PASS, unit- and live-verified), but no
live successful generation could be produced**, because at measurement time every configured provider was out of allowance
or credit. That is recorded as **BLOCKED**, with the exact refusal bodies, not presented as a pass. The numbers for this
follow-up are in `evidence/provider-reliability/rung-budget-fix.json`.

---

## Phase 3 — Spatial avatar & environmental integration

### What was added

- `src/app/scene/genesis/avatar/spatialPresence.ts` — pure geometry + state machine. Reads only the interface markers the
  app already publishes (`data-lelu-window`, `data-lelu-composer`, `data-lelu-module-window`, dock/tabs/consent), never
  writes layout, never enters the cognition or execution path.
- `LeluCompanion.tsx` — her existing window/face/hero presences now take their placement, posture, opacity and transition
  from the plan. The posture transform is applied to her **body**, never to her drag bar or resize grip.

### Spatial rules implemented

- Beside the conversation or the active demonstration when there is room.
- Over the top edge of the window when the screen is mostly window — head and shoulders **outside** the transcript.
- Leaning over a panel boundary she is working with.
- Resting at the screen edge, at reduced opacity, when nothing is open (ambient).
- Hidden entirely when no placement clears the composer and every control.
- Real `env(safe-area-inset-*)` values measured, not assumed; viewport from `visualViewport`.
- Reduced motion: final position, zero travel, no transform.
- Her box is capped at 42% of viewport width and half its height.

### States and modes

States (all driven by app state, none random): `idle, observing, peeking, climbing, leaning, resting, emerging, retreating,
listening, speaking, interacting, demonstrating, transitioning, hidden`.
Modes: `ambient | companion | interactive`, chosen from chat/workspace/turn/dialogue state.

### Results

| Check | Result | Evidence |
|---|---|---|
| Placement rules (phone, cramped panel, desktop, demo, ambient, tiny) | **PASS** | 13 tests in `tests/spatial-presence.test.ts` |
| Never covers the chat input | **PASS** | live reading and tests (`overlaps(rect, composer) === false`) |
| Never covers a control | **PASS** | candidates that overlap dock/tabs/consent are rejected |
| Safe areas, responsive resize | **PASS** | measured insets; viewport listener + 500 ms geometry poll |
| Reduced motion | **PASS** | transform `none`, duration 0 |
| Live browser placement | **PASS** | 328×528 (narrower than iPhone): `peeking over its top edge`, composer clear, screenshot `02-live-home-328x528.png` |
| iPhone 390×844 **rendered** screenshot | **BLOCKED** | the browser harness rejected Playwright's viewport override (`options.mode` validation error). Geometry is unit-verified at exactly 390×844, not visually rendered. |
| Rig-level climb/lean clips | **BLOCKED (honest)** | the existing captured clip set has no climb/lean animation; those postures are driven body transforms, not new skeletal animation. No static illustration was substituted. |
| GPU/mobile budget | **PASS by construction** | one existing avatar canvas, 500 ms layout poll, no per-frame layout reads added |

### Defect found and fixed during live verification

The first live reading placed her **inside** the transcript (`placement:"above the composer"`, box overlapping the chat).
The composer-relative placement was removed and the strip-above-the-window placement added; a reload produced the correct
`peeking over its top edge` reading with the composer clear.

---

## Phase 4 — Demonstration integration

`demonstrating` is selected when a workspace/demonstration is active with tools running, and her anchor is computed from
the active panel (`space.panels[0]`) rather than the chat, with a `lean` posture toward it.

| Check | Result |
|---|---|
| Unit placement beside the demonstrated panel | **PASS** |
| Live demonstration turn in the browser | **BLOCKED** — no demonstration was run in this session, so no live claim is made |

She remains an independent presentation layer: the module exports pure functions and holds no execution or cognition state.

---

## Phase 5 — Verification summary

- `npx tsc -b --force` → exit 0.
- Full suite (after the provider-chain fix): **1453 tests, 1451 passed, 0 failed, 2 skipped** (`bun run test`, 158 s).
- Provider-chain suites: 28/28 (`provider-rung-budget`, `provider-fallback`, `provider-fallback-cognition`,
  `runtime-integrity`).
- Spatial suite: 13/13. Related avatar/companion/layout suites: 31/31.
- Live browser: page mounted, chat opened, placement measured, screenshot captured, poem turn traced.

## Phase 6 — Delivery

- Files: `spatialPresence.ts` (new), `LeluCompanion.tsx` (modified), `tests/spatial-presence.test.ts` (new), evidence and
  this audit.
- No verified functionality was rewritten; no architecture was added beyond one presentation-layer module.
- Working tree left clean after commit; branch not pushed.

## Evidence

- `docs/audit/2026-11-06/evidence/provider-reliability/live-provider-and-opencode.json`
- `docs/audit/2026-11-06/evidence/spatial-presence/spatial-evidence.json`
- `docs/audit/2026-11-06/evidence/spatial-presence/01-cramped-panel-peek.png`
- `docs/audit/2026-11-06/evidence/spatial-presence/02-live-home-328x528.png`

## Open items (not claimed as done)

1. In-app provider chain: the per-rung and chain budgets are in place and tested. A live successful generation is
   **BLOCKED by provider allowance**, not by the code: Groq had 856 tokens left for the day, OpenRouter had no free
   requests left, Anthropic had no credit. Re-run the poem turn after the allowances reset to close this out.
2. Anthropic: needs `ANTHROPIC_API_KEY` in the server environment before connectivity can be tested.
3. A rendered iPhone 390×844 browser capture (harness blocked) and real skeletal climb/lean clips.
