# LÉLU V1.1 — recovery and integration report

Date: 2026-11-01. Branch `freebuff/b6da3caf29b9fda0e880006b`.
Merge commit `66557f2`. Backup of the pre-merge branch:
`backup/pre-avatar-merge` = `fad3bd2`. **Nothing was pushed.**

---

## 1. Branches and commits discovered

The two commits named in the brief: `e95cee5` exists (inside
`claude/avatar-3d-world`); `d1e21c4` exists and is the tip of
`claude/cosmos-chat-experience-z6xja0`. The real tip of the avatar line had
moved forward to `c2b9f88`.

| Remote branch | Tip | Date | Contains every other line? |
|---|---|---|---|
| `claude/avatar-3d-world` | **c2b9f88** | 2026-11-01 | **yes** |
| `claude/cosmos-chat-experience-z6xja0` | d1e21c4 | 2026-10-31 | contained in c2b9f88 |
| `claude/lelu-continuous-cognition-92p3jy` | d3e6e75 | 2026-10-31 | contained in c2b9f88 |
| `claude/open-session-rbwmdw` | e7b667b | 2026-10-30 | base of both lines |
| `main` and `should-not-exist` | 44bdd93 | 2026-10-08 | old, contained |
| claude-redesign (`9067818`, `b2d1e41`) | 2026-10-26 | contained |
| `freebuff/4737-4315072` | 9be834b | 2026-10-31 | **not** contained (older base) |

`git branch -r --contains` verified containment, not commit subjects.

## 2. What was actually wrong — and what was recovered

Nothing was lost. **The preview was showing an old branch.** This branch was
cut from `claude/open-session-rbwmdw` (`e7b667b`); the work continued on
`claude/avatar-3d-world`, which shares that exact base and adds **55
commits**, including every other Claude line merged in (`89dc39e`, `da9d251`,
`191ec3a`).

Recovered by one merge (`66557f2`, 352 files, +29,262/−6,458):

- **3D avatar**: `6738c4e` "One LÉLU everywhere: the Forge 3D model in the
  companion and the Cosmos", `5ca5818` head-swapped rig with fixed eyes,
  `6738566` face projection, `b3d51e7` her face behind the chat text and her
  own docked window, `c2b9f88` seated life, walking off.
- **Animation/behaviour**: `97f161a` animations and gestures on every
  surface, **no caption cards**; `1d52561` face/gaze/speech/body language and
  the wearable hood slot; `30bdc38` hood-up/down looks.
- **Voice**: `a718645` Whisper fallback + turn detection + no duplicate
  turns; `8e60abb` turn detection on the audio thread; `324f124` barge-in
  cancels a turn.
- **Chat / multi-chat / Cosmos**: `d8a6e7f` persistent history, tabs inside
  the chat, keyboard-safe phone layout; `650702b` OG tabs/toasts/phone menu;
  `a4d3a7c` Cosmos yields to the conversation (render budget); `7270ab2`
  GenesisCore stable actions.
- **AI runtime**: `8bb9f0e` Anthropic primary and no false "key not set";
  `93f8dc0` accept `LELU_ANTHROPIC_API_KEY`; `5eee601` current model, tool
  loop, refusals, retries, broker limits; `ec090f5` real orchestration and
  cancellation; `711aa5b` agentic core with approval gate.
- **Supabase**: `315ce11` persistence also resolves the server-published
  `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`.
- **World/Forge**: `8e774d7` LÉLUVERSE world engine (rooms, physics,
  versions); `e78467f` room generation + persistent avatar state; the whole
  Meshy Forge pipeline and 8 Blender stages under `scripts/blender/`.
- **Production**: `ca96b25` production server with `/healthz`, streamed
  assets, owner access gate; `cc6c7eb` Contabo kit (`deploy/contabo/*`:
  install, systemd app/backup/health-watchdog, Caddy HTTPS, update with
  rollback).

### Conflicts (3 files, resolved by hand)

| File | Resolution |
|---|---|
| `server.ts` | Kept **this branch's** conditional/Range/streaming static handler (the new side reverted to a plain `createReadStream`, which would have dropped ETags and ranges), kept the new `execSync`/`accessGate`/`VERSION` wiring, and combined the startup log so it reports both the engineering posture and the access gate. |
| `Avatar3DReconstructor.ts` | Kept this branch's **memory-only fallback** for a paid model and took the new `meshyTaskId` (`finished.meshyTaskId ?? finished.id`), plus the restored `sizeKb` the new message text needs. |
| `LeluCompanion.tsx` | Took **theirs**: the new geometry/docked-window design supersedes the run-29 auto-placement (`chooseSpot`/500 ms `reconsider` no longer exists there). `CompanionStore` keeps `EDGE_MARGIN` 100 and the 0.1/0.15 default spot. |

