# M22.6 — RELEASE CANDIDATE VERIFICATION

**Date:** 2026-11-19
**Decision:** **BLOCKED**
The code candidate is sound, but the mission's central gate — a real live voice conversation — could not be run. Canonical promotion is **not** recommended.

---

## 1. Identity

| Item | Value |
|---|---|
| Starting canonical branch | `integration/m16-3-wp05-reconciliation` |
| Canonical SHA at start (unchanged) | `543da7c8d7876258869d928648cffa913cd10649` |
| M22.5 implementation commit | `e481c2c4ca6f8421528b653d9b06646aad6bc9aa` |
| M22.5 final candidate (base) | `8aa24ce156531fa4500580a69b748ad0de473f1e` |
| M22.6 branch | `freebuff/m22-6-voice-runtime-release-qualification` |
| M22.6 implementation commit | `2bcc3c66304780a1055509692e43e2fa8b94ef78` |
| M22.6 evidence commit | the commit that contains this file (child of `2bcc3c66`) |
| Remote branch | `m22.6/voice-runtime-release-qualification` (pushed after this file) |
| Remote verification | recorded in `MISSION-22.6/REMOTE-VERIFICATION.md` |

Ancestry: `543da7c8` → … → `e481c2c4` → `8aa24ce1` (M22.5 candidate) → `2bcc3c66` (M22.6 implementation) → (M22.6 evidence). M22.5 history is preserved; nothing was rewritten or force-pushed.

## 2. Files changed at `2bcc3c66`

| File | Change |
|---|---|
| `src/core/perception/FeatureUnderstanding.ts` | typed `numericMeasurement` helper; removes both TypeScript errors without suppression |
| `src/core/voice/VoiceEngine.ts` | `TranscriptProvenance` on turns; each recogniser labels its source; provenance passed to chat |
| `src/core/AIService.ts` | chat options carry the transcript; consolidation forwards it |
| `src/core/MemoryBridge.ts` | optional transcript provenance merged into the stored context |
| `src/brain/Brain.ts` | exported `findKnowledgeToSupersede`; `persistLayer` supersedes in place with history |
| `src/brain/MemoryEngine.ts` | exported `looksLikeCorrection` for reuse (one rule, two callers) |
| `src/core/tools/ExecutionEvidence.ts` | optional `MissionScope`, set/current helpers, sanitisation, log line |
| `src/core/tools/ToolDispatcher.ts` | attaches the declared scope to each record |
| `tests/asr-provenance.test.ts` | 3 tests |
| `tests/knowledge-supersession.test.ts` | 7 tests |
| `tests/execution-mission-scope.test.ts` | 3 tests |

No new subsystem, registry, ledger, database or dependency. `bun.lock` unchanged.

## 3. Gate results

| Gate | Status | Evidence |
|---|---|---|
| Typecheck | **VERIFIED** | `tsc -b --force` exit 0 |
| Production build | **VERIFIED** | `bun run build` exit 0, 22.22 s |
| Lint | **VERIFIED** | 0 errors, 176 warnings |
| Full regression | **VERIFIED (no regression)** | 2286 · 2276 pass · 2 pre-existing fails · 8 skip |
| Deterministic voice | **VERIFIED (unit)** | 77 · 76 pass · 1 skip · 0 fail |
| Real speech recognition | **PARTIALLY VERIFIED** | 16/16 real WAVs, 265–356 ms, via the app's broker |
| Live voice conversation (5 turns, barge-in, recovery) | **BLOCKED** | no browser, no mic, no TTS engine |
| Audible LÉLU response | **BLOCKED** | Vox worker ECONNREFUSED; ElevenLabs 503; no audio device |
| ASR provenance | **VERIFIED (unit + acceptance)** | 3/3 tests; stored source observed |
| Runtime mission/commit provenance | **PARTIALLY VERIFIED** | field + tests; no in-product caller |
| Knowledge supersession | **VERIFIED** | 7/7 tests + 4 acceptance checks |
| Learning retrieval | **VERIFIED (polyfilled store)** | 18/18 checks |
| Live voice performance | **BLOCKED** | no session; STT latency measured only |

## 4. Why the decision is BLOCKED, not CONDITIONALLY APPROVED

The mission defines five priorities, and makes the live conversation its central gate. Three of the five are complete (build, learning integrity, release evidence). The fourth and fifth (live voice input/output and its acceptance) are impossible here for precisely documented environmental reasons, not for lack of code.

"CONDITIONALLY APPROVED" would imply the only remaining work is procedural. It is not: the browser must be able to start, audio hardware must exist, and an output engine must be configured. Until then nobody can say whether a spoken turn survives barge-in, reconnects, or five turns without corruption.

## 5. Known limitations (complete list)

1. No live voice acceptance; no screenshots, audio, or turn timestamps exist.
2. No audible output; no LÉLU-voice synthesis was produced.
3. No measured end-to-end voice latency.
4. Mission scope is a capability, not an automatic recording; ordinary user sessions carry none.
5. No first-class "test result" execution record.
6. Browser IndexedDB persistence was not exercised (polyfill used, disclosed).
7. `tests/genesis-interface.test.tsx` fails and is undiagnosed (pre-existing).
8. `tests/sandbox-security.test.ts` network test is environmental (pre-existing).
9. Two weak knowledge-supersession edges: lexical (not semantic) matching, and `PatternMemory.search` overlap limits.
10. Supabase persistence unconfigured; no cross-device sync test.

## 6. Requirements to clear the block

- **Browser:** Chromium with `libnspr4`, `libnss3`, `libgbm1`, `libasound2`, `libxkbcommon0`, `libdrm2`, `libatk*` (or `npx playwright install --with-deps chromium` as root).
- **Audio:** microphone + speaker, or Chromium `--use-file-for-fake-audio-capture` for a *simulated-input* run that must be labelled simulated, plus a recordable sink for output.
- **Output engine:** VoxCPM2 worker (model + ≥16 GiB RAM or GPU) — the only path that is LÉLU's voice — or `ELEVENLABS_API_KEY` as a generic voice, clearly labelled.
- **Reply provider:** any configured text provider (present here).
- **LiveKit (only for full-duplex claims):** `livekit-server`, the Python agent env, `LIVEKIT_*`.

## 7. Canonical promotion rules

**Do not promote now.** Canonical remains `543da7c8`.

Once the live gate passes on the exact remote HEAD:

1. Re-run `tsc -b`, `bun run build`, `npm test` at that HEAD; record totals.
2. Record the live session (screen + logs) with the conversation id and cleanup evidence.
3. Verify `git ls-remote` shows the candidate SHA.
4. Fast-forward the canonical branch to that SHA **only** with explicit authorization, or open a PR from `m22.6/voice-runtime-release-qualification` and merge it.
5. Record the promoted SHA in a follow-up evidence file so the canonical version is traceable to the verified candidate.

Never force-push, reset, or rewrite canonical.

## 8. Reproduction

```bash
git checkout freebuff/m22-6-voice-runtime-release-qualification
bun install --frozen-lockfile
npx tsc -b --force
bun run build
npm test
npm run lint
# real STT (no browser):
PORT=4180 bun run server.ts &
curl -s -X POST http://127.0.0.1:4180/api/model/groq/audio/transcriptions \
  -F "file=@docs/voice/listening-pack/05-B.wav;type=audio/wav" \
  -F "model=whisper-large-v3-turbo" -F "response_format=verbose_json"
```
