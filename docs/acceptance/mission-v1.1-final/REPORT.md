# LÉLU V1.1 — Final fixes, voice reference, Contabo deployment: consolidated report

Date 2026-11-14 · Work branch `claude/lelu-integration-performance-eai80a` · Ran in an ephemeral cloud
container (4 vCPU, 15.7 GiB, no GPU). Status words: **Implemented** (code committed) · **Tested locally**
(real run here) · **Deployed** · **Verified in production** · **Blocked**.

## Verdict
**Not deployed.** This session still has no path to the VPS (no SSH client, no key, port 22 refused,
outbound limited to an HTTPS proxy, no Remote Control computer). Nothing in production can be
claimed. Everything that does not need the VPS is done and tested here, and a second, independent
blocker surfaced: **every model account available to LÉLU is spent or refused** (§5).

## 1. Repository
| | |
|---|---|
| Baseline | `5eee649` (contains `main` and the GitHub default branch) |
| Branch / commit | see `GATE` line in §7 (HEAD of `claude/lelu-integration-performance-eai80a`) |
| New commits on other branches | none since 2026-11-13 |
| Review | `5eee649..HEAD` reviewed before deployment; findings fixed in `d4739fe` (§2.4) |

## 2. Outstanding fixes completed (Implemented + Tested locally)
1. **Archived-memory recall off the turn's critical path** (`b6174e9`). Evidence first: `legacy_memories`
   has 69 rows; `EXPLAIN ANALYZE` of the per-turn query = 5.6 ms, so the 1.5–2.1 s was round trip and
   **no index was added**. The frozen snapshot is fetched once per session (prefetched), filtered
   locally with identical semantics, dropped on sign-in change; >500 rows keeps the server query.
   Real guest turns: no archive request during a turn; first answer 3.3–4.4 s (was 4.0–6.4 s).
2. **Broker hid every final refusal as `502 Body is unusable`** (`10133ef`). The retry loop cancelled
   the upstream body before deciding it could not retry. Measured: Groq's daily-quota 429 and
   Cerebras' 401 both reached the page as that 502 (treated as transient, real reason lost).
   Regression test reproduces the exact 502 without the fix.
3. **402 "can only afford N" retried once, smaller** (`43aa332`). LÉLU asks for 2,048 output tokens;
   OpenRouter refused every turn although credit remained. Live: `402 at max_tokens=2048; retrying
   once at 1479 (account can afford 1557)` → "The capital of France is Paris." spoken over LiveKit.
4. **Root-run installer review fixes** (`d4739fe`): backs up existing state **before** any change
   (`/root/lelu-preinstall/`, mode 600; gzip when zstd is absent — that case aborted the script and
   was caught by exercising it); an existing `/opt/lelu` keeps its owner/mode; a non-empty non-git
   `/opt/lelu/app` stops the script; voice venvs pinned to system Python (ProtectHome units).
5. **Providers for deployment**: template ships `LELU_ENABLE_ANTHROPIC=false`, `DEFAULT_PROVIDER=groq`
   (Anthropic unauthorized and not a dependency); `lelu-verify` calls Anthropic only when enabled.
   Verified: page leads with Groq; Anthropic never called. Runtime settings bridge preserved
   (`bcdc0d9`); `ANTHROPIC_BASE_URL` not published (checked by `lelu-verify`).

## 3. The voice reference "MP4"
| Check | Result |
|---|---|
| `.mp4`/`.m4v`/`.mov` in working tree, all 30 branch tips, full history | **none** (only third-party demo files inside Python venvs) |
| MPEG-4 files ever committed | exactly one: `public/audio/voice/lelu-voice-reference.m4a` (`62ad310`, 2026-11-10) |
| Container | **ISO MP4**: major brand `M4A`, compatible `mp42`/`isom`; audio only |
| Stream | AAC-LC, 44.1 kHz, stereo, 104 kb/s, **48.81 s**; sha256 `9ac99650…41ae` |
| Quality | SNR ≈ 17.6 dB (clean references are ≥ 30 dB); ~27 % of frames clear speech; 1 sample at full scale |
| Content (ASR) | a dialogue montage: "to bring them tribute from the temple… My only wish is to serve the gods… if you guys want the gold…" |
| Speakers (ECAPA, line vs rest) | one dominant voice on long lines (0.51–0.74); four short lines 0.29–0.37 (other characters or too short to tell); the conditioning window 0–12 s holds dominant-speaker lines only |
| Preserved | unchanged; never modified |
| Connected to MOSS | yes — worker `/health` reports the same file and sha256, first 12 s at 48 kHz |
| Reaches LiveKit | yes — agent → app `/api/voice/vox/speech` → MOSS (that reference) → LiveKit; received audio scores 0.22 vs reference after Opus |

