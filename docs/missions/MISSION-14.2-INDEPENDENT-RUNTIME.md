# MISSION 14.2 — LÉLU INDEPENDENT RUNTIME

**Prompt:** `M14.2-WP05-P01` (independent-runtime continuation)  
**Branch:** `freebuff/8994d7c2e03123fc8927b6fc`  
**Base commit:** `a76bc18`  
**Status:** Implemented and locally verified. Remote Supabase account tests remain unavailable because no account or credentials were supplied.

---

## 1. Result

LÉLU now boots and operates with no Supabase configuration:

- Configuration resolves to `null`; no built-in project is substituted.
- `SupabasePersistence` reports `disabled`; no Supabase client is created.
- No `*.supabase.co` or `*.supabase.in` request occurs in local-only mode.
- Local identity, projects, conversations, cognition, knowledge graph and tool registry initialize.
- Local state survives reload through the existing `KvStore` / IndexedDB architecture.
- The eight-condition `MissionSyncGate` is unchanged and still governs remote mission sync.
- Supabase remains an optional adapter, selected only by explicit configuration.

The root defect was not a startup import. It was `SUPABASE_PUBLIC_DEFAULT`: an empty
environment was silently treated as a configured Supabase project. That made every
"is Supabase configured?" answer true and caused the optional adapter to create a
client and probe auth on a deployment that had supplied no credentials.

---

## 2. Dependency matrix

| System | Current authority | Supabase dependency | Local fallback | Verified |
|---|---|---|---|---|
| Startup | `main.tsx` → `GenesisScene` → `useLeluRuntime` → `runtimeKernel` / `LeluRuntime` | None; `AIService` starts persistence in a contained background block | Full local runtime | Live browser boot |
| Identity | `LeluIdentity`, `UserManager`, `UserProfileStore` | None | `KvStore`; `UserProfileStore` now falls back to `KvStore` when IndexedDB is unavailable | Browser + unit |
| Cognition | `CognitiveCore`, `CognitiveLoop`, `KnowledgeGraph` | None | In-process cognition | Runtime health `cognition: online` |
| Memory | `Brain`, `PatternMemory`, `IndexedDBStore`, conversation `KvStore` | None | IndexedDB / `KvStore` | Runtime health `memory: online` |
| Chat | `AIService`, `MultiChatStore` | None | `KvStore` workspace | Browser reload |
| Projects | `ProjectStore` | None | `KvStore` (`lelu.projects.v1`) | Browser reload + unit |
| Providers | `Environment`, `AIService`, server relay | None | Local deterministic paths; remote LLM remains optional | Runtime health `providers: online` |
| Tool authorization | `ToolRegistry`, `ToolDispatcher`, `ExecutionLedger` | Only the intentional real-project apply/commit identity boundary | `ToolRegistry` / local policy | Registry 192 tools; existing security tests |
| Tool execution | `ToolDispatcher` | None for local tools | In-process dispatch | Existing tool suites |
| Cosmos | `CosmosStore` derived from canonical `AgentStore`; camera/layout in `KvStore`; Forge placements in local filesystem | None | `KvStore` / local files | Browser health `cosmos: online` |
| Neural map / knowledge graph | `KnowledgeGraph` | None | **New:** `KvStore` (`lelu.cognition.knowledge.v1`), nodes, edges, provenance, revision | Unit reload test |
| Supabase adapter | `SupabasePersistence` | Optional only | Disabled when unconfigured | Unit + live no-request check |
| Mission sync | `MissionLedgerStore`, `MissionSyncGate` | None for local operation | Local ledger; remote writes remain gated | Existing gate tests |

### Intentional Supabase boundary

`EngineeringAuthorization` still requires an authenticated Supabase session before
applying or committing changes to a **real** project. That is a deliberate security
boundary for an external write, not a local-operation dependency. Local projects,
sandbox work and local tools remain available without it.

---

## 3. Before / after architecture

### Before

```text
UI boot
  └─ SupabasePersistence.initialize()
       └─ resolveSupabaseConfig()
            └─ no env? -> SUPABASE_PUBLIC_DEFAULT.url/key   (implicit)
                 └─ createClient()
                      └─ auth session probe / network activity
```

### After

