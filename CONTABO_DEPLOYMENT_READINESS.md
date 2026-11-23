# CONTABO DEPLOYMENT READINESS (WP06)

**Status: offline preparation complete and verified in a container; live
Contabo deployment NOT performed** — this session has no SSH access, VPS
address, domain or root credentials. Nothing below claims a live deployment.

## 1. Intended production architecture (as found in the repo, unchanged)

```
Browser / iPhone ──HTTPS──▶ Caddy :443 (Let's Encrypt, HSTS, zstd/gzip, SSE flush,
                              Permissions-Policy microphone=(self))
                               │ reverse_proxy 127.0.0.1:4173 (health_uri /healthz)
                               ▼
                 lelu.service (systemd): bun run server.ts  — User=lelu, HOST=127.0.0.1
                   • owner access gate (LELU_ACCESS_PASSWORD → HMAC session cookie)
                   • dist/ (vite build) + SPA fallback
                   • /api/model/* broker (keys server-side), /api/voice, /api/asre,
                     /api/forge, /api/self, /api/acquisition, /api/env-check …
                   • /healthz and /api/health
                               ├── Supabase (auth, conversations, memory, continuity)
                               └── /opt/lelu/app/leluverse/assets (Forge ledger, models, Cosmos state)
```

No Docker, no local Postgres/Redis. Files: `deploy/contabo/{install.sh, update.sh,
backup.sh, healthcheck.sh, verify.sh, lelu.service, lelu-*.timer, Caddyfile,
lelu.env.example}`, guide `DEPLOY_CONTABO.md`.

## 2. Audit results

| Item | Finding | Verified how |
|---|---|---|
| Runtime | Bun 1.4.4 runs `server.ts`; Node 22 for `tsc`/`vite` | ran here |
| Package install | `bun install --frozen-lockfile` clean, 957 packages, lockfiles unchanged by the merge | ran here |
| Production build | `tsc -b && vite build` pass, 6 s build (after the Tailwind fix; was 379 s) | ran here |
| Server startup | healthy in 116–454 ms; RSS ≈ 50 MB idle, 62–64 MB after ~11 min of use | ran here |
| Health check | `/healthz` 200 `{ok, version, uptime, rssMb, dist, accessGate}`; Caddy and `lelu-health.timer` use it | curl |
| API routing on `server.ts` | `/api/model/status`, `/api/env-check`, `/api/voice/status`, `/api/asre/status`, `/api/acquisition` 200; `/api/self/*` was 404 on `server.ts` only — **fixed** (`4b87a535`) | curl |
| Access gate | `/` → 303 login; APIs 401; wrong password 401; right password → cookie → 200 | `logs/access-gate.txt` |
| Provider routing | Groq via broker 200 (0.24–0.38 s); Anthropic `POLICY_DISABLED` (403); paid ElevenLabs refused `402` | curl |
| Restart recovery | `server.ts` stop/start: conversation still present in the same browser profile | `restart-persistence.json` |
| systemd unit | parses (`systemd-analyze verify`; only complaint: bun binary absent on this host); `Restart=always`, `MemoryMax=3G`, `ProtectSystem=strict`, `ReadWritePaths=/opt/lelu` | ran here |
| Scripts | `bash -n` passes for install/update/backup/healthcheck/verify | ran here |
| Writable paths | ASRE (`leluverse/assets/asre`) and Foundry (`artifacts/foundry/store`) default inside `/opt/lelu/app` → covered by `ReadWritePaths` | code read |
| Microphone secure context | requires HTTPS (Caddy provides it); Permissions-Policy allows `microphone=(self)` | Caddyfile |
| WebSockets | not required by the core app; LiveKit voice is optional and external | code read |
| Logging | journald (persistent, capped), Caddy access log with rotation | install.sh |
| Env template | names-only template; **added** the optional ASRE/Foundry/local-voice variables the merged lines read (`3cbedff4`) | diff |
| Secrets | none committed; no values printed in any evidence file | review |

## 3. Supabase — migrations (read-only inspection of the connected projects)

Repo migrations: 7 files in `supabase/migrations/`. Applied state, read with
`list_migrations` and a read-only catalogue query (nothing was written):

