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

## AI chat providers (fallback priority order)

| Variable | Role | Required |
|---|---|---|
| `VITE_GROQ_API_KEY` | Groq — **primary** provider | yes |
| `VITE_GROQ_MODEL` | Groq model override | no |
| `VITE_OPENROUTER_API_KEY` | OpenRouter — fallback #1 | yes |
| `VITE_OPENROUTER_MODEL` | OpenRouter model override | no |
| `VITE_CEREBRAS_API_KEY` | Cerebras — fallback #2 | yes |
| `VITE_CEREBRAS_MODEL` | Cerebras model override | no |
| `VITE_MISTRAL_API_KEY` | Mistral — fallback #3 | yes |
| `VITE_MISTRAL_MODEL` | Mistral model override | no |
| `VITE_FIREWORKS_API_KEY` | Fireworks AI — fallback #4 | yes |
| `VITE_FIREWORKS_MODEL` | Fireworks model override | no |
| `VITE_GITHUB_TOKEN` | GitHub Models — fallback #5 + GitHub repo tool | yes |
| `VITE_GITHUB_MODEL` | GitHub Models model override | no |
| `VITE_AI_PROXY_BASE_URL` | Custom AI proxy for GitHub Models | no |

## Knowledge / research providers

| Variable | Role | Required |
|---|---|---|
| `VITE_NEWS_API_KEY` | NewsAPI.org — current news lookups | yes |
| `VITE_YOUTUBE_API_KEY` | YouTube Data API v3 — video lookups | yes |

## Providers that need no key

Wikipedia, Wikidata, Wikimedia, GDELT, OpenMeteo, Hacker News, NASA,
arXiv, CrossRef, OpenAlex, OpenStreetMap/Nominatim, and RSS.

## Security rules

- Every `VITE_` variable is readable from the browser bundle — use only
  public-facing client credentials there.
- Server-only secrets must never be prefixed with `VITE_` and must stay
  out of frontend code.
- Never hardcode keys, log secret values, or return credentials through
  API responses.
