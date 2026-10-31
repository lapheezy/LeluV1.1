# Deploying LÉLU V1.1 on the Contabo Cloud VPS 4

Target: Ubuntu 24.04 LTS, 4 vCPU, 8 GB RAM, 100 GB disk, x86_64, EU. There's no GPU and none is
needed: Anthropic does the reasoning remotely, and no local models are loaded.

```
iPhone Safari ──HTTPS──▶ Caddy :443 (Let's Encrypt, HSTS, gzip/zstd, SSE streaming)
                           │
                           ▼ 127.0.0.1:4173
                 lelu.service: bun run server.ts
                   • owner access gate (LELU_ACCESS_PASSWORD → session cookie)
                   • dist/ (vite build) with SPA fallback
                   • /api/model/*  broker: Anthropic primary, fallbacks; keys stay here
                   • /api/engineer/*, /api/forge/*, /api/github/*, /api/env-check, …
                   • /healthz
                           │
                           ├── Supabase (conversations, memory, personality records)
                           └── leluverse/assets (Forge ledger, models, Cosmos state)
```

This is the architecture already in the repo. `server.ts` serves the build and every API the Vite
dev server provides. Nothing here depends on the dev server or a Codespace.

## 1. Before you start

- A domain or subdomain with an **A record pointing at the VPS IP**, for example
  `lelu.yourdomain.com`. Let's Encrypt needs this before Caddy can get a certificate.
- SSH access as root (or a sudo user) to the VPS.
- Your provider keys. The names are below; never paste values into git.

## 2. Install (one command, run twice)

```bash
ssh root@<vps-ip>
apt-get update && apt-get install -y git
git clone --branch claude/avatar-3d-world https://github.com/lapheezy/LeluV1.1.git /root/lelu-src
cd /root/lelu-src/deploy/contabo
LELU_DOMAIN=lelu.yourdomain.com LELU_ACME_EMAIL=you@example.com bash install.sh
```

The first run installs the system packages and sets up:
- the firewall: ufw allows only 22/80/443;
- fail2ban;
- a `lelu` service user;
- Bun and Node 22;
- the checkout under `/opt/lelu/app`.

It then creates `/etc/lelu/lelu.env` from the template (with a random `LELU_SESSION_SECRET`) and
**stops**. Fill that file in:

```bash
nano /etc/lelu/lelu.env      # set LELU_ACCESS_PASSWORD + provider keys
bash install.sh              # same command again: builds, starts, enables HTTPS
```

The second run:
- runs `bun install --frozen-lockfile`;
- runs the production build (`tsc -b && vite build`), which must succeed;
- installs and starts `lelu.service` and the backup and health timers;
- makes the journal persistent (capped at 1 GB);
- installs Caddy with your domain and checks `/healthz`.

It refuses to finish if `LELU_ACCESS_PASSWORD` is empty, so LÉLU is never public without the gate.

Open `https://lelu.yourdomain.com` on the iPhone, enter the passphrase, then use Share → **Add to
Home Screen**. The session cookie lasts 30 days per device.

## 3. Environment variables (names only)

`/etc/lelu/lelu.env`, owned `root:lelu`, mode 0640. Template: `deploy/contabo/lelu.env.example`.

