# WP01 — Baseline audit of M22.6

## Repository state at start

| Check | Result |
|---|---|
| Branch | `m22.6/memory-integrity-deletion-propagation` |
| HEAD | `21cb99dfe693faef8b7eb1adc1f009a5b3e8cf6a` — matches the mission's stated candidate |
| Tree | clean (0 entries) |
| Remote `m22.6/…` | `21cb99dfe693…` — identical to local |
| Remote `main` | `44bdd936892bc989b6b59fd5ecfb9502747e6a58` — unchanged |
| M22.5 implementation | `42a3606`, remote `freebuff/m22-5-historical-memory-residue` = `12d24071…`, unchanged |

Commands:

```bash
git branch --show-current && git rev-parse HEAD && git status --porcelain | wc -l
git ls-remote --heads origin refs/heads/m22.6/memory-integrity-deletion-propagation refs/heads/main
```

## What M22.6 actually left

Read in full before changing anything: `MISSION-22.6/` (12 documents, 4 JSON
evidence files, 2 screenshots) and
`docs/missions/MISSION-22.6-AUTONOMOUS-MEMORY-INTEGRITY.md`. Its own gates said
the cloud mirror was implemented but unverified, OG server-side deletion was
uncovered, and telemetry/profile were unaudited. This mission did not take that
on trust — each of those three was re-derived from the code below.

## Persistence authorities found (M22.6's list, extended)

M22.6 counted 18. This pass found **20 usable entries** once the remote tables
are enumerated individually instead of as "Supabase": `memory_items`,
`legacy_memories`, `memory_tombstones` (new), `knowledge_items`,
`cognitive_events`, `user_preferences` (profile), `user_preferences`
(identity/journal/curiosity documents), `projects`, `conversations`, `messages`,
`ui_state`, `agents`, `proactive_questions`, `improvement_items`,
`api_health`, `news_preferences`, plus the client-side project store, the local
memory store, the deletion ledger and the migration/healing records.

| Authority | Status at start | Action taken |
|---|---|---|
| Local projects (`lelu.projects.v1`) | M22.6 covered | regression only |
| IndexedDB memory (`lelu-memory`) | M22.6 covered | regression only |
| Local deletion ledger | M22.6 covered | extended (outbox, adoption) |
| `memory_items` (cloud mirror) | **partial** — row deleted, no evidence | **completed**: RPC + trigger + hydration import |
| Cloud mirror on other devices | **partial** | **completed**: tombstones adopted before merge |
| OG server-side `memory_items` | **uncovered** | **implemented** (`deleteMemory` → `erase_memory`) |
| `legacy_memories` (OG archive) | **uncovered** | audited: read-only; excluded at provider seam |
| `cognitive_events` (telemetry) | **uncovered** | audited; payload scrubbed at write |
| `user_preferences.profile` | **uncovered** | audited: not memory-derived; deliberately untouched |
| identity / journal / curiosity documents | **partial** | scrubbed at write, filtered on read |
| `knowledge_items` (derived knowledge) | **partial** | scrubbed at write, guard on read |
| `improvement_items` (agent proposals) | **uncovered** | scrubbed at write |
| `conversations` / `messages` (transcripts) | **partial** | policy defined (WP06), filtered on read |
| `projects` rows (checkpoints) | covered locally | upload carries locally-cleaned text |
| Checkpoints and objectives | M22.6 covered | regression only |
| Multi-provider context | M22.6 covered | regression only |
| `ui_state`, `api_health`, `news_preferences`, `proactive_questions`, `agents` | not memory-derived | audited, unchanged (WP05) |

## Deletion pathways in the application

1. Memory panel → `AIService.forgetMemory` → `Brain.forgetMemory` (store, graph,
   checkpoints) → cloud erase.
2. Conversation delete → `AIService.forgetConversation` → `Brain.forgetConversation`
   (session memories, graph) → cloud erase per id.
3. Reset → `Brain.reset` (tombstones recorded).
4. OG memory screen → `deleteMemory` server function.
5. Background: boot-time healer cleans provable residue (M22.6).

Known gaps left open are listed in `known-limitations` of the final report, not
hidden: profile, `legacy_memories` deletion, transcript rewriting.
