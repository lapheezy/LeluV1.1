# MISSION 3.2 — Live Model Tool-Calling, Environment Creation, Cosmos Verification & Persistence

Date: 2026-11-08 · Branch: `claude/mission-3-2-live-model-tool-execution`

---

## 1. Executive verdict

**MISSION PARTIALLY COMPLETE.** The central link of the chain is now real and measured: a live
model received the application's own tool-carrying request and **chose `environment_compose`**,
and the application executed it through the existing ToolDispatcher (`Tool environment_compose ->
ok`), with the chat reporting "1 tool used". Nothing below is a mock, a scripted tool call, or a
deterministic fallback.

What is not proven: the created environment was not captured with an environment ID, not
interacted with by real pointer input after creation, and the inspect/modify + reload-continuation
gates (E, F) were not reached. Gate A is **BLOCKED** by a measured infrastructure fact (the GitHub
Models upstream reachable from this host answers a 4-byte stub), and the regression check is **FAIL**
for reasons diagnosed below.

| Gate | Result |
|---|---|
| A — GitHub Models broker auth in the real chain | **BLOCKED** |
| B — real provider accepts complete tool-carrying request | **PASS** |
| C — genuine model-selected tool call executed | **PASS** |
| D — created environment visible & interactive in Cosmos | **PARTIAL** |
| E — LÉLU inspects and modifies it | **NOT TESTED** |
| F — persistence and continuation | **NOT TESTED** |
| G — failure recovery without false success | **PARTIAL** |
| Regression | **FAIL** (harness-caused; diagnosed) |

---

## 2. Branch and commit information

| Item | Value |
|---|---|
| Starting branch | `claude/mission-3-1-live-chat-recovery` |
| Starting commit (verified) | `476a031` — Mission 3.1 HEAD |
| New mission branch | `claude/mission-3-2-live-model-tool-execution` |
| Base commit | `476a031` |
| Tool-schema lineage merge | `59f9137` (tip of `claude/mission-5-6-live-autonomy-completion`) |
| Mission HEAD | `ab8f711` (merge commit) |

`ab8f711` is `476a031` + `59f9137`, resolved without duplicating any registry, tool definition,
dispatcher or environment engine.

---

## 3. Starting-state verification

- `wt-live` at `476a031`, working tree clean, Mission 3.1 GitHub Models broker-auth correction present
  (`if (!isBrokered("githubModels") && !this.apiKey)`).
- Shared worktree left at `68fd4f9 [claude/m52-acceptance-completion]` with its 4 pre-existing dirty
  paths untouched; Mission 3.1 evidence byte-for-byte intact (20 JSON + report + scripts + shots).
- Canonical branch not modified: local `claude/master-integration` `ae5a9cb`, `origin/…` `91f5361`,
  remote canonical `ce768e08` — three different refs, none changed by this mission.
- Anthropic never enabled: `/api/model/status` reported `anthropic:false` in every run.

**Ancestry (measured, not assumed).** `ce768e08` is an ancestor of all six named branches.
`68fd4f9` and `7345ad6` are ancestors of `476a031`; `7c4a373` is an ancestor of both `5619efd` and
`59f9137`. **`476a031` and `59f9137` diverge at `61b27c8`** (8 vs 20 commits apart). Mission 5.5's
`toolSchemasForRequest` / `reducedToolSchemas` and Mission 5.6's two-step degrade exist **only** on
the `59f9137` side, which is why they were merged rather than reimplemented.

**Merge conflict resolution.** Four add/add conflicts, all
`docs/acceptance/spatial-phase-2-15-6/lifecycle-*.json`. This branch's bytes were kept at the
original paths and the incoming bytes preserved as `*-from-5.6.json`; no evidence was discarded.

---

## 4. Provider authentication evidence — Gate A: **BLOCKED**

`/api/model/status` → `{"groq":true,"openrouter":true,"githubModels":true,"anthropic":false,…}`, and
`plugins/modelApi.ts` does attach the server credential and forward to
`endpoint("githubModels")` = `https://models.github.ai/inference`.

The measured result is not a completion:

| Probe | Result |
|---|---|
| `POST /api/model/githubModels/chat/completions` (with 1 tool schema) | `200`, body = `OK\r\n`, **4 bytes** |
| `POST https://models.github.ai/inference/chat/completions`, **no** Authorization, from this host | `200`, body = `OK\r\n`, **4 bytes** |
| `POST https://api.openai.com/v1/chat/completions` (no auth) | `401` + JSON error |
| `POST https://api.anthropic.com/v1/messages` (no auth) | `401` + JSON error |
| `POST https://api.groq.com/openai/v1/chat/completions` (no auth) | `401` + JSON error |

A real Models API rejects an unauthenticated request; this host answers a 4-byte stub, and it does so
with or without a credential. So the broker authenticates and forwards, but **no real upstream
completion is reachable for `githubModels` from this environment**. `GitHubModelsProvider` correctly
surfaced this as `[GitHubModelsProvider] Empty model response {model: openai/gpt-4o, response: null}`.

