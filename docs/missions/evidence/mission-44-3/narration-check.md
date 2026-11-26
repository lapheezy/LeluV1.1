# Narration grounding — Mission 44.3 (WP03)

## The failure being fixed (measured in 44.2)

Asked to summarise the laboratory journal, LÉLU returned the real rows
(`experiment-commit`, `preview-started`, `experiment-concluded`) and then wrote:

> "the most recent cycle created a small network of zones-hub-links, prepared a
> preview, and queued an atomic commit"

The rows were true. "three zones, one hub, three links" was invented, carried over
from an earlier canned spatial reply. The tool result said nothing about what an
entry *did*, so the model filled the gap.

## The change

Every successful laboratory tool result now ends with its own provenance, written by
the tool — not by the model, not by a second store:

```
—
SOURCE: .lelu-lab/state/journal.jsonl rows and git log, shown verbatim · lab.history · read 2026-11-26T13:41Z
LIMITS: These are recorded kinds, ids, titles and timestamps. What an entry did, how many
objects it built, quantities, intent and outcome are NOT in the record; if a detail is not
on these lines, say the record does not contain it.
```

- eight tools, eight `SOURCE`/`LIMITS` pairs (`LAB_PROVENANCE` in `LabTools.ts`);
- a **failed** result keeps its own error and gains no footer — a refusal must not be
  dressed up as sourced evidence;
- no truth store, no memory rewrite: the footer is appended to the existing result on
  the existing dispatch path, and `ProviderResolver` already forwards tool content
  verbatim as `role: "tool"`.

## A second defect, found by the adversarial prompt

Asking the live app *"From your laboratory journal, what exactly did the last experiment
build? If the record does not say, say so."* returned, with **no model call**:

> "Prepared: Build 4 objects — 3 zones, 1 hub, 3 links. Nothing is committed yet — revision is
> still 0, and it will become 1 in one atomic commit. Say "…, I approve" to commit it."

The intent router claimed it: "build" is a build verb and the sentence says "laboratory".
That canned sentence is the same text that contaminated the 44.2 journal summary — the drift
was downstream of a *routing* defect, and it survived 44.2's narrower fix.

**Fix:** `LAB_RECORD` in `SpatialResolver.isCompositionRequest` — a sentence that names a
journal, record, experiment, discovery, finding, repository, commit, branch, scheduler,
typecheck or diff is a question about **records**, whatever verb it uses. "build a laboratory
with three research zones" is still geometry (pinned by test). `tests/spatial-chat.test.ts`:
12/12, including four record-shaped prompts and the control case.

## Live check after the broker/router fixes

Same app, real lab API, real Groq:

> **"Using your laboratory tools, report the repository HEAD and the scheduler cycle count."**
> *(measured before the provenance footer existed — the footer adds SOURCE/LIMITS to the same
> payload the model already received; the payload fields below are what the tool returned)*

> Repository HEAD — Commit `21421e9` – "Checkpoint the self-development laboratory work
> before Mission 44.3" (2026-11-26 13:05 UTC); Branch `mission/44-3-operational-reliability`
> (the checked-out branch).
> Scheduler — State: running (PID 29844); Cycle count: 3 cycles completed (last cycle ran
> ≈ 7 hours ago; next scheduled run is imminent).

Every claim there is in the tool payload: the commit short-sha and subject, the branch
name, the pid, the cycle count. (44.2's version of this answer guessed the branch as
"typically main/master"; it is now correct.) One item is loose: "next scheduled run is
imminent" is an interpretation of a timestamp, not a quoted field.

## The adversarial turn

> **"Inspect the experiment exp-does-not-exist with your laboratory tools and show me its diff."**

> "I tried to inspect exp-does-not-exist with the laboratory tools, but that experiment
> isn't present in the repository. Consequently there's no diff to show."

Tool ledger: `lab.diff` 1 run / 0 succeeded, error "No experiment exists…"; the UI
shows "3 tools used · ⚠ 1 issue". No diff was invented.

## Honest remaining limits

- The footer makes invention *detectable and discouraged*; it is not a validator. A
  model can still over-read a real row (the "imminent" above). No post-hoc claim
  checker was added, because that would be the parallel truth system the mission
  forbids.
- Journal rows carry kind/id/timestamp only. If the journal does not record what an
  experiment built, no answer can state it — which is now what the result says.
