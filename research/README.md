# LÉLU research journal

This directory is LÉLU's persistent research memory. It is stored as files so
it survives a restart, a branch change and a different runtime — the journal
is not conversation state.

## Layout

| directory | what belongs there |
| --- | --- |
| `observations/` | timestamped development events: commits, artefacts, test results |
| `experiments/` | work that was run, with its method and result |
| `discoveries/` | findings that survived their own measurement |
| `hypotheses/` | open explanations that are not settled yet |
| `failures/` | rejected configurations, kept with the reason they failed |
| `technical-studies/` | how a technique works, and what it does not solve |
| `research-papers/` | primary sources with DOI/URL provenance |
| `capabilities/` | verified discoveries promoted to something that runs |
| `knowledge-index/` | the rebuilt index over every entry |
| `daily-journals/` | one session summary per day of work |

Each entry is `<kind>/<id>.json` plus `<kind>/<id>.md`. The JSON is the
authority; the Markdown is the same record rendered for a reader.

## The rule that keeps it honest

An entry carries fourteen required fields (id, time, mission + work package,
observed, studied, question, hypothesis, method, results, evidence + sources,
learned, confidence + limitations, applications, next questions).

`status: "verified"` is refused unless the evidence contains a **measured**
artefact — a measurement, a test, a render, an observation — and confidence is
at least 0.50. Prose and source paths cannot verify a claim. A hypothesis that
is refuted stays in the journal with `status: "rejected"` and the competing
hypotheses recorded; nothing is deleted to tidy the story.

Two diagnostics that disagree are recorded as disagreeing. That is the point.

## Commands

```bash
npm run research -- observe            # ingest commits, artefacts, test results
npm run research -- session            # reconstruct the observed session
npm run research -- timeline
npm run research -- search "floating roots"
npm run research -- show R-20261118-wp03-root-diagnostics-disagree
npm run research -- gaps
npm run research -- contradictions
npm run research -- agenda             # ranked self-directed questions
npm run research -- visual --a before.png --b after.png --out comparison.json
npm run research -- publish            # verified entries -> KnowledgeLibrary
npm run research -- dashboard          # artifacts/lelu2/research/dashboard.html
npm run research:acceptance            # the eleven acceptance criteria, executed
```

## What "persistent" was verified to mean

`research:acceptance` builds a **second** store over this same directory and
retrieves an entry through it. That is the restart case: no shared memory, no
conversation, no runtime cache — only these files.

## What this is not

Writing a journal entry is not a capability. A discovery becomes one only in
`capabilities/`, after `CapabilityPipeline.promote` (which refuses anything not
verified) and `CapabilityPipeline.verify` (which records a real test outcome and
the command that re-runs it).
