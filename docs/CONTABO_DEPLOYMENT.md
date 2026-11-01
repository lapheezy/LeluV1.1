# LÉLU V1.1 — Contabo deployment runbook

Everything here is grounded in what the code actually does. Where a step
depends on something I could not verify from the build container, it says
so instead of guessing.

> **One requirement before anything else:** LÉLU must be served at the
> **root of a domain** (`https://lelu.example.com/`), not under a subpath.
> `public/manifest.webmanifest` hardcodes `id`, `start_url`, `scope` and
> the icon paths as absolute `/…`, and `vite.config.ts` sets `base: "/"`.
> A subpath deploy installs a PWA whose links point at the domain root.
> The GitHub Pages workflow builds `--base=/<repo>/`, which the manifest
> does not follow — that path does not produce a working PWA.

---

## 1. What you need

| Requirement | Why |
|---|---|
| A Contabo VPS (VPS S or larger: 8 GB RAM recommended) | `vite build` and `tsc -b` are memory-hungry; the runtime itself idles at ~40 MB. |
| A domain with an A/AAAA record → the VPS IP | TLS, the service worker, microphone and clipboard all require a secure context. |
| Ports 80 and 443 open | Only these two are public. The app itself is never published. |
| Docker + Compose plugin, **or** Bun 1.4+ and systemd | Pick one path in §4. |

The app does not need a database, a Codespace, or a CI runner to operate.
`dist/` plus the Bun runtime is the whole system.

---

## 2. Secrets

Server-only values go in `/opt/lelu/.env` (native) or `.env` at the repo
root (Compose), with `chmod 600` and owned by the service user.

```bash
# never here: VITE_ prefix on a paid key
ANTHROPIC_API_KEY=…       # or VITE_ANTHROPIC_API_KEY if the platform strips the plain name
GROQ_API_KEY=…
MESHY_API_KEY=…           # paid — server only
NEWS_API_KEY=…
YOUTUBE_API_KEY=…
AISSTREAM_API_KEY=…       # the AIS bridge owns the socket server-side
```

Client-visible values must be present **before** `bun run build`, because
Vite inlines `VITE_*` into the bundle: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_FIRMS_API_KEY`, model names, and
`VITE_NEKO_URL`. Changing one of those requires a rebuild, not a restart.

**Leave `LELU_ENGINEER_TOKEN` unset.** That is the correct production
state: it reads source, runs whitelisted commands, spawns preview servers
and drives a headless browser. Unset ⇒ every one of those routes answers
`503` (fail-closed). Only set it (plus `VITE_LELU_ENGINEER_TOKEN` at build
time) if you deliberately want self-development on the server, and then
also remove the proxy block in §5.

Never put a real `.env` in git. `.gitignore` covers `.env` and
`.env.local`; the Docker build deletes them from the runtime layer so a
`docker history` cannot surface them.

---

## 3. Build and verify locally first

```bash
git clone <repo> /opt/lelu && cd /opt/lelu
bun install --frozen-lockfile
bun run build                    # tsc -b && vite build
bun run typecheck
bun run lint

# The runtime's own serving contract, 33 checks
PORT=4173 bun server.ts &
node scripts/verify-asset-caching.mjs http://127.0.0.1:4173/

# The authorization gate, 33 checks (spawns its own servers)
node scripts/verify-engineer-auth.mjs
```

Do not continue if any of those fail — they are the checks that caught
the caching and access-control bugs this version fixes.

---

## 4a. Deploy with Docker (recommended)

```bash
cd /opt/lelu
export LELU_HOST=lelu.example.com
export ACME_EMAIL=you@example.com
# put LELU_HOST/ACME_EMAIL in .env too, they are read from it
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps
```

What the stack does:

- `lelu` builds the image from `deploy/Dockerfile`, runs `bun server.ts` on
  `4173`, and is **not published to the host** — only Caddy reaches it.
- `caddy` obtains and renews the certificate, compresses text (zstd+gzip),
  and forwards ranges and validators untouched.
- `lelu-data` is a named volume for state that must outlive a container.

## 4b. Deploy natively (systemd)

```bash
sudo useradd --system --create-home --home-dir /opt/lelu lelu
sudo chown -R lelu:lelu /opt/lelu
sudo install -o lelu -g lelu -m 600 .env /opt/lelu/.env