| Migration file | Project "Lelu" (`nrehs…`, appears to be production) | Project "lelu-v11-test" (`ugshf…`) |
|---|---|---|
| `202608240001_lelu_runtime.sql` | applied (as `lelu_runtime_integration`) | applied |
| `202608240002_project_metadata.sql` | applied | applied |
| `202610080001_proactive_question_lifecycle.sql` | applied | applied |
| `202611060001_revoke_trim_lelu_events_execute.sql` | **NOT applied — `anon` can still execute `trim_lelu_events()`** | applied |
| `202611070001_usage_records_and_budgets.sql` | applied (reservations variant) | applied |
| `202611160001_continuity_revisions.sql` (Mission 14) | **NOT applied** (`lelu_continuity_touch` absent) | applied |
| `202611200001_memory_tombstones.sql` (M22.7) | **NOT applied** (`memory_tombstones`, `erase_memory` absent) | not applied |

All three pending files are additive and idempotent: they create tables,
functions, triggers and policies, revoke one grant, and only drop *their own*
triggers/policies before recreating them. No data is deleted.

**Not done by this mission** (production database writes need the owner's go-ahead).
Procedure, test project first:

```bash
# 1. on the test project, then re-run the suite against it
supabase link --project-ref ugshflwlyakipeduifkd
supabase db push            # applies 202611200001_memory_tombstones.sql
# 2. production, after a backup (Dashboard → Database → Backups)
supabase link --project-ref nrehsldbfxthspikaxvr
supabase db push --dry-run  # must list exactly the three files above
supabase db push
```

Until `202611060001` is applied, any anonymous client holding the publishable
key can call `trim_lelu_events()` on production. That is the most urgent item
in this report.

## 4. Size and disk

| | Baseline | Workforce branch |
|---|---|---|
| Tracked content | 1.2 GB | **5.1 GB** (leluverse 2.1 GB, docs/evidence 1.7 GB, artifacts 1.3 GB) |
| `leluverse/assets` (what `lelu-backup` archives daily, 14 kept) | 0.25 GB | 2.1 GB → up to ~29 GB of backups |

Fine on the 100 GB VPS, but the first `git clone` downloads roughly 5 GB of
working tree plus history. Optional, to shorten it (not changed in install.sh,
untested on the host): `git clone --filter=blob:none --branch … ` keeps full
history metadata and fetches only the blobs that are checked out.

## 5. Exact commands

First install (on the VPS, as root):

```bash
apt-get update && apt-get install -y git
git clone --branch integration/lelu-four-workforce-consolidation https://github.com/lapheezy/LeluV1.1.git /root/lelu-src
cd /root/lelu-src/deploy/contabo
LELU_DOMAIN=<your.domain> LELU_ACME_EMAIL=<you@example.com> bash install.sh   # stops after creating /etc/lelu/lelu.env
nano /etc/lelu/lelu.env            # LELU_ACCESS_PASSWORD, GROQ_API_KEY*, OPENROUTER_API_KEY*, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY …
LELU_DOMAIN=<your.domain> LELU_ACME_EMAIL=<you@example.com> bash install.sh   # builds, starts lelu + timers + Caddy
sudo bash /opt/lelu/app/deploy/contabo/verify.sh | tee /root/lelu-verify.txt
```

Build / start by hand (what the unit runs):

```bash
cd /opt/lelu/app && bun install --frozen-lockfile && npx tsc -b && npx vite build
HOST=127.0.0.1 PORT=4173 NODE_ENV=production bun run server.ts
```

Restart / update / rollback / backup:

```bash
sudo systemctl restart lelu                 # restart (SIGTERM, in-flight requests finish)
journalctl -u lelu -f                       # logs
sudo lelu-update                            # latest commit of the branch; builds into dist.next,
                                            # auto-rollback if not healthy within 60 s
sudo lelu-update <commit-sha>               # pin / manual rollback to a known commit
sudo lelu-backup                            # on demand (also daily and before every update)
sudo tar --zstd -xpf /opt/lelu/backups/lelu-<stamp>.tar.zst -C /   # restore assets/env/Caddyfile
```

## 6. Remaining live-server acceptance steps (owner, on the VPS)

1. DNS A record → VPS; run install twice; `verify.sh` all PASS.
2. `https://<domain>/healthz` 200 through Caddy (TLS issued).
3. Log in through the gate on desktop and on the iPhone; Add to Home Screen.
4. One chat turn; memory write + recall across a page reload.
5. Microphone: tap the mic on the iPhone over HTTPS; speak; confirm transcript and reply (physical hardware — not testable here).
6. `sudo systemctl restart lelu`; confirm the conversation and `/healthz` return.
7. Apply the three Supabase migrations as in §3, then repeat step 4 signed in to Supabase.
8. Reboot the VPS once; confirm `lelu`, `caddy` and the timers come back.
