# MISSION 6.1.4 — INTELLIGENCE PAYLOAD OPTIMIZATION & TOKEN-BUDGET CONTROL

Date: 2026-11-12
Branch: `mission/6.1.4-intelligence-payload-optimization`
Starting baseline: `3671206` (verified: mission 6.1.3 acceptance report, clean tree)
Verdict: **A conversational turn now transmits ~5% of the tool schema it used to, Groq no longer
refuses it, and OpenRouter answers on the first call instead of after a 402.**

---

## 1. Starting commit and branch

| item | value |
|---|---|
| HEAD at start | `3671206cc8a109fc177cae4377222fd0d5beb062` — matches the required baseline exactly |
| working tree | clean (only untracked artifacts) |
| mission 6.1.3 report | preserved untouched (`MISSION-6.1.3-INTEGRATION-ACCEPTANCE.md`, 14,879 B) |
| new branch | `mission/6.1.4-intelligence-payload-optimization` |
| canonical | untouched; nothing pushed, merged or rebased |

## 2. Root cause analysis

The pipeline is not missing a budget — it has one, and that budget is sound. What it never had
was a reason to act on a *conversational* turn.

```
user message
  → AIService.chat()                     builds AIRequest { messages: prior turns, prompt, allowTools: true }
  → AIRouter / ProviderResolver.execute  rung loop, provider chain, fallback
  → generateWithTools()
       toolSchemasForRequest(prompt)     ← 58 schemas, EVERY conversational turn
       fitRequestBudget(...)             ← correct, but only trims what exceeds a ceiling
  → GroqProvider / OpenRouterProvider    own fetch, own payload, tools attached verbatim
  → /api/model/<provider>                broker; attaches the server's key
```

`toolSchemasForRequest` narrowed **only** environment turns (`ENVIRONMENT_REQUEST` regex). Every
other turn received the complete derived surface. Two consequences, both measured in 6.1.3:

