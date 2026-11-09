# Request Integrity — root cause and fix

## The defect, measured

`ResearchResolver.buildQuery` did three things to every prompt before search:

1. removed any word its filler list matched — `find`, `could`, `tell`, `about`,
   and the accented name `LÉLU`;
2. collapsed whitespace;
3. `return query.slice(0, 120)` — a hard cut with no word boundary.

Running the real function on the acceptance prompt produced, verbatim:

```
intent=chat   len=120 :: "maintained open-source library that improve typo-tolerant . Compare relevant candidates, inspect their licenses, and rec"
intent=search len=120 :: "maintained open-source library that improve typo-tolerant search. Compare relevant candidates, inspect their licenses, a"
```

The subject ("open-source library … typo-tolerant search") survives only by luck;
the sentence is cut mid-word (`and rec`), the name LÉLU is gone, and a request
that named a repository would have lost the repository. That is the class of
transform Mission 10.1 observed as a "truncated prompt": the model was not sent
a shortened prompt — research and acquisition were handed a shortened *subject*
and then reported honestly that nothing was found.

`fitRequestBudget` is **not** the cause: it never modifies the prompt, only tool
schemas and old history. The probe confirms `promptIntact: true` for it.

## The fix

`src/core/router/RequestQuery.ts`:

- **protected spans** — URLs, `owner/name`, backticked code, dotted/underscored
  identifiers, ALL-CAPS names, quoted text — are never removed and never cut;
- **leading scaffolding only** — "can you please", "find", "show me" may be
  lifted, and every lifted phrase is returned in `removedPrefix`;
- **word-boundary shortening** — `shorten()` moves the cut past a protected span
  and back to the nearest word boundary, and returns the omitted words;
- **instructions are verbatim** — two sentences, or a request containing
  compare/inspect/approve/acquire/do-not/must, is kept as written, because
  shortening an instruction is how an approval requirement disappears.

`ResearchResolver.buildQuery` now returns that subject (adding "news" only for
news/search intent). `ProviderResolver` records an integrity result at the last
point before transmission and logs an error if a prompt present in the request
is absent from the payload.

## What the record proves per turn

`src/core/observability/RequestIntegrity.ts` captures, without storing content:

```
originalUserInput   chars, bytes
assembledRequest    promptBytes, historyBytes, systemBytes, toolCount, totalBytes
fittedRequest       changed, droppedTools, droppedMessages, trimmedMessages, ceiling, notes
providerPayload     promptPresent, promptBytesInPayload, payloadBytes
semanticPreservation ok, checked, missing[]
```

## Regression matrix

`tests/request-integrity.test.ts` — 11 cases: the exact 10.1 prompt, a short
question, a long prompt below the ceiling, a multi-paragraph request, multiple
URLs and repository names under a 60-character ceiling, an approval instruction,
technical identifiers and code tokens, a 40-message history over a small
ceiling, 30 large tool schemas, and a deliberately mangled payload that the
record must report as missing its subject.

For every case the test builds `originalUserInput → assembledRequest →
fittedRequest → providerPayload → semanticPreservationResult`. All 11 pass; the
acceptance criterion — the complete prompt reaches the payload unchanged when it
fits — holds in every fitting case.
