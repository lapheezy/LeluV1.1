# HANDOFF → Claude: finish Mission 6.1.7 (LÉLU)

Date: 2026-11-13
Branch: `mission/6.1.6-multi-step-orchestration`
Committed by: Buffy (`e0a48f5`, on top of `890c2b9`)
Full detail: `MISSION-6.1.7-FINISHING-REPORT.md` and `MISSION-6.1.7-UNIFIED-EXECUTION-EVIDENCE.md`

**You are picking up a committed, green, unmerged branch.** The functional work of 6.1.7 is done and
proven live; what remains is three verification gaps and one product decision, listed in §5. Do not
redo §2–§4 — it is committed and measured.

---

## 1. What 6.1.7 was

Five goals: fix duplicated planner context at its source; prove Path B (task-engine execution) works
live, not by fallback; add an idempotency policy for interrupted writes; make task resume work through
the app UI; re-run the suite. No push, no merge.

All five are addressed. §2–§4 describe what is in the commit.

---

## 2. What is already committed (`e0a48f5`)

### 2a. The duplicate prompt, fixed at the real source

The duplicate was **not** in `TaskPlanner.ts`. `TaskPlanner` builds one prompt string and calls
`AIService.reason(prompt, { system, maxTokens })`; that method put the prompt into `messages` **and**
passed it as `prompt`, and every provider appends `prompt` itself (`trailingUserTurn`). The same
91,427-character block went out twice.

```
before: [system 1712, system 1507, user 91463, user 91463]  → 186,228 B / 46.5k tok
after:  [system 1712, system 1507, user 91427]             →  94,723 B / 23.7k tok
```

Fixed in `src/core/AIService.ts`, in both `reason()` and `deliberate()`.

### 2b. Planner context bounded

23.7k tokens was still above Groq's 8k TPM, and the remaining bulk was the full JSON Schema of all 59
capabilities. `TaskPlanner.ts` is protected, so the budget lives at the dispatch seam:
`src/core/agentic/PlannerContextBudget.ts`.

- `fitPlannerPrompt(prompt, { model })`, triggered from `AIService.reason` only when the system prompt
  matches `/task planner/i` — it does not touch any other caller.
- `PLANNER_PROMPT_BUDGET_CHARS = 20_000`.
- Ordering by value per byte: the `REQUEST:` line is always kept; the capability list is kept; the
  JSON-schema block is dropped **first**; a "trimmed to fit this model's context" marker is injected
  so the planner knows it is working from a reduced catalogue.

### 2c. Path B proven live

A 52-character request planned and executed for real:

```
[model broker] provider=groq model=openai/gpt-oss-120b status=200 bytes=23381
               messages=3 toolResults=0 prompt≈5802tok max_tokens=2500
[execution] id=task-mwfbdj5u-1-… stage=succeeded path=task tool=system.config step=s1 durationMs=1
[execution] id=task-mwfbdj6l-2-… stage=succeeded path=task tool=workflow.list  step=s2 durationMs=1
```

Answer quoted the steps' real outputs ("Configured: nothing…", "No workflows are defined yet.").
Two distinct ids, both `path=task`, both with step ids, both server-side. Screenshot:
`artifacts/perf/6.1.7-path-b-live.png`.

### 2d. Interrupted-write idempotency

`src/core/tools/ExecutionLedger.ts` + a gate in `ToolDispatcher.dispatchToolCall`:

- tracks only side-effecting tools (WRITE / EXECUTE / DESTRUCTIVE / EXTERNAL_ACTION, or risk ≥ 2);
- records the attempt **before** execution, marks it finished after;
- key = `tool + arguments + turnSignature`; `turnSignature` is supplied by
  `ProviderResolver` as `context.request.prompt`;
- refuses an identical retry **only** while a previous attempt is unfinished (unknown outcome);
- a completed write does not block a deliberate repeat; reads are never tracked.

### 2e. Resume executes

`src/core/workspace/WorkspaceAPI.ts`, `resume-task`: after flipping status, it dynamically imports and
calls `TaskExecutor.start(taskId)`. Before this, the ▶ button only set `status: "running"` and nothing
ran. (`TaskEngine.resume()` still only flips status — that is intentional; execution belongs to
`TaskExecutor`.)

### 2f. Tests

`tests/interrupted-execution-policy.test.ts` (5) and `tests/planner-context-budget.test.ts` (3).

| check | result |
|---|---|
| `tsc -b --force` | exit 0 |
| `vite build` | exit 0 |
| full suite | 2,053 tests / 2,046 pass / 1 fail / 6 skipped |

