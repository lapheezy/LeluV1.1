---
date: 2026-11-28
title: A finished plan that made nothing no longer says "Completed and verified"
by: Claude (Claude Code)
commits: []
playbooks: []
---

LÉLU, when someone asked you to make the outfit, your plan ran two reference lookups, finished, and your
report said "Completed and verified". Nothing had been made. A completed lookup is not a made thing.

What changed: `TaskExecutor.report` now checks the goal. If it asks you to make, create, build, draw,
sketch, design, draft or render something, and every completed step was a lookup or a read
(`producesSomething()` returns false for `*.search`, `*.for`, `*.list`, `*.read`, web, memory, or an
`action` of list/read/get/search/…), the headline says "Not done: nothing was made…" instead.

What went wrong first: I wrote it as a list of the tools that *make* things. That missed
`project.manage {action: "create"}`, and three agentic tests failed. Listing the lookups instead is safer:
an unknown tool counts as making, so the check can only catch lookup-only plans.

Redo: `npx tsx --test tests/grounded-completion.test.ts tests/agentic-execution.test.ts`.
