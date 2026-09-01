# LÉLU — Environment Configuration Contract

This file documents every environment variable LÉLU reads at runtime.
It exists so the configuration contract is preserved in the versioned
repo even if `.env` itself is ever recreated.

> **Important:** the real `.env` file lives in the workspace root and is
> preserved by the workspace sync. It is **not** ignored by `.gitignore`
> or `.git/info/exclude`, so it is carried with the workspace snapshot.
> Never commit a real `.env` containing secrets to a public repository.
> For platform-managed secrets, paste values into the **Keys / API keys**
> tab instead of `.env`.

## AI chat providers (fallback priority order) — **server-side only**

> **These moved.** They used to be `VITE_`-prefixed and were therefore
> compiled into the client bundle: a build with canary values put two
> provider keys into 11 separate chunks of `dist/assets/`, readable by
> anyone who loaded the page. They are now read by the server and reach
> their upstream through the same-origin relay
> (`plugins/aiProxyApi.ts` → `src/providers/aiRelay.ts`), so no chat
> credential ever enters the browser.
>
> Set them **without** the `VITE_` prefix. The `VITE_` spelling is still
> accepted by the relay so an existing `.env` keeps working, but it is no
> longer the documented place for them and it is not read by client code.
>
> `scripts/verify-bundle-secrets.ts` builds with canaries and fails if any
> of these reappear in `dist/`; `scripts/verify-live-runtime.mjs` proves
> the same thing from inside a real browser.

| Variable | Role | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude (Anthropic) — **primary** provider | yes |
| `GROQ_API_KEY` | Groq — fallback #1 | yes |
| `OPENROUTER_API_KEY` | OpenRouter — fallback #2 | yes |
| `CEREBRAS_API_KEY` | Cerebras — fallback #3 | yes |
| `MISTRAL_API_KEY` | Mistral — fallback #4 | yes |
| `FIREWORKS_API_KEY` | Fireworks AI — fallback #5 | yes |
| `GITHUB_MODELS_TOKEN` | GitHub Models — fallback #6 | yes |

`GROQ_API_KEY` also serves voice transcription (Groq Whisper), which
relays through the same endpoint — see `POST /api/ai/relay-raw`.

Claude uses the Messages API (`POST /v1/messages`), which authenticates
with `x-api-key` rather than a bearer token and takes its system prompt
as a top-level field — `src/providers/AnthropicProvider.ts` translates
LÉLU's OpenAI-shaped request into that format. `VITE_ANTHROPIC_MODEL`
overrides the model (default `claude-opus-5`).

**Deliberately NOT read:** a bare `API_KEY`. That name is generic, and in
a Claude Code environment it holds the *agent's own* Anthropic
credential — adopting it would spend someone else's quota and make the
provider report itself configured when nothing was set for LÉLU. Use
`ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`).

**Deliberately NOT read:** a bare `GITHUB_TOKEN` / `GITHUB_CODESPACE_TOKEN`.
Dev containers, Codespaces and CI runners set those for git tooling, and
adopting one makes GitHub Models falsely report itself configured (and
would spend a repo-scoped token against an unrelated inference API).
Only `GITHUB_MODELS_TOKEN` counts.

### Model overrides (browser-safe — names, not credentials)

| Variable | Role | Required |
|---|---|---|
| `VITE_ANTHROPIC_MODEL` | Claude model override (default `claude-opus-5`) | no |
| `VITE_GROQ_MODEL` | Groq model override | no |
| `VITE_OPENROUTER_MODEL` | OpenRouter model override | no |
| `VITE_CEREBRAS_MODEL` | Cerebras model override | no |
| `VITE_MISTRAL_MODEL` | Mistral model override | no |
| `VITE_FIREWORKS_MODEL` | Fireworks model override | no |
| `VITE_GITHUB_MODEL` | GitHub Models model override | no |
| `VITE_AI_PROXY_BASE_URL` | Custom AI proxy for GitHub Models (bypasses the relay) | no |