**Correction to Mission 3.1's record.** Mission 3.1 read `200 OK` from this same path as broker
success. Measured here, that `OK` is the stub above, not an upstream acceptance — status `true` only
means "a credential string exists and has not been rejected".

---

## 5. Actual outbound request measurements — Gate B: **PASS**

Captured from the page's own `fetch` after all filtering, adapter transforms and broker handling
(`scripts/instrumented-turn.mjs`).

| # | Path | Model | Tools | Tool names | Bytes | Stream |
|---|---|---|---|---|---|---|
| 1 | `/api/model/openrouter/chat/completions` | `openrouter/free` | 6 | all `environment_*` | 16 916 | yes |
| 2 | `/api/model/groq/chat/completions` | `openai/gpt-oss-20b` | 6 | all `environment_*` | 16 919 | yes |
| 3 | `/api/model/groq/chat/completions` | `openai/gpt-oss-20b` | 6 | all `environment_*` | 17 776 | yes |
| 4 | `/api/model/groq/chat/completions` | `openai/gpt-oss-20b` | **3** (reduced) | `environment_compose`, `environment_present_artifact`, `environment_mutate_surface` | 15 462 | yes |
| 5 | `/api/model/groq/chat/completions` | `openai/gpt-oss-20b` | **0** (none) | — | 12 865 | yes |

Tool names: `environment_compose`, `environment_present_artifact`, `environment_mutate_surface`,
`environment_manage_workspace`, `environment_save_state`, `environment_restore_state`.
These are the existing environment family (~3 838 B / ~960 estimated tokens); token counts are
**estimates**, byte counts are measured.

**Acceptance:** request #2 was answered `200` and its SSE body contained
`"name":"environment_compose"` — the provider accepted a complete, application-built,
tool-carrying request. Gate B: **PASS**.

Tier ladder: **FULL** (6) → **REDUCED** (3, environment family only) → **NONE** (0). Observed live,
matching Mission 5.6's intended two-step degrade.

---

## 6. Tool schema tier and tool count

47 tools are registered in total. On an environment-directed turn `toolSchemasForRequest` scopes to
the 6 `environment_*` tools (17 KB instead of the 30 442 B / 47-tool set). The reduced tier keeps 3;
the no-tool tier keeps none. **One** schema list is used throughout — no parallel inventory.

---

## 7. Genuine model-selected tool-call evidence — Gate C: **PASS**

Provider stream (captured): `"tool_calls"` present with `"name":"environment_compose"`.
Application chain (`gate-c2.json`, console):

```
[ProviderResolver] Trying Groq
[ProviderResolver] Tool environment_compose -> ok
  Metadata: { tool: environment_compose, ok: true, round: 1 }
[ProviderResolver] Groq refused the request as too large; retrying with a reduced tool set.
[ProviderResolver] Groq refused the reduced set too; retrying without tools.
[ProviderResolver] Groq failed after running tools; not repeating them on another provider.
  Metadata: { provider: Groq, ran: Array(1), … }
```

Chat surface (screenshot `shots/gate-c2.png`): "Working with tools · **1 tool used** · Done".

The model chose the tool and its arguments; the app validated, authorized and dispatched it; the
result came back as a tool result. **This is model-directed execution, not a manual invocation.**

---

## 8. Tool dispatcher execution evidence

`Tool environment_compose -> ok` is emitted by `ProviderResolver` around the existing
`ToolDispatcher` call — no new dispatcher, no bypassed authorization. `ok: true`, `round: 1`.

---

## 9. Environment creation evidence

`environment_compose` returned success and the UI opened a window whose title is the model's own
environment title: **"CREATE A NEW INTERACTIVE STUDIO ENVI…"** (desktop, 1338×818 at 88,64).
Environment **ID was not captured**: `KvStore` does not persist environments to `localStorage`
(enumeration returned none), so the ID/revision record is a documented gap, not a claim.

---

## 10. Cosmos rendering and interaction evidence — Gate D: **PARTIAL**

- Window rendered through the existing Cosmos window system with pin / expand / close chrome.
- Desktop 1440×900: window 1338×818 (`shots/gate-c2.png`, `shots/d1-desktop-1440x900.png`).
- Mobile 390×844: window reflowed to the full viewport (`shots/d2-mobile-390x844.png`).
- Not proven: real pointer interaction with the environment contents, and ID↔window identity match.
  A later run (`gate-def.json`) produced no environment window at all because the turn hit TPM
  limits, so this gate stays PARTIAL rather than PASS.

---

## 11. Self-inspection and modification evidence — Gate E: **NOT TESTED**

The second model-directed operation was not reached. No claim is made that LÉLU inspected or
modified the environment.

---

## 12. Persistence and continuation evidence — Gate F: **NOT TESTED**

