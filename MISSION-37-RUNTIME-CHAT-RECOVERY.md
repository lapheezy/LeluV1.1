# MISSION 37 — LÉLU RUNTIME & CHAT RECOVERY

Branch: `claude/lelu-voice-https-production-lvv519`
Integration branch: `integration/lelu-four-workforce-consolidation` (unchanged, still an ancestor)
Mission base: `44cf4bbb` — rebased onto the branch's current tip so the push is a fast-forward and no existing commit is discarded.

---

## 1. Root causes

### WP01 — memory runtime error (P0)

`undefined is not an object (evaluating 't[n.memoryType ?? this.defaultType(n.category)].push')`

Two independent places indexed a fixed map of the five cognitive layers with a value read from the memory record:

1. `MemorySynthesizer.groupByType` — `groups[type].push(memory)`. `groups` holds exactly
   `user | self | conversation | knowledge | system`. A record whose `memoryType` was anything else
   made the lookup `undefined` and `.push` threw.
2. `MemorySovereignty.decide` — `${pattern.keywords.join(" ")}` threw for a persisted record with no
   `keywords`. This runs in `authorize()`, i.e. **before** synthesis, inside the same turn.

Where non-canonical values come from: `memory_type` in the Supabase `memories` table, `metadata.memoryType`
in a hydrated snapshot, and legacy archive rows. Those records can carry the **scope** vocabulary
(`session`, `persistent-user`) or an older label (`episodic`, `semantic`, `runtime`), and every writer
before this change passed them through unchecked (`as ResponsePattern["memoryType"]`).

Because both reads happen inside `MemoryBridge.enrich`, the TypeError did not lose a memory — it lost the
**reply**. Reproduced before the fix: `session`, `persistent-user`, `episodic`, `bogus` → `Cannot read
properties of undefined (reading 'push')`.

### WP02 — provider latency & failover (P0)

Failover, cooldown, rate-limit classification and rung budgeting were already correct and covered
(90/90 provider tests). One real defect remained:

`ProviderResolver.executeRung` enforced its deadline by **aborting the rung signal only**. A provider that
does not wire that signal — an adapter whose fetch ignores it, or a generation that resolves late — left
`await` waiting with no deadline at all. Measured in the resolver's own harness: a stalled primary that
ignores the abort held the turn for its full 5005 ms even with an 800 ms rung budget, and the healthy
provider never got the turn. That is the "stalled response" class.

### WP03 — conversational context (P0)

Audited, no defect found beyond WP01 (the crash happened inside the turn's memory enrichment, so it took
the conversation with it). Current behaviour, verified by the existing suites:

- history comes from **this** conversation only (`resolveTurnHistory`); the brain's shared window is used
  only when no chat store exists;
- the current message travels as `prompt`, never duplicated into `messages`;
- `fitRequestBudget` protects the most recent 12 messages when trimming;
- cross-conversation material is labelled or deferred by `MemorySovereignty`;
- session isolation is enforced in the store (`PatternMemory.search → isEligible`).

### WP04 — engineering gateway (P1)

Two distinct failures, both reproduced against a running dev server:

1. **The runtime was present but disabled.** `GET /api/engineer/status` answered
   `503 {"ok":false,"disabled":true,"error":"… LELU_ENGINEER_TOKEN is not set …"}`. `SourceAccess.fetchJson`
   threw `'/api/engineer/status responded 503'`, discarding that explanation, so every caller said
   "No development runtime is serving /api/engineer here" and advised starting `npm run dev` — advice that
   does nothing for an already-running, disabled runtime. `SelfDevelopmentLoop` blocked on that message.
2. **The read-only operation could never run.** `ENGINEER_OPERATIONS.inspect` was
   `node --version && bun --version && pwd`; `plugins/commandSafety.ts` refuses any command containing a
   shell metacharacter (`&` included) before it reaches `shell: true`. So `inspect` always failed with
   `Command refused: it contains the shell metacharacter "&"` — the one level-2 operation that proves the
   runtime can execute anything.

### WP05 — mobile chat interface (P1)

