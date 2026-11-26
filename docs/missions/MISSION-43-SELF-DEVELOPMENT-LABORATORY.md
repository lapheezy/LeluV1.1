# Mission 43 — Autonomous Self-Discovery & Self-Development Laboratory

**Branch:** `freebuff/08af6cc9ef212913e6b7209b`
**Canonical HEAD at start and end of the work:** `543da7c` — *Replace the 2.1 hair shell with scalp-rooted volumetric locks*
**Repository:** `https://github.com/lapheezy/LeluV1.1.git` (credentials never read, never echoed — the laboratory sanitises the remote before it is displayed)
**Experiment branch created by the laboratory:** `lelu-lab/exp-engineer-ops` @ `374284a`
**Status of this branch:** all work uncommitted, nothing pushed, nothing deployed.

---

## 1. What this mission added

A real engineering environment, not a dashboard that describes one. Three parts:

| Part | File | What it really does |
| --- | --- | --- |
| Laboratory runtime | `plugins/labApi.ts` (~1,400 lines) | git authority, `git ls-remote` against GitHub, evidence-based discovery, isolated `git worktree` experiments, real command execution, genealogy, preview processes, evidence listing |
| Client | `src/core/selfdev/lab/LabClient.ts` | typed transport; carries the server-issued session token; surfaces refusals verbatim |
| Interface | `src/app/scene/genesis/GenesisSelfDevelopmentLab.tsx` | seven connected views inside the existing Self-Development window |

Mounted in both runtimes (`vite.config.ts`, `server.ts`), so it is not a dev-only capability.
`GenesisSelfDevPanel.tsx` gained a **Laboratory** tab; the nine existing tabs are unchanged.

State lives under `.lelu-lab/` (gitignored): `state/sync.json`, `state/discoveries.json`,
`state/journal.jsonl`, `state/experiments.json`, `experiments/<id>/`.

---

## 2. WP01 — GitHub connectivity, demonstrated

`GET /api/lab/status` reads the repository itself:

```json
{"repository":{"remote":"https://github.com/lapheezy/LeluV1.1.git",
 "branch":"freebuff/08af6cc9ef212913e6b7209b",
 "head":{"sha":"543da7c8d787…","subject":"Replace the 2.1 hair shell with scalp-rooted volumetric locks","author":"Codebuff"},
 "dirty":31,"branches":3,"ahead":0,"behind":0},
 "github":{"reachable":true,"heads":75}}
```

* `github.heads: 75` is the count of `refs/heads/*` returned by `git ls-remote --heads origin` — a live
  round trip to GitHub, not a stored value.
* The branch map reported to the interface: the canonical branch, `freebuff-base`, and the laboratory's own
  `lelu-lab/exp-engineer-ops`. Remote-only branches (the `claude/*` lines) are in `sync.remoteHeads`.
* Last successful inspection is persisted in `.lelu-lab/state/sync.json`
  (`2026-11-26T05:28:28Z`, `ok: true`, `commit 543da7c8d787`, 75 heads).
* Inaccessibility is a reported fact: a failed `git ls-remote` writes `ok: false` **and the git error** into
  the same record, and the header shows `GITHUB UNREACHABLE`.

**No token is used or needed.** Reads go through the local clone and `ls-remote`; the laboratory never reads
`GITHUB_TOKEN` and has no push.

---

## 3. WP02 — Autonomous daily discovery

`POST /api/lab/inspect` runs seven checks against the real tree. Every finding carries verbatim evidence.

1. **new commits** since the recorded inspection (`git log <last>..HEAD`)
2. **uncommitted work** (`git status --porcelain`) — work that exists on disk but in no commit
3. **capability claims whose implementation is gone** — parses `CAPABILITY_EVIDENCE` from
   `src/core/selfdev/CapabilityEvidence.ts` and checks each declared source path exists
4. **capability claims with no verifying test**
5. **validation commands that cannot run on this host** — `command -v` for each whitelisted binary, plus the
   `bun …` strings declared in `plugins/engineerApi.ts`
6. **duplicated functionality** — modules declaring the same exported symbol
7. **unfinished markers and large modules**

Findings are fingerprinted (`sha1` of the sorted finding ids + repository + branch). A repeat inspection
returns `status: "already-known"` instead of proposing the same work again — demonstrated below
(`disc-mwx3toj2-533ca5` → `already-known`).