# build as lelu, then install the unit
sudo -u lelu bash -lc 'cd /opt/lelu && bun install --frozen-lockfile && bun run build'
sudo cp deploy/lelu.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lelu
systemctl status lelu --no-pager
journalctl -u lelu -f
```

The unit binds the runtime to `127.0.0.1` only (`HOST=127.0.0.1`), so the
proxy is the only way in. It also sets `NoNewPrivileges`,
`ProtectSystem=strict` and a narrow `ReadWritePaths`.

Reverse proxy: use `deploy/Caddyfile` with Caddy, or `deploy/nginx.conf`
with nginx + certbot.

---

## 5. The proxy is the second security boundary

The runtime already fails closed with no token. The proxy adds an
independent refusal, so a future misconfiguration cannot expose the
engineering surface:

| Path | At the proxy |
|---|---|
| `/api/engineer/*` | `404` (not `403` — do not confirm the endpoints exist) |
| `/api/browser/capture` | `404` |

Both files contain this block. Remove it **only** when you have
deliberately enabled self-development and set the token.

Also keep in mind (documented, not fixed):

- `/api/model/*` is the server-side broker for the owner's AI keys. Any
  visitor to the site can spend the owner's provider credits through it —
  that is the app's design (a public LÉLU uses the owner's keys). Put a
  rate limit at the proxy if that is not what you want.
- `/api/knowledge/relay` adds `MESHY_API_KEY` server-side, and Meshy is
  paid. Same consideration.
- `/api/provider-health` runs live provider probes on every call; it is
  cheap but not free.

---

## 6. Verify the deployment

```bash
# TLS + certificate
curl -sI https://lelu.example.com | head -5

# The engineering surface must be gone
curl -s -o /dev/null -w '%{http_code}\n' https://lelu.example.com/api/engineer/status   # 404
curl -s -o /dev/null -w '%{http_code}\n' https://lelu.example.com/api/browser/capture    # 404

# Caching policy, as a phone sees it
curl -sI https://lelu.example.com/sw.js | grep -i cache-control        # no-cache
curl -sI https://lelu.example.com/manifest.webmanifest | grep -i cache-control  # must-revalidate
curl -sI https://lelu.example.com/ | grep -iE 'etag|cache-control'     # etag + no-cache

# A conditional request must be 304, not a full body
ETAG=$(curl -sI https://lelu.example.com/manifest.webmanifest | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" https://lelu.example.com/manifest.webmanifest   # 304

# Compression
curl -sI -H 'Accept-Encoding: gzip' https://lelu.example.com/ | grep -i content-encoding   # gzip

# Health
curl -s https://lelu.example.com/api/env-check        # presence only, never values
curl -s https://lelu.example.com/api/model/status     # booleans only
```

Then in a real browser, on a phone:

1. Load the site over HTTPS; the install prompt appears (secure context).
2. Reload; DevTools → Network shows `304`s, not fresh downloads.
3. Airplane mode + reload → the shell still renders.
4. Deploy a change, reload twice → the new service worker activates
   (`sw.js` is `no-cache`, so the phone always checks).

**These browser steps are the ones this build container could not run**
(no root, no Chromium system libraries). CI job `mobile-model-cache` runs
the equivalent automatically; the first real-device run is yours.

---

## 7. Logs

| Where | What |
|---|---|
| `journalctl -u lelu -f` (native) | Runtime stdout: the env-key summary (`SET`/`absent`, never values), the engineering-API state, and provider warnings. |
| `docker compose logs -f lelu` | The same, from the container. |
| `/data/access.log` (Caddy) or `/var/log/nginx/lelu.access.log` | Requests, statuses, bytes. |
| `docker compose ps` | Health from the container `HEALTHCHECK`. |

The startup line is worth reading every time:

```
[LÉLU runtime] serving /app/dist on http://0.0.0.0:4173 — engineering API DISABLED …
```

If it says `token required` on a public host, something set
`LELU_ENGINEER_TOKEN`. That is the one line to check after any redeploy.

---

## 8. Backup

State that matters (small — the app itself is reproducible from git):

```bash
# native
sudo tar czf /var/backups/lelu-$(date +%F).tar.gz \
  -C /opt/lelu data .env

# docker
docker run --rm -v lelu_lelu-data:/data -v /var/backups:/backup alpine \
  tar czf /backup/lelu-data-$(date +%F).tar.gz -C /data .
```

`data/` holds the forge ledger (`awaiting_approval` jobs, their credits
and history) and generated artifacts. `.env` holds the secrets — encrypt
or store it in a password manager, not in git.

Back up `caddy-data` if you want to keep the issued certificate and avoid
re-issuing on restore (`/var/lib/docker/volumes/...`).

Browser-side models are **not** covered by a server backup: the bytes live
in the user's IndexedDB. See [MODEL_STORAGE_POLICY.md](MODEL_STORAGE_POLICY.md).

---

## 9. Rollback

The deploy is a git checkout plus a build, so rollback is a commit:

```bash
cd /opt/lelu
git fetch --all && git log --oneline -5
git checkout <previous-good-sha>
bun install --frozen-lockfile
bun run build
sudo systemctl restart lelu          # or: docker compose -f deploy/docker-compose.yml up -d --build
```

Because `sw.js` is served `no-cache` and every other non-hashed asset
revalidates, a phone picks the rollback up on its next load. That is the
whole point of the cache-policy change — before it, a rolling back deploy
would never have reached an installed phone.

If a rollback must be immediate and the proxy is healthy, Caddy/nginx can
serve a static maintenance page while you rebuild. Do not roll back by
deleting `data/`: the forge ledger is the record of what was spent.

---

## 10. Known gaps in this package

| Gap | Consequence |
|---|---|
| No automated browser verification ran in the build container | The service-worker and phone-layout claims rest on CI job `mobile-model-cache` and the protocol-level checks. Not claimed as device-tested. |
| No rate limiting in the app | `/api/model/*`, `/api/knowledge/relay` and `/api/provider-health` can be called by any visitor; add a proxy limit if that matters. |
| No CI job deploys to the VPS | Deployment is the manual sequence above; there is no push-to-deploy. |
| Backup is manual | Add a cron/timer around the §8 commands. |