```text
UI boot
  ├─ local runtime (LeluRuntime, CognitiveCore, ToolRegistry)
  ├─ local stores (KvStore, IndexedDB where available)
  │    ├─ identity / user profile
  │    ├─ projects
  │    ├─ conversations
  │    └─ knowledge graph nodes + relationships + revision
  └─ optional SupabasePersistence
       └─ resolveSupabaseConfig()
            ├─ explicit SUPABASE_URL + publishable key -> createClient
            ├─ explicit SUPABASE_USE_PUBLIC_DEFAULT=true -> built-in public identity
            └─ otherwise -> null / status "disabled" (no client, no request)
```

The local path is not conditional on the sync gate. The gate governs remote
synchronization only.

---

## 4. Files changed

| File | Reason |
|---|---|
| `src/core/config/supabaseEnv.ts` | Built-in public project is now opt-in via `SUPABASE_USE_PUBLIC_DEFAULT` / `VITE_SUPABASE_USE_PUBLIC_DEFAULT`; absent configuration resolves `null`. |
| `src/core/config/supabasePublic.ts` | Comments corrected: the public identity is not an implicit fallback. |
| `src/core/env/publicEnv.ts` | Browser-safe snapshot exposes the explicit opt-in flag. |
| `src/core/persistence/SupabasePersistence.ts` | Passes the browser flag to the shared resolver; adds a no-network `resetForTests()` seam. |
| `src/core/user/UserProfileStore.ts` | Falls back to `KvStore` if IndexedDB is unavailable, so local identity does not depend on one browser storage backend. |
| `src/og/integrations/supabase/client.ts` | OG client reads the same resolver and opt-in flag. |
| `src/core/cognition/KnowledgeGraph.ts` | Persists nodes, edges, `provenance: "local"`, revision and updated time through `KvStore`; hydrates on construction. |
| `tests/supabase-env.test.ts` | Updated expectations: empty env is local-only; public default requires the flag; refused admin keys do not open the public project. |
| `tests/local-only-operation.test.ts` | New acceptance coverage for local-only status, zero fetch, identity fallback, project/chat persistence, knowledge graph reload, and configured-adapter initialization without writes. |
| `docs/missions/MISSION-14.2-INDEPENDENT-RUNTIME.md` | This report. |

No new dependency, database, orchestration framework, identity system, memory system
or tool authority was introduced.

---

## 5. Local operating architecture

1. `LeluRuntime` and `CognitiveCore` initialize locally.
2. `LeluIdentity`, `UserManager` and `UserProfileStore` use local storage. The profile
   store prefers IndexedDB and falls back to the same `KvStore` used by the rest of
   the app if IndexedDB cannot open.
3. `ProjectStore` and `MultiChatStore` write through `KvStore`.
4. `KnowledgeGraph` writes nodes and relationships through `KvStore`; a new graph
   hydrates the same IDs, edges and revision.
5. `CognitiveLoop` and provider health are independent of Supabase.
6. `ToolRegistry` initializes locally and exposes authorized local tools.
7. `AIService` starts `SupabasePersistence` in a background block. With no explicit
   configuration that block receives `disabled` and returns without a client.
8. `LeluSignInGate` renders nothing when status is `disabled`; the UI reports
   "Cloud sync off" rather than a fatal error.
9. `MissionSyncGate` remains the only remote mission-sync authority.

### Persistence details

- `KvStore` is the canonical local store for identity, projects, conversations and
  the knowledge graph.
- `UserProfileStore` keeps IndexedDB as its preferred backend and treats an
  unavailable/blocked database as a fallback condition, not a fatal identity error.
- The knowledge graph envelope is:

```ts
{
  version: 1,
  provenance: "local",
  revision: number,
  updatedAt: number,
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
}
```

- Local writes are synchronous `KvStore` writes; failed writes leave the in-memory
  graph available and are not reported as remote success.
- No local store claims remote synchronization.

---

## 6. Acceptance evidence

### Local-only mode

Environment: no `SUPABASE_URL`, publishable key, or public-default flag in the shell
or `.env.local`.

