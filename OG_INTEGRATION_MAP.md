# LÉLU v1.1 — OG HYBRID INTEGRATION · PHASE 1 ARCHITECTURE MAP

Produced by inspecting the actual sources, not from assumption:
`lelupheru-main.zip` (OG, 13,679 lines) against LÉLU v1.1 (131,837 lines).

---

## 1. THE OG SURFACES

The OG app is a **TanStack Router** file-based app with **TanStack Start**
SSR and server functions. It has three UI surfaces plus a chat deep-link:

| Route | Surface | Files |
| --- | --- | --- |
| `/` | **Universe** — 3D Florida-sunset horizon, tap the sun to speak | `components/universe/` — `UniverseScene`, `Sun`, `SunHub`, `ChatPanel`, `AuthPanel` |
| `/core` | **Core** — window-manager desktop, dockable panels | `components/core/` — `Core`, `CoreMenu`, `PanelDock`, `PanelRouter`, `WindowManager`, `ProcessingDock`, `StatusBar` + 11 panels |
| `/app/*` | **Inner Sky** — conventional app shell | `components/app/AppShell.tsx` + `routes/app/{index,chats,agents,memories,files,universes,queue,settings}` |
| `/chat/$threadId` | Chat deep-link | — |

**The two UIs the brief refers to are `Core` and `Inner Sky`/chat.** `Universe`
is the unauthenticated landing scene, and it overlaps heavily with what v1.1
already has in `src/app/scene/genesis/` (GenesisV2Scene3D, CosmosVisuals,
PlanetExplorer).

### Core panels (OG UI #1)
`AgentsPanel`, `ChatPanelWrap`, `ExecutivePanel`, `FilesPanel`, `LogsPanel`,
`MemoryLogPanel`, `MemoryPanel`, `ProjectsPanel`, `ResearchPanel`,
`SettingsPanel`, `VoicePanel` (15KB — the largest panel).

### OG server-side libraries
`lib/*.functions.ts` are TanStack Start **server functions**:
`conversations`, `conversation-admin`, `memories`, `memory-events`, `files`,
`horizons`, `queue`, `research`, `universes`, `system`.
Plus `lib/voice-engine.ts` and `lib/ai-gateway.server.ts`.

---

## 2. THE OG CHAT ENGINE

`src/routes/api/chat.ts` — 33KB, the single largest OG source file, and the
thing the brief calls "materially better."

It is a **server route**, and its brain is not portable as-is:

```
createFileRoute("/api/chat")
  ├── ai SDK: streamText, convertToModelMessages, tool(), stepCountIs
  ├── createLovableGateway()        ← Lovable's hosted AI gateway
  ├── createClient(...)             ← server-side Supabase, service role
  ├── tools: webSearch, scrapeUrl (Firecrawl), youtubeSearch, youtubeTranscript
  ├── chrono-node                   ← natural-language date parsing
  └── humanizeGatewayError()        ← maps 401/402/429 to human text
```

**What ports, and what does not:**

| Layer | Disposition |
| --- | --- |
| Tool definitions, prompt structure, step budget (`stepCountIs`) | **Port** onto v1.1 `ToolDispatcher` / `ToolRegistry` |
| Streaming contract, message shape, conversation flow | **Port** — this is the UX the brief wants preserved |
| Conversation persistence | **Port** behind a provider abstraction |
| `createLovableGateway` model calls | **Replace** with v1.1 `AIProviderRegistry` (brief §15 — v1.1 providers stay authoritative) |
| Server-route execution model | **Rewrite client-side** — see conflict C2 |

---

## 3. THREE HARD CONFLICTS THE BRIEF DID NOT ANTICIPATE

These are real and they gate the work. Each was verified against source.

### C1 — v1.1 has no router at all

```
src/App.tsx:
  import GenesisScene from "./app/scene/genesis/GenesisScene";
  export default function App() { return <GenesisScene />; }
```

No `react-router`, no `@tanstack/react-router`, no route table. Navigation in
v1.1 is panel state inside `GenesisDock` / `GenesisInterface`.

The brief says *"use the project's existing routing/navigation architecture"*
and *"do not create a second application router."* There is no first router to
reuse. Every OG UI is built around `createFileRoute`. Something must give.

### C2 — OG is SSR + server functions; v1.1 is a client-only SPA

OG's chat, memory, files, research and queue all run as **TanStack Start server
functions** with a service-role Supabase client. v1.1 ships as a **static SPA**
wrapped in **Capacitor for Android** — on a phone there is no server to call.

Every `*.functions.ts` and `*.server.ts` must be re-implemented as client-side
calls through v1.1's runtime, or fronted by `server.ts`/`main.ts` (which the
Android build does not run). This is the single largest chunk of work in the
brief, and it is unavoidable — it is not a porting detail.

### C3 — the styling stacks are mutually exclusive

| | OG | v1.1 |
| --- | --- | --- |
| Styling | Tailwind + `tw-animate-css` | inline `style={{}}` objects |
| Primitives | ~35 `@radix-ui/*` packages | none |
| State | `zustand` | none |
| Markdown | `react-markdown` | none |

v1.1's `components.json` is a **dead shadcn stub** — `tailwind`, `@radix-ui`
and `zustand` appear **zero** times in `package.json`.