#### Reaching Claude without an Anthropic key

`ANTHROPIC_API_KEY` is the direct path, but it is not the only one.
OpenRouter resells the Anthropic models, so a working
`OPENROUTER_API_KEY` already reaches Claude — set the model and the
existing fallback chain does the rest:

```
VITE_OPENROUTER_MODEL=anthropic/claude-haiku-4.5
```

This is a model NAME, not a credential: it is safe in `.env`, in the
client bundle, and in version control. Verified live —
`scripts/verify-live-runtime.mjs` records the model on every relay call,
and a real browser turn produced
`groq (openai/gpt-oss-120b) → openrouter (anthropic/claude-haiku-4.5)`.

Two caveats. `openrouter/free` is the default precisely because it is
free; the Anthropic models bill against the OpenRouter account. And this
routes Claude through a reseller, so it is a fallback for when the direct
credential cannot be delivered, not a replacement for one.

### The relay endpoints

Mounted by every runtime that serves the app (Vite dev/preview,
`server.ts`, `main.ts`) — the same way `/api/engineer/*` is:

- `GET  /api/ai/providers` — which providers the server holds a credential
  for. **Booleans only** — never a value, a prefix, or a length.
- `POST /api/ai/relay` — JSON chat completions, forwarded to an
  allowlisted upstream with the server's `Authorization`.
- `POST /api/ai/relay-raw` — the same for a multipart body (voice
  transcription), forwarded byte-for-byte.

All three refuse an unknown provider id, a path outside that provider's
own prefix, and a cross-origin POST; a client-supplied `Authorization`
is dropped, never forwarded.

## Knowledge / research providers

> **Still browser-side.** These services are called directly from the
> browser today, so their keys are still compiled into the bundle. That
> is a real, narrower exposure than the chat keys were — stated here
> rather than glossed over. Routing them through the relay the way the
> chat providers now are is the follow-up that closes it.

| Variable | Role | Required |
|---|---|---|
| `VITE_NEWS_API_KEY` | NewsAPI.org — current news lookups | yes |
| `VITE_YOUTUBE_API_KEY` | YouTube Data API v3 — video lookups | yes |
| `VITE_GITHUB_TOKEN` | GitHub repo access tool (not GitHub Models) | no |

## Earth Core providers (optional — the layer reports its real status without them)

| Variable | Role | Where it lives | Required |
|---|---|---|---|
| `VITE_FIRMS_API_KEY` | NASA FIRMS — live fire detection layer (MAP_KEY) | client (browser) | no |
| `AISSTREAM_API_KEY` | AISStream — live vessel positions layer | **server only** — never `VITE_`, never in client code | no |
| `VITE_EARTH_VESSELS_ENDPOINT` | Optional custom REST endpoint for vessel positions (must keep the key server-side too) | client (URL only, no key) | no |

**Vessels are served by a server-side bridge** (`plugins/aisBridgePlugin.ts`):
the AISStream key is read by the server process (Vite dev/preview,
the standalone runtime server `server.ts`, or the Deno entry `main.ts`),
the WebSocket connection (`wss://stream.aisstream.io/v0/stream`) is owned
server-side, and the browser only polls same-origin
`GET /api/ais/vessels?bbox=west,south,east,north` and
`GET /api/ais/status` — the key is never in the bundle, logs, URLs or
state. The layer reports `NOT CONFIGURED` / `AUTH FAILED` / `RATE
LIMITED` / `DISCONNECTED` honestly from the bridge.

## Engineering runtime (server-backed, not a static dead end)

LÉLU's self-development workflow (inspect source, run typecheck/tests/
builds, write verified candidates, roll back) runs through the
**engineering runtime** — the same middleware is mounted by every
runtime that serves the app:

