# Mission 5.8 — voice resource intelligence & autonomy

Starting commit: **`d586fdb`** (branch `freebuff/b088dc5ba2641bf17f787206`, clean tree).
Evidence: `docs/voice/evidence/2026-11-10-voice-resource-intelligence/`.

The goal was not "make her speak again" — she already did after `d586fdb`. It was to make her
**know**, **monitor** and **manage** the infrastructure that lets her speak.

---

## 1. Forensic baseline

| Check | Result |
|---|---|
| Branch / HEAD | `freebuff/b088dc5ba2641bf17f787206` · `d586fdb` · working tree clean |
| Existing rotation | `plugins/voiceApi.ts` spent `ELEVENLABS_API_KEY*` in order, with an in-route cooldown `Map` and no accounting at all |
| Env loading | `plugins/loadEnvFiles.ts` + `vite.config.ts` call `fillBareSecretAliases`; numbered platform secrets (`Groq1..3`, `Openrouter1..3`, `Elevenlabs2/3`) are mapped in `plugins/bareSecretAliases.ts` |
| Credentials | 3 valid ElevenLabs keys; measured through the provider, names and counts only: `Elevenlabs` **10,000/10,000**, `Elevenlabs2` **152/10,000**, `Elevenlabs3` **0/10,000** |
| Existing usage systems | `UsageLedger` / `UsageBudgetGate` (client-side per-call metering, Supabase-synced) and `ProviderHealth` (chat providers, from `AIProviderRegistry`). Both exist and are untouched — neither knows about voice allowance |
| Existing UI | `GenesisSettingsPanel` already hosts `VoiceSection` (system voices) and `UsageSection` (ledger totals) |

So: rotation existed, accounting did not, and nothing connected the two to the interface.

## 2. What was added (nothing replaced)

### `src/core/voice/VoiceResourceManager.ts` — the shared layer

Owns, per account and per modality: allowance spent, remaining estimate, cooldowns, failures,
reported-vs-estimated accounting and a bounded usage history. It is dependency-free and — critically —
**never receives a key**. Callers hand it opaque positional ids (`account-1`, `account-2`) and resolve
keys themselves, so its snapshot cannot leak a secret.

Rules it enforces:

- **Estimate before spend.** `plan("tts", { text })` costs the sentence in code points first and can
  refuse a credential that cannot pay for it (`insufficient_allowance`) instead of sending a doomed call.
- **Reported beats estimated.** A call's `character-cost` header is authoritative; a call without one is
  charged as an estimate and separately marked as unreported. Drift is only computed over comparable pairs.
- **Upstream may lag.** `applyUpstreamUsage()` takes the larger of internal and provider counters, never
  lowers the internal lower bound, and reports `lagging: true` when the provider is behind.
- **Refusals cool one account, one modality.** 401/403/429 cool; 0/400/413/422/5xx do not (another account
  cannot fix a malformed request).
- **Exhaustion is detected, then respected.** An account whose allowance is gone is skipped; after the
  probe window it is offered **once** to see whether it recovered. It is not retried per request.
- **TTS and STT are independent.** Characters are a synthesis quantity, so a spent mouth does not close
  her ears; only an account-wide refusal or an STT-specific cooldown blocks transcription.

### `src/core/voice/voiceIdentity.ts` — identity vs infrastructure

Her voice id (`cgSgspJ2msm6clMCkdW9`), model (`eleven_v3`) and speaking style now live in one file that
imports nothing and reads no credential. Rotation chooses who pays; it cannot change who speaks. The only
overrides remain `ELEVENLABS_VOICE_ID` / `ELEVENLABS_MODEL_ID`.

### `plugins/voiceApi.ts` — routes wired to the manager

| Route | Purpose |
|---|---|
| `GET /api/voice/status` | unchanged shape (`configured, stt, voiceId, modelId, sttModelId`) — the client contract |
| `POST /api/voice/tts` | same contract, now planning through the manager; adds `X-Lelu-Voice` (opaque account id) and `X-Lelu-Remaining` |
| `POST /api/voice/stt` | same contract plus `account`; tracked apart from TTS |
| `GET /api/voice/resources` | **new** — sanitized snapshot: availability, per-account allowance/utilisation/cooldown/failures, active account, last success/failure, history, identity |
| `POST /api/voice/resources/reconcile` | **new** — folds ElevenLabs' own `character_count/limit` in (the only quota network call) |
| `POST /api/voice/resources/replenish` | **new** — operator states an account has allowance again; counters restart, history is kept |