A reload was performed (`shots/f1-after-reload.png`) and the app returned, but the environment
record could not be enumerated (KvStore is not `localStorage`), so local persistence is unproven.
**Cross-device persistence: not tested and not claimed.**

---

## 13. Failure recovery evidence — Gate G: **PARTIAL**

Genuine, unplanned failure that the system handled correctly:

> "I did the work — I ran `environment_compose` — but Groq failed before it could write the summary:
> Groq failed 429 … on tokens per minute (TPM): Limit 8000, Used 4715, Requested 3367. … Nothing was
> repeated, and everything I ran is listed above."

- The completed tool was **not** re-run on another provider (`ran: Array(1)`), so no duplicate
  environment.
- The failure was surfaced as a failure, not as completion.
- Simulated failure matrix (invalid arguments, dispatcher throw, renderer failure): **not run**.

---

## 14. Desktop/mobile results

| Viewport | App mount | Chat composer | Environment window |
|---|---|---|---|
| 1440×900 | yes | enabled, real pointer + typing | 1338×818 rendered |
| 390×844 | yes | enabled | full-viewport reflow |

Sign-in gate settled and detached before every pointer interaction (Mission 3.1 procedure).

---

## 15. Full regression results — **FAIL**

`bunx tsc -b --force` → exit 0.

`bun test` on `ab8f711`: **1845 tests — 1786 pass, 53 fail, 6 skip, 2 errors** (117 s).

Mission 3.1 baseline was 1830 tests / 1826 pass / 0 fail / 4 skip on `476a031`; Mission 5.6 claims
1838 / 0 / 0 on a different machine and lineage. Totals are not comparable across lineages.

**Diagnosis (measured, not guessed):**

1. **Cross-file fetch-guard leakage — the cause of ~50 of the 53.**
   `tests/cognitive-behavior.test.ts` replaces `globalThis.fetch` with a throwing stub at import
   time and never restores it. Alone, `tests/api-ecosystem.test.ts` is **18 pass / 0 fail**; run in
   the same process as the guard file it fails (`[test] outbound network call blocked:
   http://127.0.0.1:PORT/api/sources/discover`). The guard is byte-identical in `476a031`,
   `59f9137` and `ab8f711`, so the merge did not introduce it — merging changed which files share a
   process and exposed it.
2. **Case-sensitive path — `tests/chat-transcript.test.ts`** fails alone with
   `ENOENT … /chat/chatTranscript.tsx`; the file on disk is `ChatTranscript.tsx`.
3. No test was skipped, weakened or deleted.

Because the suite is not green on the mission branch, the regression check is **FAIL** and the branch
is **not merge-ready** until the harness leak and the case-sensitivity bug are fixed.

---

## 16. Screenshots and sanitized logs

`docs/acceptance/mission-3-2-live-model-tool-execution/`

- `gate-c.json`, `gate-c2.json`, `gate-def.json` — sanitized request/response metadata, DOM, console.
- `shots/gate-c2.png` — chat with "1 tool used" + honest 429 report (1440×900).
- `shots/d1-desktop-1440x900.png`, `shots/d2-mobile-390x844.png`, `shots/f1-after-reload.png`.
- `scripts/instrumented-turn.mjs`, `scripts/gate-def.mjs`.

No keys, authorization headers, secret values or private user data are present.

---

## 17. Known limitations

- Groq `openai/gpt-oss-120b`: TPD 198 597 / 200 000 exhausted. `openai/gpt-oss-20b` used via the
  project's own `__LELU_GROQ_MODEL__` channel (no source edit) because its budget still had room;
  it then hit TPM 8 000 on follow-up rounds.
- OpenRouter: `429 free-models-per-day` — needs credits for a real attempt.
- GitHub Models: upstream stub `OK` (see §4).
- Cerebras, Mistral, Fireworks, Gemini: no credentials. Anthropic: excluded by mission rule and off
  on the server.
- Environment ID/revision not captured; `KvStore` storage backend not enumerated.
- Browser runs are slow under load; two runs were cut off by the 5-minute command ceiling.

---

## 18. Remaining blockers

1. **Provider capacity** — the only path with any budget is Groq's small model, and a single
   environment turn plus its summary round exceeds TPM 8 000. Gates E/F need two clean model turns
   in one session.
2. **GitHub Models upstream** — blocked by the stub, independent of this repository.
3. **Test harness leak** — must be fixed before the regression gate can pass.
4. **Environment ID capture** — must read KvStore's real backing store to prove same-ID continuity.

---

## 19. Merge-readiness verdict

**NOT SAFE TO MERGE.** Not because of destructiveness — nothing pre-existing was discarded and the
canonical branch is untouched — but because (a) the full suite fails on this branch (harness leak +
case bug), and (b) Gates E and F, the "understand and continue what she created" half of the
mission, are unproven. Gates B and C are genuine and reproducible; that is the real progress here.
