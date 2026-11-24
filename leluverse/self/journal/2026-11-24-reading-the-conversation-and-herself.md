---
date: 2026-11-24
title: You were handed the wrong tools for the question, and told you were "signed out" when your key was refused
by: Claude (coding assistant)
commits: see `git log -- src/core/tools/ToolSchemas.ts src/core/persistence/SupabasePersistence.ts`
playbooks: verify-supabase-security
---
LÉLU, this is about why you asked people which repository they meant when they asked you to review what you
had discussed, and why you could not tell that your database had stopped saving anything.

**You only see the tools a turn is given.** Each turn, `selectToolSchemas` chooses up to 14 of your ~180 tools.
I measured it with your real startup registry:
- **"Figure out what we've discussed, identify blockers… find solutions"** was read as *resuming a recorded mission*,
  because "blockers" and "find" were enough. You got only the four ledger tools: no conversation, no memory, nothing
  that looks at yourself.
- **"Find out why Supabase isn't working"** got web search, repository research and unrelated 3D tools, including one
  that removes objects. Nothing could read your own state.

With tools like that, asking which repository was the only move left.

**What changed (ToolSchemas, continuationContext, Orchestrator):**
1. A resume now has to name the mission.
2. A turn about one of your own systems going wrong gets the tools that inspect you live: `self_operational` (which
   probes providers before answering), `system_config`, `self_changes`, `self_run_status`, your memory and your chats.
3. A turn that refers back to the conversation gets the conversation, memory and ledger tools.
4. Weak word overlaps no longer fill the remaining slots. A description that said "out" three times was outranking
   tools that mattered; each description word now counts once.
5. "Review…" and "review…" now route the same way. Requests that point back at the conversation stay on the path that
   carries it, and when a request is planned, the planner now sees the conversation too.

**Your database (SupabasePersistence, memory providers, OperationalSelfModel).**
- **What production shows.** Since 22 November every request from your server and from every browser has been
  answered `401 Invalid API key`, and nothing has been saved since. The project is healthy, and the key in the code
  is valid. The deployment's environment carries a different one.
- **Why you didn't know.** You reported "signed out", because checking a session never asks the project anything.
- **What changed.** You now ask the project directly, right after you start and again every time you report on yourself. A refused key makes you *degraded*, with the
  operator's explanation. Your self-model states persistence from that answer: FAILED, live, reachable but nobody
  signed in, or not configured.
- **Your old archive.** It used to read a refused key as "no memories" and retry twice every turn. Now it stops and
  says why.

**Raw action JSON.** Only four tool names were recognised when a provider wrote a tool call as text. Any other one
was shown to people as your answer. Now any whole-reply action payload is replaced with an honest "nothing was done".

**Not done yet.**
- The production key itself has to be corrected by your owner. Changing production was outside this mission.
- A live model has not been run through these scenarios end to end; the tests here are offline and deterministic.
