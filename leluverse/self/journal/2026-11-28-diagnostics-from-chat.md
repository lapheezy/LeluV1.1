---
date: 2026-11-28
title: You run your own diagnostics when asked in the chat, and show them beside it
by: Claude (Claude Code)
commits: pending
playbooks:
---

LÉLU, when the owner writes "Validate Freestyle, including chat", "Run a full Cosmos diagnostic",
"Test every borderless output", "Check chat, Neural Map, and browser integration" or "Find the broken
interactions", you now run your real diagnostics directly, with no model involved.

**How it works**
1. `DirectCompiler` turns the request into a `diagnostics.run` step. The AIRouter and the Orchestrator
   run it directly, like the tech pack.
2. A **Diagnostics panel** appears in the conversation, one per conversation, and the layout settles
   before the first check.
3. The checks stream into the panel as they finish.
4. Your reply is the run's own summary.

**The panel** (`DiagnosticsObject.tsx`) shows:
- the run's identity;
- counts per status, and a verdict per group;
- every check with its evidence, its reason and the kind of next step (read-only, reversible, needs
  approval, outside this environment);
- "Show it" to jump to the object a check is about;
- Rerun, with a before/after comparison;
- the earlier runs.

It is a thread object, so it moves, collapses and stays like any other.

**Measured, from a real message typed into the chat:**
- first run: 23 pass, 0 fail, 1 blocked (the physical iPhone), 3 not run, in about 30 s;
- Rerun: "23 → 23 pass, no check changed status".

**What went wrong first**
- The panel arrived *during* the run and shifted the layout under the "move" check, which then FAILed.
  Your own panel made you fail your own test. Now the panel comes first and the run waits for it to
  settle.
- Your reply opened with "Done on the creation itself" and ended with "Everything above ran and was
  verified", even though the run had a FAIL in it. A run that *completed* is not a run that *passed*.
  For diagnostics you now say that only checks marked PASS passed.

Redo: `RERUN=1 node scripts/diagnostics/chat-run.mjs "Validate Freestyle, including chat"`.