Persistent history: `.lelu-lab/state/discoveries.json` (Discovery ID, time, repository, branch, commit,
inspected files, findings, research, recommended action, priority, status, fingerprint).

**Scheduling.** Discovery is independent of any approved task — it is one call and one button, and it writes
its own history. It is not yet wired into a cron: this runtime has no scheduler process, and inventing a
"daily" timer that only fires while a browser tab is open would be a false claim. That remains open (see §9).

---

## 4. WP03 / WP06 — The sandbox is a real clone, and it is isolated

`POST /api/lab/experiment {action:"create"}`:

1. `git worktree add --detach .lelu-lab/experiments/<id> HEAD`
2. overlays the canonical **uncommitted** work, so the copy starts from what is actually running
3. commits a **baseline** on its own branch — `b56f21e LÉLU lab baseline: 543da7c + 24 uncommitted path(s)`
4. `git checkout -B lelu-lab/<id>`
5. symlinks `node_modules` (real dependencies, no 1.1 GB copy per experiment)

The baseline commit exists because the first run proved the alternative was useless: without it a one-line
edit produced a **25-file diff**, which is the opposite of transparency.

Measured: the copy is 955 MB, created in **2.4 s**, holds 4,355 tracked files, and its own `git log` starts at
the baseline. Canons: `git status` in the canonical tree never showed the experiment's change.

The experiment can be read, edited, diffed, typechecked, built, tested, previewed, screenshotted and
committed. Multiple experiments are supported; each has its own branch and directory.

---

## 5. WP12 — One genuine improvement, end to end

### The opportunity (found by discovery, not by a prompt)

`disc-mwx2o1ty-533ca5`, priority **100/100**, `severity: high`, finding `broken-validation`:

```
plugins/engineerApi.ts ENGINEER_OPERATIONS typecheck → bun tsc -b --noEmit — "bun" is not installed, so the operation exits 127
plugins/engineerApi.ts ENGINEER_OPERATIONS build     → bun run build            — "bun" is not installed, so the operation exits 127
```

Confirmed independently at the shell: `bash: line 1: bun: command not found | exit 127`.

This is the one class of defect that makes *verification itself* unreliable: the checks that decide whether
an improvement is verified could never pass, and LÉLU would read that as "the change failed".

### The change

Experiment `exp-engineer-ops` on `lelu-lab/exp-engineer-ops`, one file, **+15 −4**:

```diff
-  typecheck: "bun tsc -b --noEmit",
-  build: "bun run build",
+  typecheck: "npx tsc -b --force",
+  build: "npm run build",
-  inspect: "node --version && bun --version && pwd",
+  inspect: "node --version && npx tsc --version && pwd",
```

`tsc -b` also rejects `--noEmit`; `--force` is the correct build-mode flag for an unconditional check.

### Verification

* Before (in the experiment, inherited command): `bun tsc -b --noEmit` → `command not found`, exit **127**.
* After (through the laboratory, cwd = the experiment): `npx tsc -b --force` → exit **0** in **32 s**,
  no output. Reproduced twice (32 s, 34 s).
* The first attempt **failed** with `TS6133` on three unused locals in `plugins/labApi.ts` — the laboratory
  caught a defect in itself, which is the point of it. Fixed, re-baselined, re-run, clean.
* Committed on the experiment branch: `374284a Make the whitelisted validation commands executable on a Node runtime`
  (`1 file changed, 15 insertions(+), 4 deletions(-)`). Not pushed.

### Result measured by the same instrument

| | before the change | after |
| --- | --- | --- |
| discovery | `disc-mwx2o1ty-533ca5` | `disc-mwx43gw3-39f934` |
| priority | **100 / 100** | **82 / 100** |
| `broken-validation` finding | present (2 commands) | **absent** |
| recommended action | "Investigate 2 validation command(s) that cannot execute…" | "Close the verification gap: 1 capability claim names no verifying test" |

The fix was then applied to the canonical working tree (uncommitted, same three lines) so the repository —
not only the copy — carries the verified change.

---

## 6. WP04 / WP05 — The seven views, and what each one proves

Inside **Self Development → Laboratory**:

