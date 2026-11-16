# MISSION 6.1.3 — CANONICAL INTEGRATION ACCEPTANCE & SYSTEM-WIDE VALIDATION

Date: 2026-11-12
Mission branch: `mission/6.1.3-integration-acceptance` @ `0353ed0`
Verdict: **LÉLU is operational for chat, voice playback and persistence on a real server.
Two measured defects degrade every conversation; three capabilities remain unverified.**

---

## 1. Verified commit identity

| item | value |
|---|---|
| canonical reference | `098dd3e` — *Merge the canonical branch's secret-name and budget fixes into the voice work* |
| merge commit | `961f646` — boot/readiness work merged onto `098dd3e` (clean, no conflicts) |
| candidate baseline | `0353ed0` — *Correct the baseline…*; **parent is `961f646`**, so it is a follow-up commit, not part of the merge's own history |
| mission branch tip | `0353ed0` (identical to candidate) |
| working tree | clean — only untracked artifacts/pid files, no tracked modifications |
| canonical ancestry | `git merge-base --is-ancestor 098dd3e HEAD` → **yes**; `4c6a3ff` → **yes**; commits in canonical not in HEAD → **0** |
| voice history present | yes (`7c2b2c0 … 098dd3e`, 12 commits, incl. VoxCPM2 sidecar, free-tier accounting) |
| boot/readiness present | yes (`perf/lelu-render-architecture` + `mission/6.0` + `6.1` + `6.1.1`, 11 commits) |

Nothing was pushed, reset, rebased, cherry-picked or written to the canonical branch.

---

## 2. Build results — VERIFIED

| check | command | result |
|---|---|---|
| TypeScript project build | `tsc -b --force` | **exit 0**, no diagnostics |
| production build | `vite build` | **exit 0**, 5.17 s |
| dependency drift vs canonical | `git diff --name-only 098dd3e HEAD -- package*.json bun.lock*` | **empty** |
| install | `npm ci` (after workspace restore wiped `node_modules`) | exit 0, lockfile byte-identical afterwards |

## 3. Full test results — VERIFIED, one known failure

```
ℹ tests 2008   ℹ pass 2001   ℹ fail 1   ℹ skipped 6   ℹ duration_ms 216330
```

Exactly the expected reference. The single failure is the pre-existing
`tests/voice-continuity.test.ts` case (§7.3). No test was changed, skipped or deleted.

## 4. Boot performance measurements — VERIFIED (software-rendered VM, no GPU)

Boot graph (`scripts/measure-boot-graph.mjs dist`):

```
entry chunk            index-CIBJPXH-.js
modulepreload links    0
chunks a cold boot     156        (reference 156)
bytes on the critical  1.65 MB    (reference 1.65 MB)
chunks emitted total   1452
entry is               10.7% of the bundle at boot
```

The 5.9 optimisation (654 chunks / 4.49 MB → 156 / 1.65 MB) survives the canonical merge.

Browser navigation timings, real app on `server.ts`, 1440×900:

| metric | cold load | repeat load |
|---|---|---|
| response end | 515 ms | 745 ms |
| first paint | 924 ms | 1528 ms |
| first contentful paint | **2444 ms** | **2060 ms** |
| DOMContentLoaded | 2374 ms | 2012 ms |
| load | 2567 ms | 2091 ms |
| JS requests | 239 | 239 |
| JS bytes fetched | 3.85 MB (whole session incl. lazy panels) | 2.63 MB |
| JS heap at idle | 85 MB | — |

Lazy behaviour holds: the boot graph carries no studio/worker/export payload. Largest
chunks are all deferred — `studioExport.worker` 2145 KB, `chunk-EIO257PC` 1778 KB,
`LatencyProbe` 1313 KB (the known 72-importer shared blob), `exceljs` 908 KB,
`ChatUniverse` 743 KB. None of them appear on the critical path.

**Not measured:** FPS and GPU frame cost. This VM software-renders WebGL (the browser
logged repeated `GPU stall due to ReadPixels`); any FPS figure here would be an artefact.

## 5. Chat acceptance — VERIFIED

Driven through the real UI (guest session → *Continue without an account* → *Travel to
Conversation* → `textarea[placeholder="Message LÉLU…"]`):

| # | capability | status | evidence |
|---|---|---|---|
| 1 | new conversation | VERIFIED | first message accepted, reply rendered |
| 2 | multi-turn | VERIFIED | turn 2 asked "What did I just ask you?" → *"You asked me to state in one short sentence what I am."* — correct recall of turn 1 |
| 3 | streaming | VERIFIED | broker SSE: 32 `data:` events + `[DONE]`; UI receives incrementally |
| 4 | persistence | VERIFIED (local) | full reload → 4 turns re-rendered; `lelu.lelu.conversation.v1` (496 B) holds `{role,text,timestamp}` |
| 5 | session restoration | VERIFIED (local) | conversation restored after page reload; chat panel must be re-opened (navigation state is not restored) |
| 6 | error recovery | VERIFIED | a turn whose first two provider calls failed (402, 413×2) still produced a reply |
| 7 | provider switching | VERIFIED (automatic) | client tried `openrouter` → 402, then `groq` → 413 ×2 → **200** |
| 8 | context continuity | VERIFIED | turn 2 correctly referenced turn 1 |
| 9 | tool invocation | UNVERIFIED | tool schemas are shipped (21,756 tokens of them) but no tool call was observed executing |
| 10 | structured response rendering | PARTIAL | plain prose renders correctly; no structured/markdown-heavy reply was exercised |