## 3. Supabase — **not connected**, and the exact reason

The code is present and the integration survived the merge (94 files
reference Supabase; the client resolves `VITE_SUPABASE_URL` /
`VITE_SUPABASE_PUBLISHABLE_KEY`, and the server also accepts the
server-published `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`).

**There is no credential in this environment.** `.env.local` is 599 bytes of
placeholders — seven names with empty values:

```
Anthropic=
Elevenlabs=
Github=
Groq=
Meshy=
Openrouter=
Supabase=
```

None of those is a name the code reads, and none has a value. So Supabase
cannot authenticate, read a profile, save a conversation, or persist memory
here. That is a configuration gap, not a code defect — and no mock was
substituted to hide it.

**To connect, provide** (in `.env.local`, and as repository/host secrets):

| Variable | Used by | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | client | published to the browser, safe |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | client | publishable/anon key only |
| `SUPABASE_URL` | server | same project URL |
| `SUPABASE_PUBLISHABLE_KEY` | server | same publishable key |

A service-role key, if ever used, must be server-only and **never** in a
`VITE_` name. Existing RLS is untouched: no migration, no policy, and no
project was created or duplicated.

## 4. LÉLU CORE

Recovered and wired: the merged tree contains the chat controller, AI
service, provider registry, SHAMAN routing, executive board, agent systems,
memory garden, personality development, curiosity engine and `DailyRecord`.
The 2026-10-31 commits make Anthropic primary with Groq as fallback and add
real orchestration with cancellation.

It cannot be demonstrated live **here** because every provider key is empty
(§3). The UI's "all providers unreachable" message is therefore accurate for
this environment, not a regression.

## 5. Anthropic / Groq

Accepted key names, read server-side (`plugins/modelApi.ts`):
`VITE_ANTHROPIC_API_KEY`, `ANTHROPIC_API_KEY`, `LELU_ANTHROPIC_API_KEY`,
`CLAUDE_API_KEY`; Groq likewise through its provider. All absent here → no
live request was made and none is claimed. The mobile screenshot shipped by
the Cosmos branch shows "LÉLU is routing to Anthropic · 3 operations", i.e.
the path worked when a key was supplied.

## 6. 3D avatar

Recovered in code: `LeluCharacter` renders the Forge model (GLB) through the
Suspense boundary and falls back to the 2D portrait only when there is no
model or no WebGL (`data-fallback="missing" | "no-webgl"`).
`LeluV2Presence` is "the ONE authoritative LÉLU avatar" inside Genesis V2 and
drives `Avatar3DReconstructor`, `LeluModelSource`, `LeluBody` and the shared
activity/mode bus. `LeluCompanion` renders `LeluCharacter` with
`framing="face"` behind the chat text and `framing="full"` in her window.

**Not visually verified**: no browser can start in this container, so I am
not claiming that the model loads on screen. The 2D cutout is a *fallback*
path in the new code, not the primary renderer.

## 7. Live voice

Recovered in code: `VoiceEngine` speech activity, turn detection on the audio
thread, Whisper fallback, barge-in cancellation, speaking/listening
animation hooks, and no caption cards (`97f161a`). Untested: this container
has no microphone and no browser, so no
microphone→AI→audio interaction was performed and none is claimed.

## 8. Genesis / Cosmos

Recovered and merged: Genesis V2, the Cosmos renderer, the render budget that
lets the conversation take frame time, the half-sheet world on phone, and the
overlap fixes for OG tabs/toasts/phone menu. `deploy`-independent.

## 9. Multi-chat and multi-window

Recovered: tabs inside the chat with independent streams, persistent history,
keyboard-safe phone layout and workspace-beside-chat (`d8a6e7f`, `191ec3a`).
Visible in the branch's own screenshots below (two tabs, "Engineering" and
"Hi LÉLU — this is the Cosmo…").

## 10. Cognition, memory, SHAMAN

Present and merged (SHAMAN routing, executive board/galaxies, Agent Forge,
Memory Garden, personality development, curiosity engine, DailyRecord, the
27–30 self-improvement runs). **Caveat:** 19 tests in the merged suite fail,
and the memory-phase and SHAMAN-tool-call assertions are among them (§14).