A request that no account can afford now answers **503 with `reason` and `Retry-After`** and sends nothing
upstream. A first attempt that the provider refuses still answers **502** — that is what happened.

### `src/app/scene/genesis/VoiceResourceSection.tsx` — the dashboard, inside Settings

Mounted beside the existing `VoiceSection` in `GenesisSettingsPanel` (not a disconnected screen). Shows
TTS/STT availability, fixed voice identity, remaining estimate, utilisation bars per account, rotation
(active account), last success/failure with reason, low-allowance alerts, recent usage, and **playback
status from the client's real synthesis attempt** (only the page knows whether audio reached speakers).
Polls every 15 s; `Refresh`, `Check provider counters` and `Replenished` buttons; a failed poll reports
the failure instead of rendering zeros.

## 3. Verification (all commands run in this VM)

| Check | Result |
|---|---|
| `bunx tsc -b --force` | **exit 0** |
| `bunx oxlint` on the five changed/new files | **0 warnings, 0 errors** |
| Full suite (`tsx --test`, all but `autonomy-end-to-end`) | **1966 tests, 1960 pass, 0 fail** |
| `tests/voice-resources.test.ts` (new, 14 tests) | usage accounting · cooldown (per modality + expiry) · §retry-worthiness · exhaustion + single probe · insufficient allowance · provider-refusal precedence · lag reconciliation · replenishment/history · identity independence · route 503-before-upstream · TTS/STT independence · sanitization · replenish/reconcile |
| Existing voice tests | unchanged and green (`voice-elevenlabs`, `voice-adapters`, `voice-continuity`, `voice-core-integration`, `voice-streaming-tts-state`) |

### Live evidence (real calls, real accounts)

- `GET /api/voice/resources` before any call: 3 accounts ready, 30,000 remaining **estimated** — honest
  about knowing nothing yet.
- `POST /api/voice/tts` → **200 `audio/mpeg`, 81,545 bytes, 68 characters reported**, `X-Lelu-Voice: account-2`,
  `X-Lelu-Remaining: 9932`. `account-1` (the truly spent key) was refused once, cooled, and is now reported
  **exhausted** instead of being retried on every sentence.
- `POST /api/voice/stt` on that same audio → **200**, transcript `"Mission 5.8: I can account for every
  character I spend"`, `usage.characterCost 6`, `fiatCostUsd 0.0006`, account `account-2`. A genuine round
  trip through the new accounting path.
- `POST /api/voice/resources/reconcile` → upstream `account-1 10000/10000`, `account-2 152/10000`
  (internal had 68 for this process), `account-3 0/10000`; upstream was **ahead**, so `usedCharacters`
  took 152 and nothing was lowered.
- After: `activeCredential {tts: account-2, stt: account-2}`, `lastFailure {tts, account-1, 401}`,
  low-allowance alert for `account-1`, drift **0** against the reported call.
- Sanitization: 0 matches for `xi-api`, `ELEVENLABS_API_KEY` or `Elevenlabs[0-9]` in either resources payload.

## 4. What is NOT verified

- **Audible playback in the interface.** This VM has no `/opt/pw-browsers/chromium` and no audio device, so
  the panel was rendered only in compilation and the audio was verified as real MPEG bytes, not heard.
  Do not read this report as "playback works in the app".
- **The dashboard's visual layout** — not viewed.
- **Persistence across restarts.** Counters are per-process. A restart starts the ledger at zero, and the
  provider's own counters (via `reconcile`) are the durable truth. No file/database store was added:
  inventing server-side state would have changed deployment semantics for a number that can be reconciled.
- **Per-account monthly limits other than 10,000.** The default allowance per account is configurable
  (`monthlyCharacterLimit`) and is replaced by the provider's own `character_limit` after a reconcile;
  no other tier was tested because only the free tier is provisioned.
- **No circumvention.** The manager does not mint, rotate-around or force limits: a refused account is
  treated as refused, and its re-probe is one request per 30-minute window, which is a health check, not
  a workaround.

## 5. Files

- `src/core/voice/VoiceResourceManager.ts` (new)
- `src/core/voice/voiceIdentity.ts` (new)
- `src/app/scene/genesis/VoiceResourceSection.tsx` (new)
- `plugins/voiceApi.ts` (rotation replaced by manager; three new routes)
- `src/app/scene/genesis/GenesisSettingsPanel.tsx` (mounts the section)
- `tests/voice-resources.test.ts` (new)
- this report + `docs/voice/evidence/2026-11-10-voice-resource-intelligence/`
- `docs/voice/LELU_VOX_RECOVERY_LEDGER.md` (§10, §9)