## 6. Cognition & memory integration findings

**Connected, not merely co-located.** A UI-typed message produced a provider-backed reply
inside the same React tree that renders the avatar, and the readiness registry
(`window.__leluReadiness`) moved out of `INITIALIZING` for the cognition/network
subsystems as a result of that reply.

- Memory recall: the browser queried `nrehsldbfxthspikaxvr.supabase.co/rest/v1/legacy_memories`
  and received **200** with rows, for both turns. The project URL is a **documented public
  default** in `src/core/config/supabasePublic.ts`, not a secret leak.
- Server-side Supabase is **MISSING** (`/api/env-check`: `VITE_SUPABASE_URL: MISSING`,
  `VITE_SUPABASE_PUBLISHABLE_KEY: MISSING`) — so server-side persistence paths are not
  configured even though the browser path works.
- Memory **writes** were not exercised → UNVERIFIED.
- This is **not** evidence of autonomous cognition: it is a model reply plus retrieval.

## 7. Voice findings

### 7.1 Runtime — PARTIAL
- `/api/voice/status` → `{"configured":true,"stt":true,"voiceId":"cgSgspJ2msm6clMCkdW9","modelId":"eleven_v3","sttModelId":"scribe_v1"}`
- `/api/voice/tts` → **200** during a real reply, followed by a `blob:` media request **206**
  — audio was generated, delivered and played by the browser.
- **VoxCPM2 sidecar: not running** (no such process; no GPU in this VM). The canonical
  sidecar path is therefore **UNVERIFIED**; ElevenLabs carried the voice.
- Interruption (barge-in), recovery after worker restart and free-tier accounting were not
  exercised in the browser → **UNVERIFIED** (unit tests for them pass).

### 7.2 Preserved
No voice file, settle semantic, billing path or architecture was modified.

### 7.3 The failing test — classified: **outdated synchronous test**

`tests/voice-continuity.test.ts:122` asserts, immediately after `finishStreamingSpeech`:

```ts
assert.equal(engine.isSpeaking(), true, "audio is queued");   // ← fails, gets false
```

Mechanism, from the code:

```ts
finishStreamingSpeech(fullText) {
  if (!this.elevenLabsSettled) { void this.probeElevenLabs();
    this.whenVoiceSettled(() => this.finishStreamingSpeech(fullText)); return; }   // ← returns
```

`whenVoiceSettled` (line 1564) only calls `speak()` after `probeElevenLabs()` resolves. The
test stubs `fetch` to 404, so the probe resolves asynchronously after the assertion runs.

That deferral is **intentional and desirable** — commit `26598e3` exists to stop the first
sentences being spoken in the browser's voice before the server answers. The engine is not
stuck (the following test `"a reply with nothing left to say still settles"` passes, and the
real browser played audio). So: **not** a timing flake, **not** a genuine state-transition
defect — the test encodes the pre-`26598e3` synchronous contract.

**Proposed resolution (not implemented, per mission rules):** make the test await the
settle — e.g. `await wait(0)` / await the engine's settle promise before asserting
`isSpeaking()` — and keep an explicit assertion that after settling the phase is
`idle`, not `speaking`. Do not weaken the end-state assertions.

## 8. Provider verification — VERIFIED, with measured limits

Independently, through the broker (`/api/model/<provider>/…`):

| | Groq | OpenRouter |
|---|---|---|
| configuration | key SET (56 chars) | key SET (73 chars) |
| authentication | works | works |
| model availability | `200`, 11 models | `200`, 439 models |
| actual completion | `200` 296–465 ms, `"INTEGRATION OK"`, 165 tok (73 reasoning) | `200` 858 ms, `"INTEGRATION OK"`, 51 tok |
| streaming | `200`, 32 SSE events + `[DONE]` | `200`, 6 SSE events + `[DONE]` |
| timeout behaviour | `-m 60` never hit; no failure observed | same |
| error handling | unknown model → **404** JSON `invalid_request_error` | unknown model → **400** JSON |
| fallback | receives traffic after OpenRouter 402 | tried first by the app |

No key, token or secret value appears in this report or in the logs quoted from.

## 9. UI findings

Desktop: cosmos shell renders — LÉLU avatar button, *Spatial*, *Return to the core*,
*Talk to LÉLU*, *Open Creation Studio*, *Portals and layout*, *Summon the chat*; chat panel
renders with correct bubbles, header, `Controls`, composer and Send button. No blank
screen, no overlap, no console error from the app itself.

Mobile (390×844):

| check | result |
|---|---|
| horizontal overflow | **0 px** (`scrollWidth − clientWidth = 0`) |
| tap targets under 32 px | 22 |
| portal buttons positioned off-viewport | 12 (the spatial ring is intentionally larger than the phone) |
| overlapping buttons | none detected above 60 % area |