`planPresence` offered the "peeking over its top edge" placement (`focus.top - height * 0.55`) for **any**
chat window. On a phone the chat is ~96% of the width and its transcript begins directly under the header,
so half a body over that edge is half a body over the messages. Measured on a 390×844 layout with a
floating sheet: the chosen placement overlapped the conversation by 120×88 px. Non-peek candidates
(the right-edge rest) were never checked against the conversation at all, only against the composer and
controls.

---

## 2. Files and functions modified

| File | Change |
| --- | --- |
| `src/brain/ResponsePattern.ts` | new `MEMORY_TYPES`, `defaultMemoryType`, `normalizeMemoryType`, `isMemoryType`, `sanitizeMemoryRecord` |
| `src/brain/MemorySynthesizer.ts` | `synthesize` sanitises input; `groupByType` uses `normalizeMemoryType` + bucket guard; `defaultType` removed (one mapping, in ResponsePattern) |
| `src/brain/MemoryEngine.ts` | `create` persists a canonical layer only |
| `src/brain/PatternMemory.ts` | hydration normalises `metadata.memoryType`; tags/keywords coerced to string arrays; search guard |
| `src/core/persistence/SupabasePersistence.ts` | `toMemory` normalises `memory_type` on read |
| `src/core/memory/MemorySovereignty.ts` | `decide` reads keywords defensively |
| `src/core/MemoryBridge.ts` | `enrich` sanitises recall before authorisation; `reflect()` and `synthesizeContext()` contained so memory work cannot fail a turn |
| `src/core/router/ProviderResolver.ts` | `executeRung` races each attempt against the rung deadline (`attempt()`, `deadline`, `timeoutError`) |
| `src/core/selfdev/SourceAccess.ts` | `fetchJson` surfaces the runtime's own error body on non-2xx |
| `src/core/engineering/EngineeringWorkspace.ts` | new `runtimeReason()`; `describe()` carries the reason |
| `src/core/selfdev/SelfDevelopmentLoop.ts` | `developProposal` reports the real cause and the matching recovery step |
| `plugins/engineerApi.ts` | `inspect` → `node scripts/inspect-runtime.mjs` |
| `scripts/inspect-runtime.mjs` | new: prints node/bun version, cwd, platform in one metacharacter-free process |
| `src/app/scene/genesis/avatar/spatialPresence.ts` | `planPresence`: full-width windows use the strip above instead of a 45%-inside peek; non-edge placements may not cover the conversation |
| `tests/mission37-runtime-recovery.test.ts` | new: 18 regression tests |

---

## 3. Completed fixes

- Every layer value resolves to one of the five (`session`/`temporary`/`episodic` → conversation,
  `persistent-user`/`personal` → user, `semantic` → knowledge, `identity` → self, `runtime`/`engineering`
  → system); anything else falls back to the category's layer. Write side, hydration side, Supabase read
  side and the synthesiser all use the same function.
- Malformed records (no `keywords`, no `context`, no `importance`/`confidence`, no `category`,
  non-array keywords, non-objects) are repaired or dropped once, at the door, before authorisation.
- Memory failures are contained twice: the records are made readable, **and** synthesis/reflection are
  wrapped so an unforeseen failure costs a context section, never the reply.
- The provider chain advances when its rung deadline elapses, whether or not the provider honours the
  abort, so a silent provider cannot hold the turn.
- The engineering gateway's failure is now the runtime's own sentence, and the self-development block
  tells the operator to set `LELU_ENGINEER_TOKEN` + `VITE_LELU_ENGINEER_TOKEN` when the runtime is
  disabled instead of telling them to start a server that is already running.
- `inspect` executes: `{"ok":true,"status":0,"stdout":"node v26.13.0\nbun 1.4.4\ncwd …","durationMs":103}`.
- Her presence stands clear of the conversation and the composer on a phone; desktop placement is
  unchanged (the peek/lean placements are still offered for windows narrower than 82% of the viewport).

---

## 4. Test results

`npm test` (full suite, `tests/*.test.ts` minus the live end-to-end file):

```
ℹ tests 3354   ℹ pass 3331   ℹ fail 6   ℹ duration_ms 651472
```

The 6 failures are **not** from this mission. Five reproduce identically on the unmodified base
(`git stash` → same 5 failures), and the sixth (`pause holds the work and resume picks up the same
objective`) is timing-sensitive under full-suite load and passes when rerun:

