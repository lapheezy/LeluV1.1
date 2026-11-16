# Improvement 2 — "Background work has its own budget and yields to conversation"

Status: **APPROVED at Gate 1 (2026-11-16) with the owner's amendment: the background allowance starts at 10 model calls a day, raised only by the owner.** Implementation and evidence: `04-IMPROVEMENT-2-GATE-2.md`.

Prerequisite: improvement 1 ("A study must conclude") was accepted on 2026-11-16.

---

## Existing behaviour (found in code; the live run is in `evidence/after-live-40-cycles.json`)

LÉLU's autonomous work and your conversations draw on **the same provider keys, the same fallback chain, and the same per-provider budgets**. Only self-study's calls are labelled (since improvement 1). Everything else is recorded as `generate`, so the usage ledger cannot tell a conversation from background work.

| Background caller | What it spends | Ceiling today |
|---|---|---|
| Self-study (`SelfStudyEngine`) | 1 call per judgement-worthy conclusion, labelled `self-study` | 12 / hour (improvement 1) |
| Curiosity (`CuriosityPorts.reason`) | up to 2 calls per tick; one tick per 60 s cognition cycle | ~120 / hour, **unlabelled** |
| Autonomous objectives (`AgentCognitionRuntime` → `AIService.deliberate`) | one decision per objective cycle, but **with tools**, so each decision can run up to 40 model rounds | bounded only by the objective's cycle limit, **unlabelled** |

These ceilings come from reading the code; I have not measured them in production. Per open browser tab, background work alone can exceed a hundred model calls an hour.

**Observed today** with the keys in this environment:
- Groq: daily token limit reached (429)
- OpenRouter: free-models-per-day exhausted (429)
- Cerebras: key rejected (401)

Nothing currently stops background work from spending the last of a provider's daily quota that a conversation would need. The existing budget UI (Settings → Usage & budgets) can cap a *provider*, but it cannot cap *background work*: a cap on Groq stops your chat on Groq too.

## Problem

Background cognition competes with you for the quota your conversations need, and you can't see or limit that competition.

## Proposed change, using the existing gate and ledger (no new provider layer)

1. **Every call states its purpose.** The `operation` label added in improvement 1 is extended to every caller:
   - `conversation` is the default; anything unlabelled counts as conversation, so a missed label can never block chat.
   - Background purposes: `self-study`, `curiosity`, `autonomous-objective`.
   - `self-development` covers code generation, which only runs after you approve a proposal.

   This touches `AIService.deliberate`, `CuriosityPorts`, `AgentCognitionRuntime` and `ProposalEngineer`.

2. **Background has its own daily cap.** `UsageBudgetGate.reserve` receives the purpose. For background purposes it checks a separate budget across all providers. The default is **100 AI calls per day per device**, adjustable or removable by you.
   - When the cap is reached, background calls are refused *before sending*.
   - The callers already degrade: self-study concludes deterministically, curiosity proceeds without model help, and autonomous objectives record the cycle as blocked by budget.
   - Conversation is never checked against this cap.

3. **Background yields when quota runs short.** When any provider refuses with a *daily* limit (a 429 mentioning per-day/TPD/daily), background stops making model calls **for the rest of that UTC day**. Whatever quota remains on other providers is kept for conversation. Conversation itself is unaffected and keeps its normal fallback.

4. **You can see it.** Settings → Usage & budgets gains a **"By purpose"** table for the selected period: calls, tokens, failures and rate-limit refusals per purpose. It also gains a **Background** entry in the budget selector, so you can set or clear the background cap there. All of it comes from the existing ledger.

5. **Self-study also yields within the hour.** Its 12-per-hour cap stays as an inner limit beneath the daily background cap.

### Not in this improvement (proposed next, as improvement 3)

Local inference on the production server. The VPS is 4 vCPU / 8 GB with no GPU, and no local model is installed. The local provider currently only probes `localhost` from your browser. A small CPU model could take over background conclusions, but that is an infrastructure change: installing a runtime and a model, using RAM and CPU alongside the app, and accepting a quality trade-off. It deserves its own measured proposal.

## Expected result

- Background work can never use more than its cap per day.
- Once a provider reports its daily quota is spent, background work stops spending, and your conversations get what's left.
- You can see in the app how many calls went to conversation, self-study, curiosity and autonomous work.

## Demonstration plan

**A. Harness**, with a provider that counts calls and can be told to answer "429 daily limit":

| | Before (to be measured on the current code) | After (target) |
|---|---|---|
| Background calls attributed by purpose | only self-study | 100 % |
| Background calls in a simulated day of cognition | unbounded | ≤ background cap |
| After a simulated daily-limit 429 | background keeps calling the remaining providers | 0 further background calls that day |
| Conversation call while the background cap is spent | — | still sent and answered |

**B. In the app:** open Settings → Usage & budgets.
- Before: rows per provider only.
- After: a "By purpose" table, and a Background budget you can set (e.g. 20/day) and see enforced. Self-study conclusions then show "concluded from the evidence alone", while chat keeps answering.

## Risks and rollback

- **A mislabelled background call would be treated as conversation.** It would be uncapped, but chat can never be blocked. Tests pin a label on every known background caller.
- **Autonomous objectives may pause more often** once the cap is reached. This is visible as "blocked: background budget" on the objective, not silent.
- **The account-wide (Supabase) budget check stays per provider.** The background cap is enforced per device in this improvement, and I'll state that in the UI.
- **Rollback:** setting the background budget to "none" restores today's behaviour without a deploy; reverting the commit removes the feature.

## Verification criteria

- Every background caller's calls carry their purpose label.
- A background reservation is refused once the cap is reached; a conversation reservation at the same moment is accepted.
- After a daily-limit refusal, no background call is sent that UTC day, and conversation still is.
- Self-study, curiosity and autonomous objectives each continue (degraded, not crashed) when refused.
- The "By purpose" totals equal the ledger's events for the period.
- Full suite, typecheck, lint and build all pass.

## Files

- `src/core/observability/UsageBudgetGate.ts`: purpose-aware reserve, background cap, daily-limit yield
- `src/core/observability/UsageLedger.ts`: per-purpose aggregation and summary; background budget key
- `src/core/AIService.ts`: `deliberate()` takes `operation`
- `src/core/curiosity/CuriosityPorts.ts`, `src/core/cognition/AgentCognitionRuntime.ts`, `src/core/selfdev/ProposalEngineer.ts`: labels; budget-refusal handling where missing
- `src/app/scene/genesis/UsageSection.tsx`: "By purpose" table and Background budget entry
- `tests/background-budget.test.ts` (new)
