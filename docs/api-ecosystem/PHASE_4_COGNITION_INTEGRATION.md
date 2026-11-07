# Phase 4 — Cognition, Agent and Research Integration

**Status:** PASS for the currency path, proven by a real chat turn. Other domains are reachable but **not chat-proven**; see "Limits".
**Code commits:** `7e7acf2`, `c274436`

## How the new capabilities reach a real conversation

No agent, runtime or tool path was added. The existing chain is:

`chat` → `AIRouter` → `TimeResolver` (deterministic) → `IntentDetector` → `ResearchResolver` (prefetch) and/or the model's own `research.web` tool call (`ToolDispatcher`) → `selectProviders` → `runProviders` → the model writes the answer with the results in context.

Changes along that chain:

| Change | Why |
|---|---|
| `research.web` `focus` enum gains `dictionary`, `books`, `currency`, `earthquakes` (built from `RESEARCH_FOCUS`, so the model's tool schema updates automatically) | Lets the model ask for the dedicated source explicitly |
| `DOMAIN_CAPS` gains four keyword routes | Prefetch selection from the user's wording |
| `SPECIFIC_DOMAIN_CAPS` rank boost | A dedicated source for a named domain outranks general ones that win on tag count ("what is" gives Wikipedia 4 tags) |
| `TimeResolver` and `IntentDetector`: "what is today" means the date only when *today* is the subject | **Live bug.** "Convert 100 USD to EUR — what is today's exchange rate?" was answered with the current time |

## Live evidence (real model, real sources)

Desktop 1440×900, dev server at `c274436`'s working tree, provider **Fireworks** (`gpt-oss-120b`; the first available provider in LÉLU's existing chain, unchanged):

1. **Before the fixes:** the answer was "Right now it's 10:04:20 PM UTC…". No research ran.
2. **After the time fix:** research ran but consulted Wikipedia, GDELT and RSS, never the rates.
3. **After the ranking fix:** `frankfurter` was called (1 result, 4.6 s), and LÉLU answered *"Today's reference rate from the European Central Bank is 1 USD = 0.89566 EUR, so 100 USD converts to ≈ 89.57 EUR (ECB reference rates)."* This matches the live API value, and the activity row shows "Web research · 1 search · 1 source found".

Screenshot: [evidence/phase4/chat-desktop.png](evidence/phase4/chat-desktop.png). Regression tests cover all three failures.

## Limits (observed, not assumed)

- **"define serendipity"** on iPhone 13: the model answered from its own knowledge and made **no** research call. That is the existing cognition's choice; the dictionary is available to it but wasn't needed. The dictionary provider is verified live only by script.
- Books and earthquakes were verified by script and by selection tests, but not through a chat turn.
- GDELT timed out on every attempt from this container (12.4 s). That's a pre-existing source, and the timeout is recorded in the usage ledger.
- No Executive Board, Galaxy or Universe wiring was changed. Those agents reach research through the same `research.web` tool, so they gain the new sources without changes. Tested only through the chat path.