| View | Real source of what it shows |
| --- | --- |
| **Repository** | `git` branch/head/ahead-behind, `git log --name-only`, live directory listing, server-side text search with line numbers |
| **Editor** | the *experiment's* file, saved back into the experiment; a highlighted read-only view of canonical source; "Where did this come from?" → `git log --follow`, origin commit, contributors, containing branches |
| **Diff** | `git diff` in the experiment against its own baseline, per file, with `+`/`−` colouring and the commit that explains it |
| **Timeline** | `.lelu-lab/state/journal.jsonl`: sync → discovery → branch → implementation → testing → commit → preview → evidence |
| **Research** | the discovery's findings with their verbatim evidence, the files it inspected, and its recorded conclusion |
| **Preview** | the experiment served on its own port, in 1440×900 / 390×844 / 844×390, plus the captured evidence gallery |
| **Verification** | the four whitelisted commands run with the experiment as cwd, exit code, duration, output; commit control |

Nothing in these views is generated prose: each panel shows what the server returned, including refusals.
The commit control states plainly that pushing, merging and deploying are not implemented.

---

## 7. WP07 — Genealogy

`POST /api/lab/genealogy {path}` answers, from git itself: the origin commit (author, date, subject) via
`git log --follow`, the last change, the contributor counts, and which branches contain the file. It is
surfaced in the Editor view. It is not a second journal — the laboratory journal is `.lelu-lab/state/journal.jsonl`
for engineering events, and mission/improvement history remains `DevelopmentJournal`, unchanged.

---

## 8. WP10 — Permission boundary and security audit

**The laboratory can:** inspect the repository, read files, search, create isolated worktrees and branches
inside `.lelu-lab/`, write inside those worktrees, run four fixed commands with the experiment as cwd, start
and stop a preview process on a chosen port, write its own journal.

**It cannot** — the capability does not exist in the code, and `tests/self-development-lab.test.ts` asserts it:

* no `git push`, `merge`, `rebase`, `reset`, `cherry-pick`, `update-ref` appears anywhere in `plugins/labApi.ts`;
* git is invoked only through `execFile` with a fixed argv array — the shell form is not imported, so no
  caller string can reach a command line;
* the only destructive git call is `git branch -D`, guarded by `branch.startsWith("lelu-lab/")`, so a
  canonical branch cannot be named;
* writes require a workspace id and are path-checked against the experiment root;
* reads are bounded (`SAFE_RELATIVE`, no `..`, no absolute paths) and exclude `.git`, `node_modules`,
  `.lelu-lab`;
* **no secret is read**: the module never touches `process.env` for credentials. The one env read is
  `LELU_LAB_ALLOWED_ORIGINS`, an origin allowlist. The remote URL is sanitised (`https://user:token@host` →
  `https://host`) before it is returned, so a credential in `.git/config` cannot be displayed;
* **CSRF**: every mutating route requires the session token issued by `GET /api/lab/status` on the same
  origin, and cross-origin requests are refused. Behind the preview proxy the browser's `Origin` differs from
  `Host`, which produced a real false negative — *"Cross-origin laboratory requests are not permitted"* while
  the laboratory was working. The fix is an explicit allowlist (`LELU_LAB_ALLOWED_ORIGINS`), never a disable:
  verified that an allowlisted `Origin` is served and `https://evil.example` is still refused 403.

Committing happens **only** on the experiment branch, with an explicit message; the canonical branch, the
canonical working tree and the remote are unreachable from that action.

---

## 9. Limitations — what is not done, stated plainly

1. **No scheduler.** Discovery is on demand. A real daily cycle needs a process that survives a closed tab;
   this work did not add one, and did not fake one.
2. **No chat-native laboratory tools.** The laboratory is a view *inside* the existing Chat Universe
   Self-Development window and its API is callable, but dedicated tool schemas so that a chat turn can call
   `show me the diff` directly were not added. WP09 is therefore partially met.
3. **Headless screenshots are unavailable on this host.** `playwright` is installed but Chromium cannot launch
   (missing system libraries), so `POST /api/lab/experiment {action:"screenshot"}` returns the real error and
   the preview URL instead of an image. The screenshots in `docs/missions/evidence/mission-43/` were captured
   by the operator through the cloud browser. On a host with the libraries, the same call captures them.