## 11. Security regression — clean

Re-verified **after** the merge, on the merged tree:

| Check | Result |
|---|---|
| `scripts/verify-engineer-auth.mjs` | **33/33** (`docs/evidence/engineer-auth/2026-11-01T03-27-56/`) |
| `scripts/verify-asset-caching.mjs` | **33/33** (`docs/evidence/asset-caching/2026-11-01T03-27-57/`) |

`plugins/engineerAuth.ts` survived the merge and is still called by
`engineerApi.ts` and `selfViewApi.ts`; `public/sw.js` still excludes models
and is still `lelu-v2`; `/healthz` answers on the production server.

## 12. Contabo deployment

Two kits now coexist, deliberately:

- this branch's `deploy/` (Dockerfile, compose, Caddy, nginx, systemd) plus
  `docs/CONTABO_DEPLOYMENT.md`;
- the recovered branch's `deploy/contabo/` (install.sh, update.sh with
  rollback, backup.sh + timer, healthcheck.sh + timer, Caddy, systemd,
  `lelu.env.example`) and its production server (access gate, `/healthz`,
  graceful shutdown).

Neither was executed here — there is no Docker and no systemd in this
container. Unverified by execution.

## 13. Screenshots

The recovered branch's own captures are in `docs/cosmos-experience/`
(desktop chat with tabs; mobile history; mobile keyboard; mobile half-sheet
world). The mobile one records LÉLU saying *"chat is working, but my avatar
isn't loaded in the Cosmos yet"* — that capture predates the "One LÉLU
everywhere" commits.

**No new screenshots were taken by me**: Chromium cannot launch here
(`libnspr4.so`). Deliverable 13 is therefore partial and reported as such.

## 14. Test and build evidence

| Check | Result |
|---|---|
| `bun run typecheck` | exit 0 |
| `bun run build` | exit 0 (3.31 s) |
| `bun run lint` | 0 errors, 89 warnings |
| Full suite | **1147 / 1165 pass, 18 fail** |

**The failures are pre-existing on the recovered branch, not caused by this
merge.** Proven by extracting a pristine copy of `c2b9f88` (`git archive`)
and running the same files: it fails the **same 19** tests. The merge adds
none.

The failing set, by cause:

- **Browser-dependent (3)**: `self-view.test.ts` layout captures and
  `genesis-interface.test.tsx` — Chromium cannot start here
  (`libnspr4.so`).
- **AI-service structure (6)**: "AIService must create exactly one
  AbortController (in chat())", "every provider combines request.signal with
  its timeout", Anthropic tool-stream and error-stream assertions,
  "temperature is never sent to a Claude model", "stopping a turn mid tool
  loop". These contradict the newer cancellation design that the adjacent
  passing test describes ("cancelTurn is the single cancellation entry
  point"), i.e. stale expectations on that branch. **Not fixed by weakening
  or deleting them.**
- **Memory/relay (4)**: "the memory phase events are missing", recalled-count
  from result, failed-recall reporting, "Meshy is reached through the relay"
  vs the browser env allowlist.
- **Other (2)**: identity-matcher ordering, SHAMAN `agent_delegate` tool call.

## 15. Blockers

1. **No credentials at all** — the single biggest blocker. `.env.local` is a
   placeholder template. Supabase, Anthropic, Groq, Meshy, Elevenlabs and
   OpenRouter cannot connect until real values exist (§3 gives the exact
   names for Supabase).
2. **No browser** in this container — avatar rendering, voice, lip sync,
   mobile layout, offline fallback and screenshots are unverified here.
3. **19 pre-existing failing tests** on the recovered branch, 3 of which are
   browser-only and 6 of which are stale AI-service assertions.
4. **Deployment kits unexecuted** (no Docker/systemd here).
5. Nothing was pushed; `backup/pre-avatar-merge` holds the pre-merge state.

## 16. Commit and branch status

```
66557f2  Recover the Claude avatar/Cosmos/voice line and keep the security hardening   <- HEAD
fad3bd2  Close the engineering runtime, and ship the deployment it was blocking
82a0cd0  Production cache policy
e7b667b  (shared base) LÉLU 3D Forge checkpoint
```

Branch `freebuff/b6da3caf29b9fda0e880006b`, local only. Remote heads were
fetched read-only; no remote branch was modified.
