# Mission 1 — LÉLU production voice integration and secure access

Branch `claude/lelu-voice-https-production-lvv519` · 2026-11-24 · by Claude (coding assistant)

> **Status: code and deployment tooling are done and rehearsed. Nothing has been deployed to production.**
> This session runs in a cloud container. Port 22 on 157.173.116.95 refuses it ("Connection refused"), and the
> only route to the VPS is the approval-gated GitHub workflow. No production acceptance result below is
> claimed as passed. Each one says where it was measured.

## 1. Original production state (observed from outside, 12:20 UTC)

| Probe | Result |
|---|---|
| `GET http://157.173.116.95/` | `303 → /auth/login`, `server: nginx/1.24.0 (Ubuntu)` |
| `GET /healthz` | `200 {"ok":true,"version":"a7503839","dist":true,"accessGate":true}` |
| `GET /api/voice/status` (no session) | `401` (access gate on) |
| `https://157.173.116.95/` | TCP accepted, then **TLS connection reset by peer**, so no HTTPS |
| Commit `a7503839a88be35591f95b19d36248f14fbe4bb9` | **Not on GitHub** (`gh api …/commits/a750…` → 422 "No commit found"; fetch → "not our ref"). The served code can't be reproduced from any pushed branch. |
| Previous `0cdedced` | On GitHub: "Record the security closure…" |
| Integration branch tip | `d6aeba2d` (this branch's base) |
| Latest `Contabo provider env` run 45318874606 | `action_required` (never ran) |
| Recon run [45396379761](https://github.com/lapheezy/LeluV1.1/actions/runs/45396379761) from this branch | **Started with no approval**, then failed: `secret LELU_VPS_SSH_KEY is missing in environment contabo-production`. The VPS was not contacted. |

The working-tree drift, services, env names, listeners, firewall, disk and backups are inside the VPS. They come from
`voice-tts-moss.sh recon`, which has not run there yet.

## 2. Architecture and voice pipeline (from source; to be confirmed by `recon`)

```
Browser ─HTTP:80─▶ nginx 1.24 ─▶ 127.0.0.1:4173  lelu.service  (bun run server.ts, EnvironmentFile=/etc/lelu/lelu.env)
                                   ├─ accessGate (LELU_ACCESS_PASSWORD → HttpOnly cookie; Secure iff X-Forwarded-Proto=https)
                                   ├─ /api/model/<provider>/…   brokers (Groq, OpenRouter… keys server-side, rotation in key ring)
                                   ├─ /api/voice/status|tts|stt|diagnostic   plugins/voiceApi.ts
                                   └─ /api/voice/vox/health|speech            plugins/voxApi.ts ─▶ VoxcpmPool
                                                                                   └─▶ 127.0.0.1:8789 lelu-moss.service
                                                                                       (MOSS-TTS-Nano, GET /health, POST /v1/audio/speech,
                                                                                        WAV or chunked audio/L16;rate=48000)
Speech in : page mic (getUserMedia: secure context only) → /api/model/groq/audio/transcriptions (Whisper, brokered)
Speech out: src/core/voice/elevenLabsTts.ts → POST /api/voice/tts {text, stream:true} → PCM player (rate from X-Lelu-Sample-Rate)
```

**Root cause of the 503.** The page only calls `/api/voice/tts`. Before this change that route spoke only through
ElevenLabs (paid, spend not authorized) or Piper (`LELU_LOCAL_TTS_*`, not set). MOSS was reachable only through
`/api/voice/vox/speech`, and the page doesn't use that route.

**Second defect, found in this mission.** The MOSS stream declares its 48 kHz rate only in `Content-Type`, but the
page's PCM player reads `X-Lelu-Sample-Rate` and defaults to 16 kHz. A naive relay would have played her voice at
one third of its speed.

**Third defect, found while rehearsing.** With an ElevenLabs key present but spend not authorized, `/api/voice/tts`
answered 402 and never tried MOSS, even though `/api/voice/status` tells the page to use the free worker.

## 3. Files modified

| Commit | Files |
|---|---|
| `322900be` | `plugins/voxApi.ts` (shared `relayWorkerSpeech`, `l16SampleRate`), `plugins/voiceApi.ts` (worker first when ElevenLabs is unusable; status and diagnostic), `tests/voice-tts-speech-worker.test.ts` (new, 10 tests) |
| `3b42ca38` | `deploy/contabo/voice-tts-moss.sh`, `deploy/contabo/https-ip.sh`, `deploy/contabo/patches/voice-tts-moss.patch` (sha256 `225eeb0f…`), `.github/workflows/contabo-voice-https.yml` |
| (this commit) | this report, journal entry, playbook `speak-through-moss-and-https` |

There are no new dependencies, env names, engines, paid APIs, Anthropic calls or LangChain. `dist/` is not affected.

## 4–5. Backup and integrity (procedure; production run pending)

Before any change, `voice-tts-moss.sh apply` does the following:
1. Runs the existing `/usr/local/bin/lelu-backup`. That covers assets, `/etc/lelu/lelu.env` and proxy config, as
   `/opt/lelu/backups/lelu-<stamp>.tar.zst`, mode 0600.
2. Verifies it with `zstd -t` and a full `tar` listing, and records its sha256.
3. Writes rollback material to `/opt/lelu/rollback/voice-tts-moss/<stamp>/`: the previous commit, `git status`, the
   drift diff, copies of the touched files, and the hash of `dist/index.html`. It stops if `/opt` has less than 2 GB free.

The HTTPS steps back up each nginx file they edit to `/opt/lelu/rollback/https/<stamp>-<step>/`. Nothing is ever deleted.

## 6. Build and test results (executed in this container)

| Run | Result |
|---|---|
| `npm test` (full, 3277 tests) | **3263 pass, 4 fail, 10 skipped.** The 4 failures also fail with the original `plugins/` files restored, so they are pre-existing: `credential-exposure` (the existing `contabo-provider-env.yml` puts `LELU_VPS_SSH_KEY` in `env:`; the new workflow uses the same pattern), `foundry-m25c` ×2, `outfit-switching`. |
| `npm run build` | exit 0 (only chunk-size warnings) |
| `tsc --noEmit -p tsconfig.node.json` (server.ts + plugins) | exit 0 |
| Voice + access + self-awareness suites after the final change | 176 pass, 1 skipped, 1 fail (the pre-existing credential-exposure one) |
| New `voice-tts-speech-worker` | 10/10: worker WAV; worker stream with `X-Lelu-Sample-Rate: 48000`; status/diagnostic; not READY → 503; no `VOXCPM_*` → unchanged; `VOICE_PROVIDER=elevenlabs` → unchanged; unauthorized paid key → worker; unauthorized key + no worker → 402; STOP aborts the worker |

`npm ci` refuses the lockfile (`livekit-client@2.24.0` missing from `package-lock.json`). That's pre-existing. I used
`npm install --no-save`, so no tracked file changed.

## 7. Rehearsal on a local replica (executed; not production)

The replica: a `lelu` user, `/opt/lelu/app` holding the code of `d6aeba2d` with simulated drift, the real
`backup.sh` as `lelu-backup`, a fake MOSS on :8789 with the real routes and headers (1.5 s of 48 kHz audio), a
stand-in server mounting the replica's **real** `voiceApi`/`voxApi` behind a password gate, and nginx 1.24.0.

| Scenario | Evidence |
|---|---|
| Baseline (unpatched) | `tts[wav] code=503 … "No speech engine is configured."`. Reproduces production. |
| `apply` | backup verified (zstd + tar), patch applied with HEAD unchanged, "typecheck: no new errors (3 pre-existing line(s) unchanged)", route test passed on the box, `lelu` restarted, `tts[wav] 200 … codec_name=pcm_s16le sample_rate=48000 channels=1 duration=1.5`, `tts[stream] 200 audio/L16;rate=48000 rate=48000 bytes=144000`, "served build unchanged" |
| `rollback` | patch reversed, "working tree identical to before apply", `lelu` healthy |
| Patch adding a type error | "typecheck: the patch introduced errors" → automatic rollback, tree identical |
| MOSS not READY at verify time | TTS 503 → "application TTS not working after apply — rolling back" → tree identical |
| First HTTPS attempt | found two bugs, both fixed and re-run: rollback picked a marker file, and probes raced nginx's asynchronous reload |
| `https stage` | challenge path served locally and on the public route; app still 200 |
| `https enable` (local CA) | "200, certificate verified", HTTP still 200, login over HTTPS 303, **session cookie Secure**, authenticated API over HTTPS 200 |
| `https rollback` ×2 / `rollback all` | site file byte-identical to the original each time |
| Certificate not matching the IP | "verify=1 — reverting", restored; :443 closes within 1 s (old workers draining) |

## 8. Latency

**No production latency has been measured.** The replica numbers (first byte about 17 ms) come from a fake worker
and say nothing about MOSS. `accept` prints real per-step timings: broker completion time, MOSS direct synthesis ms,
app TTS first-byte and total, and Whisper STT ms. The worker also reports `X-Lelu-Synthesis-Ms` and
`X-Lelu-First-Audio-Ms`. The unit file documents an earlier measurement on this VPS: first audio 250–300 ms,
RTF 0.8–1.3. That is a prior record, not a measurement from this mission.

## 9. HTTPS status and prerequisites

* **Not operational.** Port 443 resets the TLS connection.
* **A domain is not required.** [Let's Encrypt made IP-address certificates generally available on 2026-01-15](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability).
  They are short-lived only (`shortlived` profile, about 6 days). Certbot requests them with `--ip-address` and
  `--preferred-profile shortlived`; [webroot with IP addresses needs Certbot 5.4+](https://eff.org/deeplinks/2026/03/certbot-and-lets-encrypt-now-support-ip-address-certificates),
  and [Certbot obtains but does not install IP certificates](https://letsencrypt.org/2026/03/11/shorter-certs-certbot.html).
  I verified both flags against a real Certbot 5.10.0 in this container.
* Prerequisites on the VPS: port 80 reachable from the internet (it is), port 443 allowed in the firewall (`enable`
  adds `ufw allow 443/tcp` only if ufw is active and lacks it), and Certbot ≥ 5.4 (`stage` installs the snap; Ubuntu
  24.04's apt Certbot is too old). There's no account and no cost; registration is without an email.
* Decisions to note: **HSTS and the HTTP→HTTPS redirect are deliberately off**. If a 6-day certificate's renewal ever
  failed, HSTS would lock browsers out. Turn both on once renewals have been observed. `issue` proves renewal with
  `certbot renew --dry-run`.
* **Microphone depends on this.** Browsers expose `getUserMedia` only in secure contexts, so microphone capture on
  `http://157.173.116.95` can't work on desktop or iPhone. The voice Definition of Done therefore needs HTTPS.

## 10. Service health after deployment

Not applicable: nothing has been deployed.

## 11. Rollback

* Voice: action `rollback` (`voice-tts-moss.sh rollback [<stamp>]`). It reverses the patch, falls back to the file
  copies if needed, checks the tree is identical to the pre-apply drift, restarts `lelu`, and checks health. Last
  resort: `tar --zstd -xpf /opt/lelu/backups/<archive> -C /` (DEPLOY_CONTABO.md).
* HTTPS: action `https-rollback` (one layer) or `https-rollback-all` (original nginx file, firewall rule removed).

## 12. Remaining blockers

0. **No route to the VPS exists yet (hard blocker).** Run 45396379761 shows `contabo-production` has no
   `LELU_VPS_SSH_KEY`, and it ran without waiting for approval. That is consistent with an environment GitHub
   auto-created from a workflow reference: no secrets, no protection. **Before adding the key**, in repository
   Settings → Environments → `contabo-production`:
   1. add required reviewers;
   2. restrict deployment branches, for example to `integration/lelu-four-workforce-consolidation` and this branch.
   Otherwise any branch pushing a workflow could use the VPS root key. Then add `LELU_VPS_SSH_KEY` (an ed25519 private
   key whose public half is in root's `authorized_keys`) and `LELU_VPS_KNOWN_HOSTS` (the VPS host key, checked
   against the Contabo console). Re-request recon by editing `deploy/contabo/voice-https-request.json`.
   Alternative without GitHub: run the same scripts from the owner's machine or the Contabo VNC console, e.g.
   `scp deploy/contabo/{voice-tts-moss.sh,https-ip.sh,patches/voice-tts-moss.patch} root@157.173.116.95:/root/` and
   then `bash /root/voice-tts-moss.sh recon`.
1. **Then approve the runs one by one**, in this order: `recon` → `apply` → `accept` → `https-check` →
   `https-stage` → `https-issue` → `https-enable` → `accept`.
2. **Unknown production code.** `a7503839` isn't on GitHub. `apply` checks with `git apply --check` and changes
   nothing if the patch doesn't fit. Pushing that commit would make production reproducible.
3. **A person must test hardware**: microphone permission and capture, audible playback, and interruption, on a
   desktop browser and an iPhone, after HTTPS is enabled.
4. The `credential-exposure` test fails on the VPS-SSH-key pattern used by both deploy workflows. I left it
   unchanged for the owner to decide.
5. `package-lock.json` is out of sync with `package.json` (`npm ci` fails). Pre-existing.
