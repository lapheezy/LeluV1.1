# Key rotation — Geoapify, Guardian, NewsData

**Status: PREPARED, NOT ROTATED.** Rotation happens in each provider's own dashboard, which only
the owner can reach. Nothing here has been rotated, and no credential value appears in this file,
the commits or the logs.

## Why

Until `9b0cd3e`, every page served by a running LÉLU server (the dev server and the production
`server.ts`) carried these keys in its HTML as `window.__LELU_*__`. Anyone who loaded such a page
could read them. The code no longer exposes them: they are appended server-side by the
knowledge relay. The old values should still be treated as public.

## Where each key lives now

| Key | Stored in | Read by (server only) | Browser access |
|---|---|---|---|
| `GEOAPIFY_API_KEY` | Claude cloud environment **Lelu2** → environment variables; a deployment's `lelu.env` (template: `deploy/contabo/lelu.env.example`) | `plugins/aiProxyApi.ts` relay → `api.geoapify.com/v1/…` | `/api/knowledge/relay?provider=geoapify` (no key) |
| `GUARDIAN_API_KEY` | same | relay → `content.guardianapis.com/search` | `provider=guardian` |
| `NEWSDATA_API_KEY` | same | relay → `newsdata.io/api/1/…` | `provider=newsdata` |

`VITE_`-prefixed copies (`VITE_GEOAPIFY_API_KEY` …) must **not** be set anywhere. A production
build would compile them into the bundle; `scripts/verify-bundle-secrets.ts` fails if one ships.

## NewsData 401: likely cause

The stored `NEWSDATA_API_KEY` is 37 characters with **one non-hex character** in its body, while a
NewsData key is normally `pub_` + 32 hex characters (36 in total). It very likely has a stray extra
character. A fresh key, pasted with nothing else, fixes this along with the rotation.

## Steps (owner)

For each of the three providers:

1. Sign in to the provider's dashboard (geoapify.com, open-platform.theguardian.com,
   newsdata.io) and **create a new API key**.
2. **Revoke or delete the old key** there. Without this step, rotation protects nothing.
3. In claude.ai → Settings → environment **Lelu2** → environment variables, replace the value of
   `GEOAPIFY_API_KEY` / `GUARDIAN_API_KEY` / `NEWSDATA_API_KEY`. Paste only the key: no quotes,
   no spaces.
4. On any server that runs LÉLU (for example the Contabo deployment), update the same names in
   its `lelu.env` and restart the service.

Environment variables are read when a session or server starts, so verification needs a new
session (or a restart).

## Verification (to run after rotation)

On a dev server started in the new session:

```sh
curl -s http://127.0.0.1:<port>/api/knowledge/providers            # booleans only
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:<port>/api/knowledge/relay?provider=geoapify&path=%2Fv1%2Fgeocode%2Fsearch%3Ftext%3DParis%26limit%3D1%26format%3Djson'
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:<port>/api/knowledge/relay?provider=newsdata&path=%2Fapi%2F1%2Fnews%3Fq%3Dspace%26language%3Den'
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:<port>/api/knowledge/relay?provider=guardian&path=%2Fsearch%3Fq%3Dspace%26page-size%3D1'
bun run scripts/verify-bundle-secrets.ts                            # must print ALL BUNDLE SECRET CHECKS PASSED
```

Expected: 200 from each relay. Guardian could not be reached from the previous container
("Blocked by egress policy"); that is a network limit of that environment, not the key. Also
confirm the **old** keys now fail at each provider. That confirmation must come from the
provider's dashboard or a direct call; it is not claimed here.
