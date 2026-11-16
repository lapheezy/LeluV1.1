# LÉLU V1.1 — Contabo deployment runbook (run from a computer that can SSH to the VPS)

Target: `157.173.116.95` (Ubuntu 24.04, 4 vCPU, 8 GB, Docker present, user `lelu`, `/opt/lelu`).
Source: branch `integration/lelu-four-workforce-consolidation` (reviewed; contains every fix below).
Everything here is the repository's own kit (`deploy/contabo/install.sh`); nothing is improvised.

## 0. Decide and gather (cannot be done for you)

| Need | Why | Where it goes |
|---|---|---|
| SSH access as root (or sudo) | run the installer | your terminal — never paste a private key anywhere else |
| A domain, A record → `157.173.116.95` | Caddy obtains the HTTPS certificate; iOS requires HTTPS for the microphone | `LELU_DOMAIN` |
| ACME contact email | Let's Encrypt | `LELU_ACME_EMAIL` |
| **LiveKit: Cloud (recommended)** — project URL, API key, API secret | voice transport from phones; no UDP ports to open on the VPS | `/etc/lelu/lelu.env` |
| *or* LiveKit self-hosted | needs UDP 50000–60000 + TCP 7881 open, a TLS name for it, and often TURN | separate decision; not scripted here |
| A working model account | **every model account tested on 2026-11-14 was spent** (§5) | `/etc/lelu/lelu.env` |
| Supabase URL + publishable key | accounts, conversations, memory | `/etc/lelu/lelu.env` |

Check DNS before starting (must print the VPS address):
```bash
dig +short A your.domain.example      # → 157.173.116.95
```

## 1. Install (first run stops after creating the env file)
```bash
ssh root@157.173.116.95
git clone --branch integration/lelu-four-workforce-consolidation https://github.com/lapheezy/LeluV1.1.git /root/lelu-src
cd /root/lelu-src/deploy/contabo
LELU_DOMAIN=your.domain.example LELU_ACME_EMAIL=you@example.com LELU_VOICE=1 bash install.sh
```
What it does first, before changing anything: prints what exists (user, `/opt/lelu`, Docker network,
Postgres/Redis volumes — reported, **never touched**; LÉLU does not use them) and writes a backup of
`/opt/lelu`, `/etc/lelu`, the Caddyfile and unit to `/root/lelu-preinstall/` (mode 600).

## 2. Fill the environment (no secret ever goes into git)
```bash
nano /etc/lelu/lelu.env        # root:lelu 0640
```
Required: `LELU_ACCESS_PASSWORD`, at least one funded model key (`GROQ_API_KEY` leads),
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and for voice `LIVEKIT_URL`, `LIVEKIT_PUBLIC_URL`
(both `wss://<project>.livekit.cloud` for Cloud), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`LELU_VOICE_AGENT_TOKEN` (`openssl rand -hex 32`). Leave as shipped: `LELU_ENABLE_ANTHROPIC=false`,
`DEFAULT_PROVIDER=groq`, `VOXCPM_BASE_URL=http://127.0.0.1:8789`. Never set `ANTHROPIC_BASE_URL`
or `LELU_LIVEKIT_DEV_IDENTITY`.

## 3. Finish the install
```bash
cd /root/lelu-src/deploy/contabo
LELU_DOMAIN=your.domain.example LELU_ACME_EMAIL=you@example.com LELU_VOICE=1 bash install.sh
```
Builds the app on the VPS, installs `lelu`, `lelu-moss`, `lelu-voice-agent`, backup + health timers,
Caddy, `lelu-verify`. The MOSS install downloads ~1.6 GB (code + weights, anonymous).

## 4. Prove it
```bash
LELU_DOMAIN=your.domain.example lelu-verify | tee /root/lelu-verify.txt
systemctl restart lelu && sleep 5 && curl -fsS 127.0.0.1:4173/healthz          # app restart
systemctl restart lelu-moss && sleep 60 && curl -s 127.0.0.1:8789/health | jq .state   # worker restart → READY
journalctl -u lelu -u lelu-moss -u lelu-voice-agent --since -15min --no-pager | tail -50
```
Send back `/root/lelu-verify.txt` (it contains no secret values).

## 5. Model accounts (state on 2026-11-14, from live requests)
| Provider | State |
|---|---|
| Groq | daily token quota spent (`200000/day`, rolling 24 h) — recovers on its own |
| OpenRouter | key credit limit spent (last request: affordable 1,071 tokens, then offline) |
| Cerebras | key rejected (401) |
| Fireworks | account suspended (billing) |
| Anthropic | no credit; disabled by policy (not authorized) |
Without at least one funded provider LÉLU answers in offline mode; voice still listens and speaks.

## 6. iPhone acceptance (on the deployed HTTPS domain)
1. Safari → `https://your.domain.example`, sign in with `LELU_ACCESS_PASSWORD`, continue as guest or sign in.
2. Chat: ask a question → streamed answer.
3. Tap the composer mic ("Talk to LÉLU") → allow microphone → dock shows **Connected**.
4. Ask "What is the capital of France?" → transcript appears → she answers aloud.
5. Ask for a long story; tap **Stop** mid-sentence → silence within ~0.2 s.
6. Ask again and talk over her → she stops (barge-in) and answers the new question.
7. Toggle airplane mode for 10 s → session shows rejoining → returns to Connected by itself.
8. On the server `systemctl restart lelu-moss`; within ~1 min she speaks again.
9. End voice → type "what did I ask you by voice?" → answered from the same conversation.
10. Lock and unlock the phone mid-session; check audio resumes (or "Enable audio" appears).
