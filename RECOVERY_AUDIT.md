# LÉLU V1.1 — repository recovery audit (Phase 1)

Date: 2026-11-04. Read-only inspection, done before any code change in this mission.

## 1. Source of truth

| Item | Finding |
|---|---|
| Repository | `github.com/lapheezy/leluv1.1` (the only repo this session can reach; `LeluV1.1` is the same repo, GitHub names are case-insensitive) |
| Default branch | `main` @ `44bdd93` (2026-10-08) — far behind; not the working line |
| Latest implementation line | `claude/avatar-3d-world` @ `c2b9f88` (2026-11-01), in sync with GitHub, clean working tree. It contains every earlier session branch merged: `claude/lelu-continuous-cognition-92p3jy`, `claude/cosmos-chat-experience-z6xja0`, `claude/open-session-rbwmdw` (through `e7b667b`) |
| Main checkout | `/home/user/leluv1.1` on `claude/lelu-continuous-cognition-92p3jy` @ `e073b93` (older; untouched) |
| Worktrees | main checkout + `.claude/worktrees/avatar-3d-world` (this work) |
| Stashes | none |
| Local-only branch | `checkpoint/before-open-session-merge` @ `a718645` (safety checkpoint, never pushed) |
| Open PRs | refs 1–7 exist; newest (#7 `a985f22`, #6 `b1b1d22`) date from 2026-10-29 and are already contained in the line above |

### Freebuff / Codebuff work actually present

| Reference from the brief | Status |
|---|---|
| `freebuff/b51087fe6b0da1c0c7866b8b` | **Present** on GitHub. ONE commit, `ab34483` (Codebuff, 2026-11-02): "Read the platform's secret names, so the Supabase key stops arriving under a name nothing reads" — adds `plugins/bareSecretAliases.ts`, hooks it in `plugins/loadEnvFiles.ts`, `server.ts`, `main.ts`, `vite.config.ts`, plus `tests/bare-secret-aliases.test.ts`. Its base is `e7b667b` (Oct 30), so it predates — and does not contain — the 55 later commits on `claude/avatar-3d-world`. |
| `e7b667b` checkpoint | Present; already merged into `claude/avatar-3d-world` (merge `191ec3a`). |
| `freebuff/3f-integrated` | **Not in this repository** (no such ref on GitHub). |
| `05e27cbc46e181650a662e0f09b889c1849b51a6` | **Not in this repository** (object unknown after a full fetch). |
| Sessions 3A / 3B / 3C | No branch, commit, tag or report with these names exists in this repository. |

**Access limitation (exact):** any Freebuff sessions beyond `ab34483` — including
`freebuff/3f-integrated` and `05e27cbc` — were never pushed to `lapheezy/leluv1.1`. They can only be
on the machine where Freebuff ran, or in another repository. I cannot inspect them, and nothing in this
report claims to. If you push them (or name the repository), they can be audited and merged.

The deployed app (`app.leluverse.ai`, from the reference screenshot) is not reachable from this
environment (proxy CONNECT 502), so the deployed version is **NOT VERIFIED**.

## 2. Baseline of the working line (`c2b9f88`)

- Type check (`tsc -b`): **PASS**, 0 errors.
- Production build (`vite build`): **PASS**.
- Tests: 105 files; per-file run recorded separately in the acceptance report.

## 3. Subsystem inventory

Legend: ✅ complete & functioning · 🔌 implemented but disconnected · 🟡 partial · ❌ broken ·
♊ duplicated · 🪦 abandoned · ⬜ missing.

| Subsystem | Status | Where | Notes |
|---|---|---|---|
| Cosmos environment (v1 scene) | ✅ | `GenesisScene.tsx`, `environment/*`, `cosmos/*` | Renders; render budget + frame governor (`SceneRenderBudget.ts`, `SceneFrameGovernor.tsx`) |
| Genesis V2 world | ✅ | `GenesisV2Scene3D.tsx`, `LeluV2Presence.tsx` | Her 3D body lives there |
| Module window manager | ✅ | `GenesisModuleHost.tsx`, GenesisCore `modules` (move/resize/raise/minimize/expand/close, cascade, persisted) | Tool panels |
| Artifact workspace engine | ✅ ♊ (partial overlap) | `core/workspace/WorkspaceEngine.ts` (open/focus/minimize/maximize/split/stack/pin/snapshots), `LivingSystemUI.tsx` | A second window model for artifact views; overlaps the module host in "windows", but they hold different content. Not merged in this mission (risk), surfaced together on the home instead. |
| Navigation | ❌ (regression) | `GenesisDock.tsx` (left desktop rail), `GenesisMobileMenu.tsx` (30-row vertical list on phones) | Exactly the sidebar / vertical-list pattern the brief rejects. No spatial home exists. |
| Chat | ✅ | `GenesisChat.tsx`, `chat/*` (cloud chat), `MultiChatTabs.tsx` | Streaming, tabs, tool activity cards, markdown, attachments, voice. Phone: full-screen by default; floating supported |
| Chat ↔ Cosmos coexistence | 🟡 | `surface/Surface.ts` | On phones the chat takes the whole screen (Cosmos hidden). Desktop: floating window over Cosmos |
| Cognition / orchestration | ✅ | `core/cognition/*`, `core/orchestrator/*`, `AIService.ts`, `AIRouter.ts` | |
| DailyReflection | ✅ (finding resolved) | `core/agentic/DailyReflection.ts`, started in `Bootstrap.ts:198` | The earlier "implemented but not invoked" finding no longer holds on this line |
| Personality development | ✅ | `core/identity/*`, `tests/personality-development.test.ts` | |
| Memory | ✅ | `core/memory/*`, `MemoryBridge.ts`, Supabase persistence | Cloud write needs owner sign-in |
| Agent hierarchy (LÉLU → Shaman → Executive Board → galaxies → agents) | ✅ | `core/agents/Shaman.ts`, `ExecutiveOwnership.ts`, `executive/ExecutiveBoard.ts`, `AgentRunner.ts` | Galaxy mapping in `ExecutiveOwnership.ts` |
| Tasks: pause/resume/checkpoints | ✅ | `core/agentic/TaskExecutor.ts` (`recoverInterrupted` at boot), `tests/question-resume.test.ts` | |
| Approval gate | ✅ | `core/agentic/ApprovalGate.ts`, used by `ToolDispatcher.ts` | |
| Tool dispatch | ✅ | `core/tools/ToolDispatcher.ts`, `ToolRegistry.ts` | |
| Asset ledger | 🟡 | Forge ledger (`generation_logs/jobs.json`), `WorkspaceArtifacts.ts`, `ProjectStore` items | No single cross-app asset ledger; Files = projects' items |
| Browser | ✅ | `GenesisBrowserPanel.tsx`, `core/browser/*` | |
| Studio | ✅ | `GenesisVisualStudio.tsx` (sketch / render / avatar) | |
| Projects / files | ✅ | `GenesisProjectsPanel.tsx`, `core/projects/*` | |
| Notifications | ✅ | `core/notifications/NotificationProvider.ts`, `GenesisNotificationCenter.tsx`, chats panel | Routed out of the chat on phones |
| Avatar | ✅ | `avatar/LeluBody.tsx`, `LeluCompanion.tsx`, `LeluCharacter3D.tsx`, `core/avatar/*` | Face controls, 31 animations, sofa, walk-off |
| Voice | ✅ (headless-verified only) | `core/voice/*` | Whisper fallback, audio-thread turn detection; TTS = device speechSynthesis (no natural-voice provider key) |
| Supabase | 🟡 | `core/persistence/SupabasePersistence.ts`, `core/config/supabaseEnv.ts` | Works with documented names; platform-named secrets fixed only on the Freebuff branch (`ab34483`) — to recover |
| AI provider registry | ✅ | `AIProviderRegistry.ts`, model broker | Anthropic credit balance was the last known blocker |
| Weather data | ✅ (unused in UI) | `providers/OpenMeteoProvider.ts` | Keyless; available for a home card |
| Music / media player | ⬜ | — | Nothing plays music; the reference's "Muse" card would be fake. A real "Now" card replaces it |
| Cinematic transitions | 🟡 | framer-motion in chat/notifications; module windows animate | No origin-based open/close between home surfaces |

## 4. What Freebuff claimed vs. what is here

Only `ab34483` is inspectable. Its claim (platform secret names mapped onto documented names) matches
its diff and its test. Everything else attributed to Freebuff in the brief is not in this repository and
is therefore unverified, not "broken".

## 5. Plan (dependency order)

1. Recover `ab34483` (bare secret aliases) onto the working line, as working-tree changes.
2. Cosmos home (the reference composition) as a layer over the live Cosmos, built only from existing
   runtime: header (identity, cloud status, notifications, cosmos), real weather, her 3D presence, a
   real "Now" card, primary apps (Chat, Browser, Studio, Workspaces, Agents, Files), active workspaces
   (open module windows + workspace views), notifications, app library (all registered panels,
   grouped), live activity surface, spatial bottom navigation with the central Cosmos orb.
   It replaces the phone's vertical list and the desktop rail as the primary navigation; every panel stays
   reachable (library, ⌘K).
3. Chat as a floating, expandable layer over that home on phones (not a full-screen takeover by default),
   keyboard-safe; opening/closing animates from the launching element.
4. Origin-based transitions for app launches; reduced-motion respected.
5. Acceptance: build, type check, tests, and mobile + desktop runs with screenshots compared to the
   reference.
