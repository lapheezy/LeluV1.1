# Improvement 2: "Background work has its own budget and yields to conversation" — Gate 2 evidence

Status: **IMPLEMENTED ON BRANCH, AWAITING YOUR ACCEPTANCE.** Not deployed. The next improvement will not start until you accept or return this one.

Approved at Gate 1, with your amendment: *"the cap is minimal at first, up to 10 calls, unless further permission is given or extended. She must learn to use what she has efficiently and wisely before being given more."*

---

## What changed

| | Before | After |
|---|---|---|
| Labels | Only self-study's calls were labelled | Every caller states what the call is for: conversation (also the default for anything unlabelled), `self-study`, `curiosity`, `owner-objective`, `autonomous-objective`, or `self-development` (code generation after you approve) |
| Allowance | Background work shared your provider budgets with no limit of its own | **10 background model calls per UTC day per device.** Refused *before sending* once used. **Only you can change it** (Settings → Usage & budgets); nothing in her own code can set a budget, and a test pins that. |
| Spending pattern | — | **Paced:** her remaining calls are spread over what is left of the day, so 10 calls never go in the first ten minutes |
| Who gets a call | — | **Rationed by priority** when the allowance is scarce: objectives you gave her, then self-study conclusions, then objectives she set herself, then curiosity. Lower-priority work gets a call only when nothing more important has wanted one in the last 30 minutes. |
| Daily-limit refusals | Background kept using the remaining providers | When any provider refuses with a *daily* limit (on any call, chat included), **background model use stops until the next UTC day**, so what's left is kept for conversation |
| When refused | — | Self-study concludes from the evidence and says why. Curiosity proceeds without model help. An autonomous objective is **scheduled to resume** when its next call is allowed (visible on the objective, not counted as a failure). |
| What she knows | — | Her context states her allowance, what's used, when the next call is allowed, the priority order, and that only you can raise it |
| What you can see | Usage rows per provider only | A **By purpose** table and a **Background allowance** box in Settings → Usage & budgets (screenshot below), where you set or reset the allowance |

If you grant a large allowance, pacing and priority rationing switch off and only the cap applies. Rationing exists for a scarce allowance.

## Evidence

### 1. A simulated day through the real gate (`evidence/background-day-simulation.json`)

Background demand is modelled on the callers' own ceilings in code:
- curiosity up to 2 calls a minute
- self-study about every 2 minutes
- one of her own objectives every 5 minutes
- one of *your* objectives every 30 minutes from 09:00 to 12:00

Conversation is one turn every 10 minutes from 08:00 to 23:00.

| | Background calls wanted | Background calls sent | Conversation calls sent |
|---|---|---|---|
| Normal day | 3,894 | **10**: 1 curiosity (00:00, before anything else had asked), 8 self-study, 1 for your objective at 10:00 | **90 / 90** |
| Groq reports its daily limit at 14:00 | 3,894 | **6**, none after 14:00 | **90 / 90** |

Send times on the normal day: 00:00, 02:24, 04:48, 07:12, **10:00 (your objective)**, 12:20, 14:40, 17:00, 19:20, 21:40.

Her own objectives received none, because self-study kept wanting calls and ranks higher. That follows the order you approved. If you want her own objectives ahead of self-study, it is a one-line change.

**This is a model of demand, not a production measurement.** Real demand is lower: self-study only asks for judgement-worthy studies, and curiosity only when it has something to pursue.

### 2. The panel in a real browser (`evidence/usage-panel-background-allowance.png`)

Rendered from the real `UsageSection` against a ledger seeded through the real gate:
- 6 conversation calls, then 1 self-study call.
- Curiosity and her own objective were then refused by pacing and never sent.
- OpenRouter then returned "free-models-per-day", which paused background until midnight UTC.

The panel shows "1 of 10 background model call(s) used today … Paused until 12:00:00 AM: OpenRouter reported its daily limit."

### 3. Tests

- New: `tests/background-budget.test.ts`, 13/13. Unlabelled calls count as conversation. Ten calls a day, then refusal, while conversation still goes through. Pacing (each call fits inside the day, and a tool loop already started isn't cut off). Priority holds, release, and your objectives outranking self-study. A daily-limit refusal on a *conversation* call pauses background until the next UTC day, while an ordinary per-minute rate limit does not. Only your budget changes the cap, and clearing it returns to 10. A plentiful allowance isn't rationed. Totals by purpose. Her context text. Through the real resolver: a paused background call never reaches the provider, and a conversation call does. A refused objective waits as "scheduled" and does not count as a failure. Every caller's label is pinned.
- Updated: `autonomy-bridge`, `briefings`, `completion-verification` and `question-resume` exercise autonomous behaviour, not budgets. They now start by granting a large allowance explicitly, as you would; without that grant, 12 of their tests were correctly refused by pacing. `self-study-conclusions` starts two tests from an unspent allowance.
- Full suite: **2,318 tests, 2,312 pass, 0 fail, 6 skipped** (the same 6 as before). Typecheck clean, no lint findings in changed files, `vite build` succeeds. One sentence of panel wording was corrected after the suite ran; no logic changed.

## Limitations

- The allowance is **per device** (per browser). Your background-allowance setting syncs to your account like your other budgets, but each device counts its own calls. One leader tab per browser runs self-study, so this is per browser, not per tab.
- Provider health probes and source reading run only when you ask, and are labelled but not counted as background.
- The pause on a daily-limit refusal lasts until the next UTC midnight, even if the provider resets earlier.
- Agentic task tools you trigger yourself (TaskPlanner/TaskExecutor) count as conversation.

## How to try it

1. Deploy, open LÉLU, then Settings → **Usage & budgets**. Look for **By purpose** and **Background allowance** (it starts at 10).
2. Leave her running. Background calls appear spaced hours apart, mostly self-study. Your chats never show a background-budget refusal.
3. Ask her: *"How many background calls do you have left today, and what will you use them for?"* She answers from her allowance context.
4. Raise or reset the allowance in the panel whenever you decide she has earned it.

## Rollback

Reverting the commit removes the gate. To effectively lift it without a deploy, set a large allowance in the panel.
