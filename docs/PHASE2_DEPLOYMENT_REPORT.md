# LÉLU V1.1 — Phase 2: security hardening and Contabo deployment

Continues from `82a0cd0` (Phase 1 cache policy). Branch
`freebuff/b6da3caf29b9fda0e880006b`. Nothing was rebuilt or replaced:
`server.ts` cache policy, `plugins/engineerApi.ts`, `plugins/selfViewApi.ts`
and the Forge/SHAMAN/delegation/cognition code are all extended in place.

---

## 1. Security: the engineering runtime is closed

### What was wrong

`LELU_ENGINEER_TOKEN` was **optional**. With it unset — the default on any
fresh checkout, and on any VPS where nobody read `ENV_VARS.md` —
`/api/engineer/*` answered `200` to anyone who could reach the port:

```
GET  /api/engineer/status  → 200  { tokenRequired:false,
                                    workspaceRoot:"/workspace/chats/…",
                                    runtimeInfo:{engine,version,cwd} }
POST /api/engineer/command {"operation":"inspect"} → 200 + real stdout
POST /api/engineer/search  (reads source)          → 200
POST /api/engineer/preview (spawns a dev server)   → 200
POST /api/browser/capture  (drives Chromium)       → 200
```

A second, independent defect surfaced during the audit:
`plugins/selfViewApi.ts` read the header **`x-lelu-engineer-token`** while
the app sends **`x-lelu-token`**. With a token configured, capture,
preview and search returned `401` to LÉLU's own interface — the gate had
never been exercised with a token present, so nobody had noticed.

### What changed

One shared gate, **`plugins/engineerAuth.ts`**, used by every route:

| State | Response |
|---|---|
| `LELU_ENGINEER_TOKEN` **unset** | `503`, `{disabled:true}` — the runtime is off |
| set, no token presented | `401`, `{tokenRequired:true}` |
| set, wrong token | `401` |
| set, correct token | the request proceeds |

- **Fail-closed is the default.** No token configured means no command
  execution, no source reads, no preview servers, no browser driving.
- **No loopback exemption, deliberately.** Behind a reverse proxy every
  request arrives from `127.0.0.1`; a "local is trusted" rule would be a
  total bypass on exactly the deployment it is meant to protect.
- **Constant-time comparison** (`tokensMatch`), so a wrong token leaks
  nothing by timing.
- **Both header names accepted**, plus `Authorization: Bearer`, which is
  what repairs the self-view routes for the app.
- **`status` is now token-gated too.** Its refusal body carries only
  `tokenRequired` — no workspace path, no operation list, no engine or
  version. Capability detail is returned only to a token holder.
- The startup log states the posture out loud, so an operator sees it:
  ```
  engineering API DISABLED — LELU_ENGINEER_TOKEN is not set, every
  /api/engineer/* route answers 503
  ```

### Evidence — 33/33

`node scripts/verify-engineer-auth.mjs` spawns the real runtime twice
(no token, then a token) and stops them itself:
`docs/evidence/engineer-auth/2026-11-01T02-39-52/auth.json`.

Highlights, each a real HTTP response from `bun server.ts`:

- all 10 routes (`command`, `read`, `list`, `write`, `workspace`, `git`,
  `search`, `preview`, `capture`, `status`) → `503` with no token;
- the refusal contains **no** absolute path, `workspaceRoot`, `runtimeInfo`,
  operation list, version string or token;
- with a token configured: anonymous `401`, invalid `401`, valid `200`
  with the real report;
- an authorized `inspect` still runs and returns real stdout;
- an authorized **unauthenticated-equivalent write still cannot touch the
  live project** (`403`, "Writes require a workspace copy");
- **a valid token does not get past the origin guard**: foreign `Origin`
  → `403`;
- the self-view routes work with the header the app actually sends
  (`search` → `200`, 3 matches).

### The second boundary (defence in depth)

Both `deploy/Caddyfile` and `deploy/nginx.conf` answer **`404`** for
`/api/engineer/*` and `/api/browser/capture`. `404`, not `403`, so the
endpoints are not confirmed to exist. This is independent of the runtime
gate: a future misconfiguration on one side does not open the other.

### Endpoint audit (remaining surface)