Brief §2 says preserve the OG interfaces and *"do not redesign them into the
v1.1 UI."* Honouring that means adding Tailwind + ~35 Radix packages + zustand
to v1.1. That is additive and won't break v1.1's inline styles, but it roughly
doubles the dependency surface and affects the Android bundle.

---

## 4. WHAT MAPS CLEANLY ONTO v1.1

| OG capability | v1.1 counterpart | Action |
| --- | --- | --- |
| Model calls via Lovable gateway | `src/core/AIProviderRegistry.ts` + `src/providers/*` | Replace — v1.1 wins (§15) |
| Tool calling | `src/core/tools/ToolDispatcher.ts`, `ToolRegistry.ts` | Port OG tool defs into the registry |
| Agents | `src/core/agents/`, `src/core/orchestrator/` | Merge OG agent behaviour in |
| Memory | `src/core/memory/`, `MemoryBridge.ts` | Extend with OG memory-events + lifecycle controls (§9) |
| Supabase persistence | `src/core/persistence/SupabasePersistence.ts` | Already exists — becomes one `MemoryProvider` (§5) |
| Voice | `src/core/` voice + OG `lib/voice-engine.ts` | Unify on one cognition path (§14) |
| Research / URL ingestion | OG `research.server.ts` (Firecrawl, YouTube transcript) | New — port into the ingestion pipeline (§7, §8) |
| Cognition | v1.1 `src/core/cognition/` | Authoritative — OG has no equivalent |

**v1.1 has no ingestion pipeline at all.** §7/§8 (URL, link, file, note,
conversation ingestion) is net-new work, and OG supplies the useful parts:
Firecrawl `scrapeUrl`, `youtubeTranscript`, `chrono-node`.

---

## 5. BONUS FINDING — the Supabase URL

The OG `.env` names the project:

```
SUPABASE_URL = https://dkcwonxfomxzmguawege.supabase.co
```

A Supabase project URL is not a secret. This is the value missing from the
Lelu2 environment and the sole reason `SupabasePersistence` reports
`status = "disabled"`. The OG schema lives in `supabase/migrations/` (7
migrations) and is the historical data §19 refers to.

---

## 6. PHASE STATUS

- [x] **Phase 1 — Inspect.** Both architectures mapped from source.
- [x] **Phase 2 — Routing / UI.** react-router at `App.tsx`; OG Core and Inner
      Sky mounted lazily under `/og/*` with three compat layers.
- [x] **Phase 3 — Unify runtime.** OG chat serves turns through
      `AIService.chat()`. Verified with a live reply.
- [x] **Phase 4 — Memory / context bridge.** `MemoryOrchestrator` +
      `MemoryProvider`; Supabase demoted to one provider, failures isolated.
- [x] **Phase 5 — Ingestion.** `IngestionPipeline` + `ingestSource`, bounded
      at both ends.
- [x] **Phase 6 — Agents.** `AgentDepthGuard` in `AgentRunner`, plus
      insight-level consolidation into memory.
- [x] **Phase 7 — Mobile.** OG tabs in all three dock breakpoints, 44x44
      targets, no horizontal scroll at any size.
- [x] **Phase 8 — Memory safety.** `CognitiveBudget`; context bounded in
      `MemoryBridge.enrich()`.
- [x] **Phase 9 — Validate.** `bun run verify:hybrid` — 27/27 in a browser.
- [x] **Phase 10 — Final audit.** Below.

---

## 7. FINAL AUDIT — is there ONE LÉLU?

Checked against the source, not against intent:

| Question | Finding |
| --- | --- |
| Does OG call a model provider directly? | **No.** No reference to `AIProviderRegistry`, `ProviderResolver` or `.generate()` anywhere in `src/og`. Its only route to a model is `compat/chat.ts` → `AIService`. |
| Does OG run cognition of its own? | **No.** No `CognitiveLoop`, `CognitionRuntime`, `SelfStudyEngine` or `new Brain(...)` in `src/og`. |
| How many chat runtimes? | **One.** `AIService.chat()`. The OG `/api/chat` engine is deferred, not wired. |
| How many memory writers? | **One path.** `MemoryBridge` → brain, plus the provider layer and `SupabasePersistence` behind it. No OG writer. |
| How many routers? | **One.** `BrowserRouter` in `src/App.tsx`. |
| Did anything deferred reach the bundle? | **No.** The only mentions of `_deferred` outside that directory are documentation strings. |

`src/core` contains several classes named `*Orchestrator` — creative,
executive, UI. Those are pre-existing v1.1 domain orchestrators and predate
this work; they are not competing agent orchestrators. `AgentRunner` remains
the single path that runs an agent.

### Known remaining work

Honest about what is not done:

- **Supabase persistence is untested against a live project.** The provider
  layer, the OG archive reader and the degraded paths are all exercised, but
  no run has had `SUPABASE_URL` set. The URL is in §5 above.
- **§13 (authenticated external sources)** is not implemented. Ingestion
  handles public URLs; a login-gated source is detected as unreadable rather
  than triggering an auth flow.
- **YouTube and Firecrawl retrieval** are deferred with the OG originals.
  `runWebSearch` reports that honestly rather than returning empty results.
- **The OG landing scene** (`universe-index`) stays deferred — it overlaps
  v1.1's own Genesis cosmos, and the brief named Core and Inner Sky as the two
  UIs to preserve.