- **OpenRouter** sees a 494 KB ceiling (gpt-4o-mini's 128k context), so the fitter has nothing to
  trim and 102 KB leaves the browser with 21,756 tokens of tool definitions. The account cannot
  afford the response budget that request implies → **402**.
- **Groq** has a 26,880 B transport ceiling, so the fitter *would* trim — but the turn is already
  refused **413** twice (8,000 TPM) before the loop degrades to the 3-tool retry set.

Root cause, stated exactly: **the tool surface was selected by category, not by relevance, and the
default category was "everything".**

## 3. Original token payload measurements

Measured with `scripts/measure-tool-payload.ts` against the real functions (no reimplementation)
at the starting commit:

| measurement | value |
|---|---|
| derived surface (registry ∩ executor ∩ gate) | **58 tools** |
| serialized schema bytes | **35,147 B (34.3 KB)** |
| tokens at 3.2 B/token (JSON-schema density) | **~10,983** |
| tokens at 4 B/token | ~8,787 |
| offered to a conversational turn | **58 (FULL SET)** |
| offered to an environment turn | 6 (only case that narrowed) |
| size-refused retry set | 3 tools / 2,478 B |

Live broker evidence from 6.1.3 (the reason this mission exists):

```
REFUSED provider=openrouter model=openai/gpt-4o-mini status=402 bytes=102821
        tools≈21756tok  "You requested up to 16384 tokens, but can only afford 15259"
REFUSED provider=groq model=openai/gpt-oss-120b status=413 bytes=42495
        rate_limit_exceeded "TPM: Limit 8000, Requested 8978"
REFUSED provider=groq model=openai/gpt-oss-120b status=413 bytes=43676  (again)
```

## 4. New architecture and data flow

One decision point changed, and it is the one that already existed:

```
generateWithTools()
   toolSchemasForRequest(prompt, intent)
     → selectToolSchemas(derived, prompt, intent)      ← NEW: relevance for EVERY turn
          · environment turn  → existing environment family (unchanged)
          · discovery tools   → always kept: capabilities_list, capabilities_activate, system_config
          · lexical relevance → name match (×2) + description match (×1) + family hint (+3)
          · budget            → ≤ 14 schemas and ≤ 12,000 B of schema
          · no signal at all  → conversational core (memory_recall, research_web, artifact_create)
          · fails OPEN        → never returns an empty set
     → fitRequestBudget(...)                            ← unchanged, still the last word
Providers (unchanged) get a smaller `tools` array, and now always a named `max_tokens`.
```

Nothing was removed: the derived list is still `ToolRegistry ∩ ToolDispatcher ∩ AutonomyGate`, the
selection is a filter over it, and `toolSchemasForModel()` still exposes all 58 to any caller that
asks for the whole surface.

## 5. Tool discovery and selection results

`scripts/measure-tool-payload.ts`, same prompts, after the change:

| prompt | tools | schema bytes | ~tokens |
|---|---|---|---|
| "What are you?" | 6 | 2,803 B | 876 |
| "What did we discuss yesterday?" | 7 | 2,304 B | 720 |
| "search the web for the latest SpaceX launch" | 10 | 5,046 B | 1,577 |
| "write a file to the sandbox…" | 10 | 3,845 B | 1,202 |
| "build me a small website for my bakery" | 12 | 8,176 B | 2,555 |
| "make a 3D game where you fly a ship" | 11 | 7,734 B | 2,417 |
| "find where this function is used in my project" | 14 | 4,654 B | 1,454 |
| "run my workflow from last week" | 14 | 10,039 B | 3,137 |
| "summarise this conversation in three lines" | 8 | 3,234 B | 1,010 |
| "what is the weather in Tokyo" | 8 | 4,193 B | 1,310 |

Family selection is preserved: workflow questions get `workflow_run/status/author`, memory
questions get `memory_recall/chats_read`, build questions get `studio_build/creator_build`, sandbox
questions get `sandbox_write/execute`, research questions get `research_web/browser_read`.

**Capability preservation.** Every turn carries the discovery tools, so anything outside the
selected set stays reachable: the model can list and activate acquired capabilities, and the
dispatcher resolves tool calls by name regardless of whether that schema was offered this turn.
The selection also fails open — an empty result becomes the first N tools rather than nothing.

## 6. Token-budget measurements

**Before → after, conversational turn (live, in the browser, measured at the network boundary):**

| | before (6.1.3) | after (6.1.4) |
|---|---|---|
| request body | 102,821 B | **17,657 B** (later turn: 25,074 B with 8 tools) |
| tool definitions | 58 | **7–8** |
| tool schema bytes | ~68 KB | **2,123 B** |
| tool tokens (broker's own count) | 21,756 | **531** |
| provider refusals per turn | 3 (402, 413, 413) | **0** |
| provider that answered | second, after two failures | **first** |

Reduction in tool-definition tokens: **21,756 → 531 = 97.6%**. Against the statically measured
surface (35,147 B) a conversational turn now carries **2.8 KB = 92% less**, and every measured
prompt stays under the 12 KB turn budget.

**The fitter was verified, not assumed.** Given a deliberately oversized turn (58 tools + 18 KB of
history), `fitRequestBudget` for Groq trims 58 → 17 tools and lands at 26,800 B under a 26,880 B
ceiling; for OpenRouter (494 KB ceiling) it correctly changes nothing. That is the pre-existing
behaviour and it still works.

## 7. Provider routing improvements

- **Output budget is now explicit.** After the tool payload was cut, the *only* remaining refusal
  was `402 … "You requested up to 16384 tokens, but can only afford 14696"` — because an unset
  `max_tokens` makes OpenRouter reserve the model's whole 16,384-token ceiling. `GroqProvider` and
  `OpenRouterProvider` now send `max_tokens: request.maxTokens ?? DEFAULT_OUTPUT_TOKENS (2,048)`.
  With that, the same turn answered on OpenRouter on the first call.
- Provider eligibility, model selection, streaming and fallback are untouched.

## 8. Fallback behaviour

Unchanged in structure and verified still working: during the first post-change live turn,
OpenRouter refused (402) and the resolver moved to Groq, which answered — the conversation
continued without the user seeing a failure. What changed is that this path is now the exception:
in the final run the log shows **0 refusals**.

Failure classes remain distinguished by the existing classifier (`PROVIDER_RATE_LIMITED`,
`PROVIDER_AUTH_FAILURE`, `INVALID_MODEL`, `PROVIDER_TIMEOUT`, …), and the 413 path still degrades
through the reduced set before dropping tools entirely.

## 9. Performance comparisons

| metric | before | after |
|---|---|---|
| tool tokens per conversational turn | 21,756 | 531 (**−97.6%**) |
| turn body | 102,821 B | 17,657 B (**−82.8%**) |
| tool schemas offered | 58 | 7–8 (**−88%**) |
| predictable 402/413 refusals | 3 per turn | **0** |
| extra provider round-trips per turn | 2 | 0 |
| boot graph | 156 chunks / 1.65 MB | **156 / 1.65 MB** (unchanged) |
| typecheck / build | 0 / 0 | **0 / 0** |

Success criteria from §9 of the brief: tool-definition tokens cut by ≥80% on simple conversations
(**97.6%**), predictable 402/413 eliminated (**0 observed**), retries avoided (**0**), streaming,
tool calling and fallback preserved, all existing functionality intact.

## 10. Regression test results

```
ℹ tests 2018   ℹ pass 2011   ℹ fail 1   ℹ skipped 6
```

- 10 new tests in `tests/tool-payload-budget.test.ts` — all pass.
- 2008 pre-existing tests: **one** failure, `tests/voice-continuity.test.ts`, which is the
  **pre-existing** failure identified and classified in Mission 6.1.3 (§7.3: it asserts the
  pre-`26598e3` synchronous contract). It is untouched by this mission.
- The pinned contract test in `tests/tool-schema-scoping.test.ts` ("an ordinary turn keeps the full
  set") still passes, because it pins `scopeToolSchemas`, not the turn entry point — the new
  behaviour lives in `selectToolSchemas`/`toolSchemasForRequest`.
- One latent bug surfaced and was fixed: `reducedToolSchemas(schemas, prompt)` rebuilt its list from
  the registry and could therefore return tools the caller never had. It now honours a
  caller-supplied list.

## 11. Known limitations

1. **Selection is lexical.** A paraphrase that shares no word with a tool name or description can
   miss its family; a small keyword lexicon covers the common cases (weather/search, memory,
   files, studio, workflow, repo, avatar, artifacts, agents). An embedding-based selector would be
   the next step and needs its own measurement.
2. **Expansion is not mid-turn.** A withheld schema is not re-offered automatically inside the same
   turn. The model can still call a tool by name (the dispatcher resolves it), and the discovery
   tools let it widen its own capability set — but there is no "re-offer on demand" round.
3. **OpenRouter's credit ceiling is account state**, not a number the client can compute; the
   explicit 2,048-token output budget removes the predictable refusal but cannot guarantee an
   account with very little credit.
4. **2,048 output tokens is a default.** A turn that legitimately needs a longer answer will be
   truncated by the provider; callers that know better still pass `maxTokens`.
5. **Client-side telemetry is not in the server log.** The resolver's "Request budget" line is
   emitted by the browser; server-side visibility is limited to the broker's refusal lines and the
   two measurement scripts. A dev-only diagnostic view was not built.

## 12. Recommended next mission

1. **6.1.5 — Voice integrity:** align `voice-continuity.test.ts` with the intentional async speaker
   probe (§7.3 of 6.1.3) and bring the VoxCPM2 sidecar up where a GPU exists. It is the only red
   test left.
2. **6.1.6 — Memory write path** with configured server-side Supabase.
3. **6.2 — Embedding-free vs embedding selection:** measure whether semantic selection recovers the
   paraphrases the lexicon misses, against this mission's numbers.

---

## Final question

**Can LÉLU access her entire capability ecosystem while transmitting only what the task needs?**

Yes, with one honest qualifier. She still *has* the whole surface — 58 tools derived from registry,
dispatcher and autonomy gate, all callable by name, all discoverable through the tools every turn
carries — but a turn now ships 6–14 of them instead of all 58. The payload fell from 102,821 B /
21,756 tool tokens to 17,657 B / 531 tool tokens, refusals per turn went from three to zero, and
the same turn that used to need a 402 and two 413s to answer now answers on the first call.

The qualifier: selection is lexical, so a paraphrase with no shared vocabulary can miss its family.
That is measured, documented, and is the next mission's work — not a claim of perfect selection.
