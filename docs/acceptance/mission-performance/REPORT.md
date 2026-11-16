# LÉLU — Integration, Verification & Performance Report

Branch: `claude/lelu-integration-performance-eai80a` (built on `integration/lelu-four-workforce-consolidation` @ `098dd3e`).
Measured on the production build served by the real runtime (`bun run server.ts`), 4 vCPU / 15 GiB container, headless Chromium (software GL — no GPU).
Harness and raw medians: `harness/`, `evidence/`. Medians of 3 cold loads unless stated.

## 1. Contribution recovery

The clone was shallow; after `git fetch --unshallow` every remote branch was compared with the integration tip.

| Branch | Unique commits | Action |
|---|---|---|
| `mission/6.1.6-multi-step-orchestration` | 19 | **Merged** (boot-graph decoupling, readiness, tool surface, multi-step deadlines) |
| `claude/lelu-worker-recovery-4fio20` (incl. `b00cfef`, MOSS-TTS-Nano) | 18 | **Merged**; one conflict in `GenesisScene.tsx` resolved by keeping 6.1.6's lazy bridges and adding `LivekitVoiceDock` lazily |
| `mission/chat-universe-reinforcement-1` | 3 | **Merged** |
| `jules-*`, `codelazr/*`, `claude/open-session-rbwmdw-4210…` | 1–7 each | Not merged: reconciled in `MISSION-10.1-RECONCILIATION-REPORT.md` (duplicate `interface.*`/`environment.*` definitions; canonical is a superset). Verified the claim against the files. |
| `claude/mission-2-15-*`, `claude/mission-5-2-*` | 4–13 | Not merged: code already in canonical in a newer form (`GenesisModuleHost`, `SpatialNavigator`, `PortalRegistry` diffs show canonical ahead); remaining content is evidence JSON/PNG, preserved on its branches |
| `freebuff/44c122e8…` | 3 | Not merged: an earlier VoxCPM route (`plugins/voxcpmApi.ts`) superseded by the worker-recovery sidecar/pool now merged |
| All others | 0 | Already contained |

No history rewritten; nothing deleted; `main` untouched.

Voice environments were rebuilt as the voice session asked (`services/voxcpm/install.sh`, `services/mossnano/install.sh`, VoxCPM2 `bootstrap.py`: 4.96 GB, 9 files verified; MOSS weights downloaded anonymously).

## 2. Before → after

### Boot (desktop, 1440×900, 20 ms RTT)

| Metric | Before | After | Change |
|---|---|---|---|
| First contentful paint | 804 ms | **292 ms** | −64% |
| 3D canvas mounted | 1,037 ms | **514 ms** | −50% |
| Bootstrap done (`lelu:BOOTSTRAP_DONE`) | 5,211 ms | **1,997 ms** | −62% |
| Long tasks, total | 2,365 ms | **489 ms** | −79% |
| Total blocking time | 2,015 ms | **261 ms** | −87% |
| JS files fetched in first ~7 s | 409 | 259 | −37% |
| Boot graph | 154 chunks, depth 8 | **3 chunks, depth 1** | |
| Boot JS (gzip) | 509 KB | 464 KB | −9% |

### Boot (phone profile: 390×844, 4× CPU, 120 ms RTT, 9 Mbps)

| Metric | Before | After | Change |
|---|---|---|---|
| First contentful paint | 4,164 ms | **1,256 ms** | −70% |
| 3D canvas mounted | 4,501 ms | **1,505 ms** | −67% |
| Bootstrap done | not reached in window | **6,789 ms** | |
| TBT in window | 502 ms | 597 ms | more work now completes inside the window (bootstrap finishes) |

### First-visit 3D asset transfer

| | Before | After |
|---|---|---|
| Rig `lelu.glb` | 49.5 MB | **32.6 MB** (gzip, byte-identical after decode) |
| All boot GLB (rig + 31 clips) | 54.3 MB | **35.6 MB** (−34%) |

### Real chat turn (guest, real provider, "In one sentence, what is the capital of Australia?")

| Metric | Before | After |
|---|---|---|
| Submit → model request sent | 10.5 s | ~3 s |
| Research stage (routing trace) | 5,233 ms | 628–1,399 ms |
| Wikipedia/Wikidata lookups | 9 (3 identical rounds) | 3 (one concurrent round) |
| Submit → first answer text | 12.0 s | **4.3–6.4 s** |
| Answer | "The capital of Australia is Canberra." | same |

### Provider spend while idle (no user input)

| Scenario | Before | After |
|---|---|---|
| One visible tab, per hour | ~73 billed calls + ~73 doomed Fireworks 412s | ~73 billed, 1 Fireworks attempt per 15 min |
| Two visible tabs, 150 s | ~12 requests | **4** |
| One hidden tab, 120 s | ~5 | **0** |

### Voice (4 vCPU, CPU only)

| Engine | Load | RSS | First audio | RTF |
|---|---|---|---|---|
| MOSS-TTS-Nano | 39 s | 1.7 GiB | 250–296 ms (worker) | 0.79–1.30 |
| VoxCPM2 | 252 s | 6.5 GiB (10.9 GiB peak, prior measurement) | n/a | **5.42** |
| App route, WAV (`/api/voice/vox/speech`) | | | 3.7–7.5 s (whole synthesis) | |
| App route, streamed PCM | | | **0.28–0.46 s** | |

## 3. Changes (each measured, tested, kept)