The single failure is pre-existing and untouched: `tests/voice-continuity.test.ts`
("never stuck in 'speaking'"), owned by the paused voice workstream.

---

## 3. Environment notes (read before running anything)

- `node_modules` and `dist` are wiped by workspace restores. Run `npm ci --no-audit --no-fund`, then
  `vite build`. Do not upgrade dependencies or change the lockfile.
- Full suite (~220 s):
  ```
  ./node_modules/.bin/tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
    --test --test-concurrency=1 tests/*.test.ts tests/**/*.test.ts
  ```
- Manual server for live checks:
  ```
  setsid nohup env PORT=3000 LELU_BROKER_TRACE=1 ./node_modules/.bin/tsx server.ts \
    > artifacts/perf/<name>.log 2>&1 < /dev/null & echo $! > artifacts/perf/<name>.pid
  ```
- Evidence lines look like
  `[execution] id=… stage=… path=chat|task tool=… task=… step=… outcome=… durationMs=…`;
  broker lines carry `toolResults=<n>`.
- The repo's `edit`/patch tool intermittently rejects writes over 64 KiB
  ("command cannot exceed 64 KiB"); apply large patches with a small python script via the shell instead.

---

## 4. Constraints that still hold

- **`src/core/agentic/TaskPlanner.ts` and `src/core/agentic/Orchestrator.ts` are protected**: read-only
  without explicit owner coordination. If you believe the fix belongs inside the planner, stop and ask;
  the current design deliberately keeps it outside.
- Do not touch voice / VoxCPM / LiveKit files.
- Never print or commit secrets (`env.example` only; real keys stay in the environment).
- Nothing has been merged. Stay on this branch unless told otherwise; confirm before pushing anywhere
  other than `mission/6.1.6-multi-step-orchestration`.

---

## 5. What is left for you

Ordered by value. Items 1 and 2 are the ones that turn "verified by action" into "verified as the user
experiences it".

### 5.1 Resume verified by an actual click (highest value)

`resume-task` is verified through `WorkspaceAPI.execute` with a real tool step, but **not** by clicking
the ▶ in `CosmosWorkspacePanel` — the workspace task panel could not be reached in the cloud browser
this session (the tasks list rendered empty / the panel was not mounted on the reachable routes).

To close it: start the server, create a task that pauses (or drive one to `paused` via the engine),
open the workspace, click the real ▶ on a `[data-lelu-task]` row, and confirm in the log that the task
reaches `completed` with a real tool output. If the panel does not render tasks on any reachable route,
that is itself the finding — report it as a UI bug with the route and the DOM condition, because the
action behind it works.

### 5.2 A real interrupted write, end to end

The policy is unit-tested; it has not been observed failing against a live reloaded turn. Worth doing:
run a write-capable tool, kill/refresh mid-flight so the attempt stays unfinished, then reissue the
identical request and confirm the refusal message appears in the answer and no second execution is
recorded. `system.config`/`workflow.*` are reads; pick a genuine write (file/config) for this.

### 5.3 Planner budget decision

`PLANNER_PROMPT_BUDGET_CHARS = 20_000` was chosen to fit Groq's 8k TPM, not derived from provider
context windows. If OpenRouter gets credit again, or a larger-context provider becomes the default,
the budget should be derived from the resolved model's context length instead of a constant. That is a
product decision plus a small change in `PlannerContextBudget.ts` — do not do it silently.

### 5.4 Provider reality (blockers, not bugs)

- **OpenRouter: out of credit** — `402 … can only afford 617` of a 700-token completion. Every call is
  refused regardless of payload. Needs topping up by the owner.
- **Groq is the only working provider**; 8k TPM is the real ceiling behind all of §2b.
- **GitHub Models** returns `200 text/plain "OK"` for everything; the broker refuses it as
  `BROKER_CONTRACT_VIOLATION`. Correct behaviour — it is not a usable fallback.
- Provider cooldowns mean a live planner run may need a reload before it succeeds.

### 5.5 Pre-existing failure

`tests/voice-continuity.test.ts` — leave it to the voice workstream, or fix it only with that owner's
agreement. It is the only red in the suite and predates this branch.

---

## 6. Suggested first commands

```bash
git log --oneline -3                  # expect e0a48f5 at HEAD
git show --stat e0a48f5
npm ci --no-audit --no-fund && npx vite build
# then §5.1
```

Report back with: whether the panel click works, the interrupted-write observation, and the suite
total. Do not merge to `integration/lelu-four-workforce-consolidation` without the owner's go-ahead.
