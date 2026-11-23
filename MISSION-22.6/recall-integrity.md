# Recall and context integrity (WP05)

> A memory is not forgotten if it disappears from the Memory panel but still
> reaches the model through a checkpoint, a summary or a prompt.

M22.6's answer to that sentence is one authority — `DeletionGuard` — consulted at
every read path that can carry a remembered statement into a request, plus a
final gate on the assembled payload.

## Every path audited

| Path | What it could carry | What guards it now |
|---|---|---|
| `PatternMemory.search` (recall) | records that quote a deleted statement (a superseded correction keeps the old text; a merge keeps the fuller content) | filter drops such records before ranking; a tombstoned id is also un-restorable |
| `buildCognitiveContext` → checkpoints | the turn's own request persisted as work state | summary scrubbed, `nextAction` scrubbed, `pending` filtered; an emptied checkpoint is not emitted |
| `buildCognitiveContext` → projects | project names, queries, self-model project list | a project whose name quotes a deletion is hidden; `queries` filtered; self `projects`/`knows`/`goals` filtered |
| `formatCognitiveContext` | every section assembled from a dozen subsystems (autonomous work, self-study state, Studio work, cosmos inspection, checkpoints) | final backstop: the whole snapshot is sanitized once |
| `ProjectIntent.resolveIntent` | a self-study objective built from `checkpoint.nextAction` | next action scrubbed at the source |
| `CognitiveLoop` proposals | next objective from `checkpoint.nextAction` | scrubbed at the source |
| `OutcomeDerivation` | completion evidence from `checkpoint.pending` | filtered at the source |
| `CosmosInspector` | a scene description that quotes checkpoint text | scrubbed at the source |
| `MemoryBridge.enrich` → merged context | authorized recall, synthesized memory, identity providers, **external Supabase/OG archive**, project context | context-wide sentence scrub after every source has contributed, before the budget trims |
| `MemoryBridge.enrich` → dialogue turns | earlier user/assistant turns, historical summaries | `sanitizeMessages` scrubs every turn except the newest user message |
| Provider payload | whatever survived all of the above | the same `sanitizeMessages` is applied to the final `request.messages`; the broker receives the scrubbed body |
| `PatternMemory.add` (write side) | background learning / self-study / cloud hydration re-introducing the text | machine-origin records quoting a tombstone are refused; a tombstoned id is never restored |

## Why sentence-granular, and why that is the safe direction

The guard splits text into sentences (and lines) and removes a segment when a
six-token window matches a tombstone. If a sentence both quotes a deleted
statement and carries an unrelated fact, the unrelated fact goes too. That is
deliberate: partial text of a deleted statement is still the deleted statement.
The alternative — rewriting around a match — would leave a readable ghost.

Verified in test K: `"Project update. The client approved the steel finish.
Remember <deleted statement>. Ship on Friday."` becomes the two unrelated
sentences, and clean text is returned as the **same string** with `removed: 0`.

## The browser proof

This is the acceptance evidence that matters, because it inspects a real provider
body rather than a unit-test fixture.

1. A memory was deleted (~tombstone recorded).
2. A checkpoint quoting it was written **after** the deletion, so storage
   definitely held the text.
3. `window.fetch` was patched to record outgoing bodies; one chat message was sent.
4. The captured request: `POST /api/model/groq/chat/completions`, **28,752 bytes**,
   model `openai/gpt-oss-120b`, containing the `## PROJECT CHECKPOINTS` section
   and the project name `Late residue probe`.
5. Occurrences of the deleted phrase in that body: **0**. Occurrences of the
   sentence fragment "my archive phrase is": **0**.
6. At the same moment, `lelu.projects.v1` **still contained** the phrase.

So the absence in the payload is not explained by cleaning: the stored copy was
there and the provider never saw it. The gate did that.

A second restart then healed the stored copy (`cleanedFields: 1`, 1 ms), and the
deleted text was absent from every persisted key (`verification.json` →
`storage.deletedTokensPersisted: []`).

## Concurrency

Deletion, migration, recall and a second scan were run interleaved with awaits
between them (scenario G). Result: the deletion was recorded, the migration
persisted, recall returned none of the deleted content, the store no longer quotes
the token, and the checkpoint that had been quoting it is gone. A second scan saw
nothing left to filter.

The ordering guarantee: `Brain.forgetMemory` records the tombstone **before** the
record is removed with no `await` in between, so no context assembly can run in
the gap. If the removal then fails, the tombstone is withdrawn.

## Cost

200 assemblies of a 40-line context block: **0.154 ms per assembly** on this
machine. The guard caches its tombstone index and rebuilds it only when the
ledger signature changes, so the per-call cost is tokenisation of the text being
filtered, not ledger work.

## What is not covered

- The **newest user message** is never scrubbed. A user who retypes the deleted
  fact is making a new statement; deleting their words would be a different bug.
  (L1)
- Derived stores (`SelfModel`'s persisted state, knowledge library, identity) are
  filtered when read into context but are not rewritten on disk. (L3)
- Telemetry/activity keys that might echo a tool result are not assembled into
  prompts by the audited paths, but they are not verified end to end. (L4)
