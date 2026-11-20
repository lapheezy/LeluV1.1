# WP06 — Transcripts and derived memory

M22.6 filtered every read of these stores and left the stored text alone. That
stopped the sentence reaching a provider, but each store still held a copy, and
each copy could be re-uploaded under a different shape. This workpackage decides,
per store, between **rewrite**, **scrub at write**, and **filter on read only** —
and writes down why.

## Decisions

| Store | Decision | Why |
|---|---|---|
| `knowledge_items` | **scrub at write** + existing read guard | Derived knowledge is a conclusion; editing it is safe. Test `L`. |
| `improvement_items` | **scrub at write** | Agent proposals are derived from worked material. |
| identity / journal / curiosity | **scrub at write** + read guard | Self-model text; same reasoning. |
| `projects` (checkpoints) | **scrub locally, then upload** | M22.6's `ProjectStore.forgetText` and the healer clean the local row; the next `persistProjects` carries the cleaned text. |
| `conversations` / `messages` | **filter on read, do not rewrite** | A transcript is the user's own record of what was said. Rewriting a chat because a memory was deleted destroys unrelated history and cannot be reversed. |
| `legacy_memories` | **exclude at the provider seam** | Read-only archive; nothing in v1.1 can delete from it. |

## Why transcripts are not rewritten

Deleting a memory is a statement about what LÉLU may *use*, not a request to
falsify the conversation in which it was said. A rewrite would:
* destroy the user's own words and the assistant's replies around them;
* be unrecoverable if the fingerprint was wrong;
* and could not be done server-side without a write path the client does not
  have for these rows anyway.

What must be true is that the text cannot reach a prompt or a provider. That is
enforced: `MemoryBridge` sanitizes dialogue turns, and the final payload gate in
`CognitiveContext.formatCognitiveContext` is the last gate before the request.
M22.6 verified this end to end in a browser (28,752-byte payload, zero
occurrences, storage still holding the phrase). This mission did not weaken it.

## Mixed records

The guard removes **sentences**, not records. A checkpoint that says "launch on
tuesday; the phrase was X" keeps the launch and loses the phrase. Unrelated work
survives by construction, which is also why over-removal rather than
under-removal is the chosen failure direction.

## Quarantine

Ambiguous legacy records are still never auto-deleted: they are quarantined for a
person to decide (M22.6). The M22.7 changes do not touch that path, and the full
suite (which includes the M22.5/M22.6 quarantine tests) still passes.

## Restatement

A new statement by the user is treated as new input: `PatternMemory.add` refuses
machine-written records that quote a tombstone, and the payload gate never
scrubs the newest user message. That distinction is unchanged and still covered
by the M22.6 tests.