**This file is the MP4 you described — treated as definitive, as instructed.** Two findings you need:
- **Consent / likeness.** The lines match the character Chel in DreamWorks' *The Road to El Dorado*,
  voiced by actress Rosie Perez (identification by dialogue; high confidence, not certain).
  Conditioning a public deployment on it clones a real, identifiable person's voice without her
  consent. I kept the existing integration exactly as it was and did **not** tune for a closer
  imitation. Recommend replacing it with a recording made for LÉLU by a consenting speaker before
  this goes public.
- **Quality.** A noisy film-dialogue montage is a weak conditioning source either way.

**Speaker similarity** (ECAPA cosine vs held-out reference spans; real voice vs itself 0.771):
MOSS via app 0.285 / 0.336 / 0.413; after LiveKit/Opus 0.22; VoxCPM2 0.27–0.43; a different speaker
−0.06. All samples intelligible (ASR exact; "Lélu" heard as "Lei Lu"). **Not a successful clone** by
this evidence, and no human listening test was possible here.

## 4. Voice revalidation after the fixes (Tested locally — simulated microphone, not a device)
Self-hosted `livekit-server` 1.13.11 (loopback) · app token endpoint (dev identity, loopback-only) ·
agent (stream, 900 ms prebuffer) · Groq Whisper via broker · LÉLU cognition · MOSS-TTS-Nano.
Evidence: `docs/voice/evidence/livekit-voice-moss-final/`.

| Item | Before (2026-11-13) | Now |
|---|---|---|
| STT | 349–404 ms | 427 ms |
| Reply → first audio | 1.34–1.62 s | 1.84 s (0 stalls, 0 underruns) |
| Real cognition reply spoken | yes | yes ("The capital of France is Paris.", via the 402 fix); later turns offline — accounts spent (§5) |
| STOP | 151 ms | **40 ms** |
| Barge-in | 336 ms | **341 ms**, then the interrupting question is transcribed |
| LiveKit server hard-killed | rejoined 1.7 s after it returned | **PASS**, 28.3 s from kill (hard kill → loss detected by timeout, then backoff); question after recovery transcribed and processed |
| Worker restart | 12 s, app healthy | **12 s**, app 200 throughout, 503 honestly while loading, then "I am back and nothing else had to restart." (ASR) |

## 5. Providers (live, 2026-11-14 — the second blocker)
| Provider | Real state (visible only after fix 2) |
|---|---|
| Groq | 429 daily quota: 199,657 / 200,000 tokens (rolling 24 h; my test turns and each test page's background self-study contributed) |
| OpenRouter | 402 key limit: affordable fell 1,709 → 1,557 → 1,071 → exhausted during this session |
| Cerebras | 401 key rejected |
| Fireworks | 412 account suspended |
| Anthropic | no credit; disabled by policy (not authorized) |
Fallback order and behaviour preserved; with no funded provider LÉLU answers in offline mode and
voice still listens and speaks.

## 6. Deployment, domain, HTTPS, LiveKit, iPhone
| Item | Status |
|---|---|
| Contabo install (`LELU_VOICE=1`) | **Blocked** — no access; runbook `docs/deploy/CONTABO_RUNBOOK.md` |
| Existing infra inspected / preserved | kit does it read-only + pre-install backup (tested on a simulated layout); not run on the VPS |
| Postgres / Redis | not required (no driver, dependency or variable); volumes left untouched |
| Domain / DNS / HTTPS | **Blocked** — no domain provided; none invented |
| WebSocket via Caddy | not verifiable without deployment |
| LiveKit Cloud vs self-hosted | **recommend Cloud** (no UDP on the VPS); needs your project credentials |
| iPhone microphone / Safari | **Blocked** — needs the HTTPS deployment; 10-step acceptance in the runbook |
| `lelu-verify` | **Implemented**, dry-run locally; not run in production |

## 7. Test results
GATE: see the final line of this section (filled from the run at HEAD).

## 8. Remaining blockers — and exactly who unblocks them
1. VPS access: run the runbook from a computer with SSH, or connect one through Remote Control.
2. A domain with an A record → 157.173.116.95.
3. LiveKit Cloud project URL + key + secret (or a decision to self-host).
4. At least one funded model account (Groq Dev tier, OpenRouter credit, or authorized Anthropic).
5. Supabase URL + publishable key in `/etc/lelu/lelu.env`.
6. A consented voice recording, if the likeness finding in §3 matters to you.
