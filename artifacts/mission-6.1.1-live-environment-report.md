# Mission 6.1.1 — Live environment activation (evidence report)

Branch `mission/6.1.1-live-environment-activation`, cut from `d5d7066`.
Checkpoint `artifacts/checkpoints/BASE-6.1.1.txt`. Canonical branch untouched.

## 1. Backend root cause — the backend was never missing

LÉLU's real backend is **`server.ts`** (Node/Bun HTTP server), started with
`npm run serve` / `bun run server.ts`, serving `dist/` plus the API surface
(`/api/model/*` broker, `/api/env-check`, `/api/provider-health`, `/api/forge`,
`/api/engineer/*`, `/api/ais/*`, `/api/github/*`, `/api/integration/*`, …).

Earlier missions measured a **`vite preview`** process instead. That process mounts
only the subset of routes Vite's `configurePreviewServer` hooks attach
(model/env/forge), and by Mission 6.1 it had died. So the "missing `/api` backend" was
a **wrong-process** problem, not a missing implementation: nothing needed rebuilding.

Smallest safe repair: start the server that already exists. No new routes, no new
service, no dependency.

```
PORT=4173 ./node_modules/.bin/tsx server.ts     # (bun run serve also works)
```

Server startup log (first run, abridged — values as printed, no secrets):
`serving dist on 0.0.0.0:4173 — engineering API DISABLED — access gate OFF — version d5d7066`

## 2. API availability — measured

| endpoint | result |
|---|---|
| `GET /healthz` | **200 `application/json`** — `{ok:true, version, uptimeSeconds, rssMb, heapMb, dist:true, accessGate:false}` |
| `GET /api/health` | **was 200 `text/html`** (SPA fallback — a false "healthy"); now the same JSON |
| `GET /api/env-check` | 200 — `VITE_GROQ_API_KEY: SET`, `VITE_OPENROUTER_API_KEY: SET`, `ANTHROPIC`: absent, `SUPABASE`: absent |
| `GET /api/provider-health` | 200 — **groq `{status:200, ok:true}`, openrouter `{status:200, ok:true}`**, anthropic `missing-key` |
| `GET /api/model/status` | 200 — `groq:true, openrouter:true, githubModels:true`; anthropic/cerebras/mistral/fireworks/gemini false |

### Defect fixed (product code)

`/api/health` returned `200 text/html`: the documented API health path was not mounted,
so a probe reading only the status code saw "healthy" while being served index.html.
`server.ts` now answers `/api/health` with the existing `/healthz` handler — an alias,
not a second health mechanism — and still reports **liveness only** (dist present,
uptime, RSS/heap, version, access gate). It deliberately does **not** claim intelligence
operational. Verified after restart: both paths return `application/json`.

## 3. Real model execution — VERIFIED

Through the real broker, with the real server-side credential, no mocks:

```
GET  /api/model/groq/models   → 12 models (openai/gpt-oss-20b, openai/gpt-oss-120b,
                                 qwen/qwen3.8-27b, whisper-large-v3, …)
POST /api/model/groq/chat/completions
     {"model":"openai/gpt-oss-safeguard-20b", "messages":[{"role":"user","content":"Reply with exactly: LIVE"}], "max_tokens":8}
  → 200 in 209 ms
  → {"id":"chatcmpl-0074c099-…","model":"openai/gpt-oss-safeguard-20b",
     "choices":[{"message":{"role":"assistant",…}}],
     "usage":{"prompt_tokens":76,"completion_tokens":8,"total_tokens":84}}
```

Streaming (SSE) verified end to end:

```
POST /api/model/groq/chat/completions  (stream:true)
  → data: {"id":"chatcmpl-229c4666-…","object":"chat.completion.chunk",
           "choices":[{"delta":{"role":"assistant","content":""}}], …}
```

Provider connectivity: **groq = VERIFIED, openrouter = VERIFIED (HTTP 200 OK)**.
Anthropic is absent by design (the mission forbids introducing it).

### Configuration risk found

`POST /api/model/groq/chat/completions` with `llama-3.1-8b-instant` returns
`404 model_not_found` ("does not exist or you do not have access"). This account offers
`openai/gpt-oss-*`, `qwen/qwen3.8-27b`, `allam-2-7b` and audio models. Any code path that
hard-codes a retired Llama id will fail at the provider, so model ids must come from the
broker's `/models` list or configuration — recorded as a configuration action, not a
defect I patched (routing and model policy are out of scope for this mission).

## 4. What this unblocks, and what it does not

**Unblocked now that the correct process runs:** the app is served from the same origin as
its API, providers answer, and real inference is possible. Everything external that was
"UNVERIFIED — no backend" in Mission 6.1 can now be tested against this server.

**Still blocked:**

| blocker | effect |
|---|---|
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` absent | conversations/memory cannot persist to the cloud DB; readiness keeps reporting `memory DEGRADED` honestly |
| Browser automation (`connectOverCDP` timeout, `preview_evaluate` >10 s on a 2 fps soft-rendered tab) | no interactive end-to-end run (chat turn in the UI) in this session |
| No GPU | no FPS/HW measurement; `fps 2` remains a harness artefact |
| No microphone/audio device | voice stays UNVERIFIED |

## 5. Classification

| capability | status |
|---|---|
| Backend process starts from the repo | **VERIFIED** |
| Liveness JSON on `/healthz` and `/api/health` | **VERIFIED** (fixed) |
| Provider credentials present and reachable (groq, openrouter) | **VERIFIED** |
| Real model inference through the broker | **VERIFIED** (200, real usage) |
| SSE streaming from provider through broker | **VERIFIED** |
| Chat turn in the browser UI | **UNVERIFIED** — automation unavailable |
| Conversation/memory persistence | **UNVERIFIED** — Supabase not configured |
| Tools / agents / workflows against the live server | **UNVERIFIED** — needs a chat turn to drive them |
| Voice | **UNVERIFIED** — no audio device |
| Mobile hardware | **UNVERIFIED** |

## 6. Regression

- `tsc -b --force`: **0**
- Full suite: **1987 tests, 1981 pass, 0 fail, 6 skipped** (baseline preserved)
- Boot graph: **156 chunks / 1.65 MB** (unchanged; the server change is server-side only)

## 7. Performance note

No optimisation was accepted in this mission. The 1.31 MB shared intelligence chunk
(diagnosed in Mission 6.1) remains the largest deferred cost and needs its own measured
provider-lazy pass; it is not touched by this environment work.

## 8. Commit / rollback

One product change (`server.ts` health alias) plus this report. Rollback:
`git checkout mission/6.1-operational-excellence` — the previous branch state, with no
server changes.

## 9. Next, in order

1. Configure Supabase (URL + publishable key) so memory and conversation persistence can
   be verified with a real write → restart → read.
2. Restore browser automation, then run the Phase J sequence (open → chat → real reply →
   follow-up → refresh → restore) against `http://…:4173`.
3. Provider-lazy split of the 1.31 MB shared chunk, measured against 156 / 1.65 MB.