4. **The companion and the navigation paint over the window.** Both are deliberate product decisions
   (`LeluCompanion` sits at `panel+45` so she stays seen; navigation sits above panels so a panel can never
   cover the way out). The laboratory accommodates them with margins; on a wide screen she still covers part
   of the right-hand column.
5. **A discovery is not a repair.** Only one finding was acted on. The other five (`unverified-capability`,
   duplicate modules, large modules, uncommitted work, unfinished markers) are reported and unaddressed.
6. Convex was not touched; nothing was deployed.

---

## 10. Evidence index

Screenshots (`docs/missions/evidence/mission-43/`):

| File | Shows |
| --- | --- |
| `00-app-current.png` | the running application at the start (Mission 41 orbital navigation intact) |
| `01-selfdev-panel.png` | the Self-Development window with the new **Laboratory** tab |
| `02-laboratory-repository.png` | real branch, head, author, ahead/behind, 75 remote heads, directory tree, 12 commits |
| `03-research-discovery.png` | discovery run from the UI: priority 100/100, `already-known` dedupe, findings with evidence |
| `04-verification.png` | experiment branch + baseline, and a **PASSED** typecheck, exit 0, 32 s |

Reproduce:

```bash
npx vite --host 0.0.0.0 --strictPort --port 3001     # the laboratory is a middleware on this server
curl -s localhost:3001/api/lab/status                 # repository authority + session token
curl -s -XPOST -H 'x-lelu-lab: <token>' localhost:3001/api/lab/sync
curl -s -XPOST -H 'x-lelu-lab: <token>' localhost:3001/api/lab/inspect
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test --test-concurrency=1 tests/self-development-lab.test.ts
```

---

## 11. Defects this mission found in its own work

Each was found by running the thing, not by reading it:

1. **A one-line edit produced a 25-file diff.** The experiment copied the canonical *uncommitted* tree
   without a baseline, so everything already in progress appeared as the experiment's change. Fixed with a
   baseline commit on the experiment branch.
2. **Baseline commits failed silently.** This host has no git identity, so `git commit` exited non-zero and the
   baseline was never created — which looked exactly like (1). The laboratory now passes the identity per
   invocation and refuses to continue if the baseline commit fails.
3. **The typecheck reported three `TS6133` errors in `plugins/labApi.ts`** — my own unused locals. The
   laboratory caught its author. Fixed, re-baselined, exit 0.
4. **The workspace re-rendered forever.** An effect depended on the whole `experiment` object while its refresh
   created a new object each run; the page starved and the checks it was meant to show never appeared. Keyed on
   the experiment's id instead. This is what made the tab unstable, not the 3D scene.
5. **Every repository read was refused behind the preview proxy** (`Origin` ≠ `Host`), and the workspace said so
   instead of pretending to have data. Fixed with an explicit origin allowlist that still refuses
   `https://evil.example` with 403.
6. **The diff vanished once the change was committed** — it compared the working tree to `HEAD`, so a committed
   change showed as "0 file(s) changed". Now compared against the experiment's baseline, where committed and
   uncommitted work both appear.
7. **The commit precondition used that same baseline diff**, so it would have allowed committing already-committed
   work. It now checks the working tree against `HEAD`.

## 12. Exact repository state

```
branch   freebuff/08af6cc9ef212913e6b7209b
head     543da7c  (unchanged by this mission — nothing was committed on the canonical branch)
dirty    31 paths, including this mission's new files
branches freebuff-base, freebuff/08af6…, lelu-lab/exp-engineer-ops
remotes  75 heads, reachable

experiment lelu-lab/exp-engineer-ops
  b56f21e  LÉLU lab baseline: 543da7c + 24 uncommitted path(s)
  374284a  Make the whitelisted validation commands executable on a Node runtime
           plugins/engineerApi.ts | 19 +++++++++++++++----  (1 file, +15 −4)
```

New files: `plugins/labApi.ts`, `src/core/selfdev/lab/LabClient.ts`,
`src/app/scene/genesis/GenesisSelfDevelopmentLab.tsx`, `tests/self-development-lab.test.ts`, this document.
Modified: `plugins/engineerApi.ts` (the verified fix), `src/app/scene/genesis/GenesisSelfDevPanel.tsx`
(tab), `vite.config.ts`, `server.ts`, `.gitignore`.