Console: three real issues, all non-blocking —
`manifest.webmanifest` → **403**, `/api/engineer/status` → **503** (fail-closed by design,
token unset), `net::ERR_ABORTED` on a voice blob (aborted segment).

![Desktop](artifacts/perf/6.1.3-desktop.png)
![Mobile](artifacts/perf/6.1.3-mobile.png)

## 10. Runtime resilience — VERIFIED

| test | result |
|---|---|
| server startup | clean; serves `dist` on `0.0.0.0:3000`, version reported as `0353ed0` |
| API health | `/api/health` **200 application/json** with version, uptime, rss/heap |
| worker availability | VoxCPM2 sidecar **absent**; `/api/voice/*` still 200 via ElevenLabs |
| server restart | killed → ready in **1040 ms**; `/api/health` 200; Groq completion 200 in 315 ms (`"OK"`); voice status unchanged |
| partially-initialised state after restart | none found — boot log clean, no error/unhandled lines |
| lost provider connectivity | **not simulated directly**; however a real 402 + two 413s occurred mid-turn and the conversation still completed |
| background/foreground | not applicable (no service worker lifecycle exercised) |

## 11. Known defects

| id | defect | evidence | impact |
|---|---|---|---|
| **D1** | Every chat request carries **21,756 tokens of tool definitions** (OpenRouter: `bytes=102821, prompt≈3848tok, tools≈21756tok`) | broker log line: `REFUSED provider=openrouter … status=402 … "You requested up to 16384 tokens, but can only afford 15259"` | on a credit-limited OpenRouter account, the primary provider can never answer |
| **D2** | The request exceeds Groq's per-minute limit: `Requested 8978 / 9074` against `TPM: Limit 8000` → **413 twice per turn** before a 200 | `REFUSED provider=groq model=openai/gpt-oss-120b status=413 … rate_limit_exceeded` ×2 | two wasted round trips and wasted prompt tokens on every reply |
| **D3** | `voice-continuity.test.ts` asserts the pre-`26598e3` synchronous contract | §7.3 | permanent red in the suite; masks future real voice regressions |
| **D4** | `manifest.webmanifest` returns **403** | console + network log | PWA install/metadata unavailable |
| **D5** | Mobile: 12 portal buttons outside the viewport, 22 targets <32 px | 390×844 measurement | portal ring needs scrolling/zoom on phones |
| **D6** | `/api/engineer/*` and AIS bridge answer 503 | startup banner, network log | engineering API unavailable (expected without `LELU_ENGINEER_TOKEN`) |

D1 and D2 are the same root cause — **no token-budget preflight against the provider's real
limit** — and they are the largest measurable cost in the product today.

## 12. Unverified capabilities

- FPS / GPU frame cost (software rendering only in this VM).
- Microphone capture, STT round trip and barge-in in the browser.
- VoxCPM2 sidecar start, model load, generation and recovery.
- Voice free-tier accounting under refusal (unit tests pass; no live refusal seen).
- Memory **writes** / new-memory formation; server-side Supabase configuration.
- Tool invocation and structured/rich response rendering.
- Persistence across devices or accounts (guest mode only).
- Any claim about autonomous cognition.

## 13. Recommended next missions

1. **6.1.4 — Request budgeting.** Cut the 21,756-token tool payload and add a per-provider
   token preflight (Groq TPM 8000, OpenRouter credit ceiling). Success is measurable:
   zero 402/413 per turn, and a lower prompt-token bill.
2. **6.1.5 — Voice integrity.** Bring up the VoxCPM2 sidecar where a GPU exists, and align
   `voice-continuity.test.ts` with the intentional async speaker probe (§7.3).
3. **6.1.6 — Memory write path.** Configure server-side Supabase and prove that a new fact
   survives a reload *and* a device change.
4. **6.2 — Render economics on real hardware.** Establish FPS/frame cost on a GPU machine
   so the render budget claims are grounded.
5. **6.2.1 — Mobile portal layout.** Fit the spatial ring inside 390 px or make it pannable
   with visible affordance.

---

## Final answer: if the user opened LÉLU right now

**Works reliably.** Loading the app (1.65 MB critical, FCP ≈2.0–2.4 s on this VM), the
cosmos shell, opening the chat as a guest, asking a question and receiving a streamed
answer, holding a multi-turn conversation with correct recall, reloading the page and
finding the conversation still there, and hearing her voice speak the reply through
ElevenLabs.

**Works inconsistently.** Provider selection: OpenRouter is refused with **402** because the
request carries 21k tokens of tool definitions, and Groq refuses twice with **413** against
its 8000 TPM limit before answering — so every reply depends on a retry chain and pays for
it. Voice only works while ElevenLabs is reachable; the VoxCPM2 sidecar is not running here.
The mobile portal ring extends beyond the phone viewport.

**Does not work.** Server-side persistence and the engineering/AIS APIs (unconfigured,
fail-closed 503); PWA manifest (403); the voice-continuity test (outdated, permanently red).

**Cannot be judged from this environment.** Real frame rate, microphone input, the VoxCPM2
sidecar, memory formation, and tool execution.