| Endpoint | Guard | Risk |
|---|---|---|
| `/api/engineer/*`, `/api/browser/capture` | **token, fail-closed** | closed |
| `/api/model/*` | same-origin only | Any visitor can spend the owner's AI credits — the app's design; rate-limit at the proxy if unwanted. |
| `/api/knowledge/relay` | same-origin only | Adds `MESHY_API_KEY` server-side; Meshy is **paid**. Same consideration. |
| `/api/github/*` | same-origin; writes need `LELU_ALLOW_PUSH=1` | An unauthenticated same-origin caller can use the server's GitHub token for reads. Do not set a GitHub token on a public host unless intended. |
| `/api/provider-health` | none | Runs live provider probes per call: cheap, not free. |
| `/api/env-check` | none | Presence only (`SET`/`absent`) — no values. Correct as-is. |
| `/api/browse`, `/api/rss/search` | `isBlockedHost` | SSRF guard present (loopback/RFC1918/link-local refused). |
| `/api/ais/*`, `/api/neko/status`, `/api/network/quad9`, `/api/instagram/media` | none | Read-only status/data; no workspace or command access. |

### Credential exposure and rotation

Measured here, not assumed:

```
scripts/verify-bundle-secrets.ts dist
  ✓ LELU_ENGINEER_TOKEN is absent from every built file
  ✓ no VITE_*_KEY/TOKEN name is emitted bound to a value
  ALL BUNDLE SECRET CHECKS PASSED
  • VITE_FIRMS_API_KEY / GUARDIAN / GNEWS / NEWSDATA: SHIPPED — browser-side by design

scripts/verify-secrets.ts
  21 secrets declared · 21 wired to code · 0 present in this environment
```

**Which credentials actually require rotation:**

