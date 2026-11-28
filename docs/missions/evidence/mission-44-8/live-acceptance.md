# Mission 44.8 — live browser acceptance

Environment: the real app on `vite --host 0.0.0.0 --port 3001` behind the
owner-authenticated preview origin, real providers (OpenRouter answered), the
Chat Universe surface, and this workspace's own storage. Nothing below is a
harness result; each item is what the product did in a browser.

Screenshots: `browser-recurrence-investigation.png`.

## How the scenario was set up

The app's own keys were seeded and the page reloaded, so the state predates the
page's boot exactly as a restored session would:

* a project `p-44-8-accept` with objective "Ship the memory continuity layer"
* a work record whose steps are `Audit the memory systems` (completed, evidence
  "36 memory modules mapped"), `Write the provenance reader` (completed, evidence
  "MemoryProvenance.ts"), `Run the full acceptance suite` (pending), interrupted
  once with "the tab was closed"
* the record's source conversation is `c-44-8-a`; the conversation opened is
  **`c-44-8-b`** — a different one

After the reload the ledger and both conversations were present.

## A + C — continuity reaches the model from another conversation

Question asked in `c-44-8-b`:

> In one line, list the exact step names that are already done for this project
> and the one that is left.

Reply (OpenRouter, 2 messages in the conversation, `processing: false`):

> **Already done:** Audit the memory systems — 36 memory modules mapped; Write
> the provenance reader — MemoryProvenance.ts. **Left:** Run the full acceptance
> suite.

The model could only name those steps and their evidence because
`WorkContinuity.currentPlan()` put them in the request for a conversation that
never stated the objective. Nothing was re-executed: the completed steps came
back as completed.

## D — a standing instruction is recorded, and is not an authority

Sent through the real composer:

> Always run the full test suite before claiming a pass.

Storage afterwards (`lelu.instructions.v1`):

```json
{"text":"Always run the full test suite before claiming a pass.","kind":"standing-preference",
 "timesSeen":1,"status":"recorded","authority":"preference","investigation":null}
```

The reply said: "That standing instruction is recorded and I'm following it." It
did **not** claim a test ran — the same turn reported the engineering runtime as
unavailable. Recorded: yes. Authorized: `authority` is `preference` and
`executionPermission()` refuses; the autonomy level was not touched.

## B (governance half) — the record survives a reload

Reloaded the page. `lelu.instructions.v1` still contained the record with
`timesSeen: 1`, `status: recorded` — the instruction ledger is durable, not
session state.

## F — the second correction opens an investigation

Sent:

> I told you before, and I am asking again: always run the full test suite
> before claiming a pass.

Storage afterwards:

```json
{"timesSeen":2,"status":"investigating","kind":"correction",
 "investigation":{"system":"verification (project_validate / Mission evidence)",
                  "result":"pending","attempts":1}}
```

Kind was reclassified from `standing-preference` to `correction` **because** it
came back, and an investigation was opened against the system that owns the
behaviour.

### Defect found here, and fixed

The first reply to that second correction was:

> Acknowledged. The instruction stands and I'm following it.

That is the failure the mission names: acknowledgement instead of investigation.
The record was right and the context block was in the request, but the block was
advice the model ignored. Fixed in `bd96fdc`: `ProviderResolver` asks
`StandingInstructions.recurrenceFor(prompt)` and puts the note **before** the
model's text.

Third correction, after the fix, in the same conversation:

> **You have said this 3 times, so recording it again is not the answer. It
> belongs to verification (project_validate / Mission evidence); the
> investigation is pending (attempt 2). I have not verified that the behaviour
> changed yet.**
>
> Acknowledged. The rule is recorded and I'm following it — the full test suite
> will run before any pass claim.

The investigation leads; the acknowledgement follows it and cannot replace it.
Screenshot: `browser-recurrence-investigation.png`.

## G — what the browser did not measure

The journal (`MemoryObservability`) was exercised by the module tests and by
these turns' writes, but this mission did not build a UI panel for it, so the
snapshot was not read from the browser. That is a limitation of the delivery,
not a measurement.

## What this evidence does NOT cover

* A physical phone (no device available; the layout work in 44.7 is unchanged by
  this mission).
* Multiple browser profiles or two tabs writing the same project at once — the
  concurrent-writer case is covered by `tests/memory-failure-recovery.test.ts`
  at module level.
* A host reboot (this VM has no init system). Reload is covered above; process
  termination was covered in 44.7 for the same storage layer.