| Runtime | How to start | `/api/engineer/*` availability |
|---|---|---|
| Vite dev server | `bun run dev` | ✅ (`vite-dev`) |
| Vite preview server | `bun run preview` | ✅ (`vite-dev`) |
| Standalone Node/Bun runtime | `bun run build && bun run serve` | ✅ (`node-server`) — serves `dist/` + APIs on `0.0.0.0:${PORT:-4173}` |
| Deno production entry | `deno run --allow-net --allow-read --allow-write --allow-run main.ts` | ✅ (`deno`) |
| Static-only hosting (e.g. GitHub Pages) | — | ❌ the app honestly reports `STATIC-ONLY` |

Endpoints (all same-origin, no credentials):

- `GET /api/engineer/status` — runtime report (`runtime`, `operations`, `tokenRequired`)
- `POST /api/engineer/command` — `{ operation }`; **whitelisted** to
  `typecheck` (`bun tsc -b --noEmit`), `test` (`bun test`),
  `build` (`bun run build`), `inspect` (`node --version && bun --version && pwd`).
  A raw `command` string is accepted only when it matches a whitelist
  entry exactly. The server never runs arbitrary shell input.
- `POST /api/engineer/read` — `{ path }`, workspace-root-bounded
- `POST /api/engineer/write` — `{ path, content }`, workspace-root-bounded

Safety model: command whitelist + workspace path boundary + origin
guard (cross-origin POSTs rejected) + optional `LELU_ENGINEER_TOKEN`
(when set, POSTs must carry `x-lelu-token`; the app reports
`token required` honestly if it is missing).

Fires are real NASA VIIRS NRT hotspots via the FIRMS area CSV API
(bbox-bounded around the camera focus, with acquisition timestamps,
confidence, brightness and fire radiative power preserved).

Key-less Earth layers that work out of the box: aircraft (adsb.lol),
satellites (CelesTrak TLEs — positions labeled ESTIMATED), earthquakes
(USGS), weather (Open-Meteo), place search / reverse geocoding
(Open-Meteo), and terrain (Mapzen Terrarium via the existing GeoPipeline).

## Providers that need no key

Wikipedia, Wikidata, Wikimedia, GDELT, OpenMeteo, Hacker News, NASA,
arXiv, CrossRef, OpenAlex, OpenStreetMap/Nominatim, and RSS.

## Env-file loading boundary (how the runtimes read the files)

The project's environment lives in `.env` (base) and `.env.local`
(overrides — both gitignored). Every runtime must resolve the SAME
value, so loading is deterministic:

| Runtime | Loader | Precedence |
|---|---|---|
| Vite dev/preview | Vite `loadEnv(mode, cwd, "")` | process env → `.env.local` → `.env` |
| Standalone server (`server.ts`) | `plugins/loadEnvFiles.ts` → `process.env` | process env → `.env.local` → `.env` |
| Deno entry (`main.ts`) | `plugins/loadEnvFiles.ts` → merged `Deno.env` lookup | `Deno.env` → `.env.local` → `.env` |

Rules implemented by `plugins/loadEnvFiles.ts`:

- A key already present in the process/platform env is **never
  overwritten** — deployment platforms that inject secrets keep working.
- `.env.local` overrides `.env` when both define a key (Vite's
  convention, mirrored by the shared loader).
- `KEY=VALUE` lines with optional `export ` prefix and surrounding
  quotes are parsed; comments and blanks are skipped.
- The startup log reports only key names and `SET`/`absent` — never
  values.

`GET /api/env-check` reports presence (length, never the value) for
`VITE_GROQ_API_KEY`, `VITE_OPENROUTER_API_KEY`, `VITE_FIRMS_API_KEY`
and `AISSTREAM_API_KEY`. `GET /api/provider-health` runs live probes:
Groq/OpenRouter chat completions, a real NASA FIRMS hotspot fetch
(hotspot count, not the key), and the AIS bridge's actual state
(configured / connected / vesselCount).

## Security rules

- Every `VITE_` variable is readable from the browser bundle — use only
  public-facing client credentials there.
- Server-only secrets must never be prefixed with `VITE_` and must stay
  out of frontend code.
- Never hardcode keys, log secret values, or return credentials through
  API responses.