| Test | Status on this branch | Status on unmodified base |
| --- | --- | --- |
| `network: TCP, UDP, DNS and fetch all fail` | fail | fail |
| `no workflow hands a provider credential to a build` | fail | fail |
| `she changes on her own by occasion, and keeps a look a person chose` | fail | fail |
| `the coat and catsuit handbags are their own nodes` | fail | fail |
| `the three sources are ordered per component, not per source` | fail | fail |
| `pause holds the work and resume picks up the same objective` | fail (load), pass on rerun | pass |

Targeted suites after the rebase:

```
tests/mission37-runtime-recovery.test.ts          18/18
memory-*, provider-*, context-sovereignty,
conversation-memory, spatial-presence,
avatar-presence                                   260/260
```

`npx tsc -b --force`: clean. `oxlint` on every changed file: 0 warnings, 0 errors.

Covered by the new tests: all five layers, aliased and unknown layers, malformed metadata, writes across
identity/preference/goal/project/skill/relationship/general, the exact production crash through
`MemoryBridge.enrich`, synthesis failure, reflection failure, a provider that ignores the abort signal,
every whitelisted engineering command against the command guard, and phone presence geometry.

---

## 5. Before / after measurements

Provider chain (the resolver's own harness, fake providers):

| Scenario | Before | After |
| --- | --- | --- |
| healthy primary answers in 30 ms | 59 ms | 59 ms |
| primary 429 → secondary answers in 60 ms | 64 ms | 64 ms |
| primary stalls 5 s and ignores the abort, rung budget 800 ms | **5005 ms, answered by the stalled provider** | 250 ms rung → secondary answers (measured 559 ms including registry init) |
| every provider fails | 3 ms → offline notice | 3 ms → offline notice |

Memory enrichment (`MemoryBridge.enrich`, 40–41 recalled records, median of 5):

| Input | Before | After |
| --- | --- | --- |
| 40 well-formed memories | ~28 ms (unchanged path) | 28.2 ms |
| 41 memories incl. 12 aliased/malformed | **TypeError — no reply** | 22.9 ms, 38 authorised, 631 chars of context |
| `MemorySynthesizer.synthesize` over the messy set | crash | 0.141 ms/turn (1000 runs) |

Engineering gateway (live dev server, `vite-dev`):

| Probe | Before | After |
| --- | --- | --- |
| `GET /api/engineer/status` without a token | 503, reason discarded | 503, full reason preserved in `RuntimeStatus.error` |
| `GET /api/engineer/status` with a token | 200 | 200, `workspaceRoot` resolved |
| `POST /api/engineer/command {inspect}` | refused: `"&"` | `ok:true, status 0`, 103–120 ms |
| `POST /api/engineer/read {package.json}` | ok | ok (bounded read, real file) |

---

## 6. Remaining issues

- The five full-suite failures above are pre-existing and untouched by this mission; they are unrelated to
  memory, providers, conversation or the engineering gateway.
- **Mobile layout was not viewed in a browser.** This environment has no browser and no Playwright
  chromium, so WP05 is verified by the pure placement geometry (unit test + measured layout rectangles),
  not by a screenshot. The visual result should be checked on a real phone.
- **No live provider latency was measured** — no provider credentials in this environment. Failover and
  stall behaviour are measured against the resolver with fake providers, which exercises the real budget,
  ordering and fallback code.
- A record whose stored layer is a *session* word (`session`, `episodic`) resolves to the conversation
  layer and is then **deferred** by the existing sovereignty rule when no originating session is recorded.
  That is a decision, not a crash (tested); if those legacy rows were meant to be durable, they need a
  provenance backfill rather than a layer guess.
- The engineering API remains fail-closed by design: enabling it on a host that runs commands requires
  `LELU_ENGINEER_TOKEN` on the server and `VITE_LELU_ENGINEER_TOKEN` in the client build.

---

## 7. Commits and branches

- Working branch: `claude/lelu-voice-https-production-lvv519`
- Local mission branch used for the work: `mission37/runtime-chat-recovery`
- Mission base: `44cf4bbb`, rebased onto the branch tip `2dcaacbe` (fast-forward push; no commit discarded)
- Integration branch `integration/lelu-four-workforce-consolidation` at `cb9aecdb` is still an ancestor
  of the candidate branch and was not modified.
