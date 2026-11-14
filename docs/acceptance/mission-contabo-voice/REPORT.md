# LÉLU — Contabo deployment + live voice verification: acceptance report

Date 2026-11-14 · Work branch `claude/lelu-integration-performance-eai80a` · Ran in an ephemeral cloud
container (4 vCPU, 15.7 GiB, no GPU). Every PASS below has a test or a live measurement behind it.

## 1. Repository reconciliation (done before any change)

| Fact | Value |
|---|---|
| HEAD at start | `5eee649` on `claude/lelu-integration-performance-eai80a`, clean tree |
| `5eee649` | exists; == `origin/integration/lelu-four-workforce-consolidation` == work branch |
| `origin/main` | `44bdd93`, **ancestor** of `5eee649` (0 commits not in it; Oct 8) |
| GitHub default branch | `claude/open-session-rbwmdw` (`e7b667b`, Oct 30), **ancestor** of `5eee649` |
| New commits on any branch since the last mission | none |
| Branches with commits outside `5eee649` | the same side branches dispositioned in `MISSION-10.1-RECONCILIATION-REPORT.md` and `docs/acceptance/mission-performance/REPORT.md` §1 (Jules/Codelazr duplicates, Mission 2.15/5.2 evidence, superseded Freebuff VoxCPM route) |

**Canonical branch:** the de-facto canonical line is `integration/lelu-four-workforce-consolidation`
(it contains `main` and the GitHub default branch). Neither `main` nor the default branch was moved —
that is your decision. `integration` was **not** advanced in this mission: the new commits below are on
the work branch for review (`5eee649..HEAD`), per "do not deploy unreviewed changes".

Commits this mission (all on the work branch): `bcdc0d9` bridge/env fix · `5f55699`, `674e781` voice
evidence · `0cb3014` Contabo kit · this report.

## 2. Contabo deployment — **BLOCKED (no access path from this session)**

| Check | Result |
|---|---|
| SSH key in session | none |
| `ssh` client | not installed |
| TCP to 157.173.116.95:22 | connection refused (egress is HTTPS-only through a proxy; raw IPs cannot be allow-listed) |
| Remote Control computer folder | none connected |

Nothing was deployed and nothing on the VPS was touched. What was done instead — the kit, fitted to the
server you described, verified where it can be verified here:

- **Architecture finding: LÉLU uses no PostgreSQL and no Redis.** No driver, dependency or
  connection variable exists. Persistence = Supabase (remote: accounts, conversations, memory) + files
  under the app (`leluverse/` Forge store, `.lelu-acquisitions`, `.lelu-studio`, `.lelu-sandbox`) +
  the browser's storage. The provisioned Postgres/Redis volumes and the `lelu-internal` network are
  therefore **not used**; `install.sh` now reports them read-only and never recreates or deletes them.
- `deploy/contabo/install.sh`: deploys `integration/lelu-four-workforce-consolidation` (was the stale
  `claude/avatar-3d-world`); read-only preflight; Bun pinned to `/opt/lelu/.bun` (independent of the
  provisioned user's home); optional `LELU_VOICE=1` voice install (uv system-wide — Ubuntu 24.04 refuses
  `pip --user` — MOSS worker, agent, units).
- `deploy/voice/lelu-moss.service` (new, loopback, 3 threads, MemoryMax 3G) and
  `lelu-voice-agent.service` set to the measured MOSS configuration (stream + 900 ms prebuffer).
- `deploy/contabo/verify.sh` → `lelu-verify`: services, health (loopback and HTTPS), real Anthropic and
  Groq calls, page configuration, voice, public listeners, env-file mode, secrets in tree/page, disk,
  logs, one backup run; prints no secret values. Dry-run here: applicable checks pass, and it correctly
  flags a published `ANTHROPIC_BASE_URL` and a policy-disabled Anthropic.
- `backup.sh` now includes `.lelu-acquisitions` and `.lelu-studio`.
- Existing (unchanged, reviewed): systemd `lelu.service` (Restart=always, hardening, loopback bind),
  Caddy (HTTPS, zstd/gzip, edge-refuses `/api/engineer/*`), health + backup timers, persistent
  bounded journald, UFW 22/80/443 only.

**Run it (on the VPS, as root):**
```bash
git clone --branch claude/lelu-integration-performance-eai80a https://github.com/lapheezy/LeluV1.1.git /root/lelu-src
# (or the integration branch once you fast-forward it to this review)
cd /root/lelu-src/deploy/contabo
LELU_DOMAIN=<your domain> LELU_ACME_EMAIL=<you> LELU_BRANCH=claude/lelu-integration-performance-eai80a bash install.sh
nano /etc/lelu/lelu.env     # first run stops here; fill keys, then re-run install.sh (add LELU_VOICE=1 for voice)
lelu-verify | tee /root/lelu-verify.txt   # paste this output back for review
```

## 3. Anthropic activation — **configured correctly; BLOCKED on billing**