1. `SelfStudyEngine`: one cognizing tab per browser (Web Lock), 5-minute cadence while hidden, immediate resume on visible.
2. `AIProviderRegistry`: account suspended for billing (412 / spending limit) and Anthropic's "credit balance is too low" are `billing`, which now cools for 15 min instead of 30 s.
3. `plugins/compressedAsset.ts` + forge route: once-made gzip copies of immutable model assets, warmed at server start; `Vary`, range-safe; avatar fetched at `priority: "low"`.
4. `vite.config.ts`: rolldown `$initial`-tag groups put the boot graph in `boot-vendor` + entry.
5. `PlanetTextures` → pixel buffers (pixel-identical, 1,781 → 548 ms), generated once per session in `planetTextures.worker.ts`, filled into the same `CanvasTexture` (no material recompile).
6. `ResearchResolver`: "news" appended only when a news source is selected; providers of a round run concurrently with every per-provider guard kept.
7. `ToolRegistry`: the three availability probes run concurrently; `AIService` starts the refresh alongside memory recall.
8. `gpuWorkers`: duplicate worker ids made unique — fixed `/vox/speech` answering 503 while `/vox/health` reported a READY worker.
9. `VoiceEngine`: a reply waiting on the voice probe counts as speaking (barge-in/echo window); fixed the pre-existing failing continuity test.
10. `CapabilityPipeline`: lint false positive (`useToolsFor` → `toolsForCapability`).

## 4. Acceptance

| Check | Result |
|---|---|
| `tsc -b --force` | **PASS** (exit 0) |
| `oxlint` | **PASS** (0 errors; was 1 at baseline) |
| `npm test` | **PASS**: 2,089 pass, 0 fail, 6 skipped (baseline 2,080 / 1 fail) |
| `vite build` | **PASS** |
| `verify-no-tests-in-bundle`, `verify-asset-caching` (33/33) | **PASS** |
| `verify-bundle-secrets` | **FAIL, pre-existing**: Excalidraw's own `VITE_APP_PLUS_EXPORT_PUBLIC_KEY` constant in the lazy DrawingEditor chunk; identical on the baseline build; not a LÉLU secret |
| Same DOM, canvases, console errors before/after boot changes | **PASS** |

## 5. Capability status

| Capability | Status | Evidence / reason |
|---|---|---|
| Guest access, chat, streaming reply | **PASS** | real turns above |
| OpenRouter provider | **PASS** | 200, live |
| Groq / Cerebras | UNTESTED | configured; not selected in measured turns |
| Fireworks | **BLOCKED** | account suspended for billing (412) |
| Anthropic primary | **BLOCKED** | policy-gated (`LELU_ENABLE_ANTHROPIC`, deliberate since `5888297`); with the flag set the broker reaches Anthropic and it answers **"credit balance is too low"** |
| Research / knowledge retrieval | **PASS** | Wikipedia/Wikidata/Wikimedia live |
| Memory recall (Supabase archive) | **PASS** | live query on each turn (1.5–2.1 s, still on the critical path) |
| Continuous cognition (self-study) | **PASS** | live calls; leader + hidden policy verified |
| Cosmos/planet rendering | PASS (pixels) / UNTESTED (GPU fps) | no GPU here; software GL guard deliberately disables painting |
| ElevenLabs TTS | **BLOCKED** | character allowance exhausted |
| MOSS-TTS-Nano via app | **PASS** | WAV and streamed PCM through `/api/voice/vox/speech` |
| VoxCPM2 on CPU | PASS (speaks) / not viable real-time | RTF 5.42 |
| LiveKit token / voice round trip | **BLOCKED** | no `LIVEKIT_*` config here; route fails closed (503) |
| Authenticated (signed-in) chat | UNTESTED | no test account credentials |
| Mobile on a real device, GPU frame rate | UNTESTED | emulated profile only |

## 6. Remaining bottlenecks (by impact)

1. **Archive memory search** (`legacy_memories` `ilike` over `value`/`key`): 1.5–2.1 s on every turn, before routing. Needs a trigram/FTS index or a bounded timeout; an index is a database change not applied here.
2. **Avatar first visit still 35.6 MB.** Meshopt/KTX2 recompression of the rig would cut it much further but changes the approved Forge asset, so it was not done unilaterally.
3. **Voice agent playback mode.** `LELU_AGENT_PLAYBACK=sentence` (default) waits for a whole sentence; with MOSS on CPU, `stream` + `LELU_AGENT_PREBUFFER_MS≈900` should start speech at ~1.2 s instead of 3.7–7.5 s. Config change; untested here without a LiveKit server.
4. **Model latency itself** (provider stage 1.2–2.2 s on gpt-4o-mini via OpenRouter).

## 7. Contabo sizing (CPU only)

| Component | RAM | CPU |
|---|---|---|
| App runtime (bun `server.ts`) | ~55 MB RSS idle | low; asset gzip is one-time (1.9 s per 50 MB file) |
| MOSS-TTS-Nano worker | 1.7 GiB | ~RTF 0.8–1.3 on 4 vCPU, near-saturating during speech |
| VoxCPM2 worker | 6.5 GiB resident, 10.9 GiB peak at load | RTF ~5.4: **not recommended without a GPU** |
| Caddy, LiveKit server + agent | < 0.5 GiB | low |

Recommendation: 4 vCPU / 8 GiB runs app + MOSS + LiveKit comfortably; VoxCPM2 should run on a GPU worker (`VOXCPM_WORKERS`) rather than on Contabo.

## 8. Operator actions required (not done: account/billing/config decisions)

- Fund Anthropic and set `LELU_ENABLE_ANTHROPIC=true`, `VITE_DEFAULT_PROVIDER=anthropic` (rebuild) to make Anthropic primary.
- Fireworks account suspended; ElevenLabs allowance spent.
- Set `VOXCPM_BASE_URL=http://127.0.0.1:8789` (MOSS) and the `LIVEKIT_*` variables for voice; consider `LELU_AGENT_PLAYBACK=stream`.
- Nothing was deployed to Contabo.
