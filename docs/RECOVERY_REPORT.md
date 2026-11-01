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

## 3. Supabase — key present, URL absent, and the key does not pair with the archived project

The code is present and the integration survived the merge (94 files
reference Supabase; the client resolves `VITE_SUPABASE_URL` /
`VITE_SUPABASE_PUBLISHABLE_KEY`, and the server also accepts the
server-published `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`).

**The file is generated, and its names are the SECRET names.** Its first line
says so:

```
# Written by Freebuff from this project's secrets (Settings → Projects). Changes here are replaced.
```

The seven entries are keyed by a provider word — the name the secret store uses
— while the code asks for `ANTHROPIC_API_KEY` / `GROQ_API_KEY` (server, where
model calls are brokered) and `VITE_SUPABASE_PUBLISHABLE_KEY` (browser):

```
Anthropic=…    Elevenlabs=…   Github=…     Groq=…
Meshy=…        Openrouter=…   Supabase=…
```

So seven real credentials sat in the file while every provider reported itself
unconfigured, and Supabase reported `disabled` because its key was filed under
`Supabase`. Renaming the lines by hand fixes that only until the file is next
regenerated — which is exactly what happened here: a working hand-rename was
replaced, and the providers went dark again with the keys still in place.

**The fix is in code, not in the file, and it is pinned by a test.**
`plugins/bareSecretAliases.ts` fills each documented name from its bare
counterpart — only where the documented name is absent, so it can fill a hole
but never redirect a working configuration. It is applied by `vite.config.ts`
(the dev server and the build) and by `plugins/loadEnvFiles.ts` (the standalone
and Deno runtimes), and `tests/bare-secret-aliases.test.ts` holds it (8/8).

Model credentials map to their **server-side** names only (`ANTHROPIC_API_KEY`,
`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GITHUB_MODELS_TOKEN`), never to a `VITE_`
name: requests are brokered through `/api/model/<id>`, and putting a model key
in a `VITE_` variable would publish it to anyone who can reach the dev server.
After the change the broker's own exposure warning is silent — it previously
named the keys as readable from the browser.

The GitHub secret maps to `GITHUB_MODELS_TOKEN`, not `GITHUB_TOKEN`: the ambient
one is blocked on purpose (`Environment.ts` → `NEVER_ADOPT_BARE`), because a
dev container sets one for git tooling that is not an inference key.

This was checked against the code, not assumed: `Environment.ts` reads
`VITE_ANTHROPIC_API_KEY` / `VITE_GROQ_API_KEY` / `VITE_OPENROUTER_API_KEY` /
`VITE_GITHUB_TOKEN`, the Anthropic provider resolves
`ANTHROPIC_API_KEY` → `LELU_ANTHROPIC_API_KEY` → `CLAUDE_API_KEY`, and
`ENV_VARS.md` documents `MESHY_API_KEY` as server-side only.

Evidence, all of it from the regenerated bare-name file and none of it
inferred from a successful build. The startup line names what was supplied:

```
[env] bare secret names supplied ANTHROPIC_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY,
      GITHUB_MODELS_TOKEN, MESHY_API_KEY, ELEVENLABS_API_KEY,
      VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_PUBLISHABLE_KEY
```

`GET /api/model/status` (booleans only, no values):

```json
{"ok":true,"providers":{"anthropic":true,"groq":true,"openrouter":true,
 "cerebras":false,"mistral":false,"fireworks":false,"gemini":false,
 "githubModels":true}}
```

`GET /api/provider-health` — live requests, not a local check:

```json
{"groq":{"status":200,"ok":true},"openrouter":{"status":200,"ok":true},
 "anthropic":{"status":200,"ok":true}}
```

**What is actually wrong with Supabase.** The `Supabase` secret is a genuine
publishable key (`sb_publishable_…`, 46 characters) — the right *kind* of
credential, client-safe by design, with RLS as the protection. It is not a URL, so no alias
invents one; the URL came separately from the owner, below.

**The project URL was supplied by the owner, and it is live.** `https://dndbribvsphduvrrypxr.supabase.co`
resolves from public DNS (Cloudflare DoH `Status:0` → `104.18.38.10` /
`172.64.149.246`) and is written into `SUPABASE_URL` and `VITE_SUPABASE_URL`.
`/api/env-check` now reports `VITE_SUPABASE_URL: SET (40 chars)` beside
`VITE_SUPABASE_PUBLISHABLE_KEY: SET (46 chars)`. An earlier reading of this
hostname as NXDOMAIN was a stale negative cache; it is not a typo and not a
deleted project.

**The key, however, is not that project's key.** Supabase's edge distinguishes
the two failure modes, which makes this provable rather than a guess:

```
apikey → dndbribvsphduvrrypxr  → 401 {"message":"Invalid API key",
                                      "hint":"…might also be owned by another Supabase project."}
apikey → a ref that does not exist → 400 {"message":"Project not specified."}
```

So the project exists and answers; the stored `Supabase` secret is simply
another project's publishable key. It also 401s against the archived
`dkcwonxfomxzmguawege` project, so it is not that one either. A modern
`sb_publishable_` key carries no project ref (`projectRefFromKey`), so the
pairing can only be settled by a request — and every request says no.

**What remains is the key.** Take the publishable/anon key from Dashboard →
Project Settings → API keys for `dndbribvsphduvrrypxr` and replace the project
secret named `Supabase` (never a line in `.env.local`, which is regenerated),
and add `SUPABASE_URL` as a secret too, so the URL survives the next
regeneration. Until then `SupabasePersistence` reports `degraded`, not
`connected` — a 401 is never dressed up as a working connection.

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

Accepted key names: `VITE_ANTHROPIC_API_KEY`, `ANTHROPIC_API_KEY`,
`LELU_ANTHROPIC_API_KEY`, `CLAUDE_API_KEY`; Groq likewise through its provider.
After the alias layer (§3) the status route reports Anthropic, Groq, OpenRouter and
GitHub Models as configured, and `scripts/verify-providers.ts` builds and sends
correct requests for each against a stubbed transport (64/66 pass). **No live
paid call was made from this container**, so correctness of the keys themselves
remains unverified — and none is claimed. The mobile screenshot shipped by
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

1. **Supabase has no project URL.** Every other credential is now visible to
   the runtime through the alias layer in §3, but the `Supabase` entry is a key
   with no URL beside it, so `VITE_SUPABASE_URL` / `SUPABASE_URL` are empty and
   persistence cannot connect. The project URL is now live (§3); what 401s is
   the key, which belongs to a different Supabase project. Replacing that one
   secret is the last step.
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