| Check | Result | Evidence |
|---|---|---|
| LÉLU cold-starts | Pass | Live browser rendered the LÉLU home |
| Local identity/session | Pass | `UserManager` reload test + browser boot |
| Chat initializes | Pass | Local chat created, messaged and reloaded |
| Cognition initializes | Pass | Runtime health `cognition: online` |
| Memory initializes | Pass | Runtime health `memory: online` |
| Local projects create/edit/reopen/delete | Pass | Browser reload + unit test |
| Persistence survives reload | Pass | Project description and chat message found after reload |
| State after disconnect | Partial | Local reads verified; the cloud browser's CDP connection timed out during the offline probe |
| Missing config does not crash | Pass | Live boot and unit test |
| No Supabase network request | Pass | Browser performance entries filtered for `supabase.co` / `supabase.in` returned `[]` |
| No remote writes | Pass | No Supabase request in local-only mode |
| Eight blockers enforced | Pass | Existing `mission-sync-gate` / `mission-security` coverage |
| Security/persistence regressions | Pass with known baseline failures | Full suite below |

### Browser network instrumentation

Live page on the preview origin after boot and after reload:

```text
supabaseResources: []
externalHosts: ["cdn.jsdelivr.net"]
```

The only non-preview host observed was the static asset CDN. Supabase module code is
served by Vite as a local script, but no Supabase endpoint was contacted. No request
was sent to a Supabase URL.

Runtime health from the live page:

```json
{
  "cognition": "online",
  "memory": "online",
  "providers": "online",
  "ui": "online",
  "voice": "online",
  "cosmos": "online",
  "tasks": "online",
  "engines": "online",
  "world": "online",
  "overall": "online"
}
```

Tool registry from the live page: 192 tools; `cosmos.navigate` available with
`WRITE` permission. `project.list` was not offered in that session because the
browser runtime had not made the project capability available; this is a tool
availability state, not a Supabase failure.

### Supabase-configured mode

A separate unit test sets explicit test-only values:

```text
SUPABASE_URL=https://local-test.invalid
SUPABASE_PUBLISHABLE_KEY=sb_publishable_local_test
```

`SupabasePersistence.initialize()` reports `signed_out`, creates its optional client,
and performs no fetch or write before sign-in. The full remote sign-in and sync
round trip was **not** exercised because no real account, project or credentials were
supplied and no remote writes were authorized.

### Regression

Final full-suite command:

```text
npm test
tests 2251
pass 2241
fail 2
skipped 8
```

Known baseline failures, unchanged by this work:

1. `tests/genesis-interface.test.tsx` — `ERR_PACKAGE_PATH_NOT_EXPORTED` for
   `@excalidraw/excalidraw/index.css` under the current Node version.
2. `tests/sandbox-security.test.ts` — denial returns `''` where the test expects
   `/^denied:/`.

Typecheck and lint:

```text
npm run typecheck  -> 0 errors
npm run lint       -> 0 errors, 409 existing warnings
npm run build      -> success (6.06 s)
```

The build emits existing `INEFFECTIVE_DYNAMIC_IMPORT` warnings only.

---

## 7. Remaining limitations

- No authenticated Supabase account was available, so configured-mode verification
  is limited to local initialization and zero-write behavior. A real sign-in,
  hydration and sync round trip remains unverified.
- The live offline probe could not complete because the cloud browser's CDP
  connection timed out. Local persistence and offline status are covered by unit
  tests and by direct `KvStore` reload checks, not by a live disconnected browser.
- The knowledge graph is local-only. No remote graph sync was added.
- `KnowledgeGraph` is the branch's node/relationship graph. There is no separate
  module named `NeuralMap`; the Cosmos entity hierarchy remains derived from
  `AgentStore`, with camera/layout in `KvStore` and Forge placements in local files.
- The public Supabase identity remains in the source as an opt-in convenience
  (`SUPABASE_USE_PUBLIC_DEFAULT`). It is never used implicitly.
- `EngineeringAuthorization` still requires an authenticated session for real-project
  apply/commit by design. That boundary was not weakened.
- The two full-suite failures above pre-date this work and are unrelated to
  Supabase initialization.

---

## 8. Git

- Branch: `freebuff/8994d7c2e03123fc8927b6fc`
- Base commit: `a76bc18`
- Final commit: the commit created after the verified tree (HEAD at delivery)
- Push: not forced; see the final delivery message for the exact status.