| Check | Result |
|---|---|
| Live request (2026-11-14) | 400 `"Your credit balance is too low to access the Anthropic API"` |
| Server setting | `LELU_ENABLE_ANTHROPIC=true` — read by the broker (`plugins/modelApi.ts`) |
| Page settings | `LELU_ENABLE_ANTHROPIC` and `DEFAULT_PROVIDER` (or `VITE_DEFAULT_PROVIDER`) — published to the page **at request time** by `server.ts` (`plugins/runtimeKeyBridge.ts`). **A service restart applies them; no rebuild is needed.** There is no `import.meta.env` path in the browser by design. |
| Bug fixed (`bcdc0d9`) | the bridge silently dropped any setting given under its documented `VITE_` name, so `VITE_DEFAULT_PROVIDER=anthropic` never reached the page. Now published (accept guards kept). Regression test added. |
| Bug fixed (`bcdc0d9`) | the Contabo env template said "Anthropic is primary" but never set the opt-in; it now sets `LELU_ENABLE_ANTHROPIC=true` and `DEFAULT_PROVIDER=anthropic`. |
| Pitfall found | `ANTHROPIC_BASE_URL` in the server env is published to the page, which then calls it directly (no key) and skips the broker. The template warns; `lelu-verify` checks. Builds made where it is set bake it into `dist/index.html` — build on the VPS. |
| Selection proven | with both settings: page logs `Trying Anthropic` first → broker logs `REFUSED provider=anthropic … 400 … credit balance is too low` → falls back → correct answer. |
| After a refusal | billing refusals sit out 15 min (previous mission) — so a background cycle that hits the empty balance first makes the next turns skip Anthropic for that window. Expected, not a fault. |

**To finish:** add credit → restart `lelu` → `lelu-verify` must show `PASS Anthropic answered`.

## 4. Groq fallback — **PASS**
Real request through the broker with LÉLU's configured model `openai/gpt-oss-120b`: 200, reply `"ok"`,
375 ms. (An id the account lacks, `llama-3.1-8b-instant`, returns 404 — not used by LÉLU.)

## 5. LiveKit voice — **PASS end to end in this container (simulated microphone)**

Stack: self-hosted `livekit-server` 1.13.11 (built from source, loopback) · app token endpoint (dev
identity — honoured only for loopback LiveKit and non-production) · voice agent (stream, 900 ms
prebuffer) · Groq Whisper via the broker · LÉLU cognition · **MOSS-TTS-Nano** worker · headless
iPhone-13 page whose microphone is a WAV file. Evidence: `docs/voice/evidence/livekit-voice-moss/`.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | VoxCPM2 weights | PASS | `bootstrap.py --check`: 9 files, 4,960,731,830 bytes, sizes verified |
| 2 | MOSS weights | PASS | `.mossnano/state/model-ready.json`; 642 MB + 87 MB ONNX |
| 3 | Worker startup | PASS | MOSS READY in ~39 s, 1.7 GiB RSS |
| 4 | Voice identity / config | PASS (config) · PARTIAL (likeness) | worker conditions on `lelu-voice-reference.m4a` sha256 `9ac99650…`; ECAPA vs held-out reference: MOSS 0.29–0.41, 0.22 after Opus; VoxCPM2 0.27–0.43; real voice 0.77; other speaker −0.06. Not a close clone; no listening test. |
| 5 | LiveKit credentials/room | PASS (dev) | token endpoint → room `lelu-dev-e2e`, connected in ~0.2 s, agent present |
| 6 | Agent joins | PASS | `participant_joined`, `listening` |
| 7 | Mic reaches agent | PASS | `transcript` events, STT 349–404 ms |
| 8 | Speech processed | PASS | exact transcripts; reply 1.97 s (short) / 5.2 s (long story) |
| 9 | TTS generates | PASS | agent `first_audio` 1.34–1.62 s after reply (VoxCPM2 on CPU: 27–70 s) |
| 10 | Audio streamed back | PASS | page recording, independent ASR: "The capital of France is Paris." / "Once upon a time, in a faraway land…"; 0 stalls, 0 underruns |
| 11 | Interruption / turn-taking | PASS | STOP: last audible 151 ms after click; barge-in: silent **336 ms** after overlapping speech (target 300; prior 534), then the interrupting question is transcribed |
| 12 | Restart recovery | PASS | LiveKit server killed → page rejoined by itself 1.7 s after it returned; MOSS worker restarted under a running app: app healthy throughout, speech refused honestly (502/503) during load, 200 + audio after READY (12 s) |
| — | Text continuity after voice | PASS (transport) | same 6-message conversation; but asked for the *first* voice question she named the second — a reasoning slip by the fallback model |
| — | Real device (iPhone, real mic, echo) | **NOT TESTED** | no device; no public HTTPS deployment |
| — | On Contabo | **BLOCKED** | §2 |