| Purpose | Variables |
|---|---|
| Access (required) | `LELU_ACCESS_PASSWORD`, `LELU_SESSION_SECRET`, `LELU_SESSION_DAYS` |
| Engineering API (optional 2nd factor) | `LELU_ENGINEER_TOKEN` |
| Anthropic (primary) | `LELU_ANTHROPIC_API_KEY` (or `ANTHROPIC_API_KEY`), optional `ANTHROPIC_MODEL` |
| Fallback chat providers | `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `FIREWORKS_API_KEY`, `GITHUB_MODELS_TOKEN`, `GEMINI_API_KEY` |
| GitHub relay | `GITHUB_TOKEN` |
| Supabase (public by design, protected by RLS) | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` |
| Voice | speech-to-text uses `GROQ_API_KEY` (Whisper); see "Voice" below |
| 3D Forge | `MESHY_API_KEY`, optional `LELU_BLENDER_PYTHON` |
| Optional data feeds | `AISSTREAM_API_KEY`, `NEWS_API_KEY`, `YOUTUBE_API_KEY`, `GEOAPIFY_API_KEY`, `GUARDIAN_API_KEY`, `NEWSDATA_API_KEY`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID` |

Set by the unit, not by you: `HOST=127.0.0.1`, `PORT=4173`, `NODE_ENV=production`.

Secrets and the browser:
- No provider credential is compiled into the bundle. `scripts/verify-bundle-secrets.ts` checks this
  with canaries against a real build; it was also checked against the live keys.
- The served page receives only public values (Supabase URL and publishable key) and the optional
  data-feed keys listed above. Behind the gate, only the signed-in owner's browser gets them.

## 4. Operating it

| Task | Command |
|---|---|
| Status | `systemctl status lelu` · `curl -s localhost:4173/healthz` |
| Live logs | `journalctl -u lelu -f` (kept across reboots) |
| Health warnings | `journalctl -t lelu-health` |
| Restart | `systemctl restart lelu` (in-flight requests finish first, max 10 s) |
| Update | `sudo lelu-update` (latest of the branch) or `sudo lelu-update <commit>` |
| Backup now | `sudo lelu-backup` |
| Proxy logs | `/var/log/caddy/lelu-access.log` |

**Recovery behaviour**

| Event | What happens |
|---|---|
| Reboot | `lelu.service` and `caddy` start automatically (`WantedBy=multi-user.target`). |
| Crash | systemd restarts the app after 3 s (`Restart=always`). |
| Hang (alive but not answering) | `lelu-health.timer` probes `/healthz` every minute and restarts after 3 failures. |
| Memory runaway | `MemoryHigh=2G` throttles; `MemoryMax=3G` kills, and systemd restarts it. |
| Bad update | `lelu-update` builds into `dist.next` while the old build keeps serving. If the new process isn't healthy within 60 s, the previous commit and build are restored. |

**Conversation state across restarts and updates.** Conversations, memory and personality
records live in Supabase and the browser; the server holds none of them in RAM. A restart takes
about 3 seconds and the phone simply reconnects. Server-side state (the Forge ledger, character
models, Cosmos world and avatar state) lives on disk under `/opt/lelu/app/leluverse/assets`.
Updates never touch it, and it's backed up before every update.

## 5. Backups and restore

Backups run daily at about 03:17 and before every update, into `/opt/lelu/backups` (newest 14
kept). Each archive contains:
- `leluverse/assets`;
- the engineering workspace, if present;
- `/etc/lelu/lelu.env`;
- the Caddyfile.

Copy them off the machine regularly:

```bash
rsync -a root@<vps-ip>:/opt/lelu/backups/ ~/lelu-backups/
```

Restore:

```bash
sudo systemctl stop lelu
sudo tar --zstd -xpf /opt/lelu/backups/lelu-YYYYmmdd-HHMMSS.tar.zst -C /
sudo systemctl start lelu
```

Supabase data is backed up by Supabase (project settings → Database → Backups).

## 6. Resource use on 4 vCPU / 8 GB

- The app normally runs well under 1 GB RSS. `/healthz` reports `rssMb` and `heapMb`, and the
  watchdog logs a warning above 2 GB.
- No local AI models are loaded. Local-model probing only happens when the app is opened on
  `localhost`, never from the VPS.
- The server never starts a browser. Playwright and Chromium are only needed to run the repo's
  browser tests (`npx playwright install --with-deps chromium`); they aren't needed to serve LÉLU.
- Blender (`bpy`) is optional, for the 3D Forge stages. Install it into its own venv only if you
  want those stages on the VPS; each run uses up to ~2 GB for a minute or two.
- `CPUQuota=300%` leaves a core for Caddy and SSH even if the app is busy.

## 7. Security checklist

- [x] The firewall allows only 22/80/443; the app listens on 127.0.0.1 only.
- [x] HTTPS with HSTS via Caddy (automatic certificate renewal).
- [x] Owner gate: every page and API needs the session. Login is rate-limited (5 attempts per
      minute per IP) and compared in constant time; the cookie is HttpOnly, Secure and
      SameSite=Lax.
- [x] Cross-origin writes are refused (origin guard), so other websites can't drive the APIs.
- [x] The engineering API is behind the gate, uses a command whitelist and stays inside the
      workspace. `LELU_ENGINEER_TOKEN` can add a second factor.
- [x] The model broker is rate-limited per IP; provider keys stay on the server.
- [x] Request and header timeouts are bounded; Caddy caps request bodies at 64 MB.
- [x] fail2ban protects SSH.
- [ ] Recommended: SSH key-only login (`PasswordAuthentication no` in `/etc/ssh/sshd_config`).