| Credential | Rotate? | Why |
|---|---|---|
| `MESHY_API_KEY` | **No** | Server-only since the relay existed; the scan finds it in no built file. |
| `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, and the other model keys | **Only if** an older build that inlined `VITE_` model keys was ever published. Current bundles contain none. If one was published, rotate — the key would have been in a JS file. |
| `NEWS_API_KEY`, `YOUTUBE_API_KEY` | **No** (already rotated by the owner), unless a bundle published before the relay fix is still served. The current build ships neither. |
| `AISSTREAM_API_KEY`, `INSTAGRAM_ACCESS_TOKEN`, `NEKO_PASSWORD` | **No** | Server-only; never in the bundle. |
| `VITE_FIRMS_API_KEY` (and Guardian/GNews/NewsData) | **Rotate if they are yours and the bundle is public.** These are *designed* to be browser-side, so treat them as public: rotate on abuse, limit them in the provider console. |
| `LELU_ENGINEER_TOKEN` | New. Generate per deployment (`openssl rand -hex 32`) if you enable it; never reuse. |

0 of the 21 are present in this build container, so this proves the code
path, not any particular key. Run `verify-secrets.ts` where the keys live.

---

## 2. Mobile / Chromium verification

**Not run here — blocked, and reported as blocked.** The harness exists and
is now self-sufficient; the container cannot launch a browser:

```
chrome-headless-shell: error while loading shared libraries:
libnspr4.so: cannot open shared object file: No such file or directory
```

No root (`sudo` → `The "no new privileges" flag is set`), no
`apt-get download`, and hand-extracted Debian packages demand
`GLIBC_2.43`, newer than this host.

What was done instead:

- **`scripts/verify-mobile-model-cache.mjs` now creates its own 49 MB
  `.glb`** in `dist/models/` (the model does not exist in the repo), served
  by the runtime's real static handler, and removes it on exit — verified:
  `dist/models` is gone after the run, so nothing large can reach a deploy.
- New checks added: a **replaced model at the same URL is not served
  stale**, it carries a **new ETag**, the **service worker keeps no model
  copy**, and a **refused IndexedDB write fails loudly and succeeds on
  retry** (the recovery path for a paid model).
- **CI job `mobile-model-cache`** runs it on `ubuntu-latest` with
  `bunx playwright install --with-deps chromium`, against
  `PORT=4173 bun run serve`, and uploads `mobile.json` as an artifact.
  Workflow YAML validated.

Protocol-level equivalents verified here against the real runtime:
repeat visits are `304` with 0 bytes; ranges resume; `sw.js` is `no-cache`
(so an installed phone can actually update); avatar art revalidates.

**Until CI runs, the phone-level claims are protocol-verified, not
device-verified.** That includes service-worker update, offline fallback,
IndexedDB persistence and mobile layout.

---

## 3. Final model-storage architecture

Full detail in [MODEL_STORAGE_POLICY.md](MODEL_STORAGE_POLICY.md). The
responsibilities are now explicit:

| Layer | Owns |
|---|---|
| **Meshy CDN** | The authoritative artifact for a job; the download is verified (`<1024` bytes rejected). |
| **IndexedDB** (`lelu-avatar-3d` / `models` / `reconstructed`) | The persisted model across sessions, keyed by a fingerprint of the reference image. |
| **HTTP cache** | One revalidatable copy if a model is ever served from LÉLU's origin. |
| **Service worker** | The app shell only — **models are explicitly excluded**. |

Three fixes make that true:

1. **The service worker no longer caches models.** `isModelAsset()` returns
   early for `.glb`/`.gltf`/`.fbx`/`.bin` and `/models/`. This removes a
   duplicate tens-of-MB copy on the phone, stops a replaced model being
   served stale from Cache Storage, and removes an unhandled `cache.put`
   rejection on quota. Cache name bumped `lelu-v1` → `lelu-v2`, which also
   drops the old cache on activate.
2. **A failed write no longer loses a paid model.**
   `Avatar3DReconstructor.persist()` keeps the record in memory, reports
   `storage: "memory-only"` (a new field on the `succeeded` status), logs
   it, and retries on the next `getModelFor()` / `retryPersist()`. The
   reconstruction resolves usable instead of throwing away bytes that were
   already paid for and downloaded.
3. **A replaced model revalidates.** `/models/*` is served
   `must-revalidate` with a strong `ETag` — never `immutable`.

**Still open before approving `forge-c4c1e9c2` (30 credits):** there is no
recovery after a full storage clear (Meshy CDN URLs expire, so the phone's
bytes are the only copy), and `navigator.storage.persist()` is not
requested, so the model can be evicted silently. Decide whether the server
should keep the downloaded GLB under the owner's account.

---

## 4. Deployment package

New, all of it grounded in the code that exists:

| File | Purpose |
|---|---|
| `deploy/Dockerfile` | Two-stage image: build (`tsc -b && vite build`), runtime (`bun server.ts`). **Deletes `.env`/`.env.local` from the runtime layer** so server secrets cannot be recovered from `docker history`. Non-root user, `HEALTHCHECK` on `/api/env-check`, `STOPSIGNAL SIGTERM`. |
| `deploy/docker-compose.yml` | `lelu` + `caddy`. The app is **not published to the host** — only Caddy reaches it, so the proxy block cannot be bypassed by hitting `:4173`. Secrets via `env_file`. Named volume for state. Log rotation. |
| `deploy/Caddyfile` | Automatic HTTPS, `encode zstd gzip`, ranges and validators forwarded, `flush_interval -1`, 300 s transfer timeouts, `404` for the engineering surface, access log. |
| `deploy/nginx.conf` | Alternative: gzip, explicit `Range`/`If-Range`/`If-None-Match` forwarding, `proxy_buffering off`, same `404` block, explicit warning **not** to add `expires 1y`. |
| `deploy/lelu.service` | Hardened systemd unit: `HOST=127.0.0.1` (loopback only), `NoNewPrivileges`, `ProtectSystem=strict`, narrow `ReadWritePaths`, `Restart=always`, journal logging. |
| `deploy/.dockerignore` | Keeps `.git`, evidence, artifacts and local DBs out of the build context. |
| `docs/CONTABO_DEPLOYMENT.md` | The runbook: prerequisites, secrets, both deployment paths, verification, logs, backup, rollback. |

Deliberate choices worth knowing:

- **Brotli is not in the Caddy config.** Caddy's built-in encoder does gzip
  and zstd; brotli needs a plugin. The nginx file documents the flag if the
  module is present. zstd+gzip cover every modern mobile browser.
- **No blanket cache rule at the proxy.** Adding one would reintroduce the
  bug `82a0cd0` fixed.
- **Root-path hosting only.** The manifest hardcodes absolute `/` paths, so
  a subpath deploy installs a broken PWA.
- **Health checking is real:** the container `HEALTHCHECK` hits
  `/api/env-check`, and compose waits for `service_healthy`.

---

## 5. Exact deployment instructions

```bash
# 0. DNS: A record for lelu.example.com → the VPS IP; ports 80 and 443 open.

# 1. Code
git clone <repo> /opt/lelu && cd /opt/lelu
git checkout <this branch or the merged commit>

# 2. Secrets — server-only, never VITE_
cp env.example .env && chmod 600 .env
#   fill: ANTHROPIC_API_KEY (or VITE_), GROQ_API_KEY, MESHY_API_KEY,
#         NEWS_API_KEY, YOUTUBE_API_KEY, AISSTREAM_API_KEY
#   client-visible (needed BEFORE the build):
#         VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_FIRMS_API_KEY
#   leave LELU_ENGINEER_TOKEN empty — that is the secure default

# 3. Verify before deploying
bun install --frozen-lockfile && bun run build
node scripts/verify-engineer-auth.mjs            # 33/33 expected
PORT=4173 bun server.ts & sleep 3
node scripts/verify-asset-caching.mjs http://127.0.0.1:4173/   # 33/33 expected
kill %1

# 4a. Docker (recommended)
printf 'LELU_HOST=lelu.example.com\nACME_EMAIL=you@example.com\n' >> .env
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps      # both healthy

# 4b. Or native
sudo useradd --system --create-home --home-dir /opt/lelu lelu
sudo chown -R lelu:lelu /opt/lelu
sudo install -o lelu -g lelu -m 600 .env /opt/lelu/.env
sudo cp deploy/lelu.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now lelu
#    Caddy: cp deploy/Caddyfile /etc/caddy/Caddyfile (edit LELU_HOST/ACME_EMAIL)
#    nginx: deploy/nginx.conf + certbot --nginx -d lelu.example.com

# 5. Verify the deployment
curl -s -o /dev/null -w '%{http_code}\n' https://lelu.example.com/api/engineer/status   # 404
curl -sI https://lelu.example.com/sw.js | grep -i cache-control        # no-cache
curl -sI https://lelu.example.com/manifest.webmanifest | grep -i cache-control  # must-revalidate
curl -sI -H 'Accept-Encoding: gzip' https://lelu.example.com/ | grep -i content-encoding  # gzip
journalctl -u lelu -n 5     # must say: engineering API DISABLED
```

Rollback: `git checkout <previous-good-sha>`, `bun install --frozen-lockfile`,
`bun run build`, restart. Because `sw.js` is `no-cache` and everything else
revalidates, an installed phone picks the rollback up on its next load.

---

## 6. Remaining blockers

1. **No browser ran here.** Mobile cache, service-worker update, offline
   fallback, voice/microphone, Cosmos rendering and mobile layout are
   **not device-verified**; they are protocol-verified and wired into CI
   (`mobile-model-cache`, `verify-live-runtime`). Chromium cannot start in
   this image.
2. **No provider connectivity test.** All 21 credentials are absent from
   this environment, so Anthropic/Groq chat, the model broker and the
   knowledge relay could not be exercised end to end — only structurally
   (`verify-providers.ts` contracts, bundle scan, `/api/model/status`).
3. **No migration/backup automation.** The runbook has manual commands;
   there is no cron/timer.
4. **No rate limiting** on `/api/model/*`, `/api/knowledge/relay` or
   `/api/provider-health`. Add it at the proxy if the host is public.
5. **`navigator.storage.persist()` is not requested**, so a stored model
   can be evicted by the OS without warning.
6. **No recovery of a paid model after a full storage clear** (see §3).
7. **Deploy packaging is untested end to end** — Docker/Compose are not
   available in this container, so the image was not built and the stack
   was not started here. The files are grounded in the real runtime and the
   commands are the ones in `package.json`, but they are unproven by
   execution. **Build the image once before trusting it.**

---

## 7. Commit hashes and branch status

Phase 1: `82a0cd0` — production cache policy (33/33 asset-caching checks).
Phase 2: see the commit at the end of this report; branch
`freebuff/b6da3caf29b9fda0e880006b`, **committed locally, not pushed**.

Inherited and preserved: `e7b667b` (`claude/open-session-rbwmdh` at the time
of handoff), SHAMAN + delegation (PRs #6/#7 at `d3645c7`), Forge pipeline,
personality, cognition, avatar rig.

---

## Verification actually run

| Check | Result |
|---|---|
| `bun run typecheck` (`tsc -b --force`) | exit 0 |
| `bun run build` | exit 0 — 2.63 s |
| `bun run lint` | 0 errors, 76 pre-existing warnings |
| `node scripts/verify-engineer-auth.mjs` | **33/33** |
| `node scripts/verify-asset-caching.mjs` | **33/33** |
| `bunx tsx --test tests/companion-mode.test.ts tests/lelu-character.test.ts` | 15/15 pass |
| Full suite (`bun run test`) | **1063/1065 pass.** The 2 failures are the two `tests/self-view.test.ts` cases that launch a real browser: Chromium aborts with `libnspr4.so: cannot open shared object file` (exit 127) before the test body runs. Environment, not this change — the same file passes in CI, which installs Chromium's system libraries. Not weakened or skipped. |
| `scripts/verify-bundle-secrets.ts dist` | all passed — no server token in any built file |
| `scripts/verify-secrets.ts` | 21 declared, 21 wired, 0 present here |
| `node scripts/verify-mobile-model-cache.mjs` | **failed to launch Chromium** (`libnspr4.so`) — not claimed as passing |
| CI workflow YAML | parses (`yaml.safe_load`) |