**Actual voice model:** MOSS-TTS-Nano (`OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX`) for the VPS.
VoxCPM2 was **not** forced onto the 8 GiB CPU box: on CPU it measures RTF 5.4, 252 s load, 6.5 GiB
resident / ~11 GiB peak.

**LiveKit for production — what is needed** (no credentials were invented): either LiveKit Cloud
(`LIVEKIT_URL=wss://<project>.livekit.cloud`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` from the project
settings; nothing to open on the VPS) — recommended — or self-hosted `livekit-server` on the VPS with
a TLS domain and UDP 50000–60000 + TCP 7881 opened (larger attack surface, TURN needed for some
networks). Plus `LIVEKIT_PUBLIC_URL` and `LELU_VOICE_AGENT_TOKEN` (`openssl rand -hex 32`).

## 6. Desktop heap 88 → 126 MB — **not a leak at that level; small residual growth unproven**
The earlier figure was raw `usedJSHeapSize` at ~7 s, without GC. With forced GC (harness `heap.mjs`):

| after GC | 10 s | 60 s | 120 s | 240 s | 12 min |
|---|---|---|---|---|---|
| baseline `098dd3e` | 24.1 | 26.5 | 49.4 | 49.6 | — |
| HEAD | 34.6 | 37.1 | 36.0 | 38.8 | 39.0 |

HEAD loads content earlier (baseline reaches its plateau only at ~120 s) and retains **less** at
steady state (~37–39 MB vs ~49–50 MB). Residual: +3.1 MB over 11 min with a stable DOM, slowing
(≈0.55 → 0.13 MB/min) — consistent with bounded buffers filling, **not proven bounded**. Next step if
it matters: heap-snapshot diff at 5 and 30 min.

## 7. Archived-memory latency — task written, **no schema change**
`docs/tasks/archived-memory-recall-latency.md`. Live, read-only: `legacy_memories` has **69 rows**;
`EXPLAIN ANALYZE` of the exact query = **5.6 ms**. The 1.5–2.1 s is round trip/session, not the
database: an index is **not** warranted. Proposed: a 400 ms deadline on the archive band, then a
per-session cache of the frozen snapshot.

## 8. Final integration status

| Item | Status |
|---|---|
| Backend running on Contabo | **BLOCKED** (no access) |
| Health checks | PASS locally (`/api/health`, `/healthz`); VPS pending `lelu-verify` |
| Database/cache | N/A by architecture (no Postgres/Redis); Supabase reachable, recall works |
| Anthropic | **BLOCKED** (credit); selection and fallback proven |
| Groq fallback | PASS |
| LiveKit round trip | PASS (container, simulated mic) |
| MOSS streaming | PASS (app route: first bytes 0.28–0.46 s; agent: first audio 1.3–1.6 s) |
| Memory across restarts | NOT TESTED on VPS (memory lives in Supabase, not on the host) |
| Logs / restart / backups | units and scripts in place; NOT RUN on VPS |
| Secrets | PASS here: none in git, none in the served page, none in evidence logs (checked) |
| Chat / Chat Universe | PASS: real guest turns answered (this mission and the full suite on the work branch) |

Full gate at this HEAD (run after all changes): `tsc -b --force` exit 0 · `oxlint` 0 errors · `npm test` **2,090 pass, 0 fail, 6 skipped** (2,096).

## 9. Security findings
- Fixed: documented `VITE_` settings were silently dropped (`bcdc0d9`) — a correctness bug, but also
  meant operators could believe a policy was applied when it was not.
- Pitfall: never set `ANTHROPIC_BASE_URL` on the server unless it is a browser-reachable proxy.
- Self-hosting LiveKit on the VPS opens UDP 50000–60000; LiveKit Cloud keeps the VPS at 22/80/443.
- `LELU_LIVEKIT_DEV_IDENTITY` must never be set in production (ignored there anyway).
- The Postgres/Redis volumes are unused; if no future service needs them, removing them is your call.
- Pre-existing, unchanged: `verify-bundle-secrets` flags Excalidraw's own public-key constant name.

## 10. Outstanding user actions
1. Give a deployment path: run `install.sh` yourself (commands in §2), or connect a computer that can
   SSH to the VPS through Remote Control.
2. A domain with an A record → 157.173.116.95 (Caddy needs it for HTTPS).
3. Fill `/etc/lelu/lelu.env` (template lists every name; Supabase URL + publishable key included).
4. Add Anthropic credit.
5. LiveKit Cloud project credentials (or decide to self-host).
6. Review `5eee649..claude/lelu-integration-performance-eai80a`, then fast-forward `integration`.
7. Confirm the voice reference (the earlier "BEER voice" question is still open).

## 11. Exact next mission
**Run `install.sh` (with `LELU_VOICE=1`) on the VPS from the reviewed branch, return `lelu-verify`
output, then repeat the LiveKit round trip against the deployed HTTPS domain from a real iPhone**,
with Anthropic funded. Then: the archive-recall deadline/cache task, and a heap-snapshot diff only if
the residual growth matters.
