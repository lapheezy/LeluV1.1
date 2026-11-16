# LÉLU voice in production: where each piece runs

**Status: designed and unit-checked. NOT DEPLOYED, NOT TESTED on a host.** The development container
has no SSH or API access to the Contabo VPS, so none of this has run there.

## Topology

```
iPhone (Safari) ── HTTPS ──▶ Caddy ──▶ lelu.service (bun server.ts, :4173)          ┐
      │                                   ├─ POST /api/livekit/token  (Supabase id)   │ Contabo VPS 4
      │                                   ├─ /api/model/* broker, /api/voice/vox/*    │ 4 vCPU / 8 GB
      └── WSS/WebRTC ──▶ LiveKit ◀────────┴─ lelu-voice-agent.service (:8790, loopback) ┘
                          (Cloud, or self-hosted)          │  speech: /api/voice/vox/speech
                                                           ▼
                                   lelu-voxcpm.service on a SEPARATE host (≥16 GB RAM or GPU),
                                   reached through an authenticated tunnel (VOXCPM_TOKEN)
```

## Why the speech worker cannot run on the VPS

Loading VoxCPM2 on CPU peaks at about 11 GiB of RAM and settles at about 6.6 GiB. That was
measured over seven loads; see `WORKER-RESOURCE-RECOVERY-REPORT.md`. The Contabo VPS 4 has 8 GB of
RAM in total. Neither quantising the model nor swapping it out was approved. The worker therefore
needs its own host:

| Host | Expected | Notes |
|---|---|---|
| GPU, ≥ 12 GB VRAM | faster than real time (upstream claim, **unmeasured** here) | set `LELU_AGENT_PLAYBACK=stream` |
| CPU, ≥ 16 GB RAM, AVX512-BF16/AMX | RTF 4–5 (measured) | a sentence takes 4–5× its own length to synthesise |

## LiveKit: Cloud or self-hosted

- **LiveKit Cloud** is the fastest route to a working connection from an iPhone. It handles TURN and
  TLS, and there are no UDP ports to open on the VPS. Set `LIVEKIT_URL=wss://<project>.livekit.cloud`
  plus the key and secret.
- **Self-hosted** `livekit-server` 1.13.11 was built from source and verified in the development
  container (loopback only). On the VPS it needs:
  - a public domain with TLS for `wss://`;
  - UDP 50000–60000, or one UDP mux port;
  - TCP 7881;
  - TURN/TLS on 443 for networks that block UDP.

## Environment (names only; server-side, never `VITE_`)

`/etc/lelu/lelu.env` (VPS):

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_PUBLIC_URL` (if it differs from `LIVEKIT_URL`)
- `LELU_VOICE_AGENT_TOKEN`
- `VOXCPM_BASE_URL`
- `VOXCPM_TOKEN`
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, which the token endpoint uses to verify
  the user

**Never set `LELU_LIVEKIT_DEV_IDENTITY` in production.** It is ignored anyway unless both LiveKit
URLs are loopback and `NODE_ENV` is not `production`.

`/etc/lelu/voxcpm.env` (worker host): `VOXCPM_TOKEN`.

## Health, restart, reboot

| Service | Health | Restart | On reboot |
|---|---|---|---|
| `lelu` | `curl :4173/healthz` | `Restart=always` + `lelu-health.timer` | enabled |
| `lelu-voice-agent` | `curl :8790/health` | `Restart=always` | enabled |
| `lelu-voxcpm` | `curl :8788/health` → `state: READY` | `Restart=on-failure`; independent of LÉLU CORE | enabled |

The app keeps working while the worker restarts. The pool reports `no-ready-worker` with the reason
(LOADING / INITIALIZING), and the agent reports a TTS error instead of claiming she spoke.
