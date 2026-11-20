# M22.5 — memory lifecycle data flow

Every step below is a real path in this repository, with the file that owns it. The point of the diagram is the last row: what happens to each copy when the user deletes the record.

```
                    user statement
                          │
                     Brain.learn
                          │
        ┌─────────────────┼───────────────────────────────┐
        ▼                 ▼                               ▼
 PatternMemory      MemoryEngine                     ConversationEngine
 (lelu-memory /     (categories, confidence,         (session context,
  memories)          dedupe)                          history window)
        │                 │                               │
        │                 ▼                               ▼
        │          CognitionRuntime.observe          MultiChatStore
        │                 │                       lelu.multichat.workspace.v1
        │        ┌────────┴────────┐                      │
        │        ▼                 ▼                      ▼
        │  WorkspaceManager   KnowledgeGraph        transcript + activity
        │  (observations,     (nodes/edges,              │
        │   in memory)         in memory)                │
        │                                                │
        ▼                                                │
 MemoryBridge / CognitiveContext                          │
 (builds request.context per turn)                        │
        │                                                 │
        ├── ## MEMORY / synthesis   ◄── rebuilt every turn │
        ├── ## REFLECTION           ◄── rebuilt every turn │
        ├── ## PROJECT CHECKPOINTS  ◄── lelu.projects.v1 ──┼── Orchestrator.persistCheckpointFromRequest
        ├── ## RELATED CHATS (not authorized)              │
        └── ## RESEARCH FROM OTHER CHATS (authorized) ◄────┘   (conversationMaterial, labelled)
                          │
                          ▼
                 request.context + priorTurnsFor(conversationId)
                          │
                          ▼
                    provider payload
```

## What deletion has to reach

| Copy | Store | Removed by | If not removed |
| --- | --- | --- | --- |
| memory record | IndexedDB `lelu-memory/memories` | `PatternMemory.remove` | recalled again |
| observation | in-memory workspace | `WorkspaceManager.forgetMemory` | surfaced in the workspace snapshot |
| graph node | in-memory graph | `CognitiveCore.forgetMemory` | reasoning links it |
| checkpoint | `lelu.projects.v1` | M22.4 `ProjectStore.forgetText`; M22.5 migration for older copies | **re-injected into every prompt** |
| tombstone | `lelu.memory.deletions.v1` | written *at* deletion | migration could not prove later copies |
| transcript | `lelu.multichat.workspace.v1` | conversation deletion only | **intentional**: the user's own history |
| synthesis / reflection | none (rebuilt) | nothing to remove | none observed |
| payload | built per turn | rebuilt from cleaned stores | — |

## M22.5 migration flow

```
DeletionLedger.record(id, prompt+response, conversationId)
        │   hashed 6-token windows only — no text
        ▼
ResidueMigration.run({dryRun:true})            ◄── panel opens with this
        │   scan ProjectStore: checkpoint fields, project text, items
        │   match each field against tombstones
        │   quarantine auto-created legacy checkpoints with no match
        ▼
ResidueMigration.run({dryRun:false})
        │   redact only matched fields (or drop a matched item)
        │   checkpoint emptied → checkpoint removed
        │   progress cursor per project id (limit) → resumable
        │   report → lelu.memory.migration.v1
        ▼
explicit review (Forget / Keep) for quarantined checkpoints
        │   Forget → ProjectStore.clearCheckpoint(projectId)
        │   Keep   → dismissed id, never deleted
        ▼
next turn: CognitiveContext rebuilds from the cleaned store
```

## Boundaries this flow keeps

- Deleting a memory never deletes a conversation, a project, its items, or unrelated checkpoint fields.
- A copy is removed only when a tombstone proves what it quotes. Otherwise it is quarantined for the user, never guessed at.
- The ledger is one-way: it can prove a text quotes a deleted statement, it cannot reproduce it.
